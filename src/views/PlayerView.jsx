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
  const [betAmount, setBetAmount] = useState(5);

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
        if (myClaim && myClaim.number === newState.currentRound?.winningNumber) {
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

    const isCashRound = Boolean(
      session?.currentRound?.isCashRound ||
      session?.currentRound?.prize?.prize_type === 'cash_multiplier'
    );
    const numericBet = Number(betAmount);
    if (isCashRound && (!Number.isFinite(numericBet) || numericBet < 5)) {
      setErrorMsg('Minimum bet amount is R5 for 3x Cash Prize rounds!');
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
          betAmount: isCashRound ? numericBet : 0
        })
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to claim number.');
        sounds.playError();
      } else {
        sounds.playClick();
        if (isCashRound) {
          setClaimSuccessMsg(`You claimed #${num} with a R${data.betAmount} bet — Win R${data.payoutAmount} Cash!`);
        } else {
          setClaimSuccessMsg(`You claimed Number #${num}! Good luck!`);
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
              <label>Game Code (5 Letters)</label>
              <input
                type="text"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="e.g. K7P4Q"
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

            {errorMsg && (
              <div className="player-error-alert">
                <AlertCircle size={16} /> {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !code.trim()}
              className="arcade-btn-primary w-full"
            >
              {loading ? 'Connecting...' : 'Join Game'}
            </button>
          </form>

          <div className="player-footer-note">
            No registration or download required. Free arcade fun at Chillax Gaming Center.
          </div>
        </div>
      </div>
    );
  }

  const status = session.status;
  const currentRound = session.currentRound;
  const prize = currentRound?.prize;
  const isCashRound = Boolean(currentRound?.isCashRound || prize?.prize_type === 'cash_multiplier');
  const myEntry = session.entries?.find((e) => e.player_token === playerToken);
  const myClaimedNumber = myEntry?.number;
  const isWinner = status === 'RESULT' && currentRound?.hasWinner && myClaimedNumber === currentRound?.winningNumber;
  const isNoWinner = status === 'RESULT' && !currentRound?.hasWinner;
  const isLoser = status === 'RESULT' && currentRound?.hasWinner && myClaimedNumber !== currentRound?.winningNumber;

  return (
    <div className="player-arena-container">
      {/* Top Mobile Bar */}
      <div className="player-top-bar">
        <div>
          <span className="player-bar-brand">CHILLAX SPIN</span>
          <span className="player-bar-code">CODE: {session.shortCode}</span>
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
              <span> • R{myEntry.bet_amount} (Win R{myEntry.payout_amount})</span>
            )}
          </div>
        )}
      </div>

      {/* Status Banner */}
      <div className="player-status-banner">
        {status === 'REGISTRATION_OPEN' && (
          <div className="banner-content open">
            <span className="pulse-dot green" />
            <span>Select one available number below!</span>
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
            {isCashRound ? '💰 REAL CASH MULTIPLIER ROUND' : "THIS ROUND'S PRIZE"}
          </div>
          <div className="prize-title">{prize.name}</div>
          <div className="prize-desc">{prize.description}</div>
        </div>
      )}

      {/* Cash Bet Amount Selector (Only for 3x Cash Multiplier Rounds) */}
      {isCashRound && (
        <div className="player-bet-card">
          <div className="player-bet-header">
            <span className="bet-title">💰 Enter Your Bet (Min R5)</span>
            <span className="bet-payout-preview">
              Win 3x: <strong>R{Number(betAmount) >= 5 ? Math.round(Number(betAmount) * 3 * 100) / 100 : 0}</strong>
            </span>
          </div>
          <div className="bet-presets-row">
            {[5, 10, 20, 50, 100].map((amt) => (
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
                Update Bet
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
            <span className="won-prize-label">{isCashRound ? '3X CASH PAYOUT WON' : 'PRIZE WON'}</span>
            <span className="won-prize-name">
              {isCashRound && myEntry?.payout_amount
                ? `R${myEntry.payout_amount} CASH`
                : prize?.name}
            </span>
            <span className="won-prize-desc">
              {isCashRound && myEntry?.bet_amount
                ? `3x your R${myEntry.bet_amount} bet!`
                : prize?.description}
            </span>
          </div>
          <div className="redemption-token-box">
            <span>VERIFICATION TOKEN</span>
            <code>{playerToken.slice(-6).toUpperCase()}</code>
          </div>
          <p className="winner-instructions">
            Show this screen to the Chillax counter staff to redeem your prize!
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
          {Array.from({ length: session.numberRange.max - session.numberRange.min + 1 }).map((_, i) => {
            const num = session.numberRange.min + i;
            const entry = session.entries?.find((e) => e.number === num);
            const isMyPick = myClaimedNumber === num;
            const isTaken = Boolean(entry && !isMyPick);
            const isLocked = status !== 'REGISTRATION_OPEN';

            return (
              <button
                key={num}
                type="button"
                disabled={isTaken || isLocked || isClaiming}
                onClick={() => handleClaimNumber(num)}
                className={`player-grid-btn ${isMyPick ? 'my-pick' : ''} ${isTaken ? 'taken' : 'available'}`}
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
