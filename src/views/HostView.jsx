import React, { useState, useEffect, useCallback } from 'react';
import { getSocket } from '../utils/socket';
import { 
  Play, Lock, Unlock, RotateCcw, Award, CheckCircle2, 
  XCircle, Tv, AlertCircle, History, Shield, Users, RefreshCw
} from 'lucide-react';

export function HostView() {
  const [pin, setPin] = useState(localStorage.getItem('chillax_host_pin') || '');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState('');
  const [session, setSession] = useState(null);
  const [prizes, setPrizes] = useState([]);
  const [selectedPrizeId, setSelectedPrizeId] = useState('');
  const [numberMin, setNumberMin] = useState(1);
  const [numberMax, setNumberMax] = useState(20);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [historyData, setHistoryData] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [redeemNotes, setRedeemNotes] = useState('');

  // Check stored PIN on load
  useEffect(() => {
    fetchPrizes();
    const storedPin = localStorage.getItem('chillax_host_pin');
    if (storedPin) {
      verifyPin(storedPin);
    }
  }, []);

  const fetchPrizes = async () => {
    try {
      const res = await fetch('/api/prizes');
      if (res.ok) {
        const data = await res.json();
        setPrizes(data.prizes || []);
        if (data.prizes?.length > 0) {
          setSelectedPrizeId(data.prizes[0].id);
        }
      }
    } catch {}
  };

  const verifyPin = async (pinToTest) => {
    setAuthError('');
    try {
      const res = await fetch('/api/host/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinToTest })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setIsAuthenticated(true);
        localStorage.setItem('chillax_host_pin', pinToTest);
        // Try loading existing session
        const savedSessionId = localStorage.getItem('chillax_host_session_id');
        if (savedSessionId) {
          loadSession(savedSessionId);
        }
      } else {
        setIsAuthenticated(false);
        setAuthError(data.error || 'Invalid Host PIN');
      }
    } catch {
      setAuthError('Network error verifying PIN');
    }
  };

  const loadSession = async (sessionId) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/state`);
      if (res.ok) {
        const data = await res.json();
        setSession(data);
        localStorage.setItem('chillax_host_session_id', data.sessionId);
      }
    } catch {}
  };

  // Socket listener for real-time state sync
  useEffect(() => {
    if (!session?.sessionId) return;
    const socket = getSocket();

    socket.emit('join:session', {
      sessionId: session.sessionId,
      role: 'host'
    });

    const handleState = (newState) => {
      setSession(newState);
    };

    socket.on('session:state', handleState);
    return () => {
      socket.off('session:state', handleState);
    };
  }, [session?.sessionId]);

  const apiRequest = async (url, method = 'POST', body = {}) => {
    setActionError('');
    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-host-pin': pin
        },
        body: method !== 'GET' ? JSON.stringify(body) : undefined
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Action failed.');
        return null;
      }
      return data;
    } catch (e) {
      setActionError('Network connection error: ' + e.message);
      return null;
    }
  };

  // Create new session
  const handleCreateSession = async () => {
    setLoading(true);
    const data = await apiRequest('/api/sessions', 'POST', {
      numberMin: parseInt(numberMin, 10),
      numberMax: parseInt(numberMax, 10),
      defaultPrizeId: selectedPrizeId
    });
    setLoading(false);
    if (data?.sessionId) {
      setSession(data.snapshot);
      localStorage.setItem('chillax_host_session_id', data.sessionId);
    }
  };

  // Close registration
  const handleCloseRegistration = async () => {
    await apiRequest(`/api/sessions/${session.sessionId}/close-registration`);
  };

  // Reopen registration
  const handleReopenRegistration = async () => {
    await apiRequest(`/api/sessions/${session.sessionId}/reopen-registration`);
  };

  // Trigger spin with idempotency
  const handleSpinNow = async () => {
    const idempotencyKey = 'spin_' + session.sessionId + '_' + (session.currentRound?.id || 'rnd') + '_' + Date.now();
    await apiRequest(`/api/sessions/${session.sessionId}/spin`, 'POST', { idempotencyKey });
  };

  // Mark prize redeemed
  const handleRedeemPrize = async () => {
    if (!session?.currentRound?.id) return;
    await apiRequest(`/api/rounds/${session.currentRound.id}/redeem`, 'POST', {
      redeemedBy: 'Host Controller',
      notes: redeemNotes || 'Redeemed at front counter'
    });
    setRedeemNotes('');
  };

  // Next round
  const handleNextRound = async () => {
    await apiRequest(`/api/sessions/${session.sessionId}/rounds`, 'POST', {
      prizeId: selectedPrizeId,
      numberMin: parseInt(numberMin, 10),
      numberMax: parseInt(numberMax, 10)
    });
  };

  // Cancel round
  const handleCancelRound = async () => {
    if (!window.confirm('Are you sure you want to cancel this round? This cannot be undone.')) return;
    await apiRequest(`/api/rounds/${session.currentRound.id}/cancel`, 'POST', {
      sessionId: session.sessionId,
      reason: 'Cancelled by Host'
    });
  };

  // Fetch history
  const handleLoadHistory = async () => {
    const data = await apiRequest(`/api/sessions/${session.sessionId}/history`, 'GET');
    if (data) {
      setHistoryData(data);
      setShowHistory(true);
    }
  };

  // Authentication View
  if (!isAuthenticated) {
    return (
      <div className="host-auth-container">
        <div className="host-auth-card">
          <div className="host-badge">
            <Shield size={32} className="text-cyan" />
          </div>
          <h1 className="host-title">Host Controller Login</h1>
          <p className="host-subtitle">Authorized gaming center staff PIN required.</p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              verifyPin(pin);
            }}
            className="host-pin-form"
          >
            <input
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Enter Host PIN (Default: 1234)"
              className="host-pin-input"
              autoFocus
            />
            <button type="submit" className="arcade-btn-primary w-full">
              Authenticate
            </button>
            {authError && <div className="host-error-alert">{authError}</div>}
          </form>
          <div className="host-help-tip">
            Default manager PIN is <code>1234</code>. Failed attempts are rate-limited.
          </div>
        </div>
      </div>
    );
  }

  // Session Setup View (if no active session loaded)
  if (!session) {
    return (
      <div className="host-dashboard">
        <div className="host-header">
          <h2>Host Control Center</h2>
          <button onClick={() => setIsAuthenticated(false)} className="host-btn-logout">
            Lock
          </button>
        </div>

        <div className="host-setup-card">
          <h3>Create New Game Session</h3>
          <p className="text-muted">Configure the wheel numbers and prize for the opening round.</p>

          <div className="host-field-group">
            <label>Number Range</label>
            <div className="range-selector-row">
              <button
                type="button"
                className={`range-pill ${numberMax === 10 ? 'active' : ''}`}
                onClick={() => { setNumberMin(1); setNumberMax(10); }}
              >
                1 to 10
              </button>
              <button
                type="button"
                className={`range-pill ${numberMax === 20 ? 'active' : ''}`}
                onClick={() => { setNumberMin(1); setNumberMax(20); }}
              >
                1 to 20 (Standard)
              </button>
              <button
                type="button"
                className={`range-pill ${numberMax === 30 ? 'active' : ''}`}
                onClick={() => { setNumberMin(1); setNumberMax(30); }}
              >
                1 to 30
              </button>
            </div>
          </div>

          <div className="host-field-group">
            <label>Opening Round Prize</label>
            <select
              value={selectedPrizeId}
              onChange={(e) => setSelectedPrizeId(e.target.value)}
              className="host-select"
            >
              {prizes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.value})
                </option>
              ))}
            </select>
          </div>

          {actionError && <div className="host-error-alert">{actionError}</div>}

          <button
            onClick={handleCreateSession}
            disabled={loading}
            className="arcade-btn-primary w-full"
          >
            {loading ? 'Creating...' : 'Launch Game Session'}
          </button>
        </div>
      </div>
    );
  }

  const status = session.status;
  const currentRound = session.currentRound;
  const prize = currentRound?.prize;
  const canSpin = status === 'REGISTRATION_CLOSED' && session.playerCount > 0;
  const isSpinning = status === 'SPINNING';
  const isResult = status === 'RESULT';

  return (
    <div className="host-dashboard">
      {/* Top Controller Bar */}
      <div className="host-header">
        <div className="host-brand-title">
          <span className="text-cyan font-bold">CHILLAX</span> HOST
          <span className="host-code-badge">CODE: {session.shortCode}</span>
        </div>
        <div className="host-header-actions">
          <button onClick={handleLoadHistory} className="host-icon-btn" title="View History">
            <History size={18} />
          </button>
          <button
            onClick={() => loadSession(session.sessionId)}
            className="host-icon-btn"
            title="Refresh State"
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      {actionError && <div className="host-error-alert">{actionError}</div>}

      {/* TV Connection & Status Pod */}
      <div className="host-status-pod">
        <div className="status-pod-item">
          <span className="pod-label">TV SCREEN</span>
          <span className={`pod-value ${session.tvConnected ? 'text-green' : 'text-amber'}`}>
            <Tv size={16} className="inline-icon" />
            {session.tvConnected ? 'Connected' : `Pairing Code: ${session.tvPairingCode}`}
          </span>
        </div>
        <div className="status-pod-item">
          <span className="pod-label">STATUS</span>
          <span className="pod-value text-cyan">{status.replace('_', ' ')}</span>
        </div>
        <div className="status-pod-item">
          <span className="pod-label">ROUND</span>
          <span className="pod-value">#{currentRound?.roundNumber || 1}</span>
        </div>
        <div className="status-pod-item">
          <span className="pod-label">PLAYERS</span>
          <span className="pod-value text-gold">
            <Users size={16} className="inline-icon" /> {session.playerCount}
          </span>
        </div>
      </div>

      {/* Active Prize Card */}
      {prize && (
        <div className="host-active-prize-card">
          <div className="prize-indicator" style={{ background: prize.color || '#00f2fe' }} />
          <div className="prize-info">
            <div className="prize-label">CURRENT ROUND PRIZE</div>
            <div className="prize-name">{prize.name}</div>
          </div>
          <Award size={24} style={{ color: prize.color || '#00f2fe' }} />
        </div>
      )}

      {/* MAIN ACTION BAR: The SPIN Button (Page 9) */}
      <div className="host-primary-action-area">
        {status === 'REGISTRATION_OPEN' && (
          <div className="host-reg-controls">
            <button
              onClick={handleCloseRegistration}
              disabled={session.playerCount === 0}
              className="arcade-btn-warning w-full"
            >
              <Lock size={20} className="inline-icon" />
              Lock Entries & Prepare Spin ({session.playerCount} Joined)
            </button>
            {session.playerCount === 0 && (
              <p className="host-note">Waiting for at least 1 player to claim a number.</p>
            )}
          </div>
        )}

        {status === 'REGISTRATION_CLOSED' && (
          <div className="host-spin-controls">
            <button
              onClick={handleSpinNow}
              disabled={!canSpin || isSpinning}
              className={`spin-now-btn ${canSpin ? 'pulse-btn' : 'disabled'}`}
            >
              <Play size={28} className="spin-icon" fill="currentColor" />
              SPIN NOW!
            </button>
            <div className="host-sub-action-row">
              <button onClick={handleReopenRegistration} className="sub-btn">
                <Unlock size={14} className="inline-icon" /> Re-open Entries
              </button>
              <button onClick={handleCancelRound} className="sub-btn text-danger">
                <XCircle size={14} className="inline-icon" /> Cancel Round
              </button>
            </div>
          </div>
        )}

        {isSpinning && (
          <div className="host-spinning-banner">
            <RefreshCw size={24} className="icon-spin text-cyan" />
            <span>Wheel is spinning on TV... Stand by!</span>
          </div>
        )}

        {isResult && (
          <div className="host-result-actions-card">
            {currentRound?.hasWinner || session.entries?.some(e => e.number === currentRound?.winningNumber) ? (
              <>
                <div className="result-announcement">
                  <span className="result-num-pill">#{currentRound.winningNumber}</span>
                  <div className="result-details">
                    <strong>WINNER: {session.entries?.find(e => e.number === currentRound.winningNumber)?.nickname || 'Player'}</strong>
                    <span>Prize: {prize?.name}</span>
                  </div>
                </div>

                {/* Prize Redemption Button (Page 10) */}
                <div className="host-redemption-box">
                  <input
                    type="text"
                    placeholder="Optional cashier notes (e.g. delivered snack)"
                    value={redeemNotes}
                    onChange={(e) => setRedeemNotes(e.target.value)}
                    className="redeem-notes-input"
                  />
                  <button onClick={handleRedeemPrize} className="arcade-btn-success w-full">
                    <CheckCircle2 size={18} className="inline-icon" /> Mark Prize as Redeemed
                  </button>
                </div>
              </>
            ) : (
              <div className="result-announcement">
                <span className="result-num-pill" style={{ background: '#ef4444', color: '#fff' }}>
                  #{currentRound.winningNumber}
                </span>
                <div className="result-details">
                  <strong className="text-danger">NO WINNER THIS ROUND</strong>
                  <span className="text-muted">Landed on unclaimed number #{currentRound.winningNumber}. Prize carries over!</span>
                </div>
              </div>
            )}

            {/* Next Round */}
            <div className="host-next-round-section">
              <label className="text-muted text-sm block mb-1">Select Next Round Prize:</label>
              <select
                value={selectedPrizeId}
                onChange={(e) => setSelectedPrizeId(e.target.value)}
                className="host-select mb-2"
              >
                {prizes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.value})
                  </option>
                ))}
              </select>
              <button onClick={handleNextRound} className="arcade-btn-primary w-full">
                <RotateCcw size={18} className="inline-icon" /> Start Round #{ (currentRound?.roundNumber || 1) + 1 }
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Difficulty Mode Control */}
      <div className="host-setup-card">
        <div className="flex justify-between items-center mb-1">
          <h4 className="text-sm font-bold text-cyan">WINNER DIFFICULTY MODE</h4>
          <span className="text-xs text-gold">
            {session.winnerMode === 'TRUE_ODDS' ? '🎯 Hard (Arcade Odds)' : '🎁 Easy (Always Wins)'}
          </span>
        </div>
        <div className="range-selector-row">
          <button
            type="button"
            className={`range-pill ${session.winnerMode !== 'GUARANTEED' ? 'active' : ''}`}
            onClick={async () => {
              await apiRequest(`/api/sessions/${session.sessionId}/mode`, 'POST', { mode: 'TRUE_ODDS' });
            }}
          >
            🎯 Hard (1 in {session.numberRange.max} Odds)
          </button>
          <button
            type="button"
            className={`range-pill ${session.winnerMode === 'GUARANTEED' ? 'active' : ''}`}
            onClick={async () => {
              await apiRequest(`/api/sessions/${session.sessionId}/mode`, 'POST', { mode: 'GUARANTEED' });
            }}
          >
            🎁 Party (Guaranteed Winner)
          </button>
        </div>
        <p className="text-xs text-muted mt-1">
          In <strong>Hard Mode</strong>, the wheel spins across all numbers (1–{session.numberRange.max}). If it lands on an unclaimed number, there is NO WINNER.
        </p>
      </div>

      {/* Number Claims Grid Monitor */}
      <div className="host-claimed-grid-card">
        <div className="grid-card-header">
          <h4>Wheel Numbers Monitor ({session.playerCount}/{session.numberRange.max} Claimed)</h4>
        </div>
        <div className="host-number-chips-grid">
          {Array.from({ length: session.numberRange.max - session.numberRange.min + 1 }).map((_, i) => {
            const num = session.numberRange.min + i;
            const entry = session.entries?.find(e => e.number === num);
            const isWinner = isResult && currentRound?.winningNumber === num;

            return (
              <div
                key={num}
                className={`host-num-chip ${entry ? 'claimed' : 'empty'} ${isWinner ? 'winner' : ''}`}
              >
                <span className="chip-num">{num}</span>
                <span className="chip-player" title={entry ? entry.nickname : 'Available'}>
                  {entry ? entry.nickname : '—'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* History Modal */}
      {showHistory && (
        <div className="host-modal-overlay">
          <div className="host-modal-card">
            <div className="modal-header">
              <h3>Session Rounds History</h3>
              <button onClick={() => setShowHistory(false)} className="modal-close-btn">✕</button>
            </div>
            <div className="modal-body">
              {historyData?.rounds?.length === 0 ? (
                <p className="text-muted">No completed rounds yet.</p>
              ) : (
                <table className="history-table">
                  <thead>
                    <tr>
                      <th>Rnd</th>
                      <th>Win #</th>
                      <th>Winner</th>
                      <th>Prize</th>
                      <th>Redeemed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyData?.rounds?.map((r) => (
                      <tr key={r.id}>
                        <td>#{r.round_number}</td>
                        <td className="text-cyan font-bold">{r.winning_number ? `#${r.winning_number}` : '—'}</td>
                        <td>{r.winner_nickname || '—'}</td>
                        <td>{r.prize_name || 'Standard'}</td>
                        <td>
                          {r.redeemed_at ? (
                            <span className="badge-redeemed">✓ Redeemed</span>
                          ) : (
                            <span className="badge-pending">Pending</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
