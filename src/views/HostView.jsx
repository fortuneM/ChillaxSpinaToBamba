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
  const [hasDoubleZero, setHasDoubleZero] = useState(true);
  const [nextRoundNumberMax, setNextRoundNumberMax] = useState(20);
  const [nextRoundHasDoubleZero, setNextRoundHasDoubleZero] = useState(true);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [historyData, setHistoryData] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [redeemNotes, setRedeemNotes] = useState('');
  const [walkInName, setWalkInName] = useState('');
  const [walkInBet, setWalkInBet] = useState(10);
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
  const [showOwnerModel, setShowOwnerModel] = useState(
    () => localStorage.getItem('chillax_show_owner_model') === 'true'
  );
  const [ownerModelTab, setOwnerModelTab] = useState('profitability'); // 'profitability' | 'schedule' | 'calendar'
  const [replenishAmount, setReplenishAmount] = useState(500);
  const walkInInputRef = useRef(null);

  const toggleProfitEngine = () => {
    setShowProfitEngine((prev) => {
      const next = !prev;
      localStorage.setItem('chillax_show_profit_engine', String(next));
      return next;
    });
  };

  const toggleOwnerModel = () => {
    setShowOwnerModel((prev) => {
      const next = !prev;
      localStorage.setItem('chillax_show_owner_model', String(next));
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

  // Update live wheel configuration (number range & 2 zeros 0 / 00)
  const handleUpdateWheelConfig = async (newMax, newDoubleZero) => {
    if (!session?.sessionId) return;
    const data = await apiRequest(`/api/sessions/${session.sessionId}/wheel-config`, 'POST', {
      numberMax: parseInt(newMax, 10),
      hasDoubleZero: Boolean(newDoubleZero)
    });
    if (data?.success) {
      setNumberMax(parseInt(newMax, 10));
      setNextRoundNumberMax(parseInt(newMax, 10));
      setNextRoundHasDoubleZero(Boolean(newDoubleZero));
    }
  };

  // Next round
  const handleNextRound = async () => {
    setSelectedPickNum(null);
    setWalkInName('');
    setHostPickFeedback('');
    await apiRequest(`/api/sessions/${session.sessionId}/rounds`, 'POST', {
      prizeId: selectedPrizeId,
      numberMin: parseInt(numberMin, 10),
      numberMax: parseInt(nextRoundNumberMax || numberMax, 10),
      hasDoubleZero: Boolean(nextRoundHasDoubleZero)
    });
  };

  // Host manually claims a number for a player without a phone
  const handleHostClaimNumber = async (num, customName = walkInName) => {
    if (!session?.sessionId || isAssigningPick) return;
    const isWeightedCash = Boolean(
      session?.currentRound?.isWeightedCash ||
      session?.currentRound?.prize?.prize_type === 'weighted_cash'
    );
    const isCashRound = Boolean(
      session?.currentRound?.isCashRound ||
      session?.currentRound?.prize?.prize_type === 'cash_multiplier' ||
      isWeightedCash
    );
    const numericBet = Number(walkInBet);
    if (isCashRound && (!Number.isFinite(numericBet) || numericBet < 5)) {
      setActionError('Minimum bet amount is R5 (recommended R10) for Cash Spin rounds.');
      return;
    }

    setIsAssigningPick(true);
    setHostPickFeedback('');
    const data = await apiRequest(`/api/sessions/${session.sessionId}/host-entries`, 'POST', {
      number: String(num),
      nickname: customName ? customName.trim() : '',
      betAmount: isCashRound ? numericBet : 0,
      ageVerified: true
    });
    setIsAssigningPick(false);
    if (data?.success) {
      setHostPickFeedback(
        isWeightedCash
          ? `Assigned #${data.number} to ${data.nickname} (Stake R${data.betAmount} • Tx: ${data.txId || 'OK'} → Win R10/R20/R50/R100)`
          : isCashRound
            ? `Assigned #${data.number} to ${data.nickname} (Bet R${data.betAmount} • Tx: ${data.txId || 'OK'} → Win R${Math.round(data.betAmount * 1.5 * 100) / 100}–R${Math.round(data.betAmount * 3 * 100) / 100})`
            : `Assigned #${data.number} to ${data.nickname} (Tx: ${data.txId || 'OK'})`
      );
      setWalkInName('');
      setSelectedPickNum(null);
    }
  };

  // Switch active round prize (e.g. toggle between Weighted Cash Schedule, 3x Cash Multiplier, and Standard Prizes)
  const handleChangeRoundPrize = async (newPrizeId) => {
    if (!session?.sessionId) return;
    setSelectedPrizeId(newPrizeId);
    if (newPrizeId === 'prize_weighted_cash') {
      setWalkInBet(10);
    } else if (newPrizeId === 'prize_cash_3x' && Number(walkInBet) < 5) {
      setWalkInBet(5);
    }
    const data = await apiRequest(`/api/sessions/${session.sessionId}/prize`, 'POST', { prizeId: newPrizeId });
    if (data?.success) {
      fetchPrizes();
    }
  };

  // Replenish ring-fenced cash-prize reserve
  const handleReplenishReserve = async (amountToAdd = replenishAmount) => {
    if (!session?.sessionId) return;
    const data = await apiRequest(`/api/sessions/${session.sessionId}/reserve/replenish`, 'POST', {
      amount: Number(amountToAdd) || 500,
      notes: 'Owner cash-prize reserve replenishment'
    });
    if (data?.success) {
      setHostPickFeedback(`✅ Cash reserve replenished by +R${data.addedAmount} (Total Reserve Ceiling: R${data.newMonthlyCashReserve})`);
    }
  };

  // Toggle emergency suspension of new paid entries
  const handleToggleEmergencySuspend = async (suspended) => {
    if (!session?.sessionId) return;
    await apiRequest(`/api/sessions/${session.sessionId}/emergency-suspend`, 'POST', {
      suspended: Boolean(suspended),
      reason: suspended ? 'Operator emergency pause' : 'Operator resumed entries'
    });
  };

  // Update financial & commercial model parameters
  const handleUpdateFinancialSettings = async (partialSettings) => {
    if (!session?.sessionId) return;
    await apiRequest(`/api/sessions/${session.sessionId}/financial-settings`, 'POST', partialSettings);
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
      setSelectedPickNum(String(selectedPickNum) === String(num) ? null : num);
      setHostPickFeedback('');
      return;
    }

    // If host already typed a player name or tapped the already-selected number again, assign immediately
    if (walkInName.trim() || String(selectedPickNum) === String(num)) {
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
            <label>Wheel Numbers Configuration</label>
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
              <button
                type="button"
                className={`range-pill ${hasDoubleZero ? 'active' : ''}`}
                onClick={() => setHasDoubleZero((prev) => !prev)}
                title="Include 0 and 00 on the wheel"
              >
                {hasDoubleZero ? '🟢 + 2 Zeros (0 & 00)' : '⚪ No Zeros'}
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
  const isWeightedCash = Boolean(currentRound?.isWeightedCash || prize?.prize_type === 'weighted_cash');
  const isCashRound = Boolean(currentRound?.isCashRound || prize?.prize_type === 'cash_multiplier' || isWeightedCash);
  const canSpin = status === 'REGISTRATION_CLOSED' && session.playerCount > 0;
  const isSpinning = status === 'SPINNING';
  const isResult = status === 'RESULT';
  const stats = session.houseCashStats || {};
  const profModel = stats.profitabilityModel || null;
  const finSettings = stats.financialSettings || {};

  const activeShopCode = linkedShop?.shopCode || session.shopCode || session.shortCode;
  const activeShopName = linkedShop?.name || session.shopName || 'CHILLAX';

  // For grid display, show 0 and 00 at the top followed by numbers in ascending order
  const allWheelPockets = session?.wheelNumbers || [];
  const zeros = allWheelPockets.filter((n) => n === '0' || n === '00');
  const nonZeros = allWheelPockets.filter((n) => n !== '0' && n !== '00').sort((a, b) => Number(a) - Number(b));
  const gridDisplayNumbers = (zeros.length > 0 || nonZeros.length > 0)
    ? [...zeros, ...nonZeros]
    : ['0', '00', ...Array.from({ length: (session?.numberRange?.max || 20) - (session?.numberRange?.min || 1) + 1 }, (_, i) => String((session?.numberRange?.min || 1) + i))];

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
          <button onClick={handleLoadHistory} className="host-icon-btn" title="View History & Ledger">
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

      {/* Reserve Exhaustion / Warning / Emergency Banner */}
      {stats.emergencySuspended && (
        <div className="host-error-alert flex justify-between items-center">
          <span>🚨 <strong>EMERGENCY SUSPENDED:</strong> New paid entries are paused. Existing obligations remain intact.</span>
          <button
            type="button"
            onClick={() => handleToggleEmergencySuspend(false)}
            className="profit-toggle-btn"
          >
            Resume Entries
          </button>
        </div>
      )}
      {!stats.emergencySuspended && stats.isReserveExhausted && (
        <div className="host-error-alert flex justify-between items-center">
          <span>🛑 <strong>RESERVE LIMIT REACHED (R{stats.committedCashTotal} / R{stats.monthlyCashReserve}):</strong> New paid cash entries are suspended until the ring-fenced reserve is replenished.</span>
          <button
            type="button"
            onClick={() => handleReplenishReserve(500)}
            className="profit-toggle-btn"
          >
            + Replenish R500
          </button>
        </div>
      )}
      {!stats.emergencySuspended && !stats.isReserveExhausted && stats.isReserveWarning && (
        <div className="host-warning-alert flex justify-between items-center">
          <span>⚠️ <strong>RESERVE WARNING (R{stats.committedCashTotal} / R{stats.monthlyCashReserve} Committed):</strong> Exceeded R{stats.warningThreshold} warning threshold. Available reserve: R{stats.availableCashReserve}.</span>
          <button
            type="button"
            onClick={() => handleReplenishReserve(500)}
            className="profit-toggle-btn"
          >
            + Top Up R500
          </button>
        </div>
      )}

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

      {/* Active Prize Card & Cash Mode Switcher */}
      {prize && (
        <div className="host-active-prize-card">
          <div className="prize-indicator" style={{ background: prize.color || '#00f2fe' }} />
          <div className="prize-info">
            <div className="prize-label">
              {isWeightedCash
                ? '🎯 WEIGHTED CASH SCHEDULE (R10 / R20 / R50 / R100 • 4.625% WIN RATE)'
                : isCashRound
                  ? '💰 SMART CASH MODE (1.5X • 2X • 3X | MIN R5)'
                  : 'CURRENT ROUND PRIZE'}
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
            <div className="flex gap-1 flex-wrap">
              <button
                type="button"
                onClick={() => handleChangeRoundPrize('prize_weighted_cash')}
                className={`host-cash-mode-btn ${isWeightedCash ? 'active' : ''}`}
                title="R10 Spin Weighted Cash Schedule (R10 @ 4%, R20 @ 0.5%, R50 @ 0.1%, R100 @ 0.025%)"
              >
                🎯 R10 Cash Schedule
              </button>
              <button
                type="button"
                onClick={() => {
                  if (prize.prize_type === 'cash_multiplier') {
                    const firstStd = prizes.find((p) => p.prize_type !== 'cash_multiplier' && p.prize_type !== 'weighted_cash');
                    if (firstStd) handleChangeRoundPrize(firstStd.id);
                  } else {
                    handleChangeRoundPrize('prize_cash_3x');
                  }
                }}
                className={`host-cash-mode-btn ${prize.prize_type === 'cash_multiplier' ? 'active' : ''}`}
                title="Toggle Smart Cash Multiplier Mode (1.5x / 2x / 3x)"
              >
                {prize.prize_type === 'cash_multiplier' ? '💰 1.5x–3x ON' : '💰 1.5x–3x Mode'}
              </button>
            </div>
          )}
          <Award size={24} style={{ color: prize.color || '#00f2fe' }} />
        </div>
      )}

      {/* House Profit Protection & Ring-Fenced R1,000 Cash Reserve Engine */}
      {session.houseCashStats && (
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
            <span className="profit-engine-title">
              🏦 SMART PROFIT-GUARD ENGINE (1.5x / 2x / 3x) &amp; R{stats.monthlyCashReserve || 1000} RESERVE
            </span>
            <div className="profit-engine-header-right">
              {showProfitEngine && (
                <span className={`profit-3x-status ${stats.isReserveExhausted ? 'locked' : stats.is3xReady ? 'unlocked' : 'locked'}`}>
                  {stats.isReserveExhausted
                    ? '🛑 Reserve Exhausted'
                    : isWeightedCash
                      ? `🎯 R${stats.availableCashReserve} Reserve Available`
                      : stats.is3xReady
                        ? '🔓 3x Jackpot Unlocked'
                        : '🔒 3x Gated (1.5x / 2x Active)'}
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
            <>
              <div className="profit-metrics-grid">
                <div className="profit-metric-box">
                  <span className="metric-label">Collected (Stakes)</span>
                  <span className="metric-val">R{stats.historicalCollected + (session.totalBets || 0)}</span>
                </div>
                <div className="profit-metric-box">
                  <span className="metric-label">Settled Paid Out</span>
                  <span className="metric-val">R{stats.settledCashPaid ?? stats.historicalPaidOut}</span>
                </div>
                <div className="profit-metric-box" title="Unredeemed winnings are never counted as available cash">
                  <span className="metric-label">Unredeemed Liability</span>
                  <span className="metric-val text-gold">R{stats.outstandingCashLiabilities || 0}</span>
                </div>
                <div className="profit-metric-box">
                  <span className="metric-label">Net Spin Contrib.</span>
                  <span className="metric-val text-green">
                    R{Math.round(((stats.netSpinContribution ?? stats.netProfit) + (session.totalBets || 0)) * 100) / 100}
                  </span>
                </div>
                <div className="profit-metric-box">
                  <span className="metric-label">Ring-Fenced Reserve</span>
                  <span className="metric-val text-cyan">
                    R{stats.availableCashReserve} / R{stats.monthlyCashReserve}
                  </span>
                </div>
                <div className="profit-metric-box">
                  <span className="metric-label">Daily / Weekly Cap</span>
                  <span className="metric-val">
                    R{stats.dailyCashCommitted}/R{stats.dailyExposureLimit} • R{stats.weeklyCashCommitted}/R{stats.weeklyExposureLimit}
                  </span>
                </div>
                <div className="profit-metric-box">
                  <span className="metric-label">Surplus (3x Gate)</span>
                  <span className="metric-val text-gold">R{stats.surplusReserve}</span>
                </div>
                <div className="profit-metric-box">
                  <span className="metric-label">Unique / Repeat</span>
                  <span className="metric-val">
                    {stats.uniquePlayersCount || 0} ({stats.repeatPlaysCount || 0} rpt)
                  </span>
                </div>
              </div>

              <div className="reserve-controls-bar">
                <div className="reserve-controls-left">
                  <span className="text-xs text-muted">
                    Warn @ R{stats.warningThreshold} • Auto-Stop @ R{stats.suspensionThreshold} • Max Single Win R{stats.maxSingleCashPrize || 100}
                  </span>
                </div>
                <div className="reserve-controls-actions">
                  <button
                    type="button"
                    onClick={() => handleReplenishReserve(500)}
                    className="profit-toggle-btn"
                    title="Add R500 to the ring-fenced cash-prize reserve"
                  >
                    + Replenish R500
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleEmergencySuspend(!stats.emergencySuspended)}
                    className={`profit-toggle-btn ${stats.emergencySuspended ? 'text-green' : 'text-danger'}`}
                    title="Emergency control: suspend or resume new paid entries without deleting existing obligations"
                  >
                    {stats.emergencySuspended ? '✓ Resume Entries' : '🚨 Emergency Suspend'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Owner Profitability Model, Weighted Prize Schedule & Launch Plan Card (PDF Spec) */}
      {profModel && (
        <div className={`host-profit-engine-card ${showOwnerModel ? 'expanded' : 'collapsed'}`}>
          <div
            className="profit-engine-header clickable"
            onClick={toggleOwnerModel}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleOwnerModel();
              }
            }}
          >
            <span className="profit-engine-title">
              📊 OWNER PROFITABILITY MODEL, PRIZE SCHEDULE &amp; LAUNCH PLAN
            </span>
            <div className="profit-engine-header-right">
              <span className="text-xs text-cyan">
                {profModel.spinPrice ? `R${profModel.spinPrice}/spin` : 'R10/spin'} • EV R{profModel.expectedPayoutPerSpin}/spin
              </span>
              <button
                type="button"
                className="profit-toggle-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleOwnerModel();
                }}
              >
                {showOwnerModel ? <><EyeOff size={13} /> Hide</> : <><Eye size={13} /> Show Plan</>}
              </button>
            </div>
          </div>

          {showOwnerModel && (
            <div className="owner-model-body">
              {/* Sub-navigation Tabs */}
              <div className="owner-model-tabs">
                <button
                  type="button"
                  onClick={() => setOwnerModelTab('profitability')}
                  className={`range-pill ${ownerModelTab === 'profitability' ? 'active' : ''}`}
                >
                  📈 Profitability &amp; Fixed Costs
                </button>
                <button
                  type="button"
                  onClick={() => setOwnerModelTab('schedule')}
                  className={`range-pill ${ownerModelTab === 'schedule' ? 'active' : ''}`}
                >
                  🎯 Weighted Cash Schedule (4.625%)
                </button>
                <button
                  type="button"
                  onClick={() => setOwnerModelTab('calendar')}
                  className={`range-pill ${ownerModelTab === 'calendar' ? 'active' : ''}`}
                >
                  📅 Hybrid Promo Calendar &amp; Rules
                </button>
              </div>

              {ownerModelTab === 'profitability' && (
                <div className="owner-tab-panel">
                  {/* Commercial Decision Configurator (Page 6 of PDF) */}
                  <div className="configurator-grid">
                    <div className="config-item">
                      <label className="text-xs text-muted block mb-1">Daily Footfall (26 days/mo)</label>
                      <div className="flex gap-1">
                        {[50, 70].map((cust) => (
                          <button
                            key={cust}
                            type="button"
                            onClick={() => handleUpdateFinancialSettings({ dailyCustomers: cust })}
                            className={`wheel-preset-pill ${Number(profModel.dailyCustomers) === cust ? 'active' : ''}`}
                          >
                            {cust}/day ({cust * 26}/mo)
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="config-item">
                      <label className="text-xs text-muted block mb-1">Proposed Spin Price</label>
                      <div className="flex gap-1">
                        {[5, 10, 20].map((price) => (
                          <button
                            key={price}
                            type="button"
                            onClick={() => {
                              setWalkInBet(price);
                              handleUpdateFinancialSettings({ proposedSpinPrice: price });
                            }}
                            className={`wheel-preset-pill ${Number(profModel.spinPrice) === price ? 'active' : ''}`}
                          >
                            R{price}{price === 10 ? ' (Rec)' : ''}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="config-item">
                      <label className="text-xs text-muted block mb-1">Operating Route</label>
                      <div className="flex gap-1">
                        {[
                          { id: 'PARTNER', label: 'Partner' },
                          { id: 'OWN_LICENCE', label: 'Own Licence' },
                          { id: 'COMPARE', label: 'Compare' }
                        ].map((rt) => (
                          <button
                            key={rt.id}
                            type="button"
                            onClick={() => handleUpdateFinancialSettings({ operatingRoute: rt.id })}
                            className={`wheel-preset-pill ${profModel.operatingRoute === rt.id ? 'active' : ''}`}
                          >
                            {rt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="config-item">
                      <label className="text-xs text-muted block mb-1">Operator Revenue Share</label>
                      <div className="flex gap-1">
                        {[0, 10, 20, 30].map((pct) => (
                          <button
                            key={pct}
                            type="button"
                            onClick={() => handleUpdateFinancialSettings({ operatorSharePct: pct })}
                            className={`wheel-preset-pill ${Number(profModel.operatorSharePct) === pct ? 'active' : ''}`}
                          >
                            {pct}%
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Participation Scenarios Table (25%, 50%, 100%) */}
                  <div className="owner-table-wrap mt-2">
                    <div className="text-xs font-bold text-cyan mb-1">
                      MONTHLY SPIN &amp; WIN PARTICIPATION SCENARIOS ({profModel.monthlyCustomerVisits} visits/mo @ R{profModel.spinPrice}/spin)
                    </div>
                    <table className="history-table">
                      <thead>
                        <tr>
                          <th>Uptake</th>
                          <th>Spins/Mo</th>
                          <th>Gross Rev</th>
                          <th>Exp. Cash Payout</th>
                          <th>Op. Share ({profModel.operatorSharePct}%)</th>
                          <th>Net Contribution</th>
                          <th>R1k Reserve Left</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(profModel.scenarios || []).map((sc) => (
                          <tr
                            key={sc.uptakePct}
                            className={Number(profModel.targetUptakeRatePct) === sc.uptakePct ? 'selected-row' : ''}
                            onClick={() => handleUpdateFinancialSettings({ targetUptakeRatePct: sc.uptakePct })}
                            style={{ cursor: 'pointer' }}
                          >
                            <td>
                              <strong>{sc.uptakePct}%</strong> {sc.uptakePct === 50 ? '⭐' : ''}
                            </td>
                            <td>{sc.monthlySpins}</td>
                            <td>R{sc.grossSpinRevenue}</td>
                            <td>R{sc.expectedCashPayout}</td>
                            <td>R{sc.operatorShareAmount}</td>
                            <td className="text-green font-bold">R{sc.netSpinContribution}</td>
                            <td className={sc.reserveRemaining >= 0 ? 'text-cyan' : 'text-danger'}>
                              R{sc.reserveRemaining}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Full Business Fixed-Cost Coverage Summary (Rent R14k + Energy R6.5k-R10k) */}
                  {profModel.selectedScenario && (
                    <div className="profit-metrics-grid mt-2">
                      <div className="profit-metric-box">
                        <span className="metric-label">Ordinary Sales (26d)</span>
                        <span className="metric-val">R{profModel.monthlyOrdinarySales}</span>
                      </div>
                      <div className="profit-metric-box">
                        <span className="metric-label">Ordinary 65% Margin</span>
                        <span className="metric-val">R{profModel.ordinaryGrossContribution}</span>
                      </div>
                      <div className="profit-metric-box">
                        <span className="metric-label">Rent + Energy Fixed</span>
                        <span className="metric-val text-danger">
                          R{profModel.combinedFixedLow}–R{profModel.combinedFixedHigh}
                        </span>
                      </div>
                      <div className="profit-metric-box">
                        <span className="metric-label">Before Spin &amp; Win</span>
                        <span className="metric-val text-danger">
                          R{profModel.ordinaryNetLowEnergy} to R{profModel.ordinaryNetHighEnergy}
                        </span>
                      </div>
                      <div className="profit-metric-box">
                        <span className="metric-label">After Spin ({profModel.targetUptakeRatePct}% Uptake)</span>
                        <span className={`metric-val ${profModel.selectedScenario.totalShopNetLowEnergy >= 0 ? 'text-green' : 'text-gold'}`}>
                          R{profModel.selectedScenario.totalShopNetLowEnergy} to R{profModel.selectedScenario.totalShopNetHighEnergy}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="text-xs text-muted mt-2">
                    <strong>Formula:</strong> <code>{stats.formulaText}</code>
                  </div>
                </div>
              )}

              {ownerModelTab === 'schedule' && (
                <div className="owner-tab-panel">
                  <div className="text-xs text-muted mb-2">
                    <strong>Section 2 — Weighted Cash-Prize Schedule (4,000-Slot Engine):</strong> TV displays the 20/22-section wheel while the server selects outcomes using the auditable weighted table below (4.625% win probability, R0.575 expected payout per R10 spin).
                  </div>
                  <table className="history-table">
                    <thead>
                      <tr>
                        <th>Prize Tier</th>
                        <th>Win Probability</th>
                        <th>Approximate Odds</th>
                        <th>Weighting</th>
                        <th>Expected Cost / Spin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(stats.weightedCashSchedule?.tiers || []).map((tier) => (
                        <tr key={tier.id}>
                          <td className="font-bold text-gold">{tier.label}</td>
                          <td className="text-cyan">{tier.probabilityPct}%</td>
                          <td>{tier.oddsLabel}</td>
                          <td>{tier.weight} / 4,000</td>
                          <td>R{tier.expectedCostPerSpin.toFixed(3)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td><strong>Total Win / Non-Win</strong></td>
                        <td className="text-green font-bold">4.625% Win (95.375% House)</td>
                        <td>~1 in 21.62 spins</td>
                        <td>185 / 4,000</td>
                        <td className="text-green font-bold">R0.575 / R10 spin</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              {ownerModelTab === 'calendar' && (
                <div className="owner-tab-panel">
                  <div className="text-xs font-bold text-cyan mb-1">
                    HYBRID PROMOTIONAL CALENDAR (SPIN &amp; WIN + TOURNAMENTS)
                  </div>
                  <table className="history-table mb-2">
                    <thead>
                      <tr>
                        <th>Days</th>
                        <th>Activity</th>
                        <th>Commercial Purpose</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(stats.promotionalCalendar || []).map((item) => (
                        <tr key={item.days}>
                          <td className="font-bold text-gold">{item.days}</td>
                          <td className="text-cyan">{item.activity}</td>
                          <td>{item.purpose}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="text-xs text-muted">
                    <strong>Ring-Fenced Reserve Rules:</strong> (1) Keep R1,000 in a separate cash ledger; (2) Record every winning result immediately; (3) Never count unredeemed winnings as available cash; (4) Auto-suspend new paid entries before reserve is exhausted; (5) Never change prize/odds after customers have paid in a round.
                  </div>
                </div>
              )}
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
              Lock Entries &amp; Prepare Spin ({session.playerCount} Joined)
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
                <XCircle size={14} className="inline-icon" /> Cancel &amp; Refund Round
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
                  const redCode = currentRound?.redemptionCode;
                  const winTxId = winningEntry?.tx_id || currentRound?.winnerTxId;
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
                            💰 PAYOUT: R{winPayout} CASH ({currentRound?.prizeTierLabel || `${currentRound?.appliedMultiplier || 1.5}x`} on R{winBet} stake)
                          </span>
                        ) : (
                          <span>Prize: {prize?.name}</span>
                        )}
                        {(redCode || winTxId) && (
                          <span className="text-xs text-cyan block mt-1">
                            {redCode && <>Redemption Code: <strong>{redCode}</strong> </>}
                            {winTxId && <>• Tx: <code>{winTxId}</code></>}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Prize Redemption Button (Page 10) */}
                <div className="host-redemption-box">
                  <input
                    type="text"
                    placeholder={`Verify Redemption Code ${currentRound?.redemptionCode || ''} / cashier notes`}
                    value={redeemNotes}
                    onChange={(e) => setRedeemNotes(e.target.value)}
                    className="redeem-notes-input"
                  />
                  <button onClick={handleRedeemPrize} className="arcade-btn-success w-full">
                    <CheckCircle2 size={18} className="inline-icon" /> Mark Prize as Redeemed ({currentRound?.redemptionCode || 'Verified'})
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
                  <span className="text-muted">Landed on unclaimed number #{currentRound.winningNumber}. House retains stakes!</span>
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

              {/* Wheel Numbers Option for Next Round */}
              <div className="next-round-wheel-config mb-3">
                <label className="text-muted text-xs block mb-1 uppercase font-bold">
                  🎡 Choose Wheel Numbers for Round #{ (currentRound?.roundNumber || 1) + 1 }:
                </label>
                <div className="wheel-presets-row">
                  {[10, 15, 20, 30].map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setNextRoundNumberMax(count)}
                      className={`wheel-preset-pill ${nextRoundNumberMax === count ? 'active' : ''}`}
                    >
                      {count} Numbers
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setNextRoundHasDoubleZero((prev) => !prev)}
                    className={`wheel-zero-toggle-btn ${nextRoundHasDoubleZero ? 'active' : ''}`}
                    title="Toggle 2 Zeros (0 & 00)"
                  >
                    {nextRoundHasDoubleZero ? '🟢 2 Zeros (0 & 00) ON' : '⚪ 2 Zeros OFF'}
                  </button>
                </div>
              </div>

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
            <h4>Wheel Numbers &amp; Player Picks ({session.playerCount}/{session.wheelNumbers?.length || session.numberRange.max} Pockets)</h4>
            {isCashRound && (
              <span className="host-pool-badge">
                Pool: R{session.totalBets || 0}
              </span>
            )}
          </div>

          {/* Live Wheel Numbers Chooser */}
          <div className="host-wheel-config-bar">
            <div className="wheel-config-label">
              <span className="text-muted font-bold text-xs uppercase">🎡 Wheel Numbers:</span>
            </div>
            <div className="wheel-presets-row">
              {[10, 15, 20, 30].map((count) => (
                <button
                  key={count}
                  type="button"
                  disabled={status !== 'REGISTRATION_OPEN'}
                  onClick={() => handleUpdateWheelConfig(count, session.hasDoubleZero !== false)}
                  className={`wheel-preset-pill ${(session.numberRange.max === count) ? 'active' : ''}`}
                  title={`Set wheel to 1–${count} ${session.hasDoubleZero !== false ? '+ 2 Zeros (0 & 00)' : ''}`}
                >
                  {count} Numbers
                </button>
              ))}
              <button
                type="button"
                disabled={status !== 'REGISTRATION_OPEN'}
                onClick={() => handleUpdateWheelConfig(session.numberRange.max, !session.hasDoubleZero)}
                className={`wheel-zero-toggle-btn ${session.hasDoubleZero !== false ? 'active' : ''}`}
                title="Toggle 2 Zeros (0 and 00) on the wheel"
              >
                {session.hasDoubleZero !== false ? '🟢 2 Zeros (0 & 00) ON' : '⚪ 2 Zeros OFF'}
              </button>
            </div>
          </div>
          {status === 'REGISTRATION_OPEN' && (
            <span className="host-grid-subtitle">
              {isWeightedCash
                ? 'R10 Cash Schedule Round: Enter player name + stake (R10 recommended), then tap an open number. (18+ Only)'
                : isCashRound
                  ? '3x Cash Round: Enter player name + bet amount (min R5), then tap an open number. (18+ Only)'
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
                  <span className="walkin-bet-label">{isWeightedCash ? 'Spin Stake (Rec R10):' : 'Bet (Min R5):'}</span>
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
                    {isWeightedCash
                      ? 'Tiers: R10 / R20 / R50 / R100'
                      : `1.5x–3x: R${Number(walkInBet) >= 5 ? Math.round(Number(walkInBet) * 1.5 * 100) / 100 : 0}–R${Number(walkInBet) >= 5 ? Math.round(Number(walkInBet) * 3 * 100) / 100 : 0}`}
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
                          • Stake R{selEntry.bet_amount}
                        </strong>
                      )}{' '}
                      {selEntry.tx_id && (
                        <span className="text-xs text-cyan">[{selEntry.tx_id}] </span>
                      )}
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
                      <Trash2 size={14} className="inline-icon" /> Refund &amp; Free #{selectedPickNum}
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
          {gridDisplayNumbers.map((num) => {
            const entry = session.entries?.find(e => String(e.number) === String(num));
            const isWinner = isResult && String(currentRound?.winningNumber) === String(num);
            const isSelected = String(selectedPickNum) === String(num);
            const isHostPick = entry?.player_token?.startsWith('host_pick_');
            const isInteractive = status === 'REGISTRATION_OPEN';
            const isZero = String(num) === '0' || String(num) === '00';

            return (
              <button
                key={num}
                type="button"
                disabled={!isInteractive || isAssigningPick}
                onClick={() => handleChipClick(num, entry)}
                className={`host-num-chip ${isZero ? 'zero-chip' : ''} ${entry ? 'claimed' : 'empty'} ${isHostPick ? 'host-picked' : ''} ${isSelected ? 'selected' : ''} ${isWinner ? 'winner' : ''} ${isInteractive ? 'interactive' : ''}`}
              >
                <div className="chip-top-row">
                  <span className="chip-num">{num}</span>
                  {isHostPick && <span className="chip-host-dot" title="Entered by Host">H</span>}
                </div>
                <span
                  className="chip-player"
                  title={
                    entry
                      ? `${entry.nickname}${entry.bet_amount > 0 ? ` (Stake R${entry.bet_amount})` : ''}${entry.tx_id ? ` [${entry.tx_id}]` : ''}`
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
            {session.winnerMode === 'TRUE_ODDS' ? '🎯 Hard (Arcade / Weighted Odds)' : '🎁 Easy (Always Wins)'}
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
            🎯 Hard ({isWeightedCash ? '4.625% Weighted Schedule' : `1 in ${session.wheelNumbers?.length || session.numberRange.max} Odds`})
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
          {isWeightedCash
            ? 'In Weighted Cash Schedule Mode, the server uses the 4,000-slot weighted table (R10 @ 4%, R20 @ 0.5%, R50 @ 0.1%, R100 @ 0.025% = 4.625% total win rate, EV R0.575/spin).'
            : `In Hard Mode, the wheel spins across all ${session.wheelNumbers?.length || session.numberRange.max} pockets${session.hasDoubleZero !== false ? ' (including 0 & 00)' : ''}. If it lands on an unclaimed number, there is NO WINNER.`}
        </p>
      </div>

      {/* History Modal */}
      {showHistory && (
        <div className="host-modal-overlay">
          <div className="host-modal-card">
            <div className="modal-header">
              <h3>Session Rounds History &amp; Redemption Codes</h3>
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
                      <th>Prize / Payout</th>
                      <th>Code</th>
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
                          {(r.prize_type === 'cash_multiplier' || r.prize_type === 'weighted_cash') && r.winner_payout_amount > 0
                            ? `R${r.winner_payout_amount} Cash (${r.prize_tier_label || `${r.applied_multiplier || 1.5}x R${r.winner_bet_amount}`})`
                            : (r.prize_name || 'Standard')}
                        </td>
                        <td>
                          {r.redemption_code ? <code className="text-cyan">{r.redemption_code}</code> : '—'}
                        </td>
                        <td>
                          {r.redeemed_at ? (
                            <span className="badge-redeemed">✓ Redeemed</span>
                          ) : r.winning_entry_id ? (
                            <span className="badge-pending">Unredeemed Liability</span>
                          ) : (
                            <span className="text-muted">No Winner</span>
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
