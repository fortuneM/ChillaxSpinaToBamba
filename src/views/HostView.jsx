import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getSocket } from '../utils/socket';
import { 
  Play, Lock, Unlock, RotateCcw, Award, CheckCircle2, 
  XCircle, History, Shield, Users, RefreshCw,
  UserPlus, Trash2, Check, Database, Eye, EyeOff,
  Store, User, Mail, LogOut, ArrowRight
} from 'lucide-react';

export function HostView() {
  const [pin, setPin] = useState(localStorage.getItem('chillax_host_pin') || '1234');
  const [authUser, setAuthUser] = useState(() => {
    try {
      const saved = localStorage.getItem('chillax_host_user') || localStorage.getItem('chillax_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [linkedShop, setLinkedShop] = useState(() => {
    try {
      const saved = localStorage.getItem('chillax_host_shop') || localStorage.getItem('chillax_shop');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'register'
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [regShopName, setRegShopName] = useState('');
  const [regName, setRegName] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
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
  const [walkInName, setWalkInName] = useState('');
  const [walkInBet, setWalkInBet] = useState(5);
  const [selectedPickNum, setSelectedPickNum] = useState(null);
  const [hostPickFeedback, setHostPickFeedback] = useState('');
  const [isAssigningPick, setIsAssigningPick] = useState(false);
  const [mongoStatus, setMongoStatus] = useState(null);
  const [showMongoModal, setShowMongoModal] = useState(false);
  const [mongoUsername, setMongoUsername] = useState('');
  const [mongoPassword, setMongoPassword] = useState('');
  const [mongoUriInput, setMongoUriInput] = useState('');
  const [mongoConnecting, setMongoConnecting] = useState(false);
  const [mongoFeedback, setMongoFeedback] = useState('');
  const [showProfitEngine, setShowProfitEngine] = useState(
    () => localStorage.getItem('chillax_show_profit_engine') === 'true'
  );
  const walkInInputRef = useRef(null);

  const toggleProfitEngine = () => {
    setShowProfitEngine((prev) => {
      const next = !prev;
      localStorage.setItem('chillax_show_profit_engine', String(next));
      return next;
    });
  };

  // Check stored Chillax Gaming App user session on load
  useEffect(() => {
    fetchPrizes();
    fetchMongoStatus();
    if (authUser?.id || authUser?.username) {
      restoreUserSession(authUser);
    }
  }, []);

  const applyAuthenticatedShopSession = (data) => {
    if (data?.user) {
      setAuthUser(data.user);
      setPin(data.user.pin || data?.shop?.adminPin || '1234');
      localStorage.setItem('chillax_host_user', JSON.stringify(data.user));
      localStorage.setItem('chillax_user', JSON.stringify(data.user));
      localStorage.setItem('chillax_host_pin', data.user.pin || data?.shop?.adminPin || '1234');
    }
    if (data?.shop) {
      setLinkedShop(data.shop);
      localStorage.setItem('chillax_host_shop', JSON.stringify(data.shop));
      localStorage.setItem('chillax_shop', JSON.stringify(data.shop));
    }
    if (data?.session) {
      setSession(data.session);
      localStorage.setItem('chillax_host_session_id', data.session.sessionId);
    }
    setIsAuthenticated(true);
  };

  const restoreUserSession = async (savedUser) => {
    setAuthLoading(true);
    try {
      const params = new URLSearchParams();
      if (savedUser?.id) params.set('userId', savedUser.id);
      if (savedUser?.username) params.set('username', savedUser.username);
      const res = await fetch(`/api/auth/me?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (data?.success) {
          applyAuthenticatedShopSession(data);
          setAuthLoading(false);
          return;
        }
      }
      // If saved user was not found, clear stale session
      setIsAuthenticated(false);
    } catch {
      // Keep local auth state if offline
    } finally {
      setAuthLoading(false);
    }
  };

  const handleShopLogin = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: loginUsername.trim(),
          password: loginPassword
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        applyAuthenticatedShopSession(data);
        setLoginPassword('');
      } else {
        setAuthError(data.error || 'Invalid username or password.');
      }
    } catch {
      setAuthError('Network error connecting to Chillax Gaming Hub database.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleShopRegister = async (e) => {
    e.preventDefault();
    setAuthError('');
    if (!regShopName.trim()) {
      setAuthError('Please enter your Shop or Gaming Center name.');
      return;
    }
    if (!regUsername.trim()) {
      setAuthError('Please enter a username.');
      return;
    }
    if (regPassword.length < 4) {
      setAuthError('Password must be at least 4 characters.');
      return;
    }

    setAuthLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopName: regShopName.trim(),
          name: regName.trim() || regUsername.trim(),
          username: regUsername.trim().toLowerCase(),
          email: regEmail.trim(),
          password: regPassword
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        applyAuthenticatedShopSession(data);
        setRegPassword('');
      } else {
        setAuthError(data.error || 'Registration failed.');
      }
    } catch {
      setAuthError('Network error connecting to Chillax Gaming Hub database.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setAuthUser(null);
    setLinkedShop(null);
    setSession(null);
    localStorage.removeItem('chillax_host_user');
    localStorage.removeItem('chillax_host_shop');
    localStorage.removeItem('chillax_host_session_id');
    localStorage.removeItem('chillax_user');
    localStorage.removeItem('chillax_shop');
  };

  const fetchMongoStatus = async () => {
    try {
      const res = await fetch('/api/mongodb/status');
      if (res.ok) {
        const data = await res.json();
        setMongoStatus(data);
      }
    } catch {}
  };

  const handleConnectMongo = async (e) => {
    e.preventDefault();
    setMongoConnecting(true);
    setMongoFeedback('');
    setActionError('');
    try {
      const res = await fetch('/api/mongodb/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-host-pin': pin || '1234'
        },
        body: JSON.stringify({
          uri: mongoUriInput.trim() || undefined,
          username: mongoUsername.trim() || undefined,
          password: mongoPassword || undefined,
          clusterHost: 'cluster0.q1kwbvb.mongodb.net',
          dbName: 'chillaxgaminghub'
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMongoStatus(data.status);
        setMongoFeedback(`✅ Connected & synced with "${data.status?.dbName || 'chillaxgaminghub'}"!`);
        setMongoPassword('');
        setTimeout(() => {
          setShowMongoModal(false);
          setMongoFeedback('');
        }, 1200);
      } else {
        setMongoFeedback(`❌ ${data.error || 'Failed to connect to MongoDB Atlas.'}`);
      }
    } catch (err) {
      setMongoFeedback(`❌ Network error: ${err.message}`);
    } finally {
      setMongoConnecting(false);
    }
  };

  const handleManualMongoSync = async () => {
    setMongoConnecting(true);
    const data = await apiRequest('/api/mongodb/sync', 'POST', {});
    setMongoConnecting(false);
    if (data?.status) {
      setMongoStatus(data.status);
    }
  };

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
      if (newState?.mongoStatus) {
        setMongoStatus(newState.mongoStatus);
      }
    };

    const handleMongoStatus = (status) => {
      setMongoStatus(status);
    };

    socket.on('session:state', handleState);
    socket.on('mongodb:status', handleMongoStatus);
    return () => {
      socket.off('session:state', handleState);
      socket.off('mongodb:status', handleMongoStatus);
    };
  }, [session?.sessionId]);

  const apiRequest = async (url, method = 'POST', body = {}) => {
    setActionError('');
    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-host-pin': authUser?.pin || pin || '1234',
          'x-host-user-id': authUser?.id || ''
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

  // Create new session using the linked shop's shopCode
  const handleCreateSession = async () => {
    setLoading(true);
    const data = await apiRequest('/api/sessions', 'POST', {
      numberMin: parseInt(numberMin, 10),
      numberMax: parseInt(numberMax, 10),
      defaultPrizeId: selectedPrizeId,
      shopCode: linkedShop?.shopCode || null,
      shopId: linkedShop?.id || null,
      shopName: linkedShop?.name || null,
      hostId: authUser?.id || 'host_default'
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
    setSelectedPickNum(null);
    setWalkInName('');
    setHostPickFeedback('');
    await apiRequest(`/api/sessions/${session.sessionId}/rounds`, 'POST', {
      prizeId: selectedPrizeId,
      numberMin: parseInt(numberMin, 10),
      numberMax: parseInt(numberMax, 10)
    });
  };

  // Host manually claims a number for a player without a phone
  const handleHostClaimNumber = async (num, customName = walkInName) => {
    if (!session?.sessionId || isAssigningPick) return;
    const isCashRound = Boolean(
      session?.currentRound?.isCashRound ||
      session?.currentRound?.prize?.prize_type === 'cash_multiplier'
    );
    const numericBet = Number(walkInBet);
    if (isCashRound && (!Number.isFinite(numericBet) || numericBet < 5)) {
      setActionError('Minimum bet amount is R5 for 3x Cash Prize rounds.');
      return;
    }

    setIsAssigningPick(true);
    setHostPickFeedback('');
    const data = await apiRequest(`/api/sessions/${session.sessionId}/host-entries`, 'POST', {
      number: num,
      nickname: customName ? customName.trim() : '',
      betAmount: isCashRound ? numericBet : 0
    });
    setIsAssigningPick(false);
    if (data?.success) {
      setHostPickFeedback(
        isCashRound
          ? `Assigned #${data.number} to ${data.nickname} (Bet R${data.betAmount} → Win R${Math.round(data.betAmount * 1.5 * 100) / 100}–R${Math.round(data.betAmount * 3 * 100) / 100})`
          : `Assigned #${data.number} to ${data.nickname}`
      );
      setWalkInName('');
      setSelectedPickNum(null);
    }
  };

  // Switch active round prize (e.g. toggle between 3x Cash Multiplier and Standard Prizes)
  const handleChangeRoundPrize = async (newPrizeId) => {
    if (!session?.sessionId) return;
    setSelectedPrizeId(newPrizeId);
    const data = await apiRequest(`/api/sessions/${session.sessionId}/prize`, 'POST', { prizeId: newPrizeId });
    if (data?.success) {
      fetchPrizes();
    }
  };

  // Host releases/removes a claimed number while registration is open
  const handleHostUnclaimNumber = async (num) => {
    if (!session?.sessionId || isAssigningPick) return;
    setIsAssigningPick(true);
    setHostPickFeedback('');
    const data = await apiRequest(`/api/sessions/${session.sessionId}/host-entries/${num}`, 'DELETE');
    setIsAssigningPick(false);
    if (data?.success) {
      setHostPickFeedback(`Freed #${data.number} (${data.removedNickname || 'Player'})`);
      setSelectedPickNum(null);
    }
  };

  // Handle tapping a number chip in the Host grid
  const handleChipClick = (num, existingEntry) => {
    if (session?.status !== 'REGISTRATION_OPEN' || isAssigningPick) return;

    if (existingEntry) {
      setSelectedPickNum(selectedPickNum === num ? null : num);
      setHostPickFeedback('');
      return;
    }

    // If host already typed a player name or tapped the already-selected number again, assign immediately
    if (walkInName.trim() || selectedPickNum === num) {
      handleHostClaimNumber(num, walkInName);
    } else {
      setSelectedPickNum(num);
      setHostPickFeedback('');
      setTimeout(() => {
        walkInInputRef.current?.focus();
      }, 20);
    }
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

  // Chillax Gaming App Database-Synced Login & Registration View
  if (!isAuthenticated) {
    return (
      <div className="host-auth-container">
        <div className="host-auth-card">
          <div className="host-badge">
            <Store size={30} className="text-cyan" />
          </div>
          <h1 className="host-title">Chillax Gaming Hub Login</h1>
          <p className="host-subtitle">
            Sign in with your Chillax Gaming App account. Your Shop Code loads automatically from your linked shop.
          </p>

          {/* Mode Tabs */}
          <div className="host-auth-tabs">
            <button
              type="button"
              onClick={() => {
                setAuthMode('login');
                setAuthError('');
              }}
              className={`host-auth-tab ${authMode === 'login' ? 'active' : ''}`}
            >
              Shop Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode('register');
                setAuthError('');
              }}
              className={`host-auth-tab ${authMode === 'register' ? 'active' : ''}`}
            >
              <Store size={14} className="inline-icon" /> Register New Shop
            </button>
          </div>

          {authError && <div className="host-error-alert mb-3">{authError}</div>}

          {authMode === 'login' ? (
            <form onSubmit={handleShopLogin} className="host-login-form">
              <div className="host-login-field">
                <label htmlFor="host-login-username">Shop Username or Email</label>
                <div className="host-input-with-icon">
                  <User size={16} className="host-input-icon" />
                  <input
                    id="host-login-username"
                    type="text"
                    value={loginUsername}
                    onChange={(e) => {
                      setLoginUsername(e.target.value);
                      if (authError) setAuthError('');
                    }}
                    placeholder="e.g. fortuinem, alexgamer, or admin"
                    autoComplete="username"
                    autoFocus
                    required
                    className="host-text-input"
                  />
                </div>
              </div>

              <div className="host-login-field">
                <label htmlFor="host-login-password">Password</label>
                <div className="host-input-with-icon">
                  <Lock size={16} className="host-input-icon" />
                  <input
                    id="host-login-password"
                    type={showPassword ? 'text' : 'password'}
                    value={loginPassword}
                    onChange={(e) => {
                      setLoginPassword(e.target.value);
                      if (authError) setAuthError('');
                    }}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    required
                    className="host-text-input pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="host-pwd-toggle"
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={authLoading || !loginUsername.trim() || !loginPassword}
                className="arcade-btn-primary w-full mt-2"
              >
                {authLoading ? (
                  'Signing In & Syncing Shop...'
                ) : (
                  <>
                    Sign In to Shop <ArrowRight size={16} className="inline-icon" />
                  </>
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={handleShopRegister} className="host-login-form">
              <div className="host-login-field">
                <label htmlFor="host-reg-shop">Shop / Gaming Center Name *</label>
                <div className="host-input-with-icon">
                  <Store size={16} className="host-input-icon" />
                  <input
                    id="host-reg-shop"
                    type="text"
                    value={regShopName}
                    onChange={(e) => {
                      setRegShopName(e.target.value);
                      if (authError) setAuthError('');
                    }}
                    placeholder="e.g. Apex Gaming Lounge"
                    required
                    className="host-text-input"
                  />
                </div>
              </div>

              <div className="host-login-field">
                <label htmlFor="host-reg-name">Owner / Manager Name</label>
                <div className="host-input-with-icon">
                  <User size={16} className="host-input-icon" />
                  <input
                    id="host-reg-name"
                    type="text"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    placeholder="e.g. Thabelo Dumani"
                    className="host-text-input"
                  />
                </div>
              </div>

              <div className="host-login-grid-2">
                <div className="host-login-field">
                  <label htmlFor="host-reg-username">Username *</label>
                  <input
                    id="host-reg-username"
                    type="text"
                    value={regUsername}
                    onChange={(e) => {
                      setRegUsername(e.target.value);
                      if (authError) setAuthError('');
                    }}
                    placeholder="apexowner"
                    required
                    className="host-text-input no-left-icon"
                  />
                </div>
                <div className="host-login-field">
                  <label htmlFor="host-reg-email">Email (Optional)</label>
                  <input
                    id="host-reg-email"
                    type="email"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="owner@hub.co.zw"
                    className="host-text-input no-left-icon"
                  />
                </div>
              </div>

              <div className="host-login-field">
                <label htmlFor="host-reg-password">Password *</label>
                <div className="host-input-with-icon">
                  <Lock size={16} className="host-input-icon" />
                  <input
                    id="host-reg-password"
                    type={showPassword ? 'text' : 'password'}
                    value={regPassword}
                    onChange={(e) => {
                      setRegPassword(e.target.value);
                      if (authError) setAuthError('');
                    }}
                    placeholder="At least 4 characters"
                    required
                    className="host-text-input pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="host-pwd-toggle"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={authLoading || !regShopName.trim() || !regUsername.trim() || !regPassword}
                className="arcade-btn-primary w-full mt-2"
              >
                {authLoading ? 'Creating Shop & Code...' : 'Create Shop & Generate Shop Code'}
              </button>
            </form>
          )}

          <div className="host-help-tip">
            Synced with <code>chillaxgaminghub</code> • Same credentials &amp; Shop Code as your Chillax Gaming App.
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
          <div className="host-brand-title">
            <span className="text-cyan font-bold">{linkedShop?.name || 'CHILLAX'}</span>
            {linkedShop?.shopCode && (
              <span className="host-code-badge">SHOP CODE: {linkedShop.shopCode}</span>
            )}
          </div>
          <button onClick={handleLogout} className="host-btn-logout">
            <LogOut size={14} className="inline-icon" /> Sign Out
          </button>
        </div>

        <div className="host-setup-card">
          <h3>Launch Spin &amp; Win for {linkedShop?.name || 'Your Shop'}</h3>
          <p className="text-muted">
            Your session will use your linked Shop Code:{' '}
            <strong className="text-cyan">{linkedShop?.shopCode || 'CHX-XXXX'}</strong>
          </p>

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
  const isCashRound = Boolean(currentRound?.isCashRound || prize?.prize_type === 'cash_multiplier');
  const canSpin = status === 'REGISTRATION_CLOSED' && session.playerCount > 0;
  const isSpinning = status === 'SPINNING';
  const isResult = status === 'RESULT';

  const activeShopCode = linkedShop?.shopCode || session.shopCode || session.shortCode;
  const activeShopName = linkedShop?.name || session.shopName || 'CHILLAX';

  return (
    <div className="host-dashboard">
      {/* Top Controller Bar */}
      <div className="host-header">
        <div className="host-brand-title">
          <span className="text-cyan font-bold">{activeShopName.toUpperCase()}</span>
          <span className="host-code-badge" title="Linked Shop Code from Chillax Gaming App">
            SHOP CODE: {activeShopCode}
          </span>
        </div>
        <div className="host-header-actions">
          {authUser?.username && (
            <span className="host-user-pill" title={`Logged in as ${authUser.name || authUser.username}`}>
              <User size={13} /> {authUser.username}
            </span>
          )}
          <button
            onClick={() => setShowMongoModal(true)}
            className={`host-mongo-pill ${mongoStatus?.connected ? 'connected' : 'disconnected'}`}
            title="MongoDB Atlas chillaxgaminghub Connection"
          >
            <Database size={14} />
            <span>
              {mongoStatus?.connected ? 'chillaxgaminghub' : 'Connect MongoDB'}
            </span>
          </button>
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
          <button
            onClick={handleLogout}
            className="host-icon-btn text-danger"
            title="Sign Out of Shop"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>

      {actionError && <div className="host-error-alert">{actionError}</div>}

      {/* Status Pod */}
      <div className="host-status-pod">
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

      {/* Active Prize Card & Cash Multiplier Mode Switcher */}
      {prize && (
        <div className="host-active-prize-card">
          <div className="prize-indicator" style={{ background: prize.color || '#00f2fe' }} />
          <div className="prize-info">
            <div className="prize-label">
              {isCashRound ? '💰 SMART CASH MODE (1.5X • 2X • 3X | MIN R5)' : 'CURRENT ROUND PRIZE'}
            </div>
            {status === 'REGISTRATION_OPEN' ? (
              <select
                value={prize.id}
                onChange={(e) => handleChangeRoundPrize(e.target.value)}
                className="host-inline-prize-select"
              >
                {prizes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.value})
                  </option>
                ))}
              </select>
            ) : (
              <div className="prize-name">{prize.name}</div>
            )}
          </div>
          {status === 'REGISTRATION_OPEN' && (
            <button
              type="button"
              onClick={() => {
                if (isCashRound) {
                  const firstStd = prizes.find((p) => p.prize_type !== 'cash_multiplier');
                  if (firstStd) handleChangeRoundPrize(firstStd.id);
                } else {
                  handleChangeRoundPrize('prize_cash_3x');
                }
              }}
              className={`host-cash-mode-btn ${isCashRound ? 'active' : ''}`}
              title="Toggle Smart Cash Multiplier Mode (1.5x / 2x / 3x)"
            >
              {isCashRound ? '💰 Cash Mode ON' : '💰 Use Cash Mode'}
            </button>
          )}
          <Award size={24} style={{ color: prize.color || '#00f2fe' }} />
        </div>
      )}

      {/* House Profit Protection & Multiplier Telemetry Pod (Cash Mode) */}
      {isCashRound && session.houseCashStats && (
        <div className={`host-profit-engine-card ${showProfitEngine ? 'expanded' : 'collapsed'}`}>
          <div
            className="profit-engine-header clickable"
            onClick={toggleProfitEngine}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleProfitEngine();
              }
            }}
          >
            <span className="profit-engine-title">🏦 SMART PROFIT-GUARD ENGINE (1.5x / 2x / 3x)</span>
            <div className="profit-engine-header-right">
              {showProfitEngine && (
                <span className={`profit-3x-status ${session.houseCashStats.is3xReady ? 'unlocked' : 'locked'}`}>
                  {session.houseCashStats.is3xReady ? '🔓 3x Jackpot Unlocked' : '🔒 3x Gated (1.5x / 2x Active)'}
                </span>
              )}
              <button
                type="button"
                className="profit-toggle-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleProfitEngine();
                }}
                title={showProfitEngine ? 'Hide Smart Profit-Guard Engine' : 'Show Smart Profit-Guard Engine'}
              >
                {showProfitEngine ? (
                  <>
                    <EyeOff size={13} /> Hide
                  </>
                ) : (
                  <>
                    <Eye size={13} /> Show
                  </>
                )}
              </button>
            </div>
          </div>
          {showProfitEngine && (
            <div className="profit-metrics-grid">
              <div className="profit-metric-box">
                <span className="metric-label">Collected</span>
                <span className="metric-val">R{session.houseCashStats.historicalCollected + (session.totalBets || 0)}</span>
              </div>
              <div className="profit-metric-box">
                <span className="metric-label">Paid Out</span>
                <span className="metric-val">R{session.houseCashStats.historicalPaidOut}</span>
              </div>
              <div className="profit-metric-box">
                <span className="metric-label">Net Profit</span>
                <span className="metric-val text-green">
                  R{Math.round((session.houseCashStats.netProfit + (session.totalBets || 0)) * 100) / 100}
                </span>
              </div>
              <div className="profit-metric-box">
                <span className="metric-label">Surplus Reserve</span>
                <span className="metric-val text-gold">R{session.houseCashStats.surplusReserve}</span>
              </div>
            </div>
          )}
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
                {(() => {
                  const winningEntry = session.entries?.find(e => e.number === currentRound.winningNumber);
                  const isHostEntry = winningEntry?.player_token?.startsWith('host_pick_');
                  const winBet = Number(winningEntry?.bet_amount || currentRound?.winnerBetAmount || 0);
                  const winPayout = Number(winningEntry?.payout_amount || currentRound?.winnerPayoutAmount || 0);
                  return (
                    <div className="result-announcement">
                      <span className="result-num-pill">#{currentRound.winningNumber}</span>
                      <div className="result-details">
                        <strong>
                          WINNER: {winningEntry?.nickname || 'Player'}
                          {isHostEntry && <span className="host-pick-tag ml-2">HOST PICK</span>}
                        </strong>
                        {isCashRound && winPayout > 0 ? (
                          <span className="text-green font-bold">
                            💰 PAYOUT: R{winPayout} CASH ({currentRound?.appliedMultiplier || 1.5}x on R{winBet} bet)
                          </span>
                        ) : (
                          <span>Prize: {prize?.name}</span>
                        )}
                      </div>
                    </div>
                  );
                })()}

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

      {/* Number Claims Grid & Walk-in Host Pick Controls */}
      <div className="host-claimed-grid-card">
        <div className="grid-card-header">
          <div className="flex justify-between items-center">
            <h4>Wheel Numbers & Player Picks ({session.playerCount}/{session.numberRange.max} Claimed)</h4>
            {isCashRound && (
              <span className="host-pool-badge">
                Pool: R{session.totalBets || 0}
              </span>
            )}
          </div>
          {status === 'REGISTRATION_OPEN' && (
            <span className="host-grid-subtitle">
              {isCashRound
                ? '3x Cash Round: Enter player name + bet amount (min R5), then tap an open number.'
                : "No phone? Enter a player's name below and tap an open number to claim it for them."}
            </span>
          )}
        </div>

        {status === 'REGISTRATION_OPEN' && (
          <div className="host-walkin-box">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (selectedPickNum && !session.entries?.some(en => en.number === selectedPickNum)) {
                  handleHostClaimNumber(selectedPickNum, walkInName);
                }
              }}
              className="host-walkin-form"
            >
              {isCashRound && (
                <div className="host-walkin-bet-row">
                  <span className="walkin-bet-label">Bet (Min R5):</span>
                  <div className="walkin-bet-presets">
                    {[5, 10, 20, 50].map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => setWalkInBet(amt)}
                        className={`walkin-bet-chip ${Number(walkInBet) === amt ? 'active' : ''}`}
                      >
                        R{amt}
                      </button>
                    ))}
                  </div>
                  <div className="walkin-bet-custom">
                    <span>R</span>
                    <input
                      type="number"
                      min="5"
                      step="1"
                      value={walkInBet}
                      onChange={(e) => setWalkInBet(e.target.value)}
                      className="walkin-bet-input"
                    />
                  </div>
                  <span className="walkin-payout-tag">
                    1.5x–3x: R{Number(walkInBet) >= 5 ? Math.round(Number(walkInBet) * 1.5 * 100) / 100 : 0}–R{Number(walkInBet) >= 5 ? Math.round(Number(walkInBet) * 3 * 100) / 100 : 0}
                  </span>
                </div>
              )}

              <div className="host-walkin-input-row">
                <UserPlus size={18} className="walkin-icon text-cyan" />
                <input
                  ref={walkInInputRef}
                  type="text"
                  maxLength={18}
                  value={walkInName}
                  onChange={(e) => setWalkInName(e.target.value)}
                  placeholder={
                    selectedPickNum && !session.entries?.some(en => en.number === selectedPickNum)
                      ? `Name for #${selectedPickNum} (default: Player #${selectedPickNum})`
                      : 'Walk-in player name (optional, e.g. Thabo)'
                  }
                  className="host-walkin-input"
                />
                {selectedPickNum && !session.entries?.some(en => en.number === selectedPickNum) && (
                  <button
                    type="submit"
                    disabled={isAssigningPick}
                    className="host-walkin-assign-btn"
                  >
                    Assign #{selectedPickNum}{isCashRound ? ` (R${walkInBet})` : ''}
                  </button>
                )}
              </div>
            </form>

            {/* Selected Claimed Number Management Bar */}
            {selectedPickNum && session.entries?.some(en => en.number === selectedPickNum) && (() => {
              const selEntry = session.entries.find(en => en.number === selectedPickNum);
              const isHostEntry = selEntry?.player_token?.startsWith('host_pick_');
              return (
                <div className="host-selected-entry-bar">
                  <div className="selected-entry-info">
                    <span className="selected-num-badge">#{selectedPickNum}</span>
                    <span>
                      Claimed by <strong>{selEntry.nickname}</strong>{' '}
                      {isCashRound && selEntry.bet_amount > 0 && (
                        <strong className="text-green">
                          • Bet R{selEntry.bet_amount} (Win R{selEntry.payout_amount})
                        </strong>
                      )}{' '}
                      <span className="text-muted text-xs">
                        ({isHostEntry ? 'Host Pick' : 'Phone'})
                      </span>
                    </span>
                  </div>
                  <div className="selected-entry-actions">
                    <button
                      type="button"
                      disabled={isAssigningPick}
                      onClick={() => handleHostUnclaimNumber(selectedPickNum)}
                      className="host-free-num-btn"
                    >
                      <Trash2 size={14} className="inline-icon" /> Free #{selectedPickNum}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedPickNum(null)}
                      className="host-cancel-sel-btn"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              );
            })()}

            {hostPickFeedback && (
              <div className="host-pick-feedback">
                <Check size={15} /> <span>{hostPickFeedback}</span>
              </div>
            )}
          </div>
        )}

        <div className="host-number-chips-grid">
          {Array.from({ length: session.numberRange.max - session.numberRange.min + 1 }).map((_, i) => {
            const num = session.numberRange.min + i;
            const entry = session.entries?.find(e => e.number === num);
            const isWinner = isResult && currentRound?.winningNumber === num;
            const isSelected = selectedPickNum === num;
            const isHostPick = entry?.player_token?.startsWith('host_pick_');
            const isInteractive = status === 'REGISTRATION_OPEN';

            return (
              <button
                key={num}
                type="button"
                disabled={!isInteractive || isAssigningPick}
                onClick={() => handleChipClick(num, entry)}
                className={`host-num-chip ${entry ? 'claimed' : 'empty'} ${isHostPick ? 'host-picked' : ''} ${isSelected ? 'selected' : ''} ${isWinner ? 'winner' : ''} ${isInteractive ? 'interactive' : ''}`}
              >
                <div className="chip-top-row">
                  <span className="chip-num">{num}</span>
                  {isHostPick && <span className="chip-host-dot" title="Entered by Host">H</span>}
                </div>
                <span
                  className="chip-player"
                  title={
                    entry
                      ? `${entry.nickname}${entry.bet_amount > 0 ? ` (Bet R${entry.bet_amount} → Win R${entry.payout_amount})` : ''}`
                      : 'Tap to claim'
                  }
                >
                  {entry
                    ? `${entry.nickname}${isCashRound && entry.bet_amount > 0 ? ` • R${entry.bet_amount}` : ''}`
                    : (isInteractive ? '+ Pick' : '—')}
                </span>
              </button>
            );
          })}
        </div>
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
                        <td>
                          {r.prize_type === 'cash_multiplier' && r.winner_payout_amount > 0
                            ? `R${r.winner_payout_amount} Cash (${r.applied_multiplier || 1.5}x R${r.winner_bet_amount})`
                            : (r.prize_name || 'Standard')}
                        </td>
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

      {/* MongoDB Atlas chillaxgaminghub Connection Modal */}
      {showMongoModal && (
        <div className="host-modal-overlay">
          <div className="host-modal-card">
            <div className="modal-header">
              <h3>🗄️ Default Permanent DB: chillaxgaminghub</h3>
              <button onClick={() => setShowMongoModal(false)} className="modal-close-btn">✕</button>
            </div>
            <div className="modal-body">
              <div className="mongo-status-summary">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs text-muted">CLUSTER: cluster0.q1kwbvb.mongodb.net</span>
                  <span className={`badge-${mongoStatus?.connected ? 'redeemed' : 'pending'}`}>
                    {mongoStatus?.connected ? '● Permanent DB Active' : '○ Reconnecting...'}
                  </span>
                </div>
                <div className="mongo-sync-metrics">
                  <span>Spin Sessions: <strong>{mongoStatus?.collectionCounts?.spin_sessions || 0}</strong></span>
                  <span>Rounds: <strong>{mongoStatus?.collectionCounts?.spin_rounds || 0}</strong></span>
                  <span>Entries: <strong>{mongoStatus?.collectionCounts?.spin_entries || 0}</strong></span>
                  <span>Redemptions: <strong>{mongoStatus?.collectionCounts?.spin_redemptions || 0}</strong></span>
                </div>
                <button
                  type="button"
                  disabled={mongoConnecting}
                  onClick={handleManualMongoSync}
                  className="arcade-btn-primary w-full mt-2"
                >
                  <RefreshCw size={14} className="inline-icon" />{' '}
                  {mongoConnecting ? 'Syncing chillaxgaminghub...' : 'Sync Now with chillaxgaminghub'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
