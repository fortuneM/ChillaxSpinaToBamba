// Web Audio API arcade sound synthesizer
class SoundManager {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.activeSpinInterval = null;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
  }

  // Crisp mechanical arcade wheel tick
  playTick(frequency = 750) {
    if (this.muted) return;
    try {
      this.init();
      if (!this.ctx) return;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(frequency, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(120, this.ctx.currentTime + 0.04);

      gain.gain.setValueAtTime(0.25, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.04);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.04);
    } catch {}
  }

  // UI button click
  playClick() {
    if (this.muted) return;
    try {
      this.init();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, this.ctx.currentTime + 0.05);

      gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.06);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.06);
    } catch {}
  }

  // Low warning buzz for errors / conflicts
  playError() {
    if (this.muted) return;
    try {
      this.init();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, this.ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(90, this.ctx.currentTime + 0.2);

      gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.2);
    } catch {}
  }

  // Dramatic descending buzzer chime when wheel lands on an unclaimed number
  playNoWinner() {
    if (this.muted) return;
    try {
      this.init();
      if (!this.ctx) return;

      const tones = [350, 310, 270, 210];
      tones.forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const t = this.ctx.currentTime + idx * 0.18;

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, t);
        osc.frequency.linearRampToValueAtTime(freq - 25, t + 0.16);

        gain.gain.setValueAtTime(0.18, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.17);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(t);
        osc.stop(t + 0.17);
      });
    } catch {}
  }

  // Suspenseful spin ticking sequence matching fast acceleration and deceleration
  startSpinSounds(durationMs = 5000) {
    if (this.muted) return;
    this.stopSpinSounds();
    this.init();

    const startTime = Date.now();
    let currentDelay = 25;

    const tick = () => {
      const elapsed = Date.now() - startTime;
      if (elapsed >= durationMs) {
        return;
      }

      const progress = elapsed / durationMs;
      if (progress < 0.65) {
        currentDelay = 28 + progress * 45;
      } else {
        const decelFactor = (progress - 0.65) / 0.35;
        currentDelay = 75 + Math.pow(decelFactor, 2.4) * 380;
      }

      const pitch = 700 + (1 - progress) * 240;
      this.playTick(pitch);

      this.activeSpinInterval = setTimeout(tick, currentDelay);
    };

    tick();
  }

  stopSpinSounds() {
    if (this.activeSpinInterval) {
      clearTimeout(this.activeSpinInterval);
      this.activeSpinInterval = null;
    }
  }

  // Triumphant victory fanfare chord arpeggio
  playFanfare() {
    if (this.muted) return;
    try {
      this.init();
      if (!this.ctx) return;

      const notes = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99, 1046.50];
      const noteDelay = 0.09;

      notes.forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        const t = this.ctx.currentTime + idx * noteDelay;
        const dur = idx === notes.length - 1 ? 0.9 : 0.25;

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t);

        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.25, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(t);
        osc.stop(t + dur);
      });
    } catch {}
  }
}

export const sounds = new SoundManager();
