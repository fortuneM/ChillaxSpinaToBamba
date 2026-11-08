import React, { useEffect, useState, useRef, useCallback } from 'react';
import { getSocket } from '../utils/socket';
import { ArcadeWheel } from '../components/ArcadeWheel';
import { sounds } from '../utils/sound';
import confetti from 'canvas-confetti';
import { Volume2, VolumeX, Tv, Users, Sparkles, Award, Trophy, Flame, QrCode, ShieldCheck, Zap } from 'lucide-react';

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
      const hostUrl = window.location.origin;
      const joinUrl = `${hostUrl}/join?code=${shortCode}`;
      const QRCode = (await import('qrcode')).default;
      const dataUrl = await QRCode.toDataURL(joinUrl, {
        margin: 1,
        width: 240,
        color: {
          dark: '#00f2fe',
          light: '#050b18'
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
      const end = Date.now() + 5000;
      const colors = ['#00f2fe', '#8b5cf6', '#f59e0b', '#ec4899', '#10b981', '#fef08a'];

      (function frame() {
        confetti({
          particleCount: 5,
          angle: 60,
          spread: 65,
          origin: { x: 0, y: 0.72 },
          colors
        });
        confetti({
          particleCount: 5,
          angle: 120,
          spread: 65,
          origin: { x: 1, y: 0.72 },
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

  // If TV is not yet paired with a session, display majestic pairing splash screen
  if (!session) {
    return (
      <div className="tv-pairing-screen">
        <div className="tv-pairing-card">
          <div className="tv-pairing-badge">
            <Sparkles size={16} className="text-gold" /> LIVE ARENA DISPLAY
          </div>
          <div className="tv-logo-glow">
            <span className="arcade-title">CHILLAX</span>
            <span className="arcade-subtitle">★ SPIN &amp; WIN ★</span>
          </div>
          <p className="tv-pairing-lead">
            Welcome to the Premier Gaming Lounge Arena. Enter your Shop Code to pair this big screen with the Host Controller.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              pairWithCode(pairingCodeInput);
            }}
            className="tv-pairing-form"
          >
            <label className="tv-input-label">Enter Linked Shop Code (e.g. CHX-2855) or Pairing Code</label>
            <div className="tv-input-row">
              <input
                type="text"
                maxLength={12}
                value={pairingCodeInput}
                onChange={(e) => setPairingCodeInput(e.target.value.toUpperCase())}
                placeholder="e.g. CHX-2855"
                className="tv-pairing-input"
                autoFocus
              />
              <button type="submit" disabled={isPairing || !pairingCodeInput} className="arcade-btn-primary">
                {isPairing ? 'Connecting...' : 'Launch Arena'}
              </button>
            </div>
            {pairingError && <div className="tv-error-msg">{pairingError}</div>}
          </form>

          <div className="tv-pairing-tips">
            <p>💡 <strong>Host Setup:</strong> Sign in with your Chillax Gaming App account at <code>/host</code> to activate your Shop Code.</p>
          </div>
        </div>
      </div>
    );
  }

  const status = session.status;
  const currentRound = session.currentRound;
  const prize = currentRound?.prize;
  const isWeightedCash = Boolean(currentRound?.isWeightedCash || prize?.prize_type === 'weighted_cash');
  const isCashRound = Boolean(currentRound?.isCashRound || prize?.prize_type === 'cash_multiplier' || isWeightedCash);
  const isResultState = status === 'RESULT' && currentRound?.winningNumber;
  const hasWinner = Boolean(currentRound?.hasWinner || currentRound?.winningEntryId);

  // Ordered pockets for the Live Arena Number Board on the right column
  const allWheelPockets = session?.wheelNumbers || [];
  const zeros = allWheelPockets.filter((n) => n === '0' || n === '00');
  const nonZeros = allWheelPockets.filter((n) => n !== '0' && n !== '00').sort((a, b) => Number(a) - Number(b));
  const gridDisplayNumbers = (zeros.length > 0 || nonZeros.length > 0)
    ? [...zeros, ...nonZeros]
    : ['0', '00', ...Array.from({ length: (session?.numberRange?.max || 20) - (session?.numberRange?.min || 1) + 1 }, (_, i) => String((session?.numberRange?.min || 1) + i))];

  const entriesList = session?.entries || [];

  return (
    <div className="tv-root-container">
      {/* Ambient Stage Spotlights */}
      <div className="tv-stage-spotlights" aria-hidden="true">
        <div className="spotlight-beam beam-left" />
        <div className="spotlight-beam beam-right" />
        <div className="spotlight-center-aura" />
      </div>

      {/* Top Broadcast Header Bar */}
      <header className="tv-header-bar">
        <div className="tv-brand-wrapper">
          <div className="tv-brand-emblem">
            <Trophy size={22} className="text-gold" />
          </div>
          <span className="tv-logo-primary">{session.shopName || 'CHILLAX'}</span>
          <span className="tv-logo-tag">SPIN &amp; WIN</span>
          <span className="tv-round-pill">ROUND #{currentRound?.roundNumber || 1}</span>
        </div>

        <div className="tv-status-badge-wrapper">
          {status === 'REGISTRATION_OPEN' && (
            <div className="tv-status-badge status-open">
              <span className="pulse-dot green" /> ENTRIES OPEN • PICK YOUR LUCKY NUMBER!
            </div>
          )}
          {status === 'REGISTRATION_CLOSED' && (
            <div className="tv-status-badge status-closed">
              <span className="pulse-dot amber" /> ENTRIES LOCKED • READY TO SPIN!
            </div>
          )}
          {status === 'SPINNING' && (
            <div className="tv-status-badge status-spinning">
              <Sparkles size={18} className="icon-spin text-cyan inline-icon" /> WHEEL IS SPINNING!
            </div>
          )}
          {status === 'RESULT' && (
            <div className="tv-status-badge status-result">
              <Award size={18} className="text-gold inline-icon" /> WINNER ANNOUNCED!
            </div>
          )}
          {status === 'CANCELLED' && (
            <div className="tv-status-badge status-cancelled">
              ROUND CANCELLED
            </div>
          )}
        </div>

        <div className="tv-header-right">
          {isCashRound && (session.totalBets || 0) > 0 && (
            <div className="tv-pool-pill">
              <Flame size={16} className="text-gold" />
              <span>STAKES: <strong>R{session.totalBets}</strong></span>
            </div>
          )}
          <div className="tv-players-counter">
            <Users size={20} className="text-cyan" />
            <span><strong>{session.playerCount}</strong> / {gridDisplayNumbers.length} CLAIMED</span>
          </div>
          <button
            onClick={handleToggleSound}
            className="tv-sound-btn"
            title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
          >
            {isMuted ? <VolumeX size={22} className="text-muted" /> : <Volume2 size={22} className="text-cyan" />}
          </button>
        </div>
      </header>

      {/* Main 3-Column 16:9 Game Show Arena */}
      <main className="tv-arena">
        {/* LEFT COLUMN: QR Join Card & Prize Spotlight */}
        <section className="tv-join-panel">
          <div className="tv-join-card">
            <div className="join-card-badge">
              <QrCode size={14} /> SCAN OR ASK HOST
            </div>
            <h3 className="join-panel-heading">JOIN THIS SPIN</h3>
            <div className="tv-qr-box">
              {qrCodeUrl ? (
                <img src={qrCodeUrl} alt="Scan to join" className="tv-qr-image" />
              ) : (
                <div className="tv-qr-placeholder">Generating QR...</div>
              )}
            </div>
            <div className="tv-join-code-box">
              <span className="code-label">VENUE SHOP CODE</span>
              <span className="code-value">{session.shopCode || session.shortCode}</span>
            </div>
            <p className="tv-join-instruction">
              Visit <strong className="text-cyan">{window.location.host}/join</strong> or ask the Host at the counter!
            </p>
          </div>

          {/* Current Round Prize Spotlight */}
          {prize && (
            <div className={`tv-prize-spotlight ${isCashRound ? 'cash-spotlight' : ''}`}>
              <div className="prize-spotlight-label">
                {isCashRound ? (
                  <><Zap size={14} className="inline-icon text-gold" /> CASH MULTIPLIER JACKPOT</>
                ) : (
                  <><Trophy size={14} className="inline-icon text-gold" /> FEATURED ROUND PRIZE</>
                )}
              </div>
              <div className="prize-spotlight-name" style={{ color: isCashRound ? '#fef08a' : (prize.color || '#00f2fe') }}>
                {isWeightedCash ? '💰 Cash Multiplier (1.5x / 2x / 3x)' : prize.name}
              </div>

              {isCashRound ? (
                <div className="tv-multiplier-pills">
                  <span className="tv-mult-pill m-15">1.5x CASH</span>
                  <span className="tv-mult-pill m-20">2x CASH</span>
                  <span className="tv-mult-pill m-30">3x JACKPOT</span>
                </div>
              ) : (
                <div className="prize-spotlight-desc">{prize.description}</div>
              )}

              {isCashRound && session.houseCashStats?.dailyProfitGuard && (
                <div className="tv-max-prize-badge">
                  {session.houseCashStats.dailyProfitGuard.maxPrizeThisRound >= 7.5
                    ? `🏆 Max Cash Win This Spin: R${Math.round(session.houseCashStats.dailyProfitGuard.maxPrizeThisRound)}`
                    : `🔥 Prize Pot Building — Join Now to Unlock Cash Wins!`}
                </div>
              )}
            </div>
          )}
        </section>

        {/* CENTER COLUMN: The Majestic Wheel Stage */}
        <section className="tv-wheel-stage">
          <ArcadeWheel
            wheelNumbers={session.wheelNumbers}
            min={session.numberRange.min}
            max={session.numberRange.max}
            claimedNumbers={session.claimedNumbers || []}
            winningNumber={currentRound?.winningNumber}
            isSpinning={isSpinning || status === 'SPINNING'}
            spinDurationMs={5000}
            onSpinComplete={() => {
              setIsSpinning(false);
            }}
          />

          {/* Wheel Status Footer */}
          <div className="tv-wheel-caption">
            {status === 'REGISTRATION_OPEN' && (
              <div className="caption-pill">
                <Sparkles size={15} className="text-gold" />
                <span className="caption-text">
                  Claim your lucky number now! <span className="highlight-gold">Gold slices</span> are live in play!
                </span>
              </div>
            )}
            {status === 'REGISTRATION_CLOSED' && (
              <div className="caption-pill locked">
                <span className="caption-text blink-slow">
                  🔒 All numbers locked! Eyes on the golden pointer...
                </span>
              </div>
            )}
            {status === 'SPINNING' && (
              <div className="caption-pill spinning">
                <span className="caption-text text-cyan">
                  ⚡ High-speed spin in progress — Who takes the crown?!
                </span>
              </div>
            )}
          </div>
        </section>

        {/* RIGHT COLUMN: Live Arena Number Board & Challengers */}
        <section className="tv-live-board-panel">
          <div className="tv-board-card">
            <div className="tv-board-header">
              <div>
                <span className="tv-board-kicker">LIVE ARENA BOARD</span>
                <h3 className="tv-board-title">LUCKY NUMBERS</h3>
              </div>
              <span className="tv-board-count">
                {entriesList.length} / {gridDisplayNumbers.length}
              </span>
            </div>

            {/* Compact Live Number Pocket Grid on TV */}
            <div className="tv-pocket-grid">
              {gridDisplayNumbers.map((num) => {
                const entry = entriesList.find((e) => String(e.number) === String(num));
                const isZero = String(num) === '0' || String(num) === '00';
                const isWin = isResultState && String(currentRound?.winningNumber) === String(num);
                return (
                  <div
                    key={num}
                    className={`tv-pocket-tile ${isZero ? 'zero-tile' : ''} ${entry ? 'claimed-tile' : 'open-tile'} ${isWin ? 'winner-tile' : ''}`}
                  >
                    <span className="tv-tile-num">#{num}</span>
                    <span className="tv-tile-name">
                      {entry ? entry.nickname : 'OPEN'}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Latest Players Ticker */}
            <div className="tv-recent-players">
              <div className="tv-recent-header">
                <Users size={13} className="text-cyan" />
                <span>CHALLENGERS IN THIS SPIN</span>
              </div>
              {entriesList.length === 0 ? (
                <div className="tv-empty-challengers">
                  Be the first challenger on the board! Scan QR or ask the Host.
                </div>
              ) : (
                <div className="tv-challenger-chips">
                  {entriesList.slice(-8).reverse().map((ent) => (
                    <div key={ent.id || ent.number} className="tv-challenger-pill">
                      <span className="challenger-num">#{ent.number}</span>
                      <span className="challenger-nick">{ent.nickname}</span>
                      {isCashRound && Number(ent.bet_amount) > 0 && (
                        <span className="challenger-bet">R{ent.bet_amount}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* Result Screen Overlay (Winner or Unclaimed) */}
      {isResultState && (
        <div className="tv-result-overlay">
          {hasWinner ? (
            <div className="tv-result-card animate-pop-in">
              <div className="result-crown-badge">
                <Trophy size={42} className="text-gold" />
              </div>
              <div className="result-kicker">★ CONGRATULATIONS ★</div>
              <div className="result-headline">WE HAVE A WINNER!</div>

              <div className="result-number-pod">
                <span className="result-num-label">WINNING NUMBER</span>
                <span className="result-big-number">#{currentRound.winningNumber}</span>
              </div>

              {/* Winner nickname */}
              {session.entries?.find(e => e.number === currentRound.winningNumber)?.nickname && (
                <div className="result-player-name">
                  👑 {session.entries.find(e => e.number === currentRound.winningNumber)?.nickname}
                </div>
              )}

              {/* Prize Won */}
              {prize && (() => {
                const winEntry = session.entries?.find(e => e.number === currentRound.winningNumber);
                const winBet = Number(winEntry?.bet_amount || currentRound?.winnerBetAmount || 0);
                const winPayout = Number(winEntry?.payout_amount || currentRound?.winnerPayoutAmount || 0);
                const winMult = Number(currentRound?.appliedMultiplier || 1.5);
                const tierLabel = currentRound?.prizeTierLabel;
                return (
                  <div className="result-prize-box">
                    <span className="result-won-label">
                      {isWeightedCash
                        ? `🎯 ${tierLabel || `R${winPayout} CASH PRIZE`} HIT!`
                        : isCashRound
                          ? `🔥 ${winMult}X CASH MULTIPLIER HIT!`
                          : '🏆 GRAND PRIZE WON:'}
                    </span>
                    <span className="result-prize-title" style={{ color: prize.color || '#fef08a' }}>
                      {isCashRound && winPayout > 0 ? `R${winPayout} CASH!` : prize.name}
                    </span>
                    <span className="result-prize-val">
                      {isCashRound && winBet > 0
                        ? `${tierLabel || `${winMult}x`} on their R${winBet} stake!${currentRound?.redemptionCode ? ` • Code: ${currentRound.redemptionCode}` : ''}`
                        : prize.description}
                    </span>
                  </div>
                );
              })()}

              <div className="result-footer-instructions">
                <ShieldCheck size={16} className="inline-icon text-cyan" />
                {session.entries?.find(e => e.number === currentRound.winningNumber)?.player_token?.startsWith('host_pick_')
                  ? 'Host-registered pick! Claim your prize directly with the Chillax Host at the front desk!'
                  : 'Present your winning phone screen or verify with the Chillax front desk to redeem!'}
              </div>
            </div>
          ) : (
            <div className="tv-result-card tv-no-winner-card animate-pop-in">
              <div className="result-kicker text-danger">UNCLAIMED POCKET</div>
              <div className="result-headline text-danger">NO WINNER THIS ROUND!</div>

              <div className="result-number-pod border-danger">
                <span className="result-num-label">LANDED ON NUMBER</span>
                <span className="result-big-number">#{currentRound.winningNumber}</span>
              </div>

              <div className="result-unclaimed-notice">
                The wheel landed on <strong>#{currentRound.winningNumber}</strong>, which was unclaimed this round!
              </div>

              {prize && (
                <div className="result-prize-box">
                  <span className="result-won-label text-gold">PRIZE ROLLS OVER TO NEXT SPIN:</span>
                  <span className="result-prize-title" style={{ color: prize.color || '#00f2fe' }}>
                    {isWeightedCash ? '💰 Cash Multiplier (1.5x / 2x / 3x)' : prize.name}
                  </span>
                </div>
              )}

              <div className="result-footer-instructions">
                Get ready for the next round — Lock in your lucky numbers now!
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
