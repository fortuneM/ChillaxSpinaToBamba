import crypto from 'node:crypto';
import { db, logAudit } from './db.js';
import QRCode from 'qrcode';

// Valid state transitions defined by specification Page 8
export const ALLOWED_TRANSITIONS = {
  IDLE: ['REGISTRATION_OPEN'],
  REGISTRATION_OPEN: ['REGISTRATION_CLOSED', 'CANCELLED'],
  REGISTRATION_CLOSED: ['SPINNING', 'CANCELLED', 'REGISTRATION_OPEN'],
  SPINNING: ['RESULT', 'CANCELLED'],
  RESULT: ['REGISTRATION_OPEN', 'ENDED', 'IDLE'],
  CANCELLED: ['IDLE', 'REGISTRATION_OPEN', 'ENDED'],
  ENDED: []
};

// Generate a random 5-character uppercase alphanumeric short code (avoiding confusing chars like 0/O, 1/I)
export function generateShortCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars[crypto.randomInt(0, chars.length)];
  }
  return code;
}

// Generate a 4-digit pairing code for Android TV
export function generatePairingCode() {
  return String(crypto.randomInt(1000, 9999));
}

export class GameEngine {
  constructor(io) {
    this.io = io;
    this.failedPinAttempts = new Map(); // ip -> { count, lockedUntil }
  }

  // Rate-limiting helper for host PIN attempts
  verifyHostPin(ip, inputPin, hostPin = '1234') {
    const now = Date.now();
    const attempts = this.failedPinAttempts.get(ip) || { count: 0, lockedUntil: 0 };

    if (attempts.lockedUntil > now) {
      const waitSeconds = Math.ceil((attempts.lockedUntil - now) / 1000);
      return { success: false, error: `Too many failed attempts. Try again in ${waitSeconds}s.` };
    }

    if (inputPin !== hostPin) {
      attempts.count += 1;
      if (attempts.count >= 5) {
        attempts.lockedUntil = now + 60000; // 1 minute lockout
      }
      this.failedPinAttempts.set(ip, attempts);
      return { success: false, error: 'Invalid Host PIN.' };
    }

    this.failedPinAttempts.delete(ip);
    return { success: true };
  }

  // Helper to retrieve full authoritative session snapshot
  getSessionSnapshot(sessionId) {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return null;

    // Get current active or latest round
    const currentRound = db.prepare(`
      SELECT * FROM rounds 
      WHERE session_id = ? 
      ORDER BY round_number DESC 
      LIMIT 1
    `).get(sessionId);

    let entries = [];
    let prize = null;

    if (currentRound) {
      entries = db.prepare(`
        SELECT id, number, player_token, nickname, claimed_at, status 
        FROM entries 
        WHERE round_id = ? AND status = 'ACTIVE'
        ORDER BY number ASC
      `).all(currentRound.id);

      if (currentRound.prize_id) {
        prize = db.prepare('SELECT * FROM prizes WHERE id = ?').get(currentRound.prize_id);
      }
    }

    const claimedNumbers = entries.map(e => e.number);

    return {
      sessionId: session.id,
      shortCode: session.short_code,
      status: currentRound ? currentRound.status : session.status,
      numberRange: {
        min: session.number_min,
        max: session.number_max
      },
      playerCount: entries.length,
      claimedNumbers,
      entries,
      currentRound: currentRound ? {
        id: currentRound.id,
        roundNumber: currentRound.round_number,
        status: currentRound.status,
        winningNumber: currentRound.winning_number,
        winningEntryId: currentRound.winning_entry_id,
        prize: prize || (currentRound.prize_snapshot_json ? JSON.parse(currentRound.prize_snapshot_json) : null),
        startedAt: currentRound.started_at,
        resultAt: currentRound.result_at,
        cancelledAt: currentRound.cancelled_at,
        cancelReason: currentRound.cancel_reason
      } : null,
      tvConnected: Boolean(session.tv_connected),
      tvPairingCode: session.tv_pairing_code
    };
  }

  // Broadcast authoritative session state to all room subscribers
  broadcastSessionState(sessionId) {
    const snapshot = this.getSessionSnapshot(sessionId);
    if (snapshot) {
      this.io.to(sessionId).emit('session:state', snapshot);
    }
    return snapshot;
  }

  // Create a new session with initial round
  async createSession({ numberMin = 1, numberMax = 20, hostPin = '1234', defaultPrizeId = null }) {
    let shortCode = generateShortCode();
    // Ensure unique short code
    while (db.prepare('SELECT id FROM sessions WHERE short_code = ?').get(shortCode)) {
      shortCode = generateShortCode();
    }

    const sessionId = 'sess_' + crypto.randomBytes(6).toString('hex');
    const pairingCode = generatePairingCode();
    const createdAt = new Date().toISOString();

    db.prepare(`
      INSERT INTO sessions (id, short_code, status, number_min, number_max, created_at, host_pin, tv_pairing_code)
      VALUES (?, ?, 'REGISTRATION_OPEN', ?, ?, ?, ?, ?)
    `).run(sessionId, shortCode, numberMin, numberMax, createdAt, hostPin, pairingCode);

    // Pick a default prize if none provided
    let prizeId = defaultPrizeId;
    if (!prizeId) {
      const firstPrize = db.prepare('SELECT id FROM prizes WHERE enabled = 1 LIMIT 1').get();
      prizeId = firstPrize ? firstPrize.id : null;
    }

    const prizeObj = prizeId ? db.prepare('SELECT * FROM prizes WHERE id = ?').get(prizeId) : null;

    // Create Round 1
    const roundId = 'rnd_' + crypto.randomBytes(6).toString('hex');
    db.prepare(`
      INSERT INTO rounds (id, session_id, round_number, status, prize_id, prize_snapshot_json, started_at)
      VALUES (?, ?, 1, 'REGISTRATION_OPEN', ?, ?, ?)
    `).run(roundId, sessionId, prizeId, prizeObj ? JSON.stringify(prizeObj) : null, createdAt);

    logAudit(sessionId, 'HOST', 'host_default', 'SESSION_CREATED', { shortCode, numberMin, numberMax });

    // Generate QR code data URL for easy mobile scanning
    const joinUrl = `/join?code=${shortCode}`;
    const qrCodeDataUrl = await QRCode.toDataURL(joinUrl, {
      margin: 1,
      color: {
        dark: '#00f2fe',
        light: '#070d1e'
      }
    });

    return {
      sessionId,
      shortCode,
      tvPairingCode: pairingCode,
      qrCodeDataUrl,
      joinUrl,
      snapshot: this.getSessionSnapshot(sessionId)
    };
  }

  // Pair TV to session using 4-digit pairing code or direct short code
  pairTv(pairingCodeOrShortCode) {
    const code = String(pairingCodeOrShortCode).trim().toUpperCase();
    let session = db.prepare('SELECT * FROM sessions WHERE tv_pairing_code = ? OR short_code = ?').get(code, code);

    if (!session) {
      return { success: false, error: 'Session or pairing code not found.' };
    }

    db.prepare('UPDATE sessions SET tv_connected = 1 WHERE id = ?').run(session.id);
    logAudit(session.id, 'TV', 'tv_display', 'TV_PAIRED', { code });

    this.broadcastSessionState(session.id);
    return { success: true, sessionId: session.id, shortCode: session.short_code };
  }

  // Claim a number atomically for a round
  claimNumber(sessionId, { number, playerToken, nickname }) {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) {
      return { success: false, status: 404, error: 'Session not found.' };
    }

    const currentRound = db.prepare(`
      SELECT * FROM rounds WHERE session_id = ? ORDER BY round_number DESC LIMIT 1
    `).get(sessionId);

    if (!currentRound) {
      return { success: false, status: 400, error: 'No active round found.' };
    }

    if (currentRound.status !== 'REGISTRATION_OPEN') {
      return { success: false, status: 409, error: 'Registration is closed for this round.' };
    }

    const num = parseInt(number, 10);
    if (isNaN(num) || num < session.number_min || num > session.number_max) {
      return { success: false, status: 400, error: `Number must be between ${session.number_min} and ${session.number_max}.` };
    }

    const cleanNickname = String(nickname || 'Player').trim().slice(0, 18).replace(/[<>]/g, '');

    // Execute atomic claim in SQLite
    try {
      // Check if player already claimed a number in this round
      const existingPlayerEntry = db.prepare(`
        SELECT number FROM entries 
        WHERE round_id = ? AND player_token = ? AND status = 'ACTIVE'
      `).get(currentRound.id, playerToken);

      if (existingPlayerEntry) {
        if (existingPlayerEntry.number === num) {
          // Already owns this number
          return { success: true, message: 'You already claimed this number.' };
        }
        // Change player's number: delete previous claim and insert new claim atomically
        db.exec('BEGIN TRANSACTION;');
        try {
          db.prepare(`
            DELETE FROM entries WHERE round_id = ? AND player_token = ?
          `).run(currentRound.id, playerToken);

          const entryId = 'ent_' + crypto.randomBytes(6).toString('hex');
          db.prepare(`
            INSERT INTO entries (id, session_id, round_id, number, player_token, nickname, claimed_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
          `).run(entryId, sessionId, currentRound.id, num, playerToken, cleanNickname, new Date().toISOString());

          db.exec('COMMIT;');
        } catch (txErr) {
          db.exec('ROLLBACK;');
          throw txErr;
        }
      } else {
        // Fresh claim
        const entryId = 'ent_' + crypto.randomBytes(6).toString('hex');
        db.prepare(`
          INSERT INTO entries (id, session_id, round_id, number, player_token, nickname, claimed_at, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
        `).run(entryId, sessionId, currentRound.id, num, playerToken, cleanNickname, new Date().toISOString());
      }

      logAudit(sessionId, 'PLAYER', playerToken, 'NUMBER_CLAIMED', { number: num, nickname: cleanNickname });

      // Broadcast update
      this.io.to(sessionId).emit('entry:claimed', {
        number: num,
        nickname: cleanNickname,
        playerToken
      });
      this.broadcastSessionState(sessionId);

      return { success: true, number: num, nickname: cleanNickname };
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        return { success: false, status: 409, error: `Number #${num} was just claimed by someone else!` };
      }
      return { success: false, status: 500, error: 'Database claim error: ' + err.message };
    }
  }

  // Close registration (lock entries)
  closeRegistration(sessionId) {
    const currentRound = db.prepare(`
      SELECT * FROM rounds WHERE session_id = ? ORDER BY round_number DESC LIMIT 1
    `).get(sessionId);

    if (!currentRound) return { success: false, error: 'Round not found.' };

    if (currentRound.status !== 'REGISTRATION_OPEN') {
      return { success: false, error: `Cannot close registration when state is ${currentRound.status}.` };
    }

    db.prepare(`UPDATE rounds SET status = 'REGISTRATION_CLOSED' WHERE id = ?`).run(currentRound.id);
    db.prepare(`UPDATE sessions SET status = 'REGISTRATION_CLOSED' WHERE id = ?`).run(sessionId);

    logAudit(sessionId, 'HOST', 'host', 'REGISTRATION_CLOSED', { roundId: currentRound.id });

    this.io.to(sessionId).emit('registration:closed', { roundId: currentRound.id });
    this.broadcastSessionState(sessionId);

    return { success: true };
  }

  // Re-open registration if needed before spinning
  reopenRegistration(sessionId) {
    const currentRound = db.prepare(`
      SELECT * FROM rounds WHERE session_id = ? ORDER BY round_number DESC LIMIT 1
    `).get(sessionId);

    if (!currentRound) return { success: false, error: 'Round not found.' };

    if (currentRound.status !== 'REGISTRATION_CLOSED') {
      return { success: false, error: 'Registration is not closed.' };
    }

    db.prepare(`UPDATE rounds SET status = 'REGISTRATION_OPEN' WHERE id = ?`).run(currentRound.id);
    db.prepare(`UPDATE sessions SET status = 'REGISTRATION_OPEN' WHERE id = ?`).run(sessionId);

    logAudit(sessionId, 'HOST', 'host', 'REGISTRATION_REOPENED', { roundId: currentRound.id });
    this.broadcastSessionState(sessionId);
    return { success: true };
  }

  // Spin wheel and select winner cryptographically
  spin(sessionId, { idempotencyKey = null } = {}) {
    const currentRound = db.prepare(`
      SELECT * FROM rounds WHERE session_id = ? ORDER BY round_number DESC LIMIT 1
    `).get(sessionId);

    if (!currentRound) return { success: false, status: 400, error: 'No round found.' };

    // Check idempotency first before status check
    if (idempotencyKey && currentRound.idempotency_key === idempotencyKey) {
      return {
        success: true,
        message: 'Duplicate spin request ignored (idempotent)',
        winningNumber: currentRound.winning_number
      };
    }

    if (currentRound.status !== 'REGISTRATION_CLOSED') {
      return {
        success: false,
        status: 409,
        error: `Cannot spin when status is ${currentRound.status}. Please close registration first.`
      };
    }

    // Get all claimed active entries
    const entries = db.prepare(`
      SELECT * FROM entries WHERE round_id = ? AND status = 'ACTIVE' ORDER BY number ASC
    `).all(currentRound.id);

    if (entries.length === 0) {
      return {
        success: false,
        status: 400,
        error: 'Cannot spin: No players have claimed a number in this round.'
      };
    }

    // Specification Page 5 & 13:
    // "Uniform random selection among claimed numbers. The player holding that number wins the prize attached to the round."
    // Select uniformly using crypto.randomInt
    const winningIndex = crypto.randomInt(0, entries.length);
    const winningEntry = entries[winningIndex];
    const winningNumber = winningEntry.number;
    const spinDurationMs = 6500; // 6.5s dramatic arcade spin

    const now = new Date().toISOString();

    // Persist result immediately before broadcasting (Page 8 data integrity rule)
    db.prepare(`
      UPDATE rounds 
      SET status = 'SPINNING', 
          winning_number = ?, 
          winning_entry_id = ?, 
          started_at = ?,
          idempotency_key = ?
      WHERE id = ?
    `).run(winningNumber, winningEntry.id, now, idempotencyKey || 'spin_' + Date.now(), currentRound.id);

    db.prepare(`UPDATE sessions SET status = 'SPINNING' WHERE id = ?`).run(sessionId);

    logAudit(sessionId, 'HOST', 'host', 'SPIN_STARTED', {
      roundId: currentRound.id,
      winningNumber,
      winningPlayer: winningEntry.nickname,
      idempotencyKey
    });

    // Broadcast spin:started event
    this.io.to(sessionId).emit('spin:started', {
      roundId: currentRound.id,
      winningNumber,
      spinDurationMs,
      eligibleNumbers: entries.map(e => e.number)
    });
    this.broadcastSessionState(sessionId);

    // Schedule authoritative transition to RESULT state when spin ends
    setTimeout(() => {
      const activeRound = db.prepare('SELECT * FROM rounds WHERE id = ?').get(currentRound.id);
      if (activeRound && activeRound.status === 'SPINNING') {
        const resultTime = new Date().toISOString();
        db.prepare(`UPDATE rounds SET status = 'RESULT', result_at = ? WHERE id = ?`).run(resultTime, currentRound.id);
        db.prepare(`UPDATE sessions SET status = 'RESULT' WHERE id = ?`).run(sessionId);

        // Fetch prize
        const prize = activeRound.prize_id 
          ? db.prepare('SELECT * FROM prizes WHERE id = ?').get(activeRound.prize_id)
          : (activeRound.prize_snapshot_json ? JSON.parse(activeRound.prize_snapshot_json) : null);

        logAudit(sessionId, 'SERVER', 'engine', 'SPIN_RESULT', {
          winningNumber,
          winningPlayer: winningEntry.nickname,
          winningToken: winningEntry.player_token
        });

        this.io.to(sessionId).emit('spin:result', {
          roundId: currentRound.id,
          winningNumber,
          winnerNickname: winningEntry.nickname,
          winnerToken: winningEntry.player_token,
          prize
        });
        this.broadcastSessionState(sessionId);
      }
    }, spinDurationMs);

    return {
      success: true,
      winningNumber,
      spinDurationMs,
      winningNickname: winningEntry.nickname
    };
  }

  // Create next round
  createNextRound(sessionId, { prizeId = null, numberMin = null, numberMax = null }) {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return { success: false, error: 'Session not found.' };

    const lastRound = db.prepare(`
      SELECT * FROM rounds WHERE session_id = ? ORDER BY round_number DESC LIMIT 1
    `).get(sessionId);

    const nextRoundNumber = lastRound ? lastRound.round_number + 1 : 1;
    const roundId = 'rnd_' + crypto.randomBytes(6).toString('hex');

    // Update session number range if host adjusted it
    if (numberMin !== null || numberMax !== null) {
      db.prepare(`
        UPDATE sessions SET number_min = COALESCE(?, number_min), number_max = COALESCE(?, number_max) WHERE id = ?
      `).run(numberMin, numberMax, sessionId);
    }

    let selectedPrizeId = prizeId || (lastRound ? lastRound.prize_id : null);
    if (!selectedPrizeId) {
      const firstPrize = db.prepare('SELECT id FROM prizes WHERE enabled = 1 LIMIT 1').get();
      selectedPrizeId = firstPrize ? firstPrize.id : null;
    }

    const prizeObj = selectedPrizeId ? db.prepare('SELECT * FROM prizes WHERE id = ?').get(selectedPrizeId) : null;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO rounds (id, session_id, round_number, status, prize_id, prize_snapshot_json, started_at)
      VALUES (?, ?, ?, 'REGISTRATION_OPEN', ?, ?, ?)
    `).run(roundId, sessionId, nextRoundNumber, selectedPrizeId, prizeObj ? JSON.stringify(prizeObj) : null, now);

    db.prepare(`UPDATE sessions SET status = 'REGISTRATION_OPEN' WHERE id = ?`).run(sessionId);

    logAudit(sessionId, 'HOST', 'host', 'ROUND_CREATED', { roundNumber: nextRoundNumber, prizeId: selectedPrizeId });

    this.broadcastSessionState(sessionId);
    return { success: true, roundNumber: nextRoundNumber, roundId };
  }

  // Cancel a round
  cancelRound(sessionId, roundId, reason = 'Host cancelled') {
    const round = db.prepare('SELECT * FROM rounds WHERE id = ? AND session_id = ?').get(roundId, sessionId);
    if (!round) return { success: false, error: 'Round not found.' };

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE rounds SET status = 'CANCELLED', cancelled_at = ?, cancel_reason = ? WHERE id = ?
    `).run(now, reason, roundId);

    db.prepare(`UPDATE sessions SET status = 'CANCELLED' WHERE id = ?`).run(sessionId);

    logAudit(sessionId, 'HOST', 'host', 'ROUND_CANCELLED', { roundId, reason });

    this.broadcastSessionState(sessionId);
    return { success: true };
  }

  // Mark prize redeemed
  redeemPrize(roundId, { notes = '', redeemedBy = 'Staff Host' }) {
    const round = db.prepare('SELECT * FROM rounds WHERE id = ?').get(roundId);
    if (!round) return { success: false, error: 'Round not found.' };

    if (!round.winning_entry_id) {
      return { success: false, error: 'Cannot redeem: No winner for this round.' };
    }

    // Check if already redeemed
    const existing = db.prepare('SELECT * FROM redemptions WHERE round_id = ?').get(roundId);
    if (existing) {
      return { success: false, status: 409, error: `Prize was already marked redeemed on ${existing.redeemed_at}.` };
    }

    const redemptionId = 'red_' + crypto.randomBytes(6).toString('hex');
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO redemptions (id, round_id, prize_id, redeemed_by, redeemed_at, status, notes)
      VALUES (?, ?, ?, ?, ?, 'REDEEMED', ?)
    `).run(redemptionId, roundId, round.prize_id || 'prize_default', redeemedBy, now, notes);

    logAudit(round.session_id, 'HOST', redeemedBy, 'PRIZE_REDEEMED', { roundId, notes });

    this.io.to(round.session_id).emit('prize:redeemed', {
      roundId,
      redeemedAt: now,
      redeemedBy,
      notes
    });

    this.broadcastSessionState(round.session_id);
    return { success: true, redemptionId, redeemedAt: now };
  }

  // Get session history
  getSessionHistory(sessionId) {
    const rounds = db.prepare(`
      SELECT r.*, 
             e.number as winner_number, e.nickname as winner_nickname,
             p.name as prize_name, p.value as prize_value,
             red.redeemed_at, red.redeemed_by
      FROM rounds r
      LEFT JOIN entries e ON r.winning_entry_id = e.id
      LEFT JOIN prizes p ON r.prize_id = p.id
      LEFT JOIN redemptions red ON r.id = red.round_id
      WHERE r.session_id = ?
      ORDER BY r.round_number DESC
    `).all(sessionId);

    const audits = db.prepare(`
      SELECT * FROM audit_events WHERE session_id = ? ORDER BY timestamp DESC LIMIT 50
    `).all(sessionId);

    return { rounds, audits };
  }
}
