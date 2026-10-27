import express from 'express';
import http from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { GameEngine } from './gameEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const engine = new GameEngine(io);

app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  if (!req.path.startsWith('/assets/')) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

// Host auth middleware helper
function requireHostAuth(req, res, next) {
  const pin = req.headers['x-host-pin'] || req.body?.hostPin || req.query?.hostPin;
  const clientIp = req.ip || req.socket.remoteAddress;
  const verification = engine.verifyHostPin(clientIp, pin || '', '1234');
  if (!verification.success) {
    return res.status(401).json({ error: verification.error || 'Unauthorized host access.' });
  }
  next();
}

// -------------------------------------------------------------
// API Endpoints (as defined in Spec Page 6 & Page 10)
// -------------------------------------------------------------

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'Chillax Spin & Win Coordinator',
    venue: 'Chillax Gaming Center',
    timezone: 'Africa/Johannesburg'
  });
});

// List prizes
app.get('/api/prizes', (req, res) => {
  const prizes = db.prepare('SELECT * FROM prizes WHERE enabled = 1').all();
  res.json({ prizes });
});

// Host PIN verification endpoint
app.post('/api/host/verify-pin', (req, res) => {
  const { pin } = req.body;
  const clientIp = req.ip || req.socket.remoteAddress;
  const result = engine.verifyHostPin(clientIp, pin, '1234');
  if (!result.success) {
    return res.status(401).json({ success: false, error: result.error });
  }
  res.json({ success: true, message: 'Host authenticated successfully.' });
});

// POST /api/sessions: Create new game session (Host)
app.post('/api/sessions', requireHostAuth, async (req, res) => {
  try {
    const { numberMin = 1, numberMax = 20, defaultPrizeId } = req.body;
    const sessionData = await engine.createSession({
      numberMin: parseInt(numberMin, 10) || 1,
      numberMax: parseInt(numberMax, 10) || 20,
      defaultPrizeId
    });
    res.status(201).json(sessionData);
  } catch (err) {
    console.error('Create session error:', err);
    res.status(500).json({ error: 'Failed to create session: ' + err.message });
  }
});

// GET /api/sessions/find/:code: Lookup session by shortCode or pairing code
app.get('/api/sessions/find/:code', (req, res) => {
  const code = req.params.code.trim().toUpperCase();
  const session = db.prepare('SELECT * FROM sessions WHERE short_code = ? OR tv_pairing_code = ?').get(code, code);
  if (!session) {
    return res.status(404).json({ error: 'Session not found for code: ' + code });
  }
  const snapshot = engine.getSessionSnapshot(session.id);
  res.json(snapshot);
});

// GET /api/sessions/:id/state: Authoritative session snapshot for reconnect/refresh
app.get('/api/sessions/:id/state', (req, res) => {
  const snapshot = engine.getSessionSnapshot(req.params.id);
  if (!snapshot) {
    return res.status(404).json({ error: 'Session not found.' });
  }
  res.json(snapshot);
});

// POST /api/sessions/:id/pair-tv: Pair TV display using short-lived pairing code (Host/TV)
app.post('/api/sessions/:id/pair-tv', (req, res) => {
  const { pairingCode } = req.body;
  const result = engine.pairTv(pairingCode || req.params.id);
  if (!result.success) {
    return res.status(404).json(result);
  }
  res.json(result);
});

// POST /api/sessions/:id/entries: Claim a number for the current round (Player)
app.post('/api/sessions/:id/entries', (req, res) => {
  const { number, playerToken, nickname } = req.body;
  if (!playerToken) {
    return res.status(400).json({ error: 'Player token is required.' });
  }
  const result = engine.claimNumber(req.params.id, { number, playerToken, nickname });
  if (!result.success) {
    return res.status(result.status || 400).json(result);
  }
  res.status(201).json(result);
});

// POST /api/sessions/:id/close-registration: Lock entries (Host)
app.post('/api/sessions/:id/close-registration', requireHostAuth, (req, res) => {
  const result = engine.closeRegistration(req.params.id);
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// POST /api/sessions/:id/reopen-registration: Reopen entries (Host)
app.post('/api/sessions/:id/reopen-registration', requireHostAuth, (req, res) => {
  const result = engine.reopenRegistration(req.params.id);
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// POST /api/sessions/:id/mode: Toggle winner difficulty mode (Host)
app.post('/api/sessions/:id/mode', requireHostAuth, (req, res) => {
  const { mode } = req.body;
  const result = engine.setWinnerMode(req.params.id, mode);
  res.json(result);
});

// POST /api/sessions/:id/spin: Trigger spin and select winner (Host)
app.post('/api/sessions/:id/spin', requireHostAuth, (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'] || req.body?.idempotencyKey;
  const result = engine.spin(req.params.id, { idempotencyKey });
  if (!result.success) {
    return res.status(result.status || 400).json(result);
  }
  res.json(result);
});

// POST /api/sessions/:id/rounds: Create next round (Host)
app.post('/api/sessions/:id/rounds', requireHostAuth, (req, res) => {
  const { prizeId, numberMin, numberMax } = req.body;
  const result = engine.createNextRound(req.params.id, { prizeId, numberMin, numberMax });
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.status(201).json(result);
});

// POST /api/rounds/:id/cancel: Cancel round with reason and audit (Host)
app.post('/api/rounds/:id/cancel', requireHostAuth, (req, res) => {
  const { sessionId, reason } = req.body;
  const result = engine.cancelRound(sessionId, req.params.id, reason);
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// POST /api/rounds/:id/redeem: Mark prize redeemed (Host)
app.post('/api/rounds/:id/redeem', requireHostAuth, (req, res) => {
  const { notes, redeemedBy } = req.body;
  const result = engine.redeemPrize(req.params.id, { notes, redeemedBy });
  if (!result.success) {
    return res.status(result.status || 400).json(result);
  }
  res.json(result);
});

// GET /api/sessions/:id/history: Retrieve completed round history (Host)
app.get('/api/sessions/:id/history', requireHostAuth, (req, res) => {
  const history = engine.getSessionHistory(req.params.id);
  res.json(history);
});

// -------------------------------------------------------------
// Real-time WebSockets with Socket.IO
// -------------------------------------------------------------
io.on('connection', (socket) => {
  let joinedSessionId = null;

  socket.on('join:session', ({ sessionId, role = 'player' }) => {
    if (!sessionId) return;
    joinedSessionId = sessionId;
    socket.join(sessionId);

    // Send latest authoritative state immediately upon joining/reconnecting
    const snapshot = engine.getSessionSnapshot(sessionId);
    if (snapshot) {
      socket.emit('session:state', snapshot);
    }
  });

  socket.on('disconnect', () => {
    // Clean up if needed
  });
});

// -------------------------------------------------------------
// Static Frontend Production Delivery
// -------------------------------------------------------------
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));

// Fallback to index.html for SPA routes (/tv, /host, /join)
app.get('*', (req, res) => {
  const indexPath = path.join(distPath, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      res.status(200).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Chillax Spin & Win</title>
            <style>
              body { background: #070d1e; color: #fff; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
              .card { background: #0f172a; padding: 2rem; border-radius: 12px; border: 1px solid #1e293b; text-align: center; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>Chillax Spin & Win API Server</h1>
              <p>Frontend is currently compiling or running in Vite dev mode.</p>
              <p><a href="/api/health" style="color: #06b6d4;">Check API Health</a></p>
            </div>
          </body>
        </html>
      `);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🎮 CHILLAX SPIN & WIN SERVER IS RUNNING`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`📺 TV Display: http://localhost:${PORT}/tv`);
  console.log(`📱 Host Controller: http://localhost:${PORT}/host`);
  console.log(`🎯 Player Join: http://localhost:${PORT}/join`);
  console.log(`=======================================================`);
});

export { app, server, engine };
