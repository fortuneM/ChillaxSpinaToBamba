import mongoose from 'mongoose';
import dotenv from 'dotenv';
import dns from 'node:dns';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env');

dotenv.config({ path: envPath });

// Ensure Node.js can resolve MongoDB SRV records regardless of local ISP / router DNS
try {
  dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
} catch (e) {
  // Ignore if not permitted
}

export const DEFAULT_CLUSTER_HOST = 'cluster0.q1kwbvb.mongodb.net';
export const DEFAULT_DB_NAME = 'chillaxgaminghub';
export const DEFAULT_MONGODB_URI =
  'mongodb+srv://spinauser:RZu0Os1eK4KZyNBE@cluster0.q1kwbvb.mongodb.net/chillaxgaminghub?retryWrites=true&w=majority&appName=Cluster0';

// Generic flexible schema for chillaxgaminghub collections keyed by `id`
function createCollectionSchema(collectionName) {
  return new mongoose.Schema(
    { id: { type: String, required: true, unique: true } },
    { strict: false, _id: false, collection: collectionName, versionKey: false }
  );
}

// Existing ChillaxGamingHub collections
export const HubUser = mongoose.models.HubUser || mongoose.model('HubUser', createCollectionSchema('users'));
export const HubShop = mongoose.models.HubShop || mongoose.model('HubShop', createCollectionSchema('shops'));
export const HubTv = mongoose.models.HubTv || mongoose.model('HubTv', createCollectionSchema('tvs'));
export const HubProduct = mongoose.models.HubProduct || mongoose.model('HubProduct', createCollectionSchema('products'));
export const HubTransaction = mongoose.models.HubTransaction || mongoose.model('HubTransaction', createCollectionSchema('transactions'));
export const HubSettings = mongoose.models.HubSettings || mongoose.model('HubSettings', createCollectionSchema('settings'));

// Spin & Win collections inside `chillaxgaminghub`
export const SpinSession = mongoose.models.SpinSession || mongoose.model('SpinSession', createCollectionSchema('spin_sessions'));
export const SpinPrize = mongoose.models.SpinPrize || mongoose.model('SpinPrize', createCollectionSchema('spin_prizes'));
export const SpinRound = mongoose.models.SpinRound || mongoose.model('SpinRound', createCollectionSchema('spin_rounds'));
export const SpinEntry = mongoose.models.SpinEntry || mongoose.model('SpinEntry', createCollectionSchema('spin_entries'));
export const SpinRedemption = mongoose.models.SpinRedemption || mongoose.model('SpinRedemption', createCollectionSchema('spin_redemptions'));
export const SpinAuditEvent = mongoose.models.SpinAuditEvent || mongoose.model('SpinAuditEvent', createCollectionSchema('spin_audit_events'));

const SPIN_MODELS = {
  sessions: SpinSession,
  prizes: SpinPrize,
  rounds: SpinRound,
  entries: SpinEntry,
  redemptions: SpinRedemption,
  audit_events: SpinAuditEvent
};

// In-memory cache of existing chillaxgaminghub entities (shops, tvs, users, settings)
export const hubCache = {
  connected: false,
  connecting: false,
  dbName: process.env.MONGODB_DB_NAME || DEFAULT_DB_NAME,
  clusterHost: DEFAULT_CLUSTER_HOST,
  lastSyncAt: null,
  lastError: null,
  shops: [],
  tvs: [],
  users: [],
  products: [],
  settings: null,
  collectionCounts: {}
};

export function isPlaceholderUri(uri) {
  if (!uri || typeof uri !== 'string') return true;
  const trimmed = uri.trim();
  if (!trimmed) return true;
  return (
    trimmed.includes('<db_username>') ||
    trimmed.includes('<db_password>') ||
    trimmed.includes('<username>') ||
    trimmed.includes('<password>')
  );
}

export function normalizeMongoUri(uri) {
  if (!uri || typeof uri !== 'string') return DEFAULT_MONGODB_URI;
  const trimmed = uri
    .trim()
    .replace('cluster0.qlkwbvb.mongodb.net', DEFAULT_CLUSTER_HOST)
    .replace('RZu0OsleK4KZyNBE', 'RZu0Os1eK4KZyNBE');
  if (!trimmed || isPlaceholderUri(trimmed)) {
    return DEFAULT_MONGODB_URI;
  }
  return trimmed;
}

export function buildMongoUri({ uri, username, password, clusterHost = DEFAULT_CLUSTER_HOST, dbName = DEFAULT_DB_NAME }) {
  const cleanHost = String(clusterHost || DEFAULT_CLUSTER_HOST).replace('cluster0.qlkwbvb.mongodb.net', DEFAULT_CLUSTER_HOST);
  if (uri && !isPlaceholderUri(uri)) {
    return normalizeMongoUri(uri);
  }
  if (username && password) {
    const encUser = encodeURIComponent(String(username).trim());
    const encPass = encodeURIComponent(String(password).trim());
    return `mongodb+srv://${encUser}:${encPass}@${cleanHost}/${dbName}?retryWrites=true&w=majority&appName=Cluster0`;
  }
  return normalizeMongoUri(process.env.MONGODB_URI || DEFAULT_MONGODB_URI);
}

export function saveMongoUriToEnv(uri, dbName = DEFAULT_DB_NAME) {
  try {
    const cleanUri = normalizeMongoUri(uri);
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf-8');
    }

    const lines = envContent.split(/\r?\n/).filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith('MONGODB_URI=') && !trimmed.startsWith('MONGODB_DB_NAME=');
    });

    lines.unshift(`MONGODB_DB_NAME=${dbName}`);
    lines.unshift(`MONGODB_URI=${cleanUri}`);

    fs.writeFileSync(envPath, lines.join('\n').trim() + '\n', 'utf-8');
    process.env.MONGODB_URI = cleanUri;
    process.env.MONGODB_DB_NAME = dbName;
    return true;
  } catch (err) {
    console.error('[MongoDB] Failed to persist MONGODB_URI to .env:', err.message);
    return false;
  }
}

export async function connectMongo(customUri = null) {
  // Reload .env in case it was updated while running
  dotenv.config({ path: envPath, override: true });

  const resolvedUri = normalizeMongoUri(customUri || process.env.MONGODB_URI || DEFAULT_MONGODB_URI);
  const dbName = process.env.MONGODB_DB_NAME || DEFAULT_DB_NAME;
  process.env.MONGODB_URI = resolvedUri;
  process.env.MONGODB_DB_NAME = dbName;
  hubCache.dbName = dbName;

  hubCache.connecting = true;
  try {
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }

    await mongoose.connect(resolvedUri, {
      dbName,
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000
    });

    hubCache.connected = true;
    hubCache.connecting = false;
    hubCache.clusterHost = DEFAULT_CLUSTER_HOST;
    hubCache.dbName = mongoose.connection.name || dbName;
    hubCache.lastError = null;

    console.log(`✅ [MongoDB] Default permanent DB connected: "${hubCache.dbName}" (${DEFAULT_CLUSTER_HOST})`);
    return { connected: true, host: hubCache.clusterHost, dbName: hubCache.dbName };
  } catch (err) {
    hubCache.connected = false;
    hubCache.connecting = false;
    hubCache.lastError = err.message;
    console.warn('⚠️ [MongoDB] Connection failed:', err.message);
    return { connected: false, error: err.message };
  }
}

/**
 * Syncs between MongoDB `chillaxgaminghub` (default permanent DB) and local SQLite fast query cache.
 * 1. Loads existing hub collections (`shops`, `tvs`, `users`, `products`, `settings`) from `chillaxgaminghub`.
 * 2. Hydrates SQLite tables with remote `spin_*` documents from `chillaxgaminghub` (authoritative upsert).
 * 3. Pushes any local SQLite `spin_*` rows up to `chillaxgaminghub` so both are 100% synchronized.
 */
export async function syncWithChillaxGamingHub(sqliteDb) {
  if (mongoose.connection.readyState !== 1) {
    const conn = await connectMongo();
    if (!conn.connected) {
      hubCache.connected = false;
      return { synced: false, reason: hubCache.lastError || 'Not connected to MongoDB' };
    }
  }

  try {
    // 1. Load existing ChillaxGamingHub collections
    const [shops, tvs, users, products, settingsDoc] = await Promise.all([
      HubShop.find({}).lean(),
      HubTv.find({}).lean(),
      HubUser.find({}).lean(),
      HubProduct.find({}).lean(),
      HubSettings.findOne({ id: 'settings_singleton' }).lean()
    ]);

    hubCache.shops = shops.map(({ _id, __v, ...rest }) => rest);
    hubCache.tvs = tvs.map(({ _id, __v, ...rest }) => rest);
    hubCache.users = users.map(({ _id, __v, ...rest }) => rest);
    hubCache.products = products.map(({ _id, __v, ...rest }) => rest);
    hubCache.settings = settingsDoc ? (({ _id, __v, ...rest }) => rest)(settingsDoc) : null;

    // 2. Pull remote spin_* documents from MongoDB into local query cache (using ON CONFLICT DO UPDATE so ON DELETE CASCADE never wipes child rounds/entries)
    const remotePrizes = await SpinPrize.find({}).lean();
    for (const p of remotePrizes) {
      if (!p.id) continue;
      try {
        sqliteDb.prepare(`
          INSERT INTO prizes (id, name, description, prize_type, value, color, enabled, stock_count)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            description = excluded.description,
            prize_type = excluded.prize_type,
            value = excluded.value,
            color = excluded.color,
            enabled = excluded.enabled,
            stock_count = excluded.stock_count
        `).run(
          p.id,
          p.name || 'Prize',
          p.description || '',
          p.prize_type || 'standard',
          p.value || '',
          p.color || '#06b6d4',
          p.enabled !== undefined ? Number(p.enabled) : 1,
          p.stock_count !== undefined ? Number(p.stock_count) : 99
        );
      } catch {}
    }

    const remoteSessions = await SpinSession.find({}).lean();
    for (const s of remoteSessions) {
      if (!s.id || !s.short_code) continue;
      try {
        const existingByCode = sqliteDb.prepare('SELECT id FROM sessions WHERE short_code = ? AND id != ?').get(s.short_code, s.id);
        if (existingByCode) continue;
        sqliteDb.prepare(`
          INSERT INTO sessions (id, short_code, status, number_min, number_max, created_at, host_id, host_pin, tv_connected, tv_pairing_code, winner_mode, settings_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            short_code = excluded.short_code,
            status = excluded.status,
            number_min = excluded.number_min,
            number_max = excluded.number_max,
            host_id = excluded.host_id,
            host_pin = excluded.host_pin,
            tv_connected = excluded.tv_connected,
            tv_pairing_code = excluded.tv_pairing_code,
            winner_mode = excluded.winner_mode,
            settings_json = excluded.settings_json
        `).run(
          s.id,
          s.short_code,
          s.status || 'IDLE',
          Number(s.number_min) || 1,
          Number(s.number_max) || 20,
          s.created_at || new Date().toISOString(),
          s.host_id || 'host_default',
          s.host_pin || '1234',
          Number(s.tv_connected) || 0,
          s.tv_pairing_code || null,
          s.winner_mode || 'TRUE_ODDS',
          s.settings_json || '{}'
        );
      } catch {}
    }

    const remoteRounds = await SpinRound.find({}).lean();
    for (const r of remoteRounds) {
      if (!r.id || !r.session_id) continue;
      try {
        sqliteDb.prepare(`
          INSERT INTO rounds (id, session_id, round_number, status, prize_id, prize_snapshot_json, winning_number, winning_entry_id, applied_multiplier, started_at, result_at, cancelled_at, cancel_reason, idempotency_key)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            round_number = excluded.round_number,
            status = excluded.status,
            prize_id = excluded.prize_id,
            prize_snapshot_json = excluded.prize_snapshot_json,
            winning_number = excluded.winning_number,
            winning_entry_id = excluded.winning_entry_id,
            applied_multiplier = excluded.applied_multiplier,
            started_at = excluded.started_at,
            result_at = excluded.result_at,
            cancelled_at = excluded.cancelled_at,
            cancel_reason = excluded.cancel_reason,
            idempotency_key = excluded.idempotency_key
        `).run(
          r.id,
          r.session_id,
          Number(r.round_number) || 1,
          r.status || 'IDLE',
          r.prize_id || null,
          r.prize_snapshot_json || null,
          r.winning_number !== undefined ? r.winning_number : null,
          r.winning_entry_id || null,
          Number(r.applied_multiplier) || 0,
          r.started_at || null,
          r.result_at || null,
          r.cancelled_at || null,
          r.cancel_reason || null,
          r.idempotency_key || null
        );
      } catch {}
    }

    const remoteEntries = await SpinEntry.find({}).lean();
    for (const e of remoteEntries) {
      if (!e.id || !e.session_id || !e.round_id) continue;
      try {
        sqliteDb.prepare(`
          INSERT INTO entries (id, session_id, round_id, number, player_token, nickname, bet_amount, payout_amount, claimed_at, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            number = excluded.number,
            nickname = excluded.nickname,
            bet_amount = excluded.bet_amount,
            payout_amount = excluded.payout_amount,
            status = excluded.status
        `).run(
          e.id,
          e.session_id,
          e.round_id,
          Number(e.number),
          e.player_token,
          e.nickname || 'Player',
          Number(e.bet_amount) || 0,
          Number(e.payout_amount) || 0,
          e.claimed_at || new Date().toISOString(),
          e.status || 'ACTIVE'
        );
      } catch {}
    }

    const remoteRedemptions = await SpinRedemption.find({}).lean();
    for (const red of remoteRedemptions) {
      if (!red.id || !red.round_id) continue;
      try {
        sqliteDb.prepare(`
          INSERT INTO redemptions (id, round_id, prize_id, redeemed_by, redeemed_at, status, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            redeemed_by = excluded.redeemed_by,
            redeemed_at = excluded.redeemed_at,
            status = excluded.status,
            notes = excluded.notes
        `).run(
          red.id,
          red.round_id,
          red.prize_id || 'prize_default',
          red.redeemed_by || 'Staff Host',
          red.redeemed_at || new Date().toISOString(),
          red.status || 'REDEEMED',
          red.notes || ''
        );
      } catch {}
    }

    // 3. Push local records to MongoDB `chillaxgaminghub` (upsert)
    const tablesToPush = ['prizes', 'sessions', 'rounds', 'entries', 'redemptions', 'audit_events'];
    for (const table of tablesToPush) {
      const rows = sqliteDb.prepare(`SELECT * FROM ${table}`).all();
      const Model = SPIN_MODELS[table];
      if (Model && rows.length > 0) {
        const ops = rows.map((row) => ({
          updateOne: {
            filter: { id: row.id },
            update: { $set: { ...row, updatedAt: new Date().toISOString() } },
            upsert: true
          }
        }));
        await Model.bulkWrite(ops, { ordered: false });
      }
      hubCache.collectionCounts[`spin_${table}`] = rows.length;
    }

    hubCache.collectionCounts.shops = hubCache.shops.length;
    hubCache.collectionCounts.tvs = hubCache.tvs.length;
    hubCache.collectionCounts.users = hubCache.users.length;
    hubCache.collectionCounts.products = hubCache.products.length;
    hubCache.lastSyncAt = new Date().toISOString();
    hubCache.connected = true;

    console.log(
      `🔄 [MongoDB] Synced permanent DB "chillaxgaminghub": ${hubCache.shops.length} shop(s), ${hubCache.tvs.length} TV station(s), ${hubCache.collectionCounts.spin_sessions || 0} spin session(s), ${hubCache.collectionCounts.spin_rounds || 0} round(s)`
    );

    return {
      synced: true,
      dbName: hubCache.dbName,
      clusterHost: hubCache.clusterHost,
      lastSyncAt: hubCache.lastSyncAt,
      collectionCounts: hubCache.collectionCounts,
      shops: hubCache.shops.map((s) => ({ id: s.id, name: s.name, shopCode: s.shopCode })),
      tvs: hubCache.tvs.map((t) => ({
        id: t.id,
        name: t.name,
        stationNumber: t.stationNumber,
        shopId: t.shopId,
        shopName: t.shopName,
        status: t.status,
        type: t.type
      }))
    };
  } catch (err) {
    hubCache.lastError = err.message;
    console.error('[MongoDB] Sync error:', err.message);
    return { synced: false, error: err.message };
  }
}

/**
 * Write-through helper to upsert a Spin & Win record into `chillaxgaminghub`.
 */
export async function syncRecordToMongo(table, doc) {
  if (mongoose.connection.readyState !== 1 || !doc || !doc.id) return;
  try {
    const Model = SPIN_MODELS[table];
    if (!Model) return;
    await Model.findOneAndUpdate(
      { id: doc.id },
      { ...doc, updatedAt: new Date().toISOString() },
      { upsert: true, returnDocument: 'after', lean: true }
    );
  } catch (err) {
    console.error(`[MongoDB] Upsert error on spin_${table}:`, err.message);
  }
}

/**
 * Write-through helper to delete a Spin & Win record from `chillaxgaminghub`.
 */
export async function deleteRecordFromMongo(table, id) {
  if (mongoose.connection.readyState !== 1 || !id) return;
  try {
    const Model = SPIN_MODELS[table];
    if (!Model) return;
    await Model.deleteOne({ id });
  } catch (err) {
    console.error(`[MongoDB] Delete error on spin_${table}:`, err.message);
  }
}

/**
 * Records a completed Spin & Win cash round or prize redemption into the shared
 * `chillaxgaminghub.transactions` collection so hub reports & accounting stay unified.
 */
export async function recordHubTransaction({
  id,
  shopId = null,
  sessionId,
  roundId,
  roundNumber,
  customerName,
  totalCollected = 0,
  payoutAmount = 0,
  appliedMultiplier = 0,
  prizeName = 'Spin & Win',
  notes = ''
}) {
  if (mongoose.connection.readyState !== 1) return;
  try {
    const defaultShop = hubCache.shops[0];
    const targetShopId = shopId || defaultShop?.id || 'shop_default';
    const txId = id || `tx_spin_${roundId}`;
    const now = new Date().toISOString();
    const netAmount = Math.round((Number(totalCollected) - Number(payoutAmount)) * 100) / 100;

    const txDoc = {
      id: txId,
      shopId: targetShopId,
      type: 'SPIN_AND_WIN',
      sessionId,
      roundId,
      customerName: customerName || 'Spin & Win Players',
      items: [
        {
          productId: 'spin_and_win_round',
          name: `Spin & Win Rnd #${roundNumber} (${prizeName})`,
          price: Number(totalCollected) || 0,
          quantity: 1,
          lineTotal: Number(totalCollected) || 0
        }
      ],
      totalAmount: Number(totalCollected) || 0,
      payoutAmount: Number(payoutAmount) || 0,
      netProfit: netAmount,
      appliedMultiplier: Number(appliedMultiplier) || 0,
      paymentType: 'Cash',
      cashierName: 'Spin & Win Host',
      status: 'completed',
      notes: notes || (payoutAmount > 0 ? `Winner: ${customerName} (${appliedMultiplier}x payout R${payoutAmount})` : 'No winner payout'),
      createdAt: now,
      updatedAt: now
    };

    await HubTransaction.findOneAndUpdate(
      { id: txId },
      txDoc,
      { upsert: true, returnDocument: 'after', lean: true }
    );
  } catch (err) {
    console.error('[MongoDB] Failed to record transaction in chillaxgaminghub.transactions:', err.message);
  }
}

/**
 * Updates or links a TV station in `chillaxgaminghub.tvs` when paired with Spin & Win.
 */
export async function updateHubTvStatus(tvId, updates = {}) {
  if (mongoose.connection.readyState !== 1 || !tvId) return;
  try {
    await HubTv.findOneAndUpdate(
      { id: tvId },
      { $set: { ...updates, updatedAt: new Date().toISOString() } },
      { returnDocument: 'after', lean: true }
    );
  } catch (err) {
    console.error('[MongoDB] Failed to update TV in chillaxgaminghub.tvs:', err.message);
  }
}

/**
 * Checks if a provided PIN matches any user or shop adminPin in `chillaxgaminghub`.
 */
export function isValidHubPin(inputPin) {
  if (!inputPin) return false;
  const clean = String(inputPin).trim();
  if (clean === '1234') return true;
  if (hubCache.settings?.adminPin && String(hubCache.settings.adminPin) === clean) {
    return true;
  }
  for (const shop of hubCache.shops) {
    if (shop?.settings?.adminPin && String(shop.settings.adminPin) === clean) {
      return true;
    }
  }
  for (const user of hubCache.users) {
    if (user?.pin && String(user.pin) === clean) {
      return true;
    }
  }
  return false;
}

/**
 * Refreshes `users` and `shops` from `chillaxgaminghub` MongoDB so login is always live-synced.
 */
export async function refreshHubAuthCache() {
  if (mongoose.connection.readyState !== 1) {
    await connectMongo();
  }
  if (mongoose.connection.readyState === 1) {
    try {
      const [shops, users] = await Promise.all([
        HubShop.find({}).lean(),
        HubUser.find({}).lean()
      ]);
      hubCache.shops = shops.map(({ _id, __v, ...rest }) => rest);
      hubCache.users = users.map(({ _id, __v, ...rest }) => rest);
      hubCache.collectionCounts.shops = hubCache.shops.length;
      hubCache.collectionCounts.users = hubCache.users.length;
    } catch (err) {
      console.warn('[MongoDB] Failed to refresh users/shops from chillaxgaminghub:', err.message);
    }
  }
}

function generateUniqueShopCode() {
  const existingCodes = new Set((hubCache.shops || []).map((s) => String(s.shopCode || '').toUpperCase()));
  let code = `CHX-${Math.floor(1000 + Math.random() * 9000)}`;
  while (existingCodes.has(code)) {
    code = `CHX-${Math.floor(1000 + Math.random() * 9000)}`;
  }
  return code;
}

/**
 * Resolves the linked shop for a user from `chillaxgaminghub.shops`.
 * If the user's linked shop record does not yet exist in `shops`, creates and syncs it
 * so that every authenticated user always has a valid linked shop with a `shopCode`.
 */
export async function resolveLinkedShopForUser(user) {
  if (!user) return null;

  let shop = null;
  if (user.shopId) {
    shop = (hubCache.shops || []).find((s) => s.id === user.shopId) || null;
  }
  if (!shop) {
    shop = (hubCache.shops || []).find((s) => s.ownerId === user.id) || null;
  }

  // If user is admin/staff and default shop exists
  if (!shop && (user.username === 'admin' || user.username === 'staff' || user.role === 'superadmin') && hubCache.shops.length > 0) {
    shop = hubCache.shops[0];
  }

  // If still no shop document found for this user, create one in chillaxgaminghub.shops
  if (!shop) {
    const shopId = user.shopId && user.shopId !== 'shop_default'
      ? user.shopId
      : `shop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const shopCode = generateUniqueShopCode();
    const now = new Date().toISOString();

    shop = {
      id: shopId,
      shopCode,
      name: `${user.name || user.username}'s Gaming Center`,
      ownerId: user.id,
      currency: 'R',
      currencyCode: 'ZAR',
      retailPosEnabled: false,
      settings: {
        warningMinutes: 5,
        adminPin: user.pin || '1234',
        autoSwitchHdmi: true,
        audioAlertsEnabled: true,
        kioskLockEnabled: true,
        retailPosEnabled: false
      },
      createdAt: now,
      updatedAt: now
    };

    hubCache.shops.push(shop);
    user.shopId = shop.id;

    if (mongoose.connection.readyState === 1) {
      try {
        await HubShop.findOneAndUpdate({ id: shop.id }, shop, { upsert: true, returnDocument: 'after', lean: true });
        await HubUser.findOneAndUpdate({ id: user.id }, { $set: { shopId: shop.id, updatedAt: now } }, { upsert: true });
      } catch (err) {
        console.warn('[MongoDB] Failed to persist auto-linked shop:', err.message);
      }
    }
  } else if (user.shopId !== shop.id) {
    user.shopId = shop.id;
    if (mongoose.connection.readyState === 1) {
      try {
        await HubUser.findOneAndUpdate({ id: user.id }, { $set: { shopId: shop.id, updatedAt: new Date().toISOString() } });
      } catch {}
    }
  }

  return {
    id: shop.id,
    shopCode: shop.shopCode,
    name: shop.name,
    ownerId: shop.ownerId,
    currency: shop.currency || 'R',
    currencyCode: shop.currencyCode || 'ZAR',
    adminPin: shop.settings?.adminPin || user.pin || '1234'
  };
}

/**
 * Authenticates a user against `chillaxgaminghub.users` (username or email + password)
 * and resolves their linked shop and `shopCode` from `chillaxgaminghub.shops`.
 */
export async function authenticateHubUser({ usernameOrEmail, password }) {
  const cleanIdent = String(usernameOrEmail || '').trim().toLowerCase();
  const cleanPassword = String(password || '').trim();

  if (!cleanIdent || !cleanPassword) {
    return { success: false, status: 400, error: 'Username/email and password are required.' };
  }

  await refreshHubAuthCache();

  const user = (hubCache.users || []).find(
    (u) =>
      String(u.username || '').trim().toLowerCase() === cleanIdent ||
      (u.email && String(u.email).trim().toLowerCase() === cleanIdent)
  );

  if (!user || String(user.password || '').trim() !== cleanPassword) {
    return { success: false, status: 401, error: 'Invalid username or password.' };
  }

  const shop = await resolveLinkedShopForUser(user);

  return {
    success: true,
    user: {
      id: user.id,
      username: user.username,
      name: user.name || user.username,
      email: user.email || '',
      role: user.role || 'owner',
      shopId: shop.id,
      pin: user.pin || '1234'
    },
    shop
  };
}

/**
 * Registers a new user and linked shop in `chillaxgaminghub` (synced with Chillax Gaming App).
 */
export async function registerHubUserAndShop({ name, username, email = '', password, shopName }) {
  const cleanUsername = String(username || '').trim().toLowerCase();
  const cleanPassword = String(password || '').trim();
  const cleanName = String(name || cleanUsername).trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanShopName = String(shopName || 'Chillax Gaming Center').trim();

  if (!cleanUsername || !cleanPassword) {
    return { success: false, status: 400, error: 'Username and password are required.' };
  }
  if (cleanPassword.length < 4) {
    return { success: false, status: 400, error: 'Password must be at least 4 characters.' };
  }

  await refreshHubAuthCache();

  const existing = (hubCache.users || []).find(
    (u) => String(u.username || '').trim().toLowerCase() === cleanUsername
  );
  if (existing) {
    return { success: false, status: 400, error: 'Username already taken. Please choose another.' };
  }

  const now = new Date().toISOString();
  const userId = `usr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const shopId = `shop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const shopCode = generateUniqueShopCode();

  const newShop = {
    id: shopId,
    shopCode,
    name: cleanShopName,
    ownerId: userId,
    currency: 'R',
    currencyCode: 'ZAR',
    retailPosEnabled: false,
    settings: {
      warningMinutes: 5,
      adminPin: '1234',
      autoSwitchHdmi: true,
      audioAlertsEnabled: true,
      kioskLockEnabled: true,
      retailPosEnabled: false
    },
    subscription: {
      status: 'active',
      plan: 'per_station',
      ratePerStation: 2,
      unlimitedPrice: 15,
      stationLimit: 10,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      notes: 'Active subscription',
      blockedReason: '',
      lastPaymentDate: now
    },
    createdAt: now,
    updatedAt: now
  };

  const newUser = {
    id: userId,
    username: cleanUsername,
    name: cleanName,
    email: cleanEmail,
    shopId,
    role: 'owner',
    pin: '1234',
    password: cleanPassword,
    createdAt: now,
    updatedAt: now
  };

  hubCache.shops.unshift(newShop);
  hubCache.users.unshift(newUser);
  hubCache.collectionCounts.shops = hubCache.shops.length;
  hubCache.collectionCounts.users = hubCache.users.length;

  if (mongoose.connection.readyState === 1) {
    try {
      await Promise.all([
        HubShop.findOneAndUpdate({ id: newShop.id }, newShop, { upsert: true, returnDocument: 'after', lean: true }),
        HubUser.findOneAndUpdate({ id: newUser.id }, newUser, { upsert: true, returnDocument: 'after', lean: true })
      ]);
    } catch (err) {
      console.error('[MongoDB] Failed to persist registered user/shop to chillaxgaminghub:', err.message);
    }
  }

  return {
    success: true,
    user: {
      id: newUser.id,
      username: newUser.username,
      name: newUser.name,
      email: newUser.email,
      role: newUser.role,
      shopId: newShop.id,
      pin: newUser.pin
    },
    shop: {
      id: newShop.id,
      shopCode: newShop.shopCode,
      name: newShop.name,
      ownerId: newShop.ownerId,
      currency: newShop.currency,
      currencyCode: newShop.currencyCode,
      adminPin: '1234'
    }
  };
}

/**
 * Resolves a currently logged-in user and their linked shop by userId or username.
 */
export async function resolveHubUserAndShopById({ userId, username }) {
  await refreshHubAuthCache();
  let user = null;
  if (userId) {
    user = (hubCache.users || []).find((u) => u.id === userId) || null;
  }
  if (!user && username) {
    const clean = String(username).trim().toLowerCase();
    user = (hubCache.users || []).find((u) => String(u.username || '').trim().toLowerCase() === clean) || null;
  }
  if (!user) return null;

  const shop = await resolveLinkedShopForUser(user);
  return {
    user: {
      id: user.id,
      username: user.username,
      name: user.name || user.username,
      email: user.email || '',
      role: user.role || 'owner',
      shopId: shop.id,
      pin: user.pin || '1234'
    },
    shop
  };
}

export function getMongoStatus() {
  const rawUri = normalizeMongoUri(process.env.MONGODB_URI || DEFAULT_MONGODB_URI);
  const maskedUri = rawUri
    ? rawUri.replace(/:([^@]+)@/, ':****@')
    : null;

  return {
    connected: mongoose.connection.readyState === 1,
    readyState: mongoose.connection.readyState,
    permanentDb: true,
    needsCredentials: false,
    dbName: hubCache.dbName || DEFAULT_DB_NAME,
    clusterHost: DEFAULT_CLUSTER_HOST,
    maskedUri,
    lastSyncAt: hubCache.lastSyncAt,
    lastError: hubCache.lastError,
    collectionCounts: hubCache.collectionCounts,
    shops: hubCache.shops.map((s) => ({
      id: s.id,
      name: s.name,
      shopCode: s.shopCode,
      currency: s.currency || 'R'
    })),
    tvs: hubCache.tvs.map((t) => ({
      id: t.id,
      name: t.name,
      stationNumber: t.stationNumber,
      shopId: t.shopId,
      shopName: t.shopName,
      status: t.status,
      type: t.type,
      model: t.model
    }))
  };
}
