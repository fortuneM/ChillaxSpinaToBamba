import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { syncRecordToMongo } from './mongo.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'chillax_spin.sqlite');
export const db = new DatabaseSync(dbPath);

// Initialize database tables & indices
db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    short_code TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'IDLE',
    number_min INTEGER NOT NULL DEFAULT 1,
    number_max INTEGER NOT NULL DEFAULT 20,
    created_at TEXT NOT NULL,
    host_id TEXT NOT NULL DEFAULT 'host_default',
    host_pin TEXT NOT NULL DEFAULT '1234',
    tv_connected INTEGER NOT NULL DEFAULT 0,
    tv_pairing_code TEXT,
    winner_mode TEXT NOT NULL DEFAULT 'TRUE_ODDS',
    has_double_zero INTEGER NOT NULL DEFAULT 1,
    wheel_numbers_json TEXT,
    settings_json TEXT NOT NULL DEFAULT '{}'
  );
`);

try {
  db.exec("ALTER TABLE sessions ADD COLUMN winner_mode TEXT DEFAULT 'TRUE_ODDS';");
} catch(e) {}

try {
  db.exec("ALTER TABLE sessions ADD COLUMN has_double_zero INTEGER NOT NULL DEFAULT 1;");
} catch(e) {}

try {
  db.exec("ALTER TABLE sessions ADD COLUMN wheel_numbers_json TEXT;");
} catch(e) {}

db.exec(`
  CREATE TABLE IF NOT EXISTS prizes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    prize_type TEXT NOT NULL DEFAULT 'standard',
    value TEXT,
    color TEXT DEFAULT '#06b6d4',
    enabled INTEGER NOT NULL DEFAULT 1,
    stock_count INTEGER DEFAULT 99
  );

  CREATE TABLE IF NOT EXISTS rounds (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    round_number INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'IDLE',
    prize_id TEXT,
    prize_snapshot_json TEXT,
    winning_number TEXT,
    winning_entry_id TEXT,
    applied_multiplier REAL DEFAULT 0,
    started_at TEXT,
    result_at TEXT,
    cancelled_at TEXT,
    cancel_reason TEXT,
    idempotency_key TEXT,
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY(prize_id) REFERENCES prizes(id)
  );

  CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    round_id TEXT NOT NULL,
    number TEXT NOT NULL,
    player_token TEXT NOT NULL,
    nickname TEXT NOT NULL,
    bet_amount REAL NOT NULL DEFAULT 0,
    payout_amount REAL NOT NULL DEFAULT 0,
    claimed_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY(round_id) REFERENCES rounds(id) ON DELETE CASCADE,
    CONSTRAINT unique_round_number UNIQUE(round_id, number),
    CONSTRAINT unique_round_player UNIQUE(round_id, player_token)
  );

  CREATE TABLE IF NOT EXISTS redemptions (
    id TEXT PRIMARY KEY,
    round_id TEXT NOT NULL UNIQUE,
    prize_id TEXT NOT NULL,
    redeemed_by TEXT NOT NULL,
    redeemed_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'REDEEMED',
    notes TEXT,
    FOREIGN KEY(round_id) REFERENCES rounds(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    actor_type TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}'
  );

  CREATE INDEX IF NOT EXISTS idx_entries_round ON entries(round_id);
  CREATE INDEX IF NOT EXISTS idx_rounds_session ON rounds(session_id);
  CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_events(session_id);
`);

// Safe migration of existing entries table from INTEGER number to TEXT number (supports '0' and '00')
try {
  const entriesInfo = db.prepare('PRAGMA table_info(entries)').all();
  const numCol = entriesInfo.find((c) => c.name === 'number');
  if (numCol && String(numCol.type).toUpperCase() === 'INTEGER') {
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec(`
      CREATE TABLE entries_migrated (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        round_id TEXT NOT NULL,
        number TEXT NOT NULL,
        player_token TEXT NOT NULL,
        nickname TEXT NOT NULL,
        bet_amount REAL NOT NULL DEFAULT 0,
        payout_amount REAL NOT NULL DEFAULT 0,
        claimed_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        FOREIGN KEY(round_id) REFERENCES rounds(id) ON DELETE CASCADE,
        CONSTRAINT unique_round_number UNIQUE(round_id, number),
        CONSTRAINT unique_round_player UNIQUE(round_id, player_token)
      );
      INSERT OR IGNORE INTO entries_migrated 
        SELECT id, session_id, round_id, CAST(number AS TEXT), player_token, nickname, bet_amount, payout_amount, claimed_at, status 
        FROM entries;
      DROP TABLE entries;
      ALTER TABLE entries_migrated RENAME TO entries;
      CREATE INDEX IF NOT EXISTS idx_entries_round ON entries(round_id);
    `);
    db.exec('PRAGMA foreign_keys = ON;');
  }
} catch (e) {
  console.warn('[DB Migration Warning] entries table migration:', e.message);
}

// Safe migration of rounds table winning_number from INTEGER to TEXT
try {
  const roundsInfo = db.prepare('PRAGMA table_info(rounds)').all();
  const winCol = roundsInfo.find((c) => c.name === 'winning_number');
  if (winCol && String(winCol.type).toUpperCase() === 'INTEGER') {
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec(`
      CREATE TABLE rounds_migrated (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        round_number INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'IDLE',
        prize_id TEXT,
        prize_snapshot_json TEXT,
        winning_number TEXT,
        winning_entry_id TEXT,
        applied_multiplier REAL DEFAULT 0,
        started_at TEXT,
        result_at TEXT,
        cancelled_at TEXT,
        cancel_reason TEXT,
        idempotency_key TEXT,
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        FOREIGN KEY(prize_id) REFERENCES prizes(id)
      );
      INSERT OR IGNORE INTO rounds_migrated 
        SELECT id, session_id, round_number, status, prize_id, prize_snapshot_json, CAST(winning_number AS TEXT), winning_entry_id, applied_multiplier, started_at, result_at, cancelled_at, cancel_reason, idempotency_key 
        FROM rounds;
      DROP TABLE rounds;
      ALTER TABLE rounds_migrated RENAME TO rounds;
      CREATE INDEX IF NOT EXISTS idx_rounds_session ON rounds(session_id);
    `);
    db.exec('PRAGMA foreign_keys = ON;');
  }
} catch (e) {
  console.warn('[DB Migration Warning] rounds table migration:', e.message);
}

try {
  db.exec('ALTER TABLE entries ADD COLUMN bet_amount REAL NOT NULL DEFAULT 0;');
} catch(e) {}

try {
  db.exec('ALTER TABLE entries ADD COLUMN payout_amount REAL NOT NULL DEFAULT 0;');
} catch(e) {}

try {
  db.exec('ALTER TABLE entries ADD COLUMN tx_id TEXT;');
} catch(e) {}

try {
  db.exec('ALTER TABLE entries ADD COLUMN age_verified INTEGER NOT NULL DEFAULT 1;');
} catch(e) {}

try {
  db.exec('ALTER TABLE rounds ADD COLUMN applied_multiplier REAL DEFAULT 0;');
} catch(e) {}

try {
  db.exec('ALTER TABLE rounds ADD COLUMN redemption_code TEXT;');
} catch(e) {}

try {
  db.exec('ALTER TABLE rounds ADD COLUMN prize_tier_label TEXT;');
} catch(e) {}

// Separate Ring-Fenced Cash Reserve Ledger (Section 3 & Section 8 of Launch Plan)
db.exec(`
  CREATE TABLE IF NOT EXISTS cash_reserve_ledger (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    round_id TEXT,
    entry_id TEXT,
    tx_id TEXT NOT NULL,
    entry_type TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    committed_delta REAL NOT NULL DEFAULT 0,
    paid_delta REAL NOT NULL DEFAULT 0,
    notes TEXT,
    actor_id TEXT DEFAULT 'system',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_reserve_ledger_session ON cash_reserve_ledger(session_id);

  CREATE TABLE IF NOT EXISTS daily_profit_reports (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    shop_code TEXT NOT NULL,
    trading_date TEXT NOT NULL,
    collected_amount REAL NOT NULL DEFAULT 0,
    prizes_amount REAL NOT NULL DEFAULT 0,
    profit_amount REAL NOT NULL DEFAULT 0,
    margin_pct REAL NOT NULL DEFAULT 100,
    target_margin_pct REAL NOT NULL DEFAULT 30,
    prize_budget_left REAL NOT NULL DEFAULT 0,
    rounds_count INTEGER NOT NULL DEFAULT 0,
    entries_count INTEGER NOT NULL DEFAULT 0,
    winners_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'HEALTHY',
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_daily_profit_session_date ON daily_profit_reports(session_id, trading_date);
`);

// Insert default prizes if not exist
const countPrizes = db.prepare('SELECT COUNT(*) as c FROM prizes').get();
if (countPrizes.c === 0) {
  const insertPrize = db.prepare(`
    INSERT INTO prizes (id, name, description, prize_type, value, color, enabled, stock_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const defaultPrizes = [
    { id: 'prize_weighted_cash', name: '🎯 R10 Spin Cash Schedule (R10 / R20 / R50 / R100)', description: 'Weighted Cash Engine • R10 (4%), R20 (0.5%), R50 (0.1%), R100 (0.025%) • Expected R0.575/spin', prizeType: 'weighted_cash', value: 'R10–R100 Cash', color: '#059669' },
    { id: 'prize_cash_3x', name: '💰 Cash Multiplier (1.5x / 2x / 3x)', description: 'Win 1.5x, 2x, or 3x your bet in real cash! (Min bet R5, Max R100 win)', prizeType: 'cash_multiplier', value: '1.5x–3x Cash', color: '#10b981' },
    { id: 'prize_1', name: '10 Mins PS5 Gaming', description: '10 free minutes on PS5 console', prizeType: 'gaming_time', value: '10 mins', color: '#8b5cf6' },
    { id: 'prize_2', name: 'Free Cold Beverage', description: 'Any chilled soda or energy drink', prizeType: 'snack', value: 'Soda / Juice', color: '#06b6d4' },
    { id: 'prize_3', name: 'Chips & Dip Combo', description: 'Snack pack from the counter', prizeType: 'snack', value: 'Snack Pack', color: '#f59e0b' },
    { id: 'prize_4', name: 'Bonus Free Spin', description: 'Immediate entry for next round', prizeType: 'bonus', value: '1 Free Spin', color: '#ec4899' },
    { id: 'prize_5', name: '30 Mins PC Station', description: '30 minutes high-performance PC rig', prizeType: 'gaming_time', value: '30 mins PC', color: '#10b981' },
    { id: 'prize_6', name: 'Gaming Center Sticker Pack', description: 'Exclusive Chillax holographic stickers', prizeType: 'merch', value: 'Stickers', color: '#3b82f6' }
  ];

  for (const p of defaultPrizes) {
    insertPrize.run(p.id, p.name, p.description, p.prizeType, p.value, p.color, 1, 99);
  }
} else {
  // Ensure both the Weighted R10 Cash Schedule (Launch Plan Section 2) and Cash Multiplier exist
  db.prepare(`
    INSERT OR IGNORE INTO prizes (id, name, description, prize_type, value, color, enabled, stock_count)
    VALUES ('prize_weighted_cash', '🎯 R10 Spin Cash Schedule (R10 / R20 / R50 / R100)', 'Weighted Cash Engine • R10 (4%), R20 (0.5%), R50 (0.1%), R100 (0.025%) • Expected R0.575/spin', 'weighted_cash', 'R10–R100 Cash', '#059669', 1, 999)
  `).run();
  db.prepare(`
    UPDATE prizes
    SET name = '🎯 R10 Spin Cash Schedule (R10 / R20 / R50 / R100)',
        description = 'Weighted Cash Engine • R10 (4%), R20 (0.5%), R50 (0.1%), R100 (0.025%) • Expected R0.575/spin',
        value = 'R10–R100 Cash'
    WHERE id = 'prize_weighted_cash'
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO prizes (id, name, description, prize_type, value, color, enabled, stock_count)
    VALUES ('prize_cash_3x', '💰 Cash Multiplier (1.5x / 2x / 3x)', 'Win 1.5x, 2x, or 3x your bet in real cash! (Min bet R5)', 'cash_multiplier', '1.5x–3x Cash', '#10b981', 1, 999)
  `).run();
  db.prepare(`
    UPDATE prizes
    SET name = '💰 Cash Multiplier (1.5x / 2x / 3x)',
        description = 'Win 1.5x, 2x, or 3x your bet in real cash! (Min bet R5)',
        value = '1.5x–3x Cash'
    WHERE id = 'prize_cash_3x'
  `).run();
}

export function logReserveLedger({
  sessionId,
  roundId = null,
  entryId = null,
  txId = null,
  entryType,
  amount = 0,
  committedDelta = 0,
  paidDelta = 0,
  notes = '',
  actorId = 'system'
}) {
  const id = 'led_' + Math.random().toString(36).substring(2, 10);
  const createdAt = new Date().toISOString();
  const resolvedTxId = txId || ('TX-' + Math.random().toString(36).substring(2, 8).toUpperCase());
  db.prepare(`
    INSERT INTO cash_reserve_ledger (id, session_id, round_id, entry_id, tx_id, entry_type, amount, committed_delta, paid_delta, notes, actor_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, sessionId, roundId, entryId, resolvedTxId, entryType, amount, committedDelta, paidDelta, notes, actorId, createdAt);
  return { id, txId: resolvedTxId, createdAt };
}

export function logAudit(sessionId, actorType, actorId, action, metadata = {}) {
  const id = 'aud_' + Math.random().toString(36).substring(2, 10);
  const timestamp = new Date().toISOString();
  const metadataJson = JSON.stringify(metadata);
  const stmt = db.prepare(`
    INSERT INTO audit_events (id, session_id, actor_type, actor_id, action, timestamp, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, sessionId, actorType, actorId, action, timestamp, metadataJson);
  syncRecordToMongo('audit_events', {
    id,
    session_id: sessionId,
    actor_type: actorType,
    actor_id: actorId,
    action,
    timestamp,
    metadata_json: metadataJson
  });
}
