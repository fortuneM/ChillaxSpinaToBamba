import React, { useState, useEffect, useCallback } from 'react';
import { getSocket, getPlayerToken, getSavedNickname, saveNickname } from '../utils/socket';
import { sounds } from '../utils/sound';
import confetti from 'canvas-confetti';
import { Check, Lock, Sparkles, Award, User, RefreshCw, AlertCircle } from 'lucide-react';

export function PlayerView() {
  const [code, setCode] = useState('');
  const [nickname, setNickname] = useState(getSavedNickname());
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [claimSuccessMsg, setClaimSuccessMsg] = useState('');
  const [isClaiming, setIsClaiming] = useState(false);
  const [betAmount, setBetAmount] = useState(10);
  const [ageVerified, setAgeVerified] = useState(true);

  const playerToken = getPlayerToken();

  // Read URL search params on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const codeParam = params.get('code');
    if (codeParam) {
      const cleanCode = codeParam.trim().toUpperCase();
      setCode(cleanCode);
      joinSession(cleanCode);
    }
  }, []);

  const joinSession = async (codeToJoin) => {
    if (!codeToJoin) return;
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch(`/api/sessions/find/${codeToJoin.trim().toUpperCase()}`);
      if (!res.ok) {
        const err = await res.json();
        setErrorMsg(err.error || 'Session not found. Please verify game code.');
        setLoading(false);
        return;
      }
      const data = await res.json();
      setSession(data);
    } catch {
      setErrorMsg('Failed to connect to gaming center server.');
    } finally {
      setLoading(false);
    }
  };

  // Socket sync
  useEffect(() => {
    if (!session?.sessionId) return;
    const socket = getSocket();

    socket.emit('join:session', {
      sessionId: session.sessionId,
      role: 'player'
    });

    const handleState = (newState) => {
      setSession(newState);
      // If we just entered result state and player won, trigger celebratory confetti
      if (newState.status === 'RESULT') {
        const myClaim = newState.entries?.find(e => e.player_token === playerToken);
        if (myClaim && String(myClaim.number) === String(newState.currentRound?.winningNumber)) {
          triggerPlayerConfetti();
          sounds.playFanfare();
        }
      }
    };

    socket.on('session:state', handleState);
    return () => {
      socket.off('session:state', handleState);
    };
  }, [session?.sessionId, playerToken]);

  const triggerPlayerConfetti = useCallback(() => {
    try {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 }
      });
    } catch {}
  }, []);

  // Claim a number
  const handleClaimNumber = async (num) => {
    if (!nickname.trim()) {
      setErrorMsg('Please enter your nickname first!');
      sounds.playError();
      return;
    }

    if (!ageVerified) {
      setErrorMsg('You must confirm you are 18+ to enter.');
      sounds.playError();
      return;
    }

    const isWeightedCash = Boolean(
      session?.currentRound?.isWeightedCash ||
      session?.currentRound?.prize?.prize_type === 'weighted_cash'
    );
    const isCashRound = Boolean(
      session?.currentRound?.isCashRound ||
      session?.currentRound?.prize?.prize_type === 'cash_multiplier' ||
      isWeightedCash
    );
    const numericBet = Number(betAmount);
    if (isCashRound && (!Number.isFinite(numericBet) || numericBet < 5)) {
      setErrorMsg('Minimum stake is R5 (recommended R10) for Cash Spin rounds!');
      sounds.playError();
      return;
    }

    saveNickname(nickname.trim());
    setIsClaiming(true);
    setErrorMsg('');
    setClaimSuccessMsg('');

    try {
      const res = await fetch(`/api/sessions/${session.sessionId}/entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          number: num,
          playerToken,
          nickname: nickname.trim(),
          betAmount: isCashRound ? numericBet : 0,
          ageVerified: Boolean(ageVerified)
        })
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to claim number.');
        sounds.playError();
      } else {
        sounds.playClick();
        if (isWeightedCash) {
          setClaimSuccessMsg(
            `You claimed #${num} with a R${data.betAmount} stake (Tx: ${data.txId || 'OK'}) — Win R10, R20, R50, or R100 Cash!`
          );
        } else if (isCashRound) {
          setClaimSuccessMsg(
            `You claimed #${num} with a R${data.betAmount} bet (Tx: ${data.txId || 'OK'}) — Win R${Math.round(data.betAmount * 1.5 * 100) / 100} to R${Math.round(data.betAmount * 3 * 100) / 100} Cash!`
          );
        } else {
          setClaimSuccessMsg(`You claimed Number #${num} (Tx: ${data.txId || 'OK'})! Good luck!`);
        }
      }
    } catch {
      setErrorMsg('Network error submitting claim.');
      sounds.playError();
    } finally {
      setIsClaiming(false);
    }
  };

  // If not in a session yet, display the join code & nickname form
  if (!session) {
    return (
      <div className="player-join-screen">
        <div className="player-join-card">
          <div className="player-brand-badge">
            <span className="brand-chillax">CHILLAX</span>
            <span className="brand-sub">SPIN & WIN</span>
          </div>

          <h2 className="join-title">Join the Live Game</h2>
          <p className="join-lead">Enter the code displayed on the venue TV to pick your lucky number!</p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              joinSession(code);
            }}
            className="player-form"
          >
            <div className="player-input-group">
              <label>Shop Code</label>
              <input
                type="text"
                maxLength={12}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="e.g. CHX-2855"
                className="player-code-input"
                autoFocus
              />
            </div>

            <div className="player-input-group">
              <label>Your Nickname / First Name</label>
              <div className="nickname-input-wrapper">
                <User size={18} className="input-icon" />
                <input
                  type="text"
                  maxLength={15}
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="e.g. Thabo or SpeedRacer"
                  className="player-text-input"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-muted mb-2" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={ageVerified}
                onChange={(e) => setAgeVerified(e.target.checked)}
              />
              <span>I confirm I am 18+ and accept the Chillax Spin &amp; Win responsible play rules.</span>
            </label>

            {errorMsg && (
              <div className="player-error-alert">
                <AlertCircle size={16} /> {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !code.trim() || !ageVerified}
              className="arcade-btn-primary w-full"
            >
              {loading ? 'Connecting...' : 'Join Game'}
            </button>
          </form>

          <div className="player-footer-note">
            18+ Responsible Play • Play within your budget • Chillax Gaming Center.
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
  const myEntry = session.entries?.find((e) => e.player_token === playerToken);
  const myClaimedNumber = myEntry?.number;
  const isWinner = status === 'RESULT' && currentRound?.hasWinner && myClaimedNumber === currentRound?.winningNumber;
  const isNoWinner = status === 'RESULT' && !currentRound?.hasWinner;
  const isLoser = status === 'RESULT' && currentRound?.hasWinner && myClaimedNumber !== currentRound?.winningNumber;

  // Grid displays 0 and 00 at the top row, followed by 1 to N
  const allWheelPockets = session?.wheelNumbers || [];
  const zeros = allWheelPockets.filter((n) => n === '0' || n === '00');
  const nonZeros = allWheelPockets.filter((n) => n !== '0' && n !== '00').sort((a, b) => Number(a) - Number(b));
  const gridDisplayNumbers = (zeros.length > 0 || nonZeros.length > 0)
    ? [...zeros, ...nonZeros]
    : ['0', '00', ...Array.from({ length: (session?.numberRange?.max || 20) - (session?.numberRange?.min || 1) + 1 }, (_, i) => String((session?.numberRange?.min || 1) + i))];

  return (
    <div className="player-arena-container">
      {/* Top Mobile Bar */}
      <div className="player-top-bar">
        <div>
          <span className="player-bar-brand">{session.shopName || 'CHILLAX SPIN'}</span>
          <span className="player-bar-code">SHOP CODE: {session.shopCode || session.shortCode}</span>
        </div>
        <div className="player-round-tag">
          Round #{currentRound?.roundNumber || 1}
        </div>
      </div>

      {/* Nickname / Player Identity Bar */}
      <div className="player-id-bar">
        <div className="player-id-left">
          <User size={16} className="text-cyan" />
          <input
            type="text"
            maxLength={15}
            value={nickname}
            onChange={(e) => {
              setNickname(e.target.value);
              saveNickname(e.target.value);
            }}
            placeholder="Your nickname"
            className="player-mini-input"
            disabled={status !== 'REGISTRATION_OPEN'}
          />
        </div>
        {myClaimedNumber && (
          <div className="my-pick-badge">
            MY PICK: <strong>#{myClaimedNumber}</strong>
            {isCashRound && myEntry?.bet_amount >= 5 && (
              <span>
                {' '}• R{myEntry.bet_amount}
              </span>
            )}
            {myEntry?.tx_id && (
              <span className="text-xs text-cyan"> ({myEntry.tx_id})</span>
            )}
          </div>
        )}
      </div>

      {/* Status Banner */}
      <div className="player-status-banner">
        {status === 'REGISTRATION_OPEN' && (
          <div className="banner-content open">
            <span className="pulse-dot green" />
            <span>Select one available number below! (18+ Responsible Play)</span>
          </div>
        )}
        {status === 'REGISTRATION_CLOSED' && (
          <div className="banner-content closed">
            <Lock size={16} />
            <span>Entries Locked! Host is preparing the spin...</span>
          </div>
        )}
        {status === 'SPINNING' && (
          <div className="banner-content spinning">
            <RefreshCw size={16} className="icon-spin text-cyan" />
            <span>Wheel is spinning on TV! Watch the big screen!</span>
          </div>
        )}
        {status === 'RESULT' && (
          <div className="banner-content result">
            <Award size={16} className="text-gold" />
            <span>Winning Number: #{currentRound?.winningNumber}</span>
          </div>
        )}
      </div>

      {/* Prize Preview */}
      {prize && (
        <div className="player-prize-card">
          <div className="prize-pill" style={{ background: prize.color || '#00f2fe' }}>
            {isWeightedCash
              ? '🎯 R10 SPIN CASH SCHEDULE (R10 / R20 / R50 / R100)'
              : isCashRound
                ? '💰 REAL CASH MULTIPLIER ROUND'
                : "THIS ROUND'S PRIZE"}
          </div>
          <div className="prize-title">{prize.name}</div>
          <div className="prize-desc">{prize.description}</div>
        </div>
      )}

      {/* Cash Bet Amount Selector */}
      {isCashRound && (
        <div className="player-bet-card">
          <div className="player-bet-header">
            <span className="bet-title">
              {isWeightedCash ? '🎯 Choose Spin Stake (R10 Standard)' : '💰 Enter Your Bet (Min R5)'}
            </span>
            <span className="bet-payout-preview">
              {isWeightedCash ? (
                <>Tiers: <strong>R10 • R20 • R50 • R100</strong></>
              ) : (
                <>Win: <strong>R{Number(betAmount) >= 5 ? Math.round(Number(betAmount) * 1.5 * 100) / 100 : 0} – R{Number(betAmount) >= 5 ? Math.round(Number(betAmount) * 3 * 100) / 100 : 0}</strong></>
              )}
            </span>
          </div>
          {isWeightedCash ? (
            <div className="bet-multiplier-tiers">
              <span className="mult-tier-pill">R10 (1 in 25)</span>
              <span className="mult-tier-pill tier-2x">R20 (1 in 200)</span>
              <span className="mult-tier-pill tier-3x">R50 (1 in 1,000)</span>
              <span className="mult-tier-pill tier-3x">R100 (1 in 4,000)</span>
            </div>
          ) : (
            <div className="bet-multiplier-tiers">
              <span className="mult-tier-pill">1.5x: R{Number(betAmount) >= 5 ? Math.round(Number(betAmount) * 1.5 * 100) / 100 : 0}</span>
              <span className="mult-tier-pill tier-2x">2x: R{Number(betAmount) >= 5 ? Math.round(Number(betAmount) * 2 * 100) / 100 : 0}</span>
              <span className="mult-tier-pill tier-3x">3x: R{Number(betAmount) >= 5 ? Math.round(Number(betAmount) * 3 * 100) / 100 : 0}</span>
            </div>
          )}
          <div className="bet-presets-row">
            {[5, 10, 20, 50].map((amt) => (
              <button
                key={amt}
                type="button"
                disabled={status !== 'REGISTRATION_OPEN'}
                onClick={() => setBetAmount(amt)}
                className={`bet-preset-pill ${Number(betAmount) === amt ? 'active' : ''}`}
              >
                R{amt}
              </button>
            ))}
          </div>
          <div className="bet-custom-input-row">
            <span className="rand-prefix">R</span>
            <input
              type="number"
              min="5"
              step="1"
              disabled={status !== 'REGISTRATION_OPEN'}
              value={betAmount}
              onChange={(e) => setBetAmount(e.target.value)}
              placeholder="Enter amount (min R5)"
              className="bet-custom-input"
            />
            {myClaimedNumber && status === 'REGISTRATION_OPEN' && Number(myEntry?.bet_amount) !== Number(betAmount) && Number(betAmount) >= 5 && (
              <button
                type="button"
                disabled={isClaiming}
                onClick={() => handleClaimNumber(myClaimedNumber)}
                className="bet-update-btn"
              >
                Update Stake
              </button>
            )}
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="player-error-alert">
          <AlertCircle size={16} /> {errorMsg}
        </div>
      )}

      {claimSuccessMsg && (
        <div className="player-success-alert">
          <Check size={16} /> {claimSuccessMsg}
        </div>
      )}

      {/* Result Cards */}
      {isWinner && (
        <div className="player-winner-card animate-pop-in">
          <div className="winner-glow-ring">
            <Sparkles size={36} className="text-gold" />
          </div>
          <h2 className="winner-headline">🎉 YOU WON! 🎉</h2>
          <p className="winner-lead">
            Your number <strong>#{myClaimedNumber}</strong> was selected!
          </p>
          <div className="winner-prize-display" style={{ borderColor: prize?.color || '#00f2fe' }}>
            <span className="won-prize-label">
              {isCashRound
                ? `🔥 ${currentRound?.prizeTierLabel || `${currentRound?.appliedMultiplier || 1.5}X CASH`} WON!`
                : 'PRIZE WON'}
            </span>
            <span className="won-prize-name">
              {isCashRound && myEntry?.payout_amount
                ? `R${myEntry.payout_amount} CASH`
                : prize?.name}
            </span>
            <span className="won-prize-desc">
              {isCashRound && myEntry?.bet_amount
                ? `${currentRound?.prizeTierLabel || `${currentRound?.appliedMultiplier || 1.5}x`} on your R${myEntry.bet_amount} stake!`
                : prize?.description}
            </span>
          </div>
          <div className="redemption-token-box">
            <span>REDEMPTION CODE &amp; TOKEN</span>
            <code>{currentRound?.redemptionCode || playerToken.slice(-6).toUpperCase()}</code>
          </div>
          <p className="winner-instructions">
            Show this Redemption Code to the Chillax counter staff to verify &amp; claim your prize!
          </p>
        </div>
      )}

      {isNoWinner && (
        <div className="player-loser-card">
          <h3 className="text-amber">No Winner This Round!</h3>
          <p>
            The wheel landed on <strong className="text-cyan">#{currentRound?.winningNumber}</strong>, but nobody claimed it!
          </p>
          <p className="text-muted text-sm">
            Your pick was #{myClaimedNumber || 'none'}. Prize rolls over to next round!
          </p>
        </div>
      )}

      {isLoser && (
        <div className="player-loser-card">
          <h3>Nice Try, {nickname || 'Gamer'}!</h3>
          <p>
            Winning number was <strong className="text-cyan">#{currentRound?.winningNumber}</strong>.
            Your number was #{myClaimedNumber || 'none'}.
          </p>
          <p className="text-muted text-sm">
            Keep your phone ready for the next spin!
          </p>
        </div>
      )}

      {/* Interactive Number Grid (Pages 8, 9) */}
      <div className="player-grid-section">
        <div className="grid-header-row">
          <span className="grid-title">Choose Your Number</span>
          <span className="grid-legend">
            <span className="legend-item"><span className="legend-swatch my" /> You</span>
            <span className="legend-item"><span className="legend-swatch taken" /> Taken</span>
            <span className="legend-item"><span className="legend-swatch open" /> Open</span>
          </span>
        </div>

        <div className="player-number-grid">
          {gridDisplayNumbers.map((num) => {
            const entry = session.entries?.find((e) => String(e.number) === String(num));
            const isMyPick = String(myClaimedNumber) === String(num);
            const isTaken = Boolean(entry && !isMyPick);
            const isLocked = status !== 'REGISTRATION_OPEN';
            const isZero = String(num) === '0' || String(num) === '00';

            return (
              <button
                key={num}
                type="button"
                disabled={isTaken || isLocked || isClaiming}
                onClick={() => handleClaimNumber(num)}
                className={`player-grid-btn ${isZero ? 'zero-chip' : ''} ${isMyPick ? 'my-pick' : ''} ${isTaken ? 'taken' : 'available'}`}
              >
                <span className="btn-num">{num}</span>
                <span className="btn-state-label">
                  {isMyPick && (
                    <>
                      <Check size={12} className="inline-icon" /> YOU
                    </>
                  )}
                  {isTaken && (
                    <>
                      <Lock size={12} className="inline-icon" /> TAKEN
                    </>
                  )}
                  {!isMyPick && !isTaken && 'OPEN'}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
