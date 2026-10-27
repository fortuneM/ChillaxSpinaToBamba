import React from 'react';
import { Tv, Smartphone, Shield, Play, Sparkles, CheckCircle, Flame } from 'lucide-react';

export function LandingView() {
  return (
    <div className="landing-container">
      {/* Hero Section */}
      <header className="landing-hero">
        <div className="landing-badge">
          <Flame size={16} className="text-amber" /> CHILLAX GAMING CENTER
        </div>
        <h1 className="landing-title">
          SPIN & WIN
        </h1>
        <p className="landing-subtitle">
          Real-time arcade prize wheel coordination for Android TV and mobile phone controllers.
        </p>

        {/* Quick Launch Cards */}
        <div className="landing-cards-grid">
          {/* TV Display Card */}
          <div className="launch-card tv-card">
            <div className="card-icon-wrap">
              <Tv size={36} className="text-cyan" />
            </div>
            <h3>Android TV Display</h3>
            <p>
              16:9 large-screen arcade experience with live wheel animation, join QR code, sound synthesizer, and winner celebrations.
            </p>
            <a href="/tv" className="arcade-btn-primary w-full">
              Launch TV Display (/tv)
            </a>
          </div>

          {/* Host Controller Card */}
          <div className="launch-card host-card">
            <div className="card-icon-wrap">
              <Shield size={36} className="text-gold" />
            </div>
            <h3>Host Phone Controller</h3>
            <p>
              Staff portal with host PIN authentication (1234), session creation, entry locking, spin trigger, and prize redemption.
            </p>
            <a href="/host" className="arcade-btn-warning w-full">
              Open Host Controller (/host)
            </a>
          </div>

          {/* Player Join Card */}
          <div className="launch-card player-card">
            <div className="card-icon-wrap">
              <Smartphone size={36} className="text-purple" />
            </div>
            <h3>Player Join Portal</h3>
            <p>
              Mobile web app for gamers. Scan TV QR code or enter session code, choose a lucky number, and win instant prizes.
            </p>
            <a href="/join" className="arcade-btn-success w-full">
              Join as Player (/join)
            </a>
          </div>
        </div>
      </header>

      {/* Feature Architecture Matrix (Matching MVP Spec) */}
      <section className="landing-specs">
        <h2 className="specs-title">System Architecture & Core Rules</h2>
        <div className="specs-grid">
          <div className="spec-item">
            <CheckCircle size={20} className="text-cyan inline-icon" />
            <div>
              <strong>Server-Authoritative Fairness:</strong>
              <span> Winner selected uniformly using <code>crypto.randomInt</code> before animation starts; TV purely presents the result.</span>
            </div>
          </div>
          <div className="spec-item">
            <CheckCircle size={20} className="text-cyan inline-icon" />
            <div>
              <strong>Atomic Number Claiming:</strong>
              <span> SQLite unique constraint blocks race conditions; only one player can hold any number in a round.</span>
            </div>
          </div>
          <div className="spec-item">
            <CheckCircle size={20} className="text-cyan inline-icon" />
            <div>
              <strong>Instant State Recovery:</strong>
              <span> Authoritative snapshot syncs all clients immediately on Wi-Fi reconnect or browser refresh.</span>
            </div>
          </div>
          <div className="spec-item">
            <CheckCircle size={20} className="text-cyan inline-icon" />
            <div>
              <strong>Web Audio Arcade FX:</strong>
              <span> Zero asset downloads needed; mechanical peg ticks and victory fanfare generated on-device via Web Audio API.</span>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <p>Chillax Spin & Win • Built for Chillax Gaming Center • Local Venue Ready</p>
      </footer>
    </div>
  );
}
