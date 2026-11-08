import React, { useState, useEffect, useCallback } from 'react';
import { getSocket, getPlayerToken, getSavedNickname, saveNickname } from '../utils/socket';
import { sounds } from '../utils/sound';
import confetti from 'canvas-confetti';
import { Check, Lock, Sparkles, Award, User, RefreshCw, AlertCircle, Trophy, Zap, Ticket, ShieldCheck } from 'lucide-react';

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
        particleCount: 95,
        spread: 75,
        origin: { y: 0.6 },
        colors: ['#00f2fe', '#f59e0b', '#10b981', '#8b5cf6', '#fef08a']
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
        if (isCashRound) {
          setClaimSuccessMsg(
            `Locked in #${num} with a R${data.betAmount} stake (Tx: ${data.txId || 'OK'}) — Win R${Math.round(data.betAmount * 1.5 * 100) / 100} to R${Math.round(data.betAmount * 3 * 100) / 100} Cash!`
          );
        } else {
          setClaimSuccessMsg(`You claimed Lucky Number #${num} (Tx: ${data.txId || 'OK'})! Eyes on the TV!`);
        }
      }
    } catch {
      setErrorMsg('Network error submitting claim.');
      sounds.playError();
    } finally {
      setIsClaiming(false);
    }
  };

  // If not in a session yet, display the majestic VIP Join Portal
  if (!session) {
    return (
      <div className="player-join-screen">
        <div className="player-join-card">
          <div className="player-hero-emblem">
            <Trophy size={32} className="text-gold" />
          </div>
          <div className="player-brand-badge">
            <span className="brand-chillax">CHILLAX</span>
            <span className="brand-sub">★ SPIN &amp; WIN ★</span>
          </div>

          <h2 className="join-title">Enter the Live Arena</h2>
          <p className="join-lead">Enter the Venue Shop Code shown on the big screen to pick your lucky number!</p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              joinSession(code);
            }}
            className="player-form"
          >
            <div className="player-input-group">
              <label>Venue Shop Code</label>
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
              <label>Your Gamer Tag / First Name</label>
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

            <label className="player-age-check">
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
              {loading ? 'Connecting to Arena...' : '🚀 Enter Live Game'}
            </button>
          </form>

          <div className="player-footer-note">
            <ShieldCheck size={14} className="inline-icon text-cyan" /> 18+ Responsible Play • Play within your budget • Chillax Gaming Center
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
      {/* Sticky VIP Top Mobile Bar */}
      <div className="player-top-bar">
        <div className="player-top-left">
          <Trophy size={18} className="text-gold" />
          <span className="player-bar-brand">{session.shopName || 'CHILLAX SPIN'}</span>
          <span className="player-bar-code">{session.shopCode || session.shortCode}</span>
        </div>
        <div className="player-round-tag">
          ROUND #{currentRound?.roundNumber || 1}
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
            placeholder="Tap to enter your nickname..."
            className="player-mini-input"
            disabled={status !== 'REGISTRATION_OPEN'}
          />
        </div>
        {myClaimedNumber && (
          <div className="my-pick-badge">
            ★ PICK #{myClaimedNumber}
          </div>
        )}
      </div>

      {/* Live Status Banner */}
      <div className={`player-status-banner banner-${status.toLowerCase()}`}>
        {status === 'REGISTRATION_OPEN' && (
          <div className="banner-content open">
            <span className="pulse-dot green" />
            <span>Entries Open — Tap your lucky number below!</span>
          </div>
        )}
        {status === 'REGISTRATION_CLOSED' && (
          <div className="banner-content closed">
            <Lock size={16} />
            <span>Entries Locked! Eyes on the TV screen...</span>
          </div>
        )}
        {status === 'SPINNING' && (
          <div className="banner-content spinning">
            <RefreshCw size={16} className="icon-spin text-cyan" />
            <span>⚡ Wheel is spinning on TV! Good luck!</span>
          </div>
        )}
        {status === 'RESULT' && (
          <div className="banner-content result">
            <Award size={18} className="text-gold" />
            <span>WINNING NUMBER: #{currentRound?.winningNumber}</span>
          </div>
        )}
      </div>

      {/* Golden VIP Active Ticket (if player has claimed a number) */}
      {myClaimedNumber && status !== 'RESULT' && (
        <div className="player-vip-ticket animate-pop-in">
          <div className="vip-ticket-left">
            <span className="vip-ticket-kicker">
              <Ticket size={13} className="inline-icon" /> YOUR ACTIVE LUCKY TICKET
            </span>
            <span className="vip-ticket-player">{myEntry?.nickname || nickname}</span>
            <span className="vip-ticket-meta">
              {isCashRound && myEntry?.bet_amount >= 5
                ? `Stake: R${myEntry.bet_amount} • Potential Win: R${Math.round(myEntry.bet_amount * 1.5 * 100) / 100}–R${Math.round(myEntry.bet_amount * 3 * 100) / 100}`
                : `Prize Round Entry`}
              {myEntry?.tx_id ? ` • ${myEntry.tx_id}` : ''}
            </span>
          </div>
          <div className="vip-ticket-number-medallion">
            <span className="medallion-label">LUCKY #</span>
            <span className="medallion-num">{myClaimedNumber}</span>
          </div>
        </div>
      )}

      {/* Appetising Prize Showcase Banner */}
      {prize && (
        <div className={`player-prize-card ${isCashRound ? 'cash-prize-card' : ''}`}>
          <div className="prize-pill" style={{ background: prize.color || '#00f2fe' }}>
            {isCashRound ? '💰 REAL CASH MULTIPLIER ROUND' : "🎁 THIS ROUND'S PRIZE"}
          </div>
          <div className="prize-title">{isWeightedCash ? '💰 Cash Multiplier (1.5x / 2x / 3x)' : prize.name}</div>
          <div className="prize-desc">{isWeightedCash ? 'Win 1.5x, 2x, or 3x your bet in real cash! (Min bet R5)' : prize.description}</div>
          {isCashRound && session.houseCashStats?.dailyProfitGuard && (
            <div className="player-max-prize-badge">
              {session.houseCashStats.dailyProfitGuard.maxPrizeThisRound >= 7.5
                ? `🏆 Max Cash Prize This Spin: R${Math.round(session.houseCashStats.dailyProfitGuard.maxPrizeThisRound)}`
                : `🔥 Prize Pot Building — More Players Unlock Bigger Cash Wins!`}
            </div>
          )}
        </div>
      )}

      {/* Cash Bet Amount Selector */}
      {isCashRound && (
        <div className="player-bet-card">
          <div className="player-bet-header">
            <span className="bet-title">
              <Zap size={14} className="inline-icon text-gold" /> Choose Your Stake (Min R5)
            </span>
            <span className="bet-payout-preview">
              Win: <strong>R{Number(betAmount) >= 5 ? Math.round(Number(betAmount) * 1.5 * 100) / 100 : 0} – R{Number(betAmount) >= 5 ? Math.round(Number(betAmount) * 3 * 100) / 100 : 0}</strong>
            </span>
          </div>
          <div className="bet-multiplier-tiers">
            <span className="mult-tier-pill">1.5x → R{Number(betAmount) >= 5 ? Math.round(Number(betAmount) * 1.5 * 100) / 100 : 0}</span>
            <span className="mult-tier-pill tier-2x">2x → R{Number(betAmount) >= 5 ? Math.round(Number(betAmount) * 2 * 100) / 100 : 0}</span>
            <span className="mult-tier-pill tier-3x">3x → R{Number(betAmount) >= 5 ? Math.round(Number(betAmount) * 3 * 100) / 100 : 0}</span>
          </div>
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

      {/* Celebratory Winner Card */}
      {isWinner && (
        <div className="player-winner-card animate-pop-in">
          <div className="winner-glow-ring">
            <Trophy size={40} className="text-gold" />
          </div>
          <h2 className="winner-headline">👑 YOU WON! 👑</h2>
          <p className="winner-lead">
            Your lucky number <strong>#{myClaimedNumber}</strong> hit the jackpot!
          </p>
          <div className="winner-prize-display" style={{ borderColor: prize?.color || '#f59e0b' }}>
            <span className="won-prize-label">
              {isCashRound
                ? `🔥 ${currentRound?.prizeTierLabel || `${currentRound?.appliedMultiplier || 1.5}X CASH`} WON!`
                : '🏆 PRIZE WON'}
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
            <span>OFFICIAL REDEMPTION CODE</span>
            <code>{currentRound?.redemptionCode || playerToken.slice(-6).toUpperCase()}</code>
          </div>
          <p className="winner-instructions">
            Present this Golden Voucher to the Chillax Host at the front desk to claim your prize!
          </p>
        </div>
      )}

      {isNoWinner && (
        <div className="player-loser-card">
          <h3 className="text-gold">No Winner This Round!</h3>
          <p>
            The wheel landed on <strong className="text-cyan">#{currentRound?.winningNumber}</strong>, which was unclaimed!
          </p>
          <p className="text-muted text-sm mt-1">
            Your pick was #{myClaimedNumber || 'none'}. Get ready for the next spin!
          </p>
        </div>
      )}

      {isLoser && (
        <div className="player-loser-card">
          <h3>So Close, {nickname || 'Gamer'}!</h3>
          <p>
            Winning number was <strong className="text-cyan">#{currentRound?.winningNumber}</strong>.
            Your number was #{myClaimedNumber || 'none'}.
          </p>
          <p className="text-muted text-sm mt-1">
            Stay ready — the next round is about to open!
          </p>
        </div>
      )}

      {/* Interactive 3D Tactile Number Grid */}
      <div className="player-grid-section">
        <div className="grid-header-row">
          <span className="grid-title">🎯 Tap Your Lucky Number</span>
          <span className="grid-legend">
            <span className="legend-item"><span className="legend-swatch my" /> You</span>
            <span className="legend-item"><span className="legend-swatch open" /> Open</span>
            <span className="legend-item"><span className="legend-swatch taken" /> Taken</span>
          </span>
        </div>

        <div className="player-number-grid">
          {gridDisplayNumbers.map((num) => {
            const entry = session.entries?.find((e) => String(e.number) === String(num));
            const isMyPick = String(myClaimedNumber) === String(num);
            const isTaken = Boolean(entry && !isMyPick);
            const isLocked = status !== 'REGISTRATION_OPEN';
            const isZero = String(num) === '0' || String(num) === '00';
            const isWinningPocket = status === 'RESULT' && String(currentRound?.winningNumber) === String(num);

            return (
              <button
                key={num}
                type="button"
                disabled={isTaken || isLocked || isClaiming}
                onClick={() => handleClaimNumber(num)}
                className={`player-grid-btn ${isZero ? 'zero-chip' : ''} ${isMyPick ? 'my-pick' : ''} ${isTaken ? 'taken' : 'available'} ${isWinningPocket ? 'winning-pocket' : ''}`}
              >
                <span className="btn-num">{num}</span>
                <span className="btn-state-label">
                  {isMyPick && (
                    <>
                      <Check size={11} className="inline-icon" /> YOUR PICK
                    </>
                  )}
                  {isTaken && (
                    <>
                      <Lock size={10} className="inline-icon" /> {entry?.nickname ? entry.nickname.slice(0, 7) : 'TAKEN'}
                    </>
                  )}
                  {!isMyPick && !isTaken && (isZero ? '★ VIP ZERO' : 'OPEN')}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
