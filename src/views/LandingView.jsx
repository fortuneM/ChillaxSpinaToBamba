import React from 'react';
import { Tv, Smartphone, Shield, Sparkles, CheckCircle, Trophy, Zap, Crown } from 'lucide-react';

export function LandingView() {
  return (
    <div className="landing-container">
      {/* Hero Section */}
      <header className="landing-hero">
        <div className="landing-badge">
          <Crown size={16} className="text-gold" /> PREMIER GAMING LOUNGE EXPERIENCE
        </div>
        <h1 className="landing-title">
          CHILLAX SPIN &amp; WIN
        </h1>
        <p className="landing-subtitle">
          High-energy, real-time 3D arcade prize wheel &amp; smart profit-guarded cash multiplier arena for Android TV, Host Controllers, and Mobile Players.
        </p>

        {/* Quick Launch Cards */}
        <div className="landing-cards-grid">
          {/* TV Display Card */}
          <div className="launch-card tv-card">
            <div className="card-icon-wrap cyan-glow">
              <Tv size={34} className="text-cyan" />
            </div>
            <span className="launch-card-tag">16:9 BIG SCREEN</span>
            <h3>Broadcast TV Arena</h3>
            <p>
              Full-HD arcade game show stage with 3D marquee wheel, live challenger board, QR join portal, synthesizer sound FX, and royal winner celebrations.
            </p>
            <a href="/tv" className="arcade-btn-primary w-full">
              Launch TV Arena (/tv)
            </a>
          </div>

          {/* Host Controller Card */}
          <div className="launch-card host-card">
            <div className="card-icon-wrap gold-glow">
              <Shield size={34} className="text-gold" />
            </div>
            <span className="launch-card-tag gold">COMMAND DECK</span>
            <h3>Host Controller</h3>
            <p>
              Executive staff command deck synced with your Chillax Gaming App account. Control rounds, walk-in picks, 30%+ daily profit guard, and instant redemptions.
            </p>
            <a href="/host" className="arcade-btn-warning w-full">
              Open Host Deck (/host)
            </a>
          </div>

          {/* Player Join Card */}
          <div className="launch-card player-card">
            <div className="card-icon-wrap purple-glow">
              <Smartphone size={34} className="text-green" />
            </div>
            <span className="launch-card-tag green">VIP MOBILE PORTAL</span>
            <h3>Player Controller</h3>
            <p>
              Tactile mobile game controller for players. Scan the TV QR code or enter the Shop Code, pick your lucky number, and receive a Golden VIP Winner Ticket.
            </p>
            <a href="/join" className="arcade-btn-success w-full">
              Join as Player (/join)
            </a>
          </div>
        </div>
      </header>

      {/* Feature Architecture Matrix */}
      <section className="landing-specs">
        <h2 className="specs-title">
          <Sparkles size={20} className="inline-icon text-gold" /> Engineered for Excitement &amp; Guaranteed Shop Profit
        </h2>
        <div className="specs-grid">
          <div className="spec-item">
            <CheckCircle size={20} className="text-cyan inline-icon" />
            <div>
              <strong>30%+ Daily Profit-Guard Engine:</strong>
              <span> Automatically protects your daily shop profit floor first and funds cash multiplier winners from the remaining prize pool.</span>
            </div>
          </div>
          <div className="spec-item">
            <CheckCircle size={20} className="text-cyan inline-icon" />
            <div>
              <strong>Atomic Number Claiming:</strong>
              <span> Real-time WebSocket &amp; SQLite/MongoDB locking guarantees zero collisions between mobile QR players and front-desk walk-in picks.</span>
            </div>
          </div>
          <div className="spec-item">
            <CheckCircle size={20} className="text-cyan inline-icon" />
            <div>
              <strong>Chillax Gaming Hub Cloud Sync:</strong>
              <span> Every entry, spin result, and redemption automatically syncs to your permanent MongoDB Atlas database and sales reports.</span>
            </div>
          </div>
          <div className="spec-item">
            <CheckCircle size={20} className="text-cyan inline-icon" />
            <div>
              <strong>Synthesized Arcade Sound &amp; FX:</strong>
              <span> Mechanical peg ticks, suspenseful deceleration, and royal victory fanfare generated live via Web Audio API.</span>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <p>★ Chillax Spin &amp; Win • Crafted for Chillax Gaming Center • Local &amp; Cloud Synced ★</p>
      </footer>
    </div>
  );
}
