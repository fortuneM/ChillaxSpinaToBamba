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
    settings_json TEXT NOT NULL DEFAULT '{}'
  );
`);

try {
  db.exec("ALTER TABLE sessions ADD COLUMN winner_mode TEXT DEFAULT 'TRUE_ODDS';");
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
    winning_number INTEGER,
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
    number INTEGER NOT NULL,
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

try {
  db.exec('ALTER TABLE entries ADD COLUMN bet_amount REAL NOT NULL DEFAULT 0;');
} catch(e) {}

try {
  db.exec('ALTER TABLE entries ADD COLUMN payout_amount REAL NOT NULL DEFAULT 0;');
} catch(e) {}

try {
  db.exec('ALTER TABLE rounds ADD COLUMN applied_multiplier REAL DEFAULT 0;');
} catch(e) {}

// Insert default prizes if not exist
const countPrizes = db.prepare('SELECT COUNT(*) as c FROM prizes').get();
if (countPrizes.c === 0) {
  const insertPrize = db.prepare(`
    INSERT INTO prizes (id, name, description, prize_type, value, color, enabled, stock_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const defaultPrizes = [
    { id: 'prize_cash_3x', name: '💰 Cash Multiplier (1.5x / 2x / 3x)', description: 'Win 1.5x, 2x, or 3x your bet in real cash! (Min bet R5)', prizeType: 'cash_multiplier', value: '1.5x–3x Cash', color: '#10b981' },
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
  // Ensure the dynamic Cash Multiplier (1.5x / 2x / 3x) prize exists and is up to date
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
