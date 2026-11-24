import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { io as ioClient } from 'socket.io-client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function runChildNode(args, envOverrides = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT_DIR,
      env: { ...process.env, ...envOverrides },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function waitForServer(baseUrl, serverProc, getLogs, timeoutMs = 60000) {
  let exitCode = null;
  serverProc.on('exit', (code) => { exitCode = code; });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exitCode !== null) {
      throw new Error(`Server exited prematurely with code ${exitCode}\n--- Server Logs ---\n${getLogs()}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return await res.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for server at ${baseUrl} after ${timeoutMs}ms\n--- Server Logs ---\n${getLogs()}`);
}

async function apiJson(baseUrl, reqPath, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const res = await fetch(`${baseUrl}${reqPath}`, { ...options, headers });
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, ok: res.ok, body, headers: res.headers };
}

function connectSocketClient(baseUrl, sessionId, role) {
  return new Promise((resolve, reject) => {
    const client = ioClient(baseUrl, {
      transports: ['websocket'],
      reconnection: false,
      timeout: 5000
    });
    const events = [];
    const timer = setTimeout(() => {
      client.disconnect();
      reject(new Error(`Socket (${role}) timed out connecting/joining`));
    }, 6000);

    client.on('connect', () => {
      client.emit('join:session', { sessionId, role });
    });

    for (const evt of ['session:state', 'entry:approved', 'entry:rejected', 'spin:started', 'spin:result']) {
      client.on(evt, (payload) => {
        events.push({ event: evt, payload, ts: Date.now() });
        if (evt === 'session:state' && events.filter((e) => e.event === 'session:state').length === 1) {
          clearTimeout(timer);
          resolve({ client, events });
        }
      });
    }

    client.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function waitForEvent(events, eventName, predicate = () => true, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = events.find((e) => e.event === eventName && predicate(e.payload));
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timed out waiting for Socket.IO event "${eventName}"`);
}

async function runHttpAndSocketE2E(tempDbPath) {
  console.log('\n=== PHASE 2: Isolated HTTP REST + Socket.IO E2E Tests ===');
  const testPort = 3199;
  const baseUrl = `http://127.0.0.1:${testPort}`;

  const serverProc = spawn(process.execPath, ['--experimental-sqlite', 'server/server.js'], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PORT: String(testPort),
      CHILLAX_DB_PATH: tempDbPath,
      CHILLAX_SKIP_MONGO: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let serverLogs = '';
  serverProc.stdout.on('data', (d) => { serverLogs += d.toString(); });
  serverProc.stderr.on('data', (d) => { serverLogs += d.toString(); });

  const sockets = [];
  try {
    const health = await waitForServer(baseUrl, serverProc, () => serverLogs, 60000);
    assert.equal(health.status, 'healthy', 'Health status must be healthy');
    assert.equal(health.timezone, 'Africa/Johannesburg', 'Timezone must match venue');

    // Unknown API route must return JSON 404 (not SPA HTML)
    const missingApi = await apiJson(baseUrl, '/api/nonexistent-qa-route');
    assert.equal(missingApi.status, 404);
    assert.equal(missingApi.body.success, false);
    console.log('  ✅ Health check & JSON 404 API fallback passed');

    // Verify /lock.apk route serves APK binary headers & content length
    const lockHead = await fetch(`${baseUrl}/lock.apk`, { method: 'HEAD' });
    assert.equal(lockHead.status, 200, 'GET /lock.apk must return 200');
    assert(
      (lockHead.headers.get('content-disposition') || '').includes('Chillax-TV-Lock.apk'),
      'Content-Disposition must specify Chillax-TV-Lock.apk'
    );
    const lockLen = Number(lockHead.headers.get('content-length') || 0);
    assert(lockLen > 10_000_000, `Lock APK content-length must be >10MB (got ${lockLen})`);
    console.log(`  ✅ /lock.apk distribution endpoint verified (${lockLen} bytes)`);

    // Auth guard: creating session without Host PIN must fail with 401
    const unauthSession = await apiJson(baseUrl, '/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ numberMax: 20 })
    });
    assert.equal(unauthSession.status, 401, 'Unauthenticated POST /api/sessions must return 401');

    // Host PIN valid + negative cases
    const badPin = await apiJson(baseUrl, '/api/host/verify-pin', {
      method: 'POST',
      body: JSON.stringify({ pin: '9999' })
    });
    assert.equal(badPin.status, 401);
    const goodPin = await apiJson(baseUrl, '/api/host/verify-pin', {
      method: 'POST',
      body: JSON.stringify({ pin: '1234' })
    });
    assert.equal(goodPin.status, 200);
    assert.equal(goodPin.body.success, true);

    const hostHeaders = { 'x-host-pin': '1234' };

    // Prizes catalog
    const prizesRes = await apiJson(baseUrl, '/api/prizes');
    assert.equal(prizesRes.status, 200);
    const prizeIds = new Set(prizesRes.body.prizes.map((p) => p.id));
    assert(prizeIds.has('prize_cash_3x'), 'Cash Multiplier prize must be enabled');
    assert(prizeIds.has('prize_weighted_cash'), 'Weighted Cash schedule prize must be enabled');

    // Create isolated test session in Cash Multiplier mode
    const created = await apiJson(baseUrl, '/api/sessions', {
      method: 'POST',
      headers: hostHeaders,
      body: JSON.stringify({
        numberMin: 1,
        numberMax: 20,
        defaultPrizeId: 'prize_cash_3x',
        shopCode: 'CHX-QA01',
        shopName: 'QA Test Arena'
      })
    });
    assert.equal(created.status, 201);
    const { sessionId, shortCode } = created.body;
    assert(sessionId && shortCode);

    // Connect real Socket.IO clients for TV, Host, and Mobile Player
    const tvSock = await connectSocketClient(baseUrl, sessionId, 'tv');
    const hostSock = await connectSocketClient(baseUrl, sessionId, 'host');
    const playerSock = await connectSocketClient(baseUrl, sessionId, 'player');
    sockets.push(tvSock.client, hostSock.client, playerSock.client);

    // TV lookup & pair
    const found = await apiJson(baseUrl, `/api/sessions/find/${shortCode}`);
    assert.equal(found.status, 200);
    assert.equal(found.body.sessionId, sessionId);
    const paired = await apiJson(baseUrl, `/api/sessions/${sessionId}/pair-tv`, {
      method: 'POST',
      body: JSON.stringify({ pairingCode: shortCode })
    });
    assert.equal(paired.status, 200);
    await waitForEvent(tvSock.events, 'session:state', (s) => s.tvConnected === true);
    console.log('  ✅ Socket.IO room join & TV pairing sync verified');

    // Enforce 0 and 00 are NEVER pickable (Player HTTP + Host HTTP)
    for (const zeroCandidate of ['0', '00', ' 0 ', 0]) {
      const pZero = await apiJson(baseUrl, `/api/sessions/${sessionId}/entries`, {
        method: 'POST',
        body: JSON.stringify({
          number: zeroCandidate,
          playerToken: 'tok_qa_zero',
          nickname: 'ZeroAttacker',
          betAmount: 10,
          ageVerified: true
        })
      });
      assert.equal(pZero.status, 400, `Player claim "${zeroCandidate}" must return HTTP 400`);

      const hZero = await apiJson(baseUrl, `/api/sessions/${sessionId}/host-entries`, {
        method: 'POST',
        headers: hostHeaders,
        body: JSON.stringify({
          number: zeroCandidate,
          nickname: 'HostZero',
          betAmount: 10
        })
      });
      assert.equal(hZero.status, 400, `Host claim "${zeroCandidate}" must return HTTP 400`);
    }
    console.log('  ✅ HTTP enforcement blocking "0" and "00" claims passed');

    // Negative boundary checks: missing token, underage, sub-R5 bet, out-of-range #99
    const noTok = await apiJson(baseUrl, `/api/sessions/${sessionId}/entries`, {
      method: 'POST',
      body: JSON.stringify({ number: 5, nickname: 'NoTok', betAmount: 10 })
    });
    assert.equal(noTok.status, 400);

    const underage = await apiJson(baseUrl, `/api/sessions/${sessionId}/entries`, {
      method: 'POST',
      body: JSON.stringify({ number: 5, playerToken: 'tok_u', nickname: 'Minor', betAmount: 10, ageVerified: false })
    });
    assert.equal(underage.status, 403);

    const lowBet = await apiJson(baseUrl, `/api/sessions/${sessionId}/entries`, {
      method: 'POST',
      body: JSON.stringify({ number: 5, playerToken: 'tok_low', nickname: 'LowBet', betAmount: 4, ageVerified: true })
    });
    assert.equal(lowBet.status, 400);

    const outRange = await apiJson(baseUrl, `/api/sessions/${sessionId}/entries`, {
      method: 'POST',
      body: JSON.stringify({ number: 99, playerToken: 'tok_99', nickname: 'OutOfRange', betAmount: 10, ageVerified: true })
    });
    assert.equal(outRange.status, 400);

    // Player 1 requests #5 -> PENDING -> cancel -> request #6 -> Host approves -> broadcasts entry:approved
    const req1 = await apiJson(baseUrl, `/api/sessions/${sessionId}/entries`, {
      method: 'POST',
      body: JSON.stringify({ number: 5, playerToken: 'tok_p1', nickname: 'Sipho', betAmount: 20, ageVerified: true })
    });
    assert.equal(req1.status, 201);
    assert.equal(req1.body.status, 'PENDING');

    const cancelled = await apiJson(baseUrl, `/api/sessions/${sessionId}/entries/cancel`, {
      method: 'POST',
      body: JSON.stringify({ playerToken: 'tok_p1' })
    });
    assert.equal(cancelled.status, 200);

    const req2 = await apiJson(baseUrl, `/api/sessions/${sessionId}/entries`, {
      method: 'POST',
      body: JSON.stringify({ number: 6, playerToken: 'tok_p1', nickname: 'Sipho', betAmount: 20, ageVerified: true })
    });
    assert.equal(req2.status, 201);

    // Player 2 requests #14 -> Host rejects -> receives entry:rejected
    const reqBad = await apiJson(baseUrl, `/api/sessions/${sessionId}/entries`, {
      method: 'POST',
      body: JSON.stringify({ number: 14, playerToken: 'tok_p2', nickname: 'Unpaid', betAmount: 20, ageVerified: true })
    });
    assert.equal(reqBad.status, 201);

    const rejected = await apiJson(baseUrl, `/api/sessions/${sessionId}/pending-entries/${reqBad.body.entryId}/reject`, {
      method: 'POST',
      headers: hostHeaders,
      body: JSON.stringify({ reason: 'Did not pay' })
    });
    assert.equal(rejected.status, 200);
    await waitForEvent(playerSock.events, 'entry:rejected', (e) => e.playerToken === 'tok_p2');

    // Host approves Player 1 on #6
    const approved = await apiJson(baseUrl, `/api/sessions/${sessionId}/pending-entries/${req2.body.entryId}/approve`, {
      method: 'POST',
      headers: hostHeaders,
      body: JSON.stringify({})
    });
    assert.equal(approved.status, 200);
    await waitForEvent(playerSock.events, 'entry:approved', (e) => e.playerToken === 'tok_p1' && String(e.number) === '6');

    // Host adds walk-in players on #10 and #18
    const walk1 = await apiJson(baseUrl, `/api/sessions/${sessionId}/host-entries`, {
      method: 'POST',
      headers: hostHeaders,
      body: JSON.stringify({ number: 10, nickname: 'Thabo', betAmount: 20 })
    });
    assert.equal(walk1.status, 201);
    const walk2 = await apiJson(baseUrl, `/api/sessions/${sessionId}/host-entries`, {
      method: 'POST',
      headers: hostHeaders,
      body: JSON.stringify({ number: 18, nickname: 'Nomsa', betAmount: 20 })
    });
    assert.equal(walk2.status, 201);

    // Odds Lock Guard: cannot switch prize after paid entry
    const switchBlocked = await apiJson(baseUrl, `/api/sessions/${sessionId}/prize`, {
      method: 'POST',
      headers: hostHeaders,
      body: JSON.stringify({ prizeId: 'prize_1' })
    });
    assert.equal(switchBlocked.status, 409, 'Changing prize after paid entry must return 409');

    // Wheel shrink conflict guard: shrinking to 10 while #18 is claimed must return 409
    const shrinkBlocked = await apiJson(baseUrl, `/api/sessions/${sessionId}/wheel-config`, {
      method: 'POST',
      headers: hostHeaders,
      body: JSON.stringify({ numberMax: 10, hasDoubleZero: true })
    });
    assert.equal(shrinkBlocked.status, 409);

    // Cannot spin before closing registration
    const spinEarly = await apiJson(baseUrl, `/api/sessions/${sessionId}/spin`, {
      method: 'POST',
      headers: hostHeaders,
      body: JSON.stringify({ idempotencyKey: 'qa_early' })
    });
    assert.equal(spinEarly.status, 409);

    // Close registration, set GUARANTEED, spin with Idempotency-Key
    await apiJson(baseUrl, `/api/sessions/${sessionId}/mode`, {
      method: 'POST',
      headers: hostHeaders,
      body: JSON.stringify({ mode: 'GUARANTEED' })
    });
    const closed = await apiJson(baseUrl, `/api/sessions/${sessionId}/close-registration`, {
      method: 'POST',
      headers: hostHeaders,
      body: JSON.stringify({})
    });
    assert.equal(closed.status, 200);

    const spinRes = await apiJson(baseUrl, `/api/sessions/${sessionId}/spin`, {
      method: 'POST',
      headers: { ...hostHeaders, 'idempotency-key': 'qa_e2e_spin_1' },
      body: JSON.stringify({})
    });
    assert.equal(spinRes.status, 200);
    assert.equal(spinRes.body.success, true);
    assert(['6', '10', '18'].includes(String(spinRes.body.winningNumber)));
    await waitForEvent(tvSock.events, 'spin:started', (s) => String(s.winningNumber) === String(spinRes.body.winningNumber));

    // Idempotent duplicate spin
    const dupSpin = await apiJson(baseUrl, `/api/sessions/${sessionId}/spin`, {
      method: 'POST',
      headers: { ...hostHeaders, 'idempotency-key': 'qa_e2e_spin_1' },
      body: JSON.stringify({})
    });
    assert.equal(dupSpin.status, 200);
    assert.equal(dupSpin.body.winningNumber, spinRes.body.winningNumber);

    // Verify Daily Profit Guard endpoint reflects >=30% protected shop margin
    const guardRes = await apiJson(baseUrl, `/api/sessions/${sessionId}/daily-profit-guard`);
    assert.equal(guardRes.status, 200);
    assert.equal(guardRes.body.dailyProfitGuard.collectedToday, 60);
    assert(guardRes.body.dailyProfitGuard.marginPct >= 30, `Margin must stay >=30% (got ${guardRes.body.dailyProfitGuard.marginPct}%)`);

    console.log(`  ✅ Full HTTP + Socket.IO E2E flow passed (Winner #${spinRes.body.winningNumber}, Margin ${guardRes.body.dailyProfitGuard.marginPct}%)`);
  } finally {
    for (const s of sockets) {
      try { s.disconnect(); } catch {}
    }
    serverProc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 300));
    if (!serverProc.killed) {
      try { serverProc.kill('SIGKILL'); } catch {}
    }
  }
}

async function runPropertyAndWheelTests(tempDir) {
  console.log('\n=== PHASE 3: Statistical Fairness, Profit-Guard Invariants & Wheel Geometry ===');
  const propScript = path.join(tempDir, 'qa-property-worker.mjs');
  const propDb = path.join(tempDir, 'qa-property.sqlite');

  const workerCode = `
import assert from 'node:assert/strict';
import { GameEngine, buildWheelNumbers, calculateProfitabilityModel } from ${JSON.stringify(pathToFileURL(path.join(ROOT_DIR, 'server', 'gameEngine.js')).href)};
import { db } from ${JSON.stringify(pathToFileURL(path.join(ROOT_DIR, 'server', 'db.js')).href)};

const mockIo = { to: () => ({ emit: () => {} }), emit: () => {} };
const engine = new GameEngine(mockIo);

// 1. Wheel Geometry & Rotation Math Test across 10, 15, 20, 30 numbers (+ zeros / no zeros)
for (const count of [10, 15, 20, 30]) {
  for (const hasDoubleZero of [true, false]) {
    const nums = buildWheelNumbers({ min: 1, max: count, hasDoubleZero });
    const expectedLen = hasDoubleZero ? count + 2 : count;
    assert.equal(nums.length, expectedLen, 'Wheel pocket count mismatch');
    if (hasDoubleZero) {
      assert.equal(nums[0], '0');
      assert.equal(nums[Math.floor(nums.length / 2)], '00');
      if (count % 2 === 0) {
        assert.equal(nums.indexOf('00'), nums.length / 2, '00 must be exactly 180 deg opposite 0 on even counts');
      }
    } else {
      assert(!nums.includes('0') && !nums.includes('00'));
    }

    // Replicate exact ArcadeWheel.jsx spin angle alignment math over 25 sequential spins
    const segmentAngle = 360 / nums.length;
    let currentRotation = 0;
    for (let s = 0; s < 25; s++) {
      const target = nums[(s * 7) % nums.length];
      const winningIdx = nums.findIndex((n) => String(n) === String(target));
      assert(winningIdx >= 0, 'Target must exist on wheel');
      const targetSliceCenterAngle = winningIdx * segmentAngle;
      const currentNorm = currentRotation % 360;
      const desiredNorm = (360 - (targetSliceCenterAngle % 360)) % 360;
      let delta = desiredNorm - currentNorm;
      if (delta <= 0) delta += 360;
      const finalRotation = currentRotation + 12 * 360 + delta;
      assert(finalRotation > currentRotation + 12 * 360, 'Wheel must spin strictly clockwise >= 12 full turns');

      // Check SVG slice center after CSS rotation lands at -90 deg (12 o'clock pointer)
      const svgCenter = -90 + winningIdx * segmentAngle;
      const worldDeg = ((svgCenter + finalRotation + 90) % 360 + 360) % 360;
      const distFromTop = Math.min(worldDeg, 360 - worldDeg);
      assert(distFromTop < 1e-6, \`Pointer alignment error for \${count}/\${target}: \${distFromTop}\`);
      currentRotation = finalRotation;
    }
  }
}
console.log('  ✅ ArcadeWheel rotation & 12 o\\'clock pointer alignment verified across all 8 configs (200 spins)');

// 2. Profit-Guard Property Test across margins (30%, 40%, 50%) in 1.5x/2x/3x Cash Multiplier TRUE_ODDS (400 rounds)
for (const marginPct of [30, 40, 50]) {
  const s = await engine.createSession({
    numberMin: 1,
    numberMax: 20,
    defaultPrizeId: 'prize_cash_3x',
    shopCode: \`CHX-PG\${marginPct}\`,
    shopName: \`Profit Guard \${marginPct}%\`
  });
  engine.updateFinancialSettings(s.sessionId, { targetProfitMarginPct: marginPct });
  engine.setWinnerMode(s.sessionId, 'TRUE_ODDS');

  let winners = 0;
  for (let roundIdx = 0; roundIdx < 120; roundIdx++) {
    if (roundIdx > 0) {
      const nr = engine.createNextRound(s.sessionId, { prizeId: 'prize_cash_3x' });
      assert.equal(nr.success, true);
    }
    // Varying player counts & bet sizes (including big R100 bet mixed with R10 bets)
    const numPlayers = (roundIdx % 4) + 1;
    for (let p = 0; p < numPlayers; p++) {
      const bet = (roundIdx % 7 === 0 && p === 0) ? 100 : 10;
      const hc = engine.hostClaimNumber(s.sessionId, {
        number: String((p * 3) + 2),
        nickname: \`P\${p}\`,
        betAmount: bet
      });
      assert.equal(hc.success, true);
    }
    engine.closeRegistration(s.sessionId);
    const sp = engine.spin(s.sessionId, { idempotencyKey: \`pg_\${marginPct}_\${roundIdx}\` });
    assert.equal(sp.success, true);
    if (sp.hasWinner) {
      assert(!['0', '00'].includes(String(sp.winningNumber)), 'Winner can never be House Zero 0 or 00');
      winners++;
      assert([1.5, 2, 3].includes(sp.appliedMultiplier), \`Invalid multiplier: \${sp.appliedMultiplier}\`);
    }
    // Crucial invariant: shop cumulative/daily margin NEVER breaches targetProfitMarginPct!
    const guard = engine.getDailyProfitGuard(s.sessionId);
    assert(
      guard.marginPct >= marginPct - 0.01,
      \`PROFIT VIOLATION at \${marginPct}% floor on round \${roundIdx}: got margin \${guard.marginPct}% (collected R\${guard.collectedToday}, prizes R\${guard.prizesToday})\`
    );
  }
  assert(winners > 10, \`Players must win fairly regularly under \${marginPct}% guard (only got \${winners}/120)\`);
  console.log(\`  ✅ 120-round Cash Multiplier simulation @ \${marginPct}% Profit Floor: \${winners}/120 winners, floor NEVER violated\`);
}

// 3. Weighted Cash Schedule Monte Carlo Simulation (1,000 spins, empirical house EV & reserve protection)
const ws = await engine.createSession({
  numberMin: 1,
  numberMax: 20,
  defaultPrizeId: 'prize_weighted_cash',
  shopCode: 'CHX-WMC',
  shopName: 'Weighted Monte Carlo'
});
engine.setWinnerMode(ws.sessionId, 'TRUE_ODDS');
const snap0 = engine.getSessionSnapshot(ws.sessionId);
let totalCollected = 0;
let totalPaid = 0;
let winCount = 0;
for (let i = 0; i < 1000; i++) {
  if (i > 0) {
    engine.createNextRound(ws.sessionId, { prizeId: 'prize_weighted_cash' });
  }
  const whc = engine.hostClaimNumber(ws.sessionId, { number: '7', nickname: 'Spinner', betAmount: 10 });
  if (!whc.success) {
    const stCheck = engine.getHouseCashStats(ws.sessionId);
    assert.equal(whc.status, 403, 'Weighted cash block must only occur on reserve exhaustion');
    assert.equal(stCheck.isReserveExhausted, true, 'Reserve exhaustion must be active');
    break;
  }
  totalCollected += 10;
  engine.closeRegistration(ws.sessionId);
  const res = engine.spin(ws.sessionId, { idempotencyKey: \`mc_\${i}\` });
  assert.equal(res.success, true);
  if (res.hasWinner) {
    winCount++;
    totalPaid += Number(res.winnerPayoutAmount || 0);
    assert([10, 20, 50, 100].includes(res.winnerPayoutAmount));
  }
  const wGuard = engine.getDailyProfitGuard(ws.sessionId);
  assert(wGuard.marginPct >= 30 - 0.01, \`Weighted cash margin dropped below 30% on round \${i}: \${wGuard.marginPct}%\`);
}
console.log(\`  ✅ 1,000-spin Weighted Cash Monte Carlo: \${winCount} wins (\${(winCount / 10).toFixed(2)}%), Collected R\${totalCollected}, Paid R\${totalPaid}, Profit Margin \${(((totalCollected - totalPaid) / totalCollected) * 100).toFixed(2)}%\`);

// 4. Profitability Model sanity check
const pm = calculateProfitabilityModel();
assert.equal(pm.expectedPayoutPerSpin, 0.575);
assert.equal(pm.scenarios.uptake50.grossSpinRevenue, 6500);
console.log('  ✅ Deterministic profitability model calculations verified');
`;

  fs.writeFileSync(propScript, workerCode, 'utf8');
  const res = await runChildNode(['--experimental-sqlite', propScript], {
    CHILLAX_DB_PATH: propDb,
    CHILLAX_SKIP_MONGO: '1'
  });
  process.stdout.write(res.stdout);
  if (res.stderr.trim()) process.stderr.write(res.stderr);
  assert.equal(res.code, 0, `Property worker exited with code ${res.code}`);
}

async function main() {
  const startMs = Date.now();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chillax-spin-qa-'));
  console.log('🧪 CHILLAX SPIN & WIN — AUTOMATED QA TEST RUNNER');
  console.log(`📁 Isolated Temp Directory (live SQLite untouched): ${tempDir}\n`);

  const liveSqlite = path.join(ROOT_DIR, 'data', 'chillax_spin.sqlite');
  const liveStatBefore = fs.existsSync(liveSqlite) ? fs.statSync(liveSqlite) : null;

  try {
    console.log('=== PHASE 1: Existing Unit Test Suite (test/server.test.js) [Isolated SQLite] ===');
    const unitRes = await runChildNode(['--experimental-sqlite', 'test/server.test.js'], {
      CHILLAX_DB_PATH: path.join(tempDir, 'unit.sqlite'),
      CHILLAX_SKIP_MONGO: '1'
    });
    process.stdout.write(unitRes.stdout);
    if (unitRes.stderr.trim()) process.stderr.write(unitRes.stderr);
    assert.equal(unitRes.code, 0, `Existing unit suite failed with exit code ${unitRes.code}`);

    await runHttpAndSocketE2E(path.join(tempDir, 'e2e.sqlite'));
    await runPropertyAndWheelTests(tempDir);

    if (liveStatBefore) {
      const liveStatAfter = fs.statSync(liveSqlite);
      assert.equal(liveStatAfter.mtimeMs, liveStatBefore.mtimeMs, 'Live data/chillax_spin.sqlite MUST remain unmodified!');
      assert.equal(liveStatAfter.size, liveStatBefore.size, 'Live data/chillax_spin.sqlite size MUST remain unmodified!');
      console.log('\n🔒 Verified live data/chillax_spin.sqlite was 100% untouched.');
    }

    const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(2);
    console.log(`\n🎉 ALL AUTOMATED QA SUITES PASSED IN ${elapsedSec}s!`);
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((err) => {
  console.error('\n❌ QA SUITE FAILED:', err);
  process.exit(1);
});
