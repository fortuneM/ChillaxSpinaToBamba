import React, { useEffect, useState, useRef, useCallback } from 'react';
import { getSocket } from '../utils/socket';
import { ArcadeWheel } from '../components/ArcadeWheel';
import { sounds } from '../utils/sound';
import confetti from 'canvas-confetti';
import { Volume2, VolumeX, Tv, Users, Sparkles, Award } from 'lucide-react';

export function TvView() {
  const [session, setSession] = useState(null);
  const [pairingCodeInput, setPairingCodeInput] = useState('');
  const [isPairing, setIsPairing] = useState(false);
  const [pairingError, setPairingError] = useState('');
  const [isSpinning, setIsSpinning] = useState(false);
  const [spinningResult, setSpinningResult] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const confettiIntervalRef = useRef(null);

  // Initialize and check URL query param (e.g. /tv?code=K7P4Q)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const codeParam = params.get('code');
    if (codeParam) {
      pairWithCode(codeParam);
    } else {
      // Check localStorage for saved session
      const savedSessionId = localStorage.getItem('chillax_tv_session_id');
      if (savedSessionId) {
        fetchSessionState(savedSessionId);
      }
    }
  }, []);

  const fetchSessionState = async (sessionId) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/state`);
      if (res.ok) {
        const data = await res.json();
        setSession(data);
        localStorage.setItem('chillax_tv_session_id', data.sessionId);
        generateQrCode(data.shortCode);
      } else {
        localStorage.removeItem('chillax_tv_session_id');
      }
    } catch (e) {
      console.error('Failed to load session:', e);
    }
  };

  const generateQrCode = async (shortCode) => {
    try {
      // Host URL
      const hostUrl = window.location.origin;
      const joinUrl = `${hostUrl}/join?code=${shortCode}`;
      // Import QRCode dynamically or generate
      const QRCode = (await import('qrcode')).default;
      const dataUrl = await QRCode.toDataURL(joinUrl, {
        margin: 1,
        width: 220,
        color: {
          dark: '#00f2fe',
          light: '#070d1e'
        }
      });
      setQrCodeUrl(dataUrl);
    } catch (e) {
      console.error('QR generation error:', e);
    }
  };

  const pairWithCode = async (codeToPair) => {
    if (!codeToPair) return;
    setIsPairing(true);
    setPairingError('');
    try {
      const res = await fetch(`/api/sessions/find/${codeToPair.trim().toUpperCase()}`);
      if (!res.ok) {
        const err = await res.json();
        setPairingError(err.error || 'Game session not found.');
        setIsPairing(false);
        return;
      }
      const data = await res.json();
      setSession(data);
      localStorage.setItem('chillax_tv_session_id', data.sessionId);

      // Notify server TV has paired
      await fetch(`/api/sessions/${data.sessionId}/pair-tv`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairingCode: codeToPair })
      });

      generateQrCode(data.shortCode);
    } catch {
      setPairingError('Network error connecting to venue server.');
    } finally {
      setIsPairing(false);
    }
  };

  // Socket listener setup
  useEffect(() => {
    if (!session?.sessionId) return;
    const socket = getSocket();

    socket.emit('join:session', {
      sessionId: session.sessionId,
      role: 'tv'
    });

    const handleState = (newState) => {
      setSession(newState);
      if (newState.status === 'SPINNING') {
        setIsSpinning(true);
      } else if (newState.status !== 'SPINNING') {
        setIsSpinning(false);
      }
    };

    const handleSpinStarted = (data) => {
      setIsSpinning(true);
      setSpinningResult(data);
    };

    const handleSpinResult = (data) => {
      if (data.hasWinner) {
        triggerConfetti();
        sounds.playFanfare();
      } else {
        sounds.playNoWinner();
      }
    };

    socket.on('session:state', handleState);
    socket.on('spin:started', handleSpinStarted);
    socket.on('spin:result', handleSpinResult);

    return () => {
      socket.off('session:state', handleState);
      socket.off('spin:started', handleSpinStarted);
      socket.off('spin:result', handleSpinResult);
    };
  }, [session?.sessionId]);

  const triggerConfetti = useCallback(() => {
    try {
      const end = Date.now() + 4500;
      const colors = ['#00f2fe', '#8b5cf6', '#f59e0b', '#ec4899', '#ffffff'];

      (function frame() {
        confetti({
          particleCount: 4,
          angle: 60,
          spread: 60,
          origin: { x: 0, y: 0.7 },
          colors
        });
        confetti({
          particleCount: 4,
          angle: 120,
          spread: 60,
          origin: { x: 1, y: 0.7 },
          colors
        });

        if (Date.now() < end) {
          requestAnimationFrame(frame);
        }
      })();
    } catch {}
  }, []);

  const handleToggleSound = () => {
    const muted = sounds.toggleMute();
    setIsMuted(muted);
  };

  // If TV is not yet paired with a session, display pairing splash screen
  if (!session) {
    return (
      <div className="tv-pairing-screen">
        <div className="tv-pairing-card">
          <div className="tv-logo-glow">
            <span className="arcade-title">CHILLAX</span>
            <span className="arcade-subtitle">SPIN & WIN</span>
          </div>
          <p className="tv-pairing-lead">
            Welcome to the Gaming Center TV Experience. Pair this screen with the Host Controller.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              pairWithCode(pairingCodeInput);
            }}
            className="tv-pairing-form"
          >
            <label className="tv-input-label">Enter 4-Digit TV Pairing Code or 5-Letter Game Code</label>
            <div className="tv-input-row">
              <input
                type="text"
                maxLength={6}
                value={pairingCodeInput}
                onChange={(e) => setPairingCodeInput(e.target.value.toUpperCase())}
                placeholder="e.g. 4821 or K7P4Q"
                className="tv-pairing-input"
                autoFocus
              />
              <button type="submit" disabled={isPairing || !pairingCodeInput} className="arcade-btn-primary">
                {isPairing ? 'Connecting...' : 'Pair TV'}
              </button>
            </div>
            {pairingError && <div className="tv-error-msg">{pairingError}</div>}
          </form>

          <div className="tv-pairing-tips">
            <p>💡 <strong>Tip for Host:</strong> Start a session on your phone at <code>/host</code> and locate the TV pairing code.</p>
          </div>
        </div>
      </div>
    );
  }

  const status = session.status;
  const currentRound = session.currentRound;
  const prize = currentRound?.prize;
  const isResultState = status === 'RESULT' && currentRound?.winningNumber;
  const hasWinner = Boolean(currentRound?.hasWinner || currentRound?.winningEntryId);

  return (
    <div className="tv-root-container">
      {/* Top Header Bar */}
      <header className="tv-header-bar">
        <div className="tv-brand-wrapper">
          <span className="tv-logo-primary">CHILLAX</span>
          <span className="tv-logo-tag">SPIN & WIN</span>
          <span className="tv-round-pill">ROUND {currentRound?.roundNumber || 1}</span>
        </div>

        <div className="tv-status-badge-wrapper">
          {status === 'REGISTRATION_OPEN' && (
            <div className="tv-status-badge status-open">
              <span className="pulse-dot green" /> ENTRIES OPEN
            </div>
          )}
          {status === 'REGISTRATION_CLOSED' && (
            <div className="tv-status-badge status-closed">
              <span className="pulse-dot amber" /> ENTRIES LOCKED • READY TO SPIN
            </div>
          )}
          {status === 'SPINNING' && (
            <div className="tv-status-badge status-spinning">
              <Sparkles className="icon-spin text-cyan" /> WHEEL IS SPINNING!
            </div>
          )}
          {status === 'RESULT' && (
            <div className="tv-status-badge status-result">
              <Award className="text-amber" /> WINNER ANNOUNCED!
            </div>
          )}
          {status === 'CANCELLED' && (
            <div className="tv-status-badge status-cancelled">
              ROUND CANCELLED
            </div>
          )}
        </div>

        <div className="tv-header-right">
          <div className="tv-players-counter">
            <Users size={22} className="text-cyan" />
            <span><strong>{session.playerCount}</strong> PLAYERS</span>
          </div>
          <button
            onClick={handleToggleSound}
            className="tv-sound-btn"
            title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
          >
            {isMuted ? <VolumeX size={24} className="text-muted" /> : <Volume2 size={24} className="text-cyan" />}
          </button>
        </div>
      </header>

      {/* Main 16:9 Arena */}
      <main className="tv-arena">
        {/* Left Side: QR Code & Joining Info */}
        <section className="tv-join-panel">
          <div className="tv-join-card">
            <h3 className="join-panel-heading">JOIN THE GAME</h3>
            <div className="tv-qr-box">
              {qrCodeUrl ? (
                <img src={qrCodeUrl} alt="Scan to join" className="tv-qr-image" />
              ) : (
                <div className="tv-qr-placeholder">Generating QR...</div>
              )}
            </div>
            <div className="tv-join-code-box">
              <span className="code-label">GAME CODE</span>
              <span className="code-value">{session.shortCode}</span>
            </div>
            <p className="tv-join-instruction">
              Scan with phone camera or visit:
              <br />
              <strong className="text-cyan">{window.location.host}/join</strong>
            </p>
          </div>

          {/* Current Round Prize Spotlight */}
          {prize && (
            <div className="tv-prize-spotlight" style={{ borderColor: prize.color || '#00f2fe' }}>
              <div className="prize-spotlight-label">ROUND PRIZE</div>
              <div className="prize-spotlight-name" style={{ color: prize.color || '#00f2fe' }}>
                {prize.name}
              </div>
              <div className="prize-spotlight-desc">{prize.description}</div>
            </div>
          )}
        </section>

        {/* Center Arena: Wheel Display */}
        <section className="tv-wheel-stage">
          <ArcadeWheel
            min={session.numberRange.min}
            max={session.numberRange.max}
            claimedNumbers={session.claimedNumbers || []}
            winningNumber={currentRound?.winningNumber}
            isSpinning={isSpinning || status === 'SPINNING'}
            spinDurationMs={6500}
            onSpinComplete={() => {
              setIsSpinning(false);
            }}
          />

          {/* Wheel Status Footer */}
          <div className="tv-wheel-caption">
            {status === 'REGISTRATION_OPEN' && (
              <p className="caption-text">
                Pick an available number on your phone. <span className="highlight-gold">Golden glow</span> marks claimed numbers.
              </p>
            )}
            {status === 'REGISTRATION_CLOSED' && (
              <p className="caption-text blink-slow">
                All entries locked! Watch the wheel spin...
              </p>
            )}
            {status === 'SPINNING' && (
              <p className="caption-text text-cyan pulse">
                Suspense building... Who will take the prize?!
              </p>
            )}
          </div>
        </section>
      </main>

      {/* Result Screen Overlay (Winner or Unclaimed) */}
      {isResultState && (
        <div className="tv-result-overlay">
          {hasWinner ? (
            <div className="tv-result-card animate-pop-in">
              <div className="result-sparkles">
                <Sparkles size={48} className="text-gold spin-slow" />
              </div>
              <div className="result-headline">WE HAVE A WINNER!</div>

              <div className="result-number-pod">
                <span className="result-num-label">WINNING NUMBER</span>
                <span className="result-big-number">#{currentRound.winningNumber}</span>
              </div>

              {/* Winner nickname */}
              {session.entries?.find(e => e.number === currentRound.winningNumber)?.nickname && (
                <div className="result-player-name">
                  {session.entries.find(e => e.number === currentRound.winningNumber)?.nickname}
                </div>
              )}

              {/* Prize Won */}
              {prize && (
                <div className="result-prize-box">
                  <span className="result-won-label">WINS PRIZE:</span>
                  <span className="result-prize-title" style={{ color: prize.color || '#f59e0b' }}>
                    {prize.name}
                  </span>
                  <span className="result-prize-val">{prize.description}</span>
                </div>
              )}

              <div className="result-footer-instructions">
                Please present your winning phone screen to the Chillax front desk to redeem!
              </div>
            </div>
          ) : (
            <div className="tv-result-card tv-no-winner-card animate-pop-in">
              <div className="result-headline text-danger">NO WINNER THIS ROUND!</div>

              <div className="result-number-pod border-danger">
                <span className="result-num-label">LANDED ON NUMBER</span>
                <span className="result-big-number">#{currentRound.winningNumber}</span>
              </div>

              <div className="result-unclaimed-notice">
                The wheel landed on <strong>#{currentRound.winningNumber}</strong>, but no player claimed it!
              </div>

              {prize && (
                <div className="result-prize-box">
                  <span className="result-won-label text-gold">PRIZE ROLLS OVER:</span>
                  <span className="result-prize-title" style={{ color: prize.color || '#00f2fe' }}>
                    {prize.name}
                  </span>
                </div>
              )}

              <div className="result-footer-instructions">
                Better luck next round! Prepare your numbers on your phone...
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
