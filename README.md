# 🎮 Chillax Spin & Win

**Real-time Android TV & Phone Controller Arcade Prize Wheel**  
*Built for Chillax Gaming Center*

---

## 🌟 Overview

**Chillax Spin & Win** is a two-screen arcade entertainment system designed for gaming venues. A full-screen, vibrant prize wheel runs on an Android TV (or venue browser), while players participate directly from their smartphones without installing an app. The venue host manages the entire session, entry locking, spin triggering, and prize redemptions from an authenticated mobile phone controller.

---

## 🚀 Key Features

- 📺 **Android TV Display (`/tv`)**:
  - Full-screen 16:9 arcade aesthetic with deep navy background and neon cyan/purple/gold lighting.
  - Large deterministic arcade wheel with responsive SVG physics easing (acceleration → sustained spin → gradual deceleration precisely on the server-selected winning segment).
  - Prominent join QR code and 5-letter session code for instant mobile onboarding.
  - Built-in Web Audio API mechanical tick sounds and victory fanfare chime (no external audio files needed) with volume/mute toggle.
  - Confetti particle celebration burst upon winner announcement.

- 📱 **Host Phone Controller (`/host`)**:
  - Protected with rate-limited Host PIN (default: `1234`).
  - Configurable number ranges (1–10, 1–20 standard, 1–30) and prize selections.
  - One-touch TV pairing with a short 4-digit code.
  - Real-time live number grid monitor showing who claimed each number.
  - **"SPIN NOW!"** button with idempotency protection against double taps.
  - Prize redemption workflow to prevent duplicate claims and record audit trails.
  - Round history viewer and session cancellation controls.

- 🎯 **Player Join Portal (`/join`)**:
  - Zero-install mobile web app / PWA friendly.
  - Scan the TV QR code or enter the 5-character session code.
  - Pick a lucky number on a touch-optimized, high-contrast grid with clear accessible labels (`OPEN`, `YOU`, `TAKEN`).
  - Atomic number claiming powered by server-side SQLite unique constraints.
  - Synchronized suspense during the wheel spin.
  - Personalized winner card (`🎉 YOU WON!`) with prize details and verification code.

- ⚡ **Real-Time Backend & Architecture**:
  - **Node.js + Express** REST API.
  - **Socket.IO** for sub-100ms bidirectional event broadcasts.
  - **SQLite** database (`node:sqlite`) for zero-dependency local venue persistence.
  - Server-authoritative cryptographic winner selection (`crypto.randomInt`).
  - State snapshot recovery on network disconnect or browser refresh.

---

## 📂 Application Routes

| Route | Role | Description |
|---|---|---|
| `/` | Venue Hub | Launchpad for TV display, host controller, and player testing |
| `/tv` | Android TV Display | 16:9 wheel display, QR code, live claimed highlights, celebration |
| `/host` | Host Controller | Staff dashboard: PIN login, session setup, entry locking, spin, redeem |
| `/join` | Player Portal | Mobile number picking grid, live spin sync, personal result card |
| `/api/health` | Diagnostic | Service health check |

---

## 🛠️ Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Run in Development Mode
To run client with Vite hot module reloading:
```bash
# Terminal 1: Backend API & WebSockets
npm run dev:server

# Terminal 2: Frontend Vite Dev Server
npm run dev:client
```

### 3. Build & Run for Venue Production
For single-port venue deployment on local Wi-Fi:
```bash
# Build frontend bundle
npm run build

# Start production server
npm start
```
The server will be live at `http://<your-local-ip>:3000`.

---

## 🧪 Automated Testing

Run the test suite to verify session lifecycle, atomic claims, concurrency, spin idempotency, and prize redemptions:
```bash
npm test
```

---

## 🔐 Security & Operation Defaults

- **Host PIN**: `1234` (Rate-limited to 5 attempts before a 60-second lockout).
- **Default Rule**: Uniform random selection among claimed numbers.
- **Venue Wi-Fi**: Both the Android TV and mobile phones connect to the same venue local network address.
