import crypto from 'node:crypto';
import { db, logAudit, logReserveLedger } from './db.js';
import {
  syncRecordToMongo,
  deleteRecordFromMongo,
  recordHubTransaction,
  recordHubEntryTransaction,
  syncAllSessionEntriesToHub,
  HubTransaction,
  updateHubTvStatus,
  isValidHubPin,
  getMongoStatus,
  hubCache
} from './mongo.js';
import QRCode from 'qrcode';

// Valid state transitions defined by specification Page 8
export const ALLOWED_TRANSITIONS = {
  IDLE: ['REGISTRATION_OPEN'],
  REGISTRATION_OPEN: ['REGISTRATION_CLOSED', 'CANCELLED'],
  REGISTRATION_CLOSED: ['SPINNING', 'CANCELLED', 'REGISTRATION_OPEN'],
  SPINNING: ['RESULT', 'CANCELLED'],
  RESULT: ['REGISTRATION_OPEN', 'ENDED', 'IDLE'],
  CANCELLED: ['IDLE', 'REGISTRATION_OPEN', 'ENDED'],
  ENDED: []
};

// Section 2 of Profitability Model & Launch Plan: Weighted Cash-Prize Schedule for a R10 spin
// Total Win Probability = 4.625% (185 / 4,000) | Expected Cash Payout = R0.575 per R10 spin
export const WEIGHTED_CASH_SCHEDULE = [
  { prize: 100, probability: 0.00025, pctLabel: '0.025%', oddsLabel: '1 in 4,000', ticketsOutOf4000: 1,   expectedCost: 0.025 },
  { prize: 50,  probability: 0.001,   pctLabel: '0.1%',   oddsLabel: '1 in 1,000', ticketsOutOf4000: 4,   expectedCost: 0.05  },
  { prize: 20,  probability: 0.005,   pctLabel: '0.5%',   oddsLabel: '1 in 200',   ticketsOutOf4000: 20,  expectedCost: 0.10  },
  { prize: 10,  probability: 0.04,    pctLabel: '4%',     oddsLabel: '1 in 25',    ticketsOutOf4000: 160, expectedCost: 0.40  }
];

// Section 1, 3, 5, 10, 11 of Launch Plan: Default Financial & Reserve Control Settings
export const DEFAULT_FINANCIAL_SETTINGS = {
  customersPerDay: 50,
  avgOrdinarySpend: 20,
  tradingDaysPerMonth: 26,
  proposedSpinPrice: 10,
  targetUptakePct: 50,
  targetProfitMarginPct: 30,
  monthlyReserveLimit: 1000,
  weeklyExposureLimit: 250,
  dailyExposureLimit: 50,
  maxSingleCashPrize: 100,
  warningThreshold: 750,
  suspensionThreshold: 1000,
  replenishedReserve: 0,
  emergencySuspended: false,
  ordinaryContributionMarginPct: 65,
  monthlyRent: 14000,
  monthlyEnergyMin: 6500,
  monthlyEnergyMax: 10000,
  operatingRoute: 'PARTNER', // 'PARTNER' | 'OWN_LICENCE' | 'COMPARE'
  operatorSharePct: 0,       // 0 | 10 | 20 | 30
  paymentFeePct: 0,
  nonCashPrizeCosts: 0,
  otherDirectCosts: 0,
  dailyOrdinarySalesRecorded: 0
};

// Section 6 of Launch Plan: Hybrid Promotional Calendar
export const HYBRID_PROMOTIONAL_CALENDAR = [
  {
    days: 'Tue–Thu',
    title: 'Daily Spin activity',
    activity: 'Daily Spin activity',
    description: 'Build awareness with the TV display, visible prize information and scheduled promotional activity. Focus on quieter trading periods.',
    purpose: 'Build awareness with the TV display, visible prize information and scheduled promotional activity. Focus on quieter trading periods.',
    recommendedMode: 'STANDARD_PROMO'
  },
  {
    days: 'Friday',
    title: 'Cash-prize feature',
    activity: 'Cash-prize feature',
    description: 'Advertise the scheduled cash-prize event and encourage adult customers to visit. Use only approved games and prize arrangements.',
    purpose: 'Advertise the scheduled cash-prize event and encourage adult customers to visit. Use only approved games and prize arrangements.',
    recommendedMode: 'WEIGHTED_CASH'
  },
  {
    days: 'Saturday',
    title: 'Gaming tournaments',
    activity: 'Gaming tournaments (EA FC, Tekken, MK)',
    description: 'Run EA FC, Tekken or Mortal Kombat tournaments. Tournament prizes should have a separately approved budget.',
    purpose: 'Run EA FC, Tekken or Mortal Kombat tournaments. Tournament prizes should have a separately approved budget.',
    recommendedMode: 'TOURNAMENT'
  },
  {
    days: 'Month-end',
    title: 'Monthly feature event',
    activity: 'Monthly feature event',
    description: 'Use a special event to bring back existing customers and attract new ones. Do not promise a jackpot larger than the funded and approved amount.',
    purpose: 'Use a special event to bring back existing customers and attract new ones. Do not promise a jackpot larger than the funded and approved amount.',
    recommendedMode: 'MONTHLY_FEATURE'
  }
];

// Deterministic Profitability Model & Scenarios Calculator (Sections 1, 2, 4, 5, 10, 11 of PDF)
export function calculateProfitabilityModel(overrides = {}) {
  const cfg = { ...DEFAULT_FINANCIAL_SETTINGS, ...overrides };
  const customersPerDay = Math.max(1, Number(cfg.dailyCustomers ?? cfg.customersPerDay) || 50);
  const avgOrdinarySpend = Math.max(0, Number(cfg.avgOrdinarySpend) || 20);
  const tradingDays = Math.max(1, Number(cfg.tradingDaysPerMonth) || 26);
  const spinPrice = Math.max(5, Number(cfg.proposedSpinPrice) || 10);
  const targetUptakePct = Number(cfg.targetUptakeRatePct ?? cfg.targetUptakePct) || 50;
  const monthlyCashBudget = Math.max(0, Number(cfg.monthlyCashReserve ?? cfg.monthlyReserveLimit) || 1000);
  const ordinaryMarginPct = Number(cfg.ordinaryGrossMarginPct ?? cfg.ordinaryContributionMarginPct) || 65;
  const monthlyRent = Number(cfg.monthlyRent) || 14000;
  const monthlyEnergyMin = Number(cfg.monthlyElectricityLow ?? cfg.monthlyEnergyMin) || 6500;
  const monthlyEnergyMax = Number(cfg.monthlyElectricityHigh ?? cfg.monthlyEnergyMax) || 10000;
  const operatorSharePct = Math.max(0, Number(cfg.operatorSharePct) || 0);
  const paymentFeePct = Math.max(0, Number(cfg.paymentFeePct) || 0);
  const nonCashPrizeCosts = Math.max(0, Number(cfg.nonCashPrizeCostMonthly ?? cfg.nonCashPrizeCosts) || 0);
  const otherDirectCosts = Math.max(0, Number(cfg.otherDirectCostsMonthly ?? cfg.otherDirectCosts) || 0);

  const dailyOrdinarySales = Math.round(customersPerDay * avgOrdinarySpend * 100) / 100;
  const monthlyOrdinarySales = Math.round(dailyOrdinarySales * tradingDays * 100) / 100;
  const monthlyCustomerVisits = customersPerDay * tradingDays;

  // Section 5: Full business profitability baseline
  const ordinaryContribution = Math.round(monthlyOrdinarySales * (ordinaryMarginPct / 100) * 100) / 100;
  const fixedCostsMin = monthlyRent + monthlyEnergyMin;
  const fixedCostsMax = monthlyRent + monthlyEnergyMax;
  const remainingBeforeOtherMin = Math.round((ordinaryContribution - fixedCostsMin) * 100) / 100; // -R3,600
  const remainingBeforeOtherMax = Math.round((ordinaryContribution - fixedCostsMax) * 100) / 100; // -R7,100

  // Expected cash payout per spin scales with spinPrice (R0.575 per R10 spin = 5.75% of spin stake)
  const expectedPayoutPerSpin = Math.round((0.575 * (spinPrice / 10)) * 1000) / 1000;

  const buildScenario = (uptakePct, visits = monthlyCustomerVisits, ordSales = monthlyOrdinarySales) => {
    const spins = Math.round(visits * (uptakePct / 100));
    const spinRevenue = Math.round(spins * spinPrice * 100) / 100;
    const totalTurnover = Math.round((ordSales + spinRevenue) * 100) / 100;
    const expectedCashPayouts = Math.round(spins * expectedPayoutPerSpin * 100) / 100;
    const spinRevenueAfterPayouts = Math.round((spinRevenue - expectedCashPayouts) * 100) / 100;
    const cashBudgetRemaining = Math.round((monthlyCashBudget - expectedCashPayouts) * 100) / 100;
    const operatorShareAmount = Math.round(spinRevenue * (operatorSharePct / 100) * 100) / 100;
    const paymentFeesAmount = Math.round(spinRevenue * (paymentFeePct / 100) * 100) / 100;
    const netSpinContribution = Math.round(
      (spinRevenue - expectedCashPayouts - nonCashPrizeCosts - operatorShareAmount - paymentFeesAmount - otherDirectCosts) * 100
    ) / 100;

    return {
      uptakePct,
      customerVisits: visits,
      ordinarySales: ordSales,
      spinsPerMonth: spins,
      monthlySpins: spins,
      spinRevenue,
      grossSpinRevenue: spinRevenue,
      totalTurnover,
      expectedCashPayouts,
      expectedCashPayout: expectedCashPayouts,
      spinRevenueAfterPayouts,
      cashBudgetRemaining,
      reserveRemaining: cashBudgetRemaining,
      operatorShareAmount,
      paymentFeesAmount,
      netSpinContribution,
      totalShopNetLowEnergy: Math.round((remainingBeforeOtherMin + netSpinContribution) * 100) / 100,
      totalShopNetHighEnergy: Math.round((remainingBeforeOtherMax + netSpinContribution) * 100) / 100
    };
  };

  const sc25 = buildScenario(25);
  const sc50 = buildScenario(50);
  const sc100 = buildScenario(100);
  const scSelected = buildScenario(targetUptakePct);
  const scGrowth70 = buildScenario(50, 70 * tradingDays, 70 * avgOrdinarySpend * tradingDays);

  const scenariosList = [sc25, sc50, sc100];
  scenariosList.uptake25 = sc25;
  scenariosList.uptake50 = sc50;
  scenariosList.uptake100 = sc100;
  scenariosList.selected = scSelected;
  scenariosList.growth70Customers = scGrowth70;

  const remainingWithSpinMin = scSelected.totalShopNetLowEnergy;
  const remainingWithSpinMax = scSelected.totalShopNetHighEnergy;

  return {
    dailyCustomers: customersPerDay,
    avgOrdinarySpend,
    tradingDaysPerMonth: tradingDays,
    dailyOrdinarySales,
    monthlyOrdinarySales,
    monthlyCustomerVisits,
    ordinaryGrossContribution: ordinaryContribution,
    combinedFixedLow: fixedCostsMin,
    combinedFixedHigh: fixedCostsMax,
    ordinaryNetLowEnergy: remainingBeforeOtherMin,
    ordinaryNetHighEnergy: remainingBeforeOtherMax,
    spinPrice,
    expectedPayoutPerSpin,
    targetUptakeRatePct: targetUptakePct,
    operatingRoute: cfg.operatingRoute || 'PARTNER',
    operatorSharePct,
    selectedScenario: scSelected,
    assumptions: {
      customersPerDay,
      avgOrdinarySpend,
      tradingDaysPerMonth: tradingDays,
      dailyOrdinarySales,
      monthlyOrdinarySales,
      monthlyCustomerVisits,
      proposedSpinPrice: spinPrice,
      targetUptakePct,
      monthlyCashBudget,
      maxCashPrizePerWin: Number(cfg.maxSingleCashPrize) || 100,
      expectedPayoutPerSpin,
      totalWinProbabilityPct: 4.625,
      operatingRoute: cfg.operatingRoute || 'PARTNER',
      operatorSharePct
    },
    scenarios: scenariosList,
    fullBusinessProfitability: {
      ordinarySales: monthlyOrdinarySales,
      ordinaryContributionMarginPct: ordinaryMarginPct,
      ordinaryContribution,
      monthlyRent,
      monthlyEnergyMin,
      monthlyEnergyMax,
      combinedFixedCostsMin: fixedCostsMin,
      combinedFixedCostsMax: fixedCostsMax,
      remainingBeforeSpinMin: remainingBeforeOtherMin,
      remainingBeforeSpinMax: remainingBeforeOtherMax,
      remainingWithSpinMin,
      remainingWithSpinMax
    }
  };
}

// Generate unique transaction ID for every paid/free entry (Section 7 Step 3 & Section 8)
export function generateTransactionId(shopCode = 'CHX') {
  const cleanShop = String(shopCode || 'CHX').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 6) || 'CHX';
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randPart = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `TX-${cleanShop}-${datePart}-${randPart}`;
}

// Generate unique redemption code for winner verification (Section 8)
export function generateRedemptionCode(roundNumber = 1) {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[crypto.randomInt(0, chars.length)];
  }
  return `CLX-R${roundNumber}-${code}`;
}

// Generate a random 5-character uppercase alphanumeric short code (avoiding confusing chars like 0/O, 1/I)
export function generateShortCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars[crypto.randomInt(0, chars.length)];
  }
  return code;
}

// Generate a 4-digit pairing code for Android TV
export function generatePairingCode() {
  return String(crypto.randomInt(1000, 9999));
}

// Generate authoritative wheel numbers array with 0 and 00 positioned directly opposite each other
export function buildWheelNumbers({ min = 1, max = 20, hasDoubleZero = true } = {}) {
  const regularNums = [];
  for (let i = min; i <= max; i++) {
    regularNums.push(String(i));
  }

  if (!hasDoubleZero) {
    return regularNums;
  }

  // Place '0' at top (index 0) and '00' directly opposite across the wheel (at 180 degrees)
  const half = Math.floor(regularNums.length / 2);
  const firstHalf = regularNums.slice(0, half);
  const secondHalf = regularNums.slice(half);

  return ['0', ...firstHalf, '00', ...secondHalf];
}

// Normalize wheel pocket identifiers (handles '10.0' from DB/Mongo -> '10', preserves '0' and '00')
export function normalizeWheelNumber(val) {
  if (val === null || val === undefined) return '';
  const s = String(val).trim();
  if (s === '00' || s === '0') return s;
  const num = Number(s);
  if (!Number.isNaN(num) && Number.isInteger(num)) {
    return String(num);
  }
  return s;
}

// Format a date/timestamp into the shop's South African trading day (YYYY-MM-DD in Africa/Johannesburg)
export function getTradingDateString(isoOrDate = new Date()) {
  try {
    const d = isoOrDate ? new Date(isoOrDate) : new Date();
    if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(d);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export class GameEngine {
  constructor(io) {
    this.io = io;
    this.failedPinAttempts = new Map(); // ip -> { count, lockedUntil }
  }

  // Rate-limiting helper for host PIN attempts (also accepts PINs from chillaxgaminghub users/settings)
  verifyHostPin(ip, inputPin, hostPin = '1234') {
    const now = Date.now();
    const attempts = this.failedPinAttempts.get(ip) || { count: 0, lockedUntil: 0 };

    if (attempts.lockedUntil > now) {
      const waitSeconds = Math.ceil((attempts.lockedUntil - now) / 1000);
      return { success: false, error: `Too many failed attempts. Try again in ${waitSeconds}s.` };
    }

    const isPinValid = (inputPin === hostPin) || isValidHubPin(inputPin);
    if (!isPinValid) {
      attempts.count += 1;
      if (attempts.count >= 5) {
        attempts.lockedUntil = now + 60000; // 1 minute lockout
      }
      this.failedPinAttempts.set(ip, attempts);
      return { success: false, error: 'Invalid Host PIN.' };
    }

    this.failedPinAttempts.delete(ip);
    return { success: true };
  }

  // Write-through sync helpers to MongoDB `chillaxgaminghub`
  syncSessionToMongo(sessionId) {
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (row) syncRecordToMongo('sessions', row);
  }

  syncRoundToMongo(roundId) {
    const row = db.prepare('SELECT * FROM rounds WHERE id = ?').get(roundId);
    if (row) syncRecordToMongo('rounds', row);
  }

  syncEntryToMongo(entryId) {
    const row = db.prepare('SELECT * FROM entries WHERE id = ?').get(entryId);
    if (row) syncRecordToMongo('entries', row);
  }

  // Compute real-time house treasury, ring-fenced R1,000 cash reserve, exposure limits & Daily 30%+ Profit-Guard telemetry
  getHouseCashStats(sessionId, excludeRoundId = null) {
    const sessionRow = db.prepare('SELECT short_code, settings_json FROM sessions WHERE id = ?').get(sessionId);
    let sessionSettings = {};
    if (sessionRow?.settings_json) {
      try {
        sessionSettings = JSON.parse(sessionRow.settings_json);
      } catch {}
    }
    const finSettings = {
      ...DEFAULT_FINANCIAL_SETTINGS,
      ...(sessionSettings.financial || {}),
      ...(sessionSettings.financialSettings || {})
    };

    const resolvedRounds = db.prepare(`
      SELECT id, winning_entry_id, applied_multiplier, started_at, result_at
      FROM rounds
      WHERE session_id = ? AND status IN ('SPINNING', 'RESULT')
      ORDER BY round_number DESC
    `).all(sessionId);

    const now = new Date();
    const todayPrefix = now.toISOString().slice(0, 10); // UTC YYYY-MM-DD
    const todaySast = getTradingDateString(now);        // Africa/Johannesburg YYYY-MM-DD
    const monthPrefix = now.toISOString().slice(0, 7);  // YYYY-MM
    const sevenDaysAgoMs = now.getTime() - (7 * 24 * 60 * 60 * 1000);

    let historicalCollected = 0;
    let historicalPaidOut = 0; // Total committed cash winnings (paid + unredeemed)
    let settledCashPaid = 0;   // Redeemed cash prizes
    let outstandingCashLiabilities = 0; // Unredeemed winnings (Section 3: liability until collected)
    let dailyCollectedSettled = 0;
    let dailyCommittedCash = 0;
    let dailyRoundsCount = 0;
    let dailyEntriesCount = 0;
    let dailyWinnersCount = 0;
    let weeklyCommittedCash = 0;
    let monthlyCommittedCash = 0;
    let consecutiveNoWinners = 0;
    let streakCounting = true;
    let totalSpinEntries = 0;

    for (const r of resolvedRounds) {
      if (excludeRoundId && r.id === excludeRoundId) continue;

      const roundBets = db.prepare(`
        SELECT COALESCE(SUM(bet_amount), 0) as total, COUNT(*) as cnt
        FROM entries
        WHERE round_id = ? AND status = 'ACTIVE'
      `).get(r.id);
      const roundCollected = Number(roundBets?.total || 0);
      const roundEntryCount = Number(roundBets?.cnt || 0);
      historicalCollected += roundCollected;
      totalSpinEntries += roundEntryCount;

      const roundTimestamp = r.result_at || r.started_at || now.toISOString();
      const isToday = roundTimestamp.startsWith(todayPrefix) || getTradingDateString(roundTimestamp) === todaySast;
      if (isToday) {
        dailyCollectedSettled += roundCollected;
        dailyRoundsCount += 1;
        dailyEntriesCount += roundEntryCount;
      }

      if (r.winning_entry_id) {
        streakCounting = false;
        const winRow = db.prepare('SELECT payout_amount FROM entries WHERE id = ?').get(r.winning_entry_id);
        const payout = Number(winRow?.payout_amount || 0);
        historicalPaidOut += payout;

        if (payout > 0) {
          const redemptionRow = db.prepare('SELECT id FROM redemptions WHERE round_id = ?').get(r.id);
          if (redemptionRow) {
            settledCashPaid += payout;
          } else {
            outstandingCashLiabilities += payout;
          }

          if (isToday) {
            dailyCommittedCash += payout;
            dailyWinnersCount += 1;
          }
          if (roundTimestamp.startsWith(monthPrefix)) {
            monthlyCommittedCash += payout;
          }
          const roundTimeMs = Date.parse(roundTimestamp);
          if (!Number.isNaN(roundTimeMs) && roundTimeMs >= sevenDaysAgoMs) {
            weeklyCommittedCash += payout;
          }
        }
      } else if (streakCounting) {
        consecutiveNoWinners += 1;
      }
    }

    // Include active stakes in the current open/closed round when computing live daily collections
    let currentRoundBets = 0;
    let currentRoundEntriesCount = 0;
    const openRound = db.prepare(`
      SELECT id FROM rounds
      WHERE session_id = ? AND status IN ('REGISTRATION_OPEN', 'REGISTRATION_CLOSED')
      ORDER BY round_number DESC LIMIT 1
    `).get(sessionId);
    if (openRound && (!excludeRoundId || openRound.id !== excludeRoundId)) {
      const openRow = db.prepare(`
        SELECT COALESCE(SUM(bet_amount), 0) as total, COUNT(*) as cnt
        FROM entries
        WHERE round_id = ? AND status = 'ACTIVE'
      `).get(openRound.id);
      currentRoundBets = Number(openRow?.total || 0);
      currentRoundEntriesCount = Number(openRow?.cnt || 0);
    }

    // Customer & Repeat Participation Analytics (Section 8)
    const playerRows = db.prepare(`
      SELECT player_token, COUNT(DISTINCT round_id) as rounds_played
      FROM entries
      WHERE session_id = ? AND status = 'ACTIVE'
      GROUP BY player_token
    `).all(sessionId);
    const uniquePlayers = playerRows.length;
    const returningPlayers = playerRows.filter(p => Number(p.rounds_played) > 1).length;
    const newPlayers = Math.max(0, uniquePlayers - returningPlayers);
    const estimatedDailyCustomers = Number(finSettings.customersPerDay) || 50;
    const nonPlayingVisitors = Math.max(0, estimatedDailyCustomers - uniquePlayers);

    // Ring-Fenced Cash Reserve & Exposure Limits (Section 3)
    const baseMonthlyReserve = Number(finSettings.monthlyCashReserve ?? finSettings.monthlyReserveLimit) || 1000;
    const replenishedReserve = Number(finSettings.replenishedReserve) || 0;
    const effectiveMonthlyReserveLimit = Math.round((baseMonthlyReserve + replenishedReserve) * 100) / 100;
    const weeklyExposureLimit = Number(finSettings.weeklyExposureLimit) || 250;
    const dailyExposureLimit = Number(finSettings.dailyExposureLimit) || 50;
    const maxSingleCashPrize = Number(finSettings.maxSingleCashPrize) || 100;
    const warningThreshold = Number(finSettings.warningThreshold) || 750;
    const suspensionThreshold = Number(finSettings.suspensionThreshold) || effectiveMonthlyReserveLimit;

    const monthlyReserveRemaining = Math.max(0, Math.round((effectiveMonthlyReserveLimit - monthlyCommittedCash) * 100) / 100);
    const weeklyExposureRemaining = Math.max(0, Math.round((weeklyExposureLimit - weeklyCommittedCash) * 100) / 100);
    const dailyExposureRemaining = Math.max(0, Math.round((dailyExposureLimit - dailyCommittedCash) * 100) / 100);

    const isReserveWarning = monthlyCommittedCash >= warningThreshold;
    const isReserveExhausted = monthlyCommittedCash >= suspensionThreshold || monthlyReserveRemaining < 10;
    const emergencySuspended = Boolean(finSettings.emergencySuspended);
    const isNewEntrySuspended = emergencySuspended || isReserveExhausted;

    // Section 8 Net Spin Contribution Formula:
    // Spin contribution = Spin revenue − cash prizes − non-cash prize costs − operator share − payment fees − other direct costs
    const cleanCollected = Math.round(historicalCollected * 100) / 100;
    const cleanCommitted = Math.round(historicalPaidOut * 100) / 100;
    const operatorSharePct = Number(finSettings.operatorSharePct) || 0;
    const paymentFeePct = Number(finSettings.paymentFeePct) || 0;
    const nonCashPrizeCosts = Number(finSettings.nonCashPrizeCostMonthly ?? finSettings.nonCashPrizeCosts) || 0;
    const otherDirectCosts = Number(finSettings.otherDirectCostsMonthly ?? finSettings.otherDirectCosts) || 0;
    const operatorShareAmount = Math.round(cleanCollected * (operatorSharePct / 100) * 100) / 100;
    const paymentFeesAmount = Math.round(cleanCollected * (paymentFeePct / 100) * 100) / 100;
    const netSpinContribution = Math.round(
      (cleanCollected - cleanCommitted - nonCashPrizeCosts - operatorShareAmount - paymentFeesAmount - otherDirectCosts) * 100
    ) / 100;

    // 30%+ Profit-Guard Engine (Default 30% minimum profit floor, configurable 20%–60%)
    const targetProfitMarginPct = Math.min(60, Math.max(20, Number(finSettings.targetProfitMarginPct ?? finSettings.targetMarginPct) || 30));
    const targetProfitRatio = targetProfitMarginPct / 100;
    const netProfit = Math.round((cleanCollected - cleanCommitted) * 100) / 100;
    const protectedProfitFloor = Math.round((cleanCollected * targetProfitRatio) * 100) / 100;
    const surplusReserve = Math.max(0, Math.round((netProfit - protectedProfitFloor) * 100) / 100);
    const profitMarginPct = cleanCollected > 0
      ? Math.round((netProfit / cleanCollected) * 100)
      : 100;

    // Daily Collections & 30%+ Profit Guard Metrics (Shop keeps >= targetProfitMarginPct% of collected money first)
    const collectedToday = Math.round((dailyCollectedSettled + currentRoundBets) * 100) / 100;
    const prizesToday = Math.round(dailyCommittedCash * 100) / 100;
    const profitToday = Math.round((collectedToday - prizesToday) * 100) / 100;
    const dailyMarginPct = collectedToday > 0
      ? Math.round((profitToday / collectedToday) * 100)
      : 100;
    const dailyRequiredProfitFloor = Math.round((collectedToday * targetProfitRatio) * 100) / 100;
    const dailyMaxPrizePool = Math.max(0, Math.round((collectedToday - dailyRequiredProfitFloor) * 100) / 100);
    const prizeBudgetLeft = Math.max(0, Math.round((dailyMaxPrizePool - prizesToday) * 100) / 100);
    const maxPrizeThisRound = Math.max(
      0,
      Math.floor(Math.min(prizeBudgetLeft, maxSingleCashPrize, monthlyReserveRemaining) * 100) / 100
    );
    const unlockedWeightedTiers = [10, 20, 50, 100].filter((t) => t <= maxPrizeThisRound);
    const unlockedMultipliers = [1.5, 2, 3].filter((m) => (5 * m) <= maxPrizeThisRound);
    const maxWinnerShareRatio = Math.max(0.1, 1 - targetProfitRatio);
    const amountNeededForNextWinner = maxPrizeThisRound >= 10
      ? 0
      : Math.max(5, Math.ceil((10 + prizesToday - (maxWinnerShareRatio * collectedToday)) / maxWinnerShareRatio));
    const dailyGuardStatus = maxPrizeThisRound < 10
      ? (prizesToday > 0 ? 'PAUSED' : 'BUILDING_PROFIT')
      : (dailyMarginPct >= 40 ? 'HEALTHY' : 'WATCH');

    const dailyProfitGuard = {
      tradingDate: todaySast,
      shopCode: sessionSettings.shopCode || sessionRow?.short_code || 'CHX',
      collectedToday,
      settledCollectedToday: Math.round(dailyCollectedSettled * 100) / 100,
      currentRoundCollected: Math.round(currentRoundBets * 100) / 100,
      prizesToday,
      profitToday,
      marginPct: dailyMarginPct,
      targetMarginPct: targetProfitMarginPct,
      maxWinnerPoolPct: Math.round((100 - targetProfitMarginPct) * 100) / 100,
      requiredProfitFloor: dailyRequiredProfitFloor,
      maxPrizePoolToday: dailyMaxPrizePool,
      prizeBudgetLeft,
      maxPrizeThisRound,
      unlockedWeightedTiers,
      unlockedMultipliers,
      canMakeCashWinner: maxPrizeThisRound >= 7.5,
      canMakeR10Winner: maxPrizeThisRound >= 10,
      amountNeededForNextWinner,
      roundsToday: dailyRoundsCount,
      entriesToday: dailyEntriesCount + currentRoundEntriesCount,
      winnersToday: dailyWinnersCount,
      status: dailyGuardStatus,
      ruleSummary: `Shop locks ${targetProfitMarginPct}% profit from today's collections first (${100 - targetProfitMarginPct}% max winner pool).`
    };

    return {
      historicalCollected: cleanCollected,
      historicalPaidOut: cleanCommitted,
      settledCashPaid: Math.round(settledCashPaid * 100) / 100,
      outstandingCashLiabilities: Math.round(outstandingCashLiabilities * 100) / 100,
      totalCommittedCash: cleanCommitted,
      committedCashTotal: cleanCommitted,
      dailyCollectedSettled: Math.round(dailyCollectedSettled * 100) / 100,
      collectedToday,
      prizesToday,
      profitToday,
      dailyMarginPct,
      targetProfitMarginPct,
      prizeBudgetLeft,
      maxPrizeThisRound,
      dailyProfitGuard,
      dailyCommittedCash: prizesToday,
      dailyCashCommitted: prizesToday,
      weeklyCommittedCash: Math.round(weeklyCommittedCash * 100) / 100,
      weeklyCashCommitted: Math.round(weeklyCommittedCash * 100) / 100,
      monthlyCommittedCash: Math.round(monthlyCommittedCash * 100) / 100,
      monthlyCashCommitted: Math.round(monthlyCommittedCash * 100) / 100,
      monthlyReserveLimit: effectiveMonthlyReserveLimit,
      monthlyCashReserve: effectiveMonthlyReserveLimit,
      baseMonthlyReserve,
      replenishedReserve,
      weeklyExposureLimit,
      dailyExposureLimit,
      maxSingleCashPrize,
      warningThreshold,
      suspensionThreshold,
      monthlyReserveRemaining,
      availableCashReserve: monthlyReserveRemaining,
      weeklyExposureRemaining,
      dailyExposureRemaining,
      isReserveWarning,
      isReserveExhausted,
      emergencySuspended,
      isNewEntrySuspended,
      netProfit,
      protectedProfitFloor,
      surplusReserve,
      profitMarginPct,
      consecutiveNoWinners,
      is3xReady: prizeBudgetLeft >= 15 && surplusReserve >= 15 && monthlyReserveRemaining >= 30,
      // Section 8 Essential Owner Dashboard figures
      totalSpinEntries,
      uniquePlayers,
      uniquePlayersCount: uniquePlayers,
      newPlayers,
      returningPlayers,
      repeatPlaysCount: returningPlayers,
      nonPlayingVisitors,
      avgOrdinarySpend: Number(finSettings.avgOrdinarySpend) || 20,
      dailyOrdinarySalesRecorded: Number(finSettings.dailyOrdinarySalesRecorded) || (estimatedDailyCustomers * (Number(finSettings.avgOrdinarySpend) || 20)),
      operatorSharePct,
      operatorShareAmount,
      paymentFeePct,
      paymentFeesAmount,
      nonCashPrizeCosts,
      otherDirectCosts,
      netSpinContribution,
      formulaText: 'Spin contribution = Spin revenue − cash prizes − non-cash prize costs − operator share − payment fees − other direct costs',
      financialSettings: finSettings,
      profitabilityModel: calculateProfitabilityModel(finSettings),
      weightedSchedule: WEIGHTED_CASH_SCHEDULE,
      weightedCashSchedule: {
        tiers: WEIGHTED_CASH_SCHEDULE.map((t) => ({
          id: `tier_${t.prize}`,
          label: `R${t.prize} Cash`,
          amount: t.prize,
          probabilityPct: t.probability * 100,
          oddsLabel: t.oddsLabel,
          weight: t.ticketsOutOf4000,
          expectedCostPerSpin: t.expectedCost
        }))
      },
      promotionalCalendar: HYBRID_PROMOTIONAL_CALENDAR
    };
  }

  // Retrieve live Daily 30%+ Profit-Guard telemetry for a session
  getDailyProfitGuard(sessionId) {
    const stats = this.getHouseCashStats(sessionId);
    return stats.dailyProfitGuard;
  }

  // Persist & sync daily collections and profit snapshot to SQLite and chillaxgaminghub
  saveDailyProfitReport(sessionId) {
    const guard = this.getDailyProfitGuard(sessionId);
    if (!guard) return null;
    const reportId = `dpr_${sessionId}_${guard.tradingDate}`;
    const now = new Date().toISOString();
    try {
      db.prepare(`
        INSERT INTO daily_profit_reports (
          id, session_id, shop_code, trading_date,
          collected_amount, prizes_amount, profit_amount,
          margin_pct, target_margin_pct, prize_budget_left,
          rounds_count, entries_count, winners_count, status, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          collected_amount = excluded.collected_amount,
          prizes_amount = excluded.prizes_amount,
          profit_amount = excluded.profit_amount,
          margin_pct = excluded.margin_pct,
          target_margin_pct = excluded.target_margin_pct,
          prize_budget_left = excluded.prize_budget_left,
          rounds_count = excluded.rounds_count,
          entries_count = excluded.entries_count,
          winners_count = excluded.winners_count,
          status = excluded.status,
          updated_at = excluded.updated_at
      `).run(
        reportId,
        sessionId,
        guard.shopCode || 'CHX',
        guard.tradingDate,
        guard.collectedToday,
        guard.prizesToday,
        guard.profitToday,
        guard.marginPct,
        guard.targetMarginPct,
        guard.prizeBudgetLeft,
        guard.roundsToday,
        guard.entriesToday,
        guard.winnersToday,
        guard.status,
        now
      );
      const row = db.prepare('SELECT * FROM daily_profit_reports WHERE id = ?').get(reportId);
      if (row) syncRecordToMongo('daily_profit_reports', row);
      return row;
    } catch {
      return null;
    }
  }

  // Section 2 & 3 of Launch Plan: Weighted Cash-Prize Engine (R10 @ 4%, R20 @ 0.5%, R50 @ 0.1%, R100 @ 0.025%)
  // Protected by Daily 30%+ Profit Guard: winners are only unlocked when daily & cumulative profit stays >= targetMarginPct (30%+)
  selectWeightedCashOutcome({ session, currentRound, entries, winnerMode }) {
    const roundPool = entries.reduce((sum, e) => sum + (Number(e.bet_amount) || 0), 0);
    const stats = this.getHouseCashStats(session.id, currentRound.id);
    const allWheelNums = this.getWheelNumbers(session);
    const claimedMap = new Map(entries.map(e => [normalizeWheelNumber(e.number), e]));
    const unclaimedNums = allWheelNums.filter(n => !claimedMap.has(normalizeWheelNumber(n)));

    const targetProfitRatio = Math.max(0.20, (Number(stats.targetProfitMarginPct) || 30) / 100);
    const dailyInflow = (stats.dailyCollectedSettled || 0) + roundPool;
    const dailyProfitFloor = dailyInflow * targetProfitRatio;
    const dailyAllowedPayout = Math.max(0, Math.floor(((dailyInflow - stats.dailyCommittedCash) - dailyProfitFloor) * 100) / 100);

    const totalInflow = stats.historicalCollected + roundPool;
    const cumulativeProfitFloor = totalInflow * targetProfitRatio;
    const cumulativeAllowedPayout = Math.max(0, Math.floor(((totalInflow - stats.historicalPaidOut) - cumulativeProfitFloor) * 100) / 100);

    // Maximum allowed single cash prize bounded by monthly reserve, R100 cap, AND Daily 30%+ Profit Guard
    const reserveCap = Math.min(stats.monthlyReserveRemaining, stats.maxSingleCashPrize || 100);
    const profitProtectedCap = Math.min(reserveCap, dailyAllowedPayout, cumulativeAllowedPayout);

    // Helper: map a ticket in [0, 4000) to its cash prize tier (or 0 if >= 185 or above cap)
    const resolveTierFromRoll = (roll, betAmount = 10, activeCap = profitProtectedCap) => {
      if (roll >= 185 || activeCap < 10) return { amount: 0, tierLabel: null };
      const scale = Math.max(0.5, Math.min(2, (Number(betAmount) || 10) / 10));
      let rawPrize = 10;
      let oddsLabel = '1 in 25';
      if (roll === 0) {
        rawPrize = 100;
        oddsLabel = '1 in 4,000';
      } else if (roll < 5) {
        rawPrize = 50;
        oddsLabel = '1 in 1,000';
      } else if (roll < 25) {
        rawPrize = 20;
        oddsLabel = '1 in 200';
      } else {
        rawPrize = 10;
        oddsLabel = '1 in 25';
      }

      const scaledPrize = Math.min(100, Math.round(rawPrize * scale));
      // Clamp strictly to unlocked profit-protected prize tiers
      const affordableTiers = [100, 50, 20, 10].filter(t => t <= activeCap && t <= scaledPrize);
      if (affordableTiers.length === 0) {
        return { amount: 0, tierLabel: null };
      }
      const finalAmount = affordableTiers[0];
      return { amount: finalAmount, tierLabel: `R${finalAmount} Cash (${oddsLabel})` };
    };

    if (winnerMode === 'GUARANTEED' && entries.length > 0 && reserveCap >= 5) {
      // In Guaranteed mode, enforce profitProtectedCap when >= R10; if single-entry initial spin with 0 prior prizes, allow base R10
      const guaranteedCap = profitProtectedCap >= 10
        ? profitProtectedCap
        : (stats.dailyCommittedCash === 0 && dailyInflow >= 10 ? Math.min(10, reserveCap) : 0);

      if (guaranteedCap >= 10) {
        const chosenEntry = entries[crypto.randomInt(0, entries.length)];
        const winningRoll = crypto.randomInt(0, 185);
        const tier = resolveTierFromRoll(winningRoll, chosenEntry.bet_amount, guaranteedCap);
        const bet = Math.max(5, Number(chosenEntry.bet_amount) || 10);
        const payout = tier.amount > 0 ? tier.amount : Math.min(10, guaranteedCap);
        return {
          winningNumber: normalizeWheelNumber(chosenEntry.number),
          winningEntry: chosenEntry,
          appliedMultiplier: Math.round((payout / bet) * 100) / 100,
          payoutAmount: payout,
          prizeTierLabel: tier.tierLabel || `R${payout} Cash`
        };
      }
    }

    // Authentic Weighted Schedule (4.625% win probability per entry = 185 / 4,000)
    // Only awards a cash prize when profitProtectedCap >= 10 (ensuring shop profit stays >= 30%)
    if (profitProtectedCap >= 10) {
      const shuffledEntries = [...entries].sort(() => crypto.randomInt(0, 2) - 1);
      for (const entry of shuffledEntries) {
        const roll = crypto.randomInt(0, 4000);
        if (roll < 185) {
          const tier = resolveTierFromRoll(roll, entry.bet_amount, profitProtectedCap);
          if (tier.amount > 0) {
            const bet = Math.max(5, Number(entry.bet_amount) || 10);
            return {
              winningNumber: normalizeWheelNumber(entry.number),
              winningEntry: entry,
              appliedMultiplier: Math.round((tier.amount / bet) * 100) / 100,
              payoutAmount: tier.amount,
              prizeTierLabel: tier.tierLabel
            };
          }
        }
      }
    }

    // No cash prize won (or building 30% daily profit buffer) -> land on an unclaimed section on the wheel
    const fallbackUnclaimed = unclaimedNums.length > 0
      ? unclaimedNums[crypto.randomInt(0, unclaimedNums.length)]
      : allWheelNums[crypto.randomInt(0, allWheelNums.length)];
    return {
      winningNumber: normalizeWheelNumber(fallbackUnclaimed),
      winningEntry: null,
      appliedMultiplier: 0,
      payoutAmount: 0,
      prizeTierLabel: null
    };
  }

  // Daily 30%+ Profit-Protected winner & multiplier (1.5x, 2x, 3x) selection engine
  // Ensures that whenever a winner is made, the shop is ALREADY keeping >= 30% profit from collected money
  selectSmartCashOutcome({ session, currentRound, entries, winnerMode }) {
    const roundPool = entries.reduce((sum, e) => sum + (Number(e.bet_amount) || 0), 0);
    const stats = this.getHouseCashStats(session.id, currentRound.id);
    const targetProfitRatio = Math.max(0.20, (Number(stats.targetProfitMarginPct) || 30) / 100);

    // 1. Cumulative 30%+ profit floor
    const totalInflow = stats.historicalCollected + roundPool;
    const cumulativeProfitFloor = totalInflow * targetProfitRatio;
    const cumulativeMaxSafePayout = Math.max(0, (totalInflow - stats.historicalPaidOut) - cumulativeProfitFloor);

    // 2. Daily Collections 30%+ profit floor (Shop keeps >= 30% of today's collections first; up to 70% funds winners)
    const dailyInflow = (stats.dailyCollectedSettled || 0) + roundPool;
    const dailyProfitFloor = dailyInflow * targetProfitRatio;
    const dailyMaxSafePayout = Math.max(0, (dailyInflow - stats.dailyCommittedCash) - dailyProfitFloor);

    // Effective maximum payout that keeps BOTH today's collections AND cumulative collections at >= 30% shop profit
    const maxSafePayout = Math.min(
      cumulativeMaxSafePayout,
      dailyMaxSafePayout,
      stats.monthlyReserveRemaining,
      stats.maxSingleCashPrize || 100
    );

    // Entries where paying 1.5x keeps the shop at or above its 30% minimum profit floor
    const safeEntries = entries.filter(e => (Number(e.bet_amount) * 1.5) <= maxSafePayout);

    const allWheelNums = this.getWheelNumbers(session);
    const claimedMap = new Map(entries.map(e => [normalizeWheelNumber(e.number), e]));
    const unclaimedNums = allWheelNums.filter(n => !claimedMap.has(normalizeWheelNumber(n)));

    // Helper: pick an entry weighted inversely by sqrt(bet) so smaller/safer bets win more frequently
    const pickWeightedEntry = (pool) => {
      if (pool.length === 1) return pool[0];
      const weights = pool.map(e => Math.max(1, Math.round(100 / Math.sqrt(Math.max(5, Number(e.bet_amount))))));
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      let roll = crypto.randomInt(0, totalWeight);
      for (let i = 0; i < pool.length; i++) {
        if (roll < weights[i]) return pool[i];
        roll -= weights[i];
      }
      return pool[0];
    };

    let winningNumber;
    let winningEntry = null;

    if (winnerMode === 'GUARANTEED' && entries.length > 0) {
      // Only make a cash winner when at least one entry fits inside the 30% profit-protected budget
      if (safeEntries.length > 0) {
        winningEntry = pickWeightedEntry(safeEntries);
        winningNumber = normalizeWheelNumber(winningEntry.number);
      } else if (unclaimedNums.length > 0) {
        // Building 30% daily profit buffer: cannot pay 1.5x yet without putting shop below 30% profit
        winningNumber = normalizeWheelNumber(unclaimedNums[crypto.randomInt(0, unclaimedNums.length)]);
        winningEntry = null;
      } else {
        winningNumber = normalizeWheelNumber(allWheelNums[0]);
        winningEntry = null;
      }
    } else {
      // TRUE_ODDS (Authentic random spin across ALL pockets in wheel range, gated by 30% daily profit guard)
      const rawNumber = allWheelNums[crypto.randomInt(0, allWheelNums.length)];
      const rawEntry = claimedMap.get(normalizeWheelNumber(rawNumber)) || null;

      if (!rawEntry) {
        // Natural roll landed on an unclaimed pocket -> NO WINNER (house keeps wagers)
        winningNumber = normalizeWheelNumber(rawNumber);
        winningEntry = null;
      } else {
        // Natural roll landed on a player's number! Verify 30%+ daily & cumulative profit guard
        const isSafe = (Number(rawEntry.bet_amount) * 1.5) <= maxSafePayout;

        if (isSafe) {
          // Payout is within the 70% daily prize budget (shop keeps >= 30% profit): player wins!
          winningNumber = normalizeWheelNumber(rawNumber);
          winningEntry = rawEntry;
        } else if (unclaimedNums.length > 0) {
          // Shop has not yet collected enough today to pay 1.5x on this bet while keeping >= 30% profit
          winningNumber = normalizeWheelNumber(unclaimedNums[crypto.randomInt(0, unclaimedNums.length)]);
          winningEntry = null;
        } else {
          winningNumber = normalizeWheelNumber(rawNumber);
          winningEntry = null;
        }
      }
    }

    // Select the dynamic multiplier from [1.5, 2, 3], strictly gated by maxSafePayout so profit stays >= 30%
    let appliedMultiplier = 0;
    if (winningEntry) {
      const bet = Math.max(5, Number(winningEntry.bet_amount) || 5);
      const cost2x = bet * 2;
      const cost3x = bet * 3;

      // 2x is only eligible if paying 2x stays within maxSafePayout (keeping >= 30% shop profit)
      const canAfford2x = cost2x <= maxSafePayout;
      // 3x is strictly gated: only eligible when paying 3x stays within maxSafePayout AND leaves a healthy surplus cushion
      const canAfford3x = (cost3x <= maxSafePayout) && ((maxSafePayout - cost3x) >= Math.max(10, bet * 0.5));

      let weight1_5 = 100;
      let weight2_0 = 0;
      let weight3_0 = 0;

      if (canAfford3x) {
        const surplusRatio = maxSafePayout / cost3x;
        if (surplusRatio >= 2.5) {
          weight1_5 = 57;
          weight2_0 = 28;
          weight3_0 = 15;
        } else {
          weight1_5 = 65;
          weight2_0 = 27;
          weight3_0 = 8;
        }
      } else if (canAfford2x) {
        weight1_5 = 72;
        weight2_0 = 28;
        weight3_0 = 0;
      } else {
        weight1_5 = 100;
        weight2_0 = 0;
        weight3_0 = 0;
      }

      const multRoll = crypto.randomInt(0, weight1_5 + weight2_0 + weight3_0);
      if (multRoll < weight1_5) {
        appliedMultiplier = 1.5;
      } else if (multRoll < weight1_5 + weight2_0) {
        appliedMultiplier = 2;
      } else {
        appliedMultiplier = 3;
      }
    }

    return {
      winningNumber,
      winningEntry,
      appliedMultiplier
    };
  }

  // Resolve authoritative wheel numbers array for a session
  getWheelNumbers(session) {
    if (!session) return buildWheelNumbers({ min: 1, max: 20, hasDoubleZero: true });

    if (session.wheel_numbers_json) {
      try {
        const parsed = JSON.parse(session.wheel_numbers_json);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map(String);
        }
      } catch {}
    }

    let settings = {};
    if (session.settings_json) {
      try {
        settings = JSON.parse(session.settings_json);
      } catch {}
    }
    if (Array.isArray(settings.wheelNumbers) && settings.wheelNumbers.length > 0) {
      return settings.wheelNumbers.map(String);
    }

    const hasDoubleZero = session.has_double_zero !== 0 && settings.hasDoubleZero !== false;
    const min = Number(session.number_min) || 1;
    const max = Number(session.number_max) || 20;

    return buildWheelNumbers({ min, max, hasDoubleZero });
  }

  // Update wheel numbers configuration (e.g. 10, 15, 20, 30 pockets and 0 & 00 toggle)
  setWheelConfig(sessionId, { numberMax = null, hasDoubleZero = null, customNumbers = null }) {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return { success: false, status: 404, error: 'Session not found.' };

    let validMax = session.number_max || 20;
    if (numberMax !== null && numberMax !== undefined) {
      const parsed = parseInt(numberMax, 10);
      if (!isNaN(parsed) && parsed >= 5 && parsed <= 50) {
        validMax = parsed;
      }
    }

    const useDoubleZero = hasDoubleZero !== null && hasDoubleZero !== undefined
      ? (hasDoubleZero ? 1 : 0)
      : (session.has_double_zero !== 0 ? 1 : 0);

    let wheelNumbersJson = null;
    if (Array.isArray(customNumbers) && customNumbers.length > 0) {
      wheelNumbersJson = JSON.stringify(customNumbers.map(String));
    } else {
      wheelNumbersJson = JSON.stringify(
        buildWheelNumbers({ min: session.number_min || 1, max: validMax, hasDoubleZero: Boolean(useDoubleZero) })
      );
    }

    let settings = {};
    try {
      settings = session.settings_json ? JSON.parse(session.settings_json) : {};
    } catch {}
    settings.hasDoubleZero = Boolean(useDoubleZero);
    settings.numberMax = validMax;

    db.prepare(`
      UPDATE sessions 
      SET number_max = ?, 
          has_double_zero = ?, 
          wheel_numbers_json = ?,
          settings_json = ?
      WHERE id = ?
    `).run(validMax, useDoubleZero, wheelNumbersJson, JSON.stringify(settings), sessionId);

    this.syncSessionToMongo(sessionId);
    logAudit(sessionId, 'HOST', 'host', 'WHEEL_CONFIG_UPDATED', {
      numberMax: validMax,
      hasDoubleZero: Boolean(useDoubleZero)
    });

    const snapshot = this.broadcastSessionState(sessionId);
    return {
      success: true,
      snapshot
    };
  }

  // Guarantee that an existing session always has at least one active round
  ensureCurrentRound(sessionId) {
    if (!sessionId) return null;
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return null;

    let currentRound = db.prepare(`
      SELECT * FROM rounds 
      WHERE session_id = ? 
      ORDER BY round_number DESC 
      LIMIT 1
    `).get(sessionId);

    if (!currentRound) {
      const firstStandardPrize = db.prepare("SELECT id FROM prizes WHERE enabled = 1 AND prize_type NOT IN ('cash_multiplier', 'weighted_cash') LIMIT 1").get();
      const fallbackPrize = firstStandardPrize || db.prepare('SELECT id FROM prizes WHERE enabled = 1 LIMIT 1').get();
      const prizeId = fallbackPrize ? fallbackPrize.id : null;
      const prizeObj = prizeId ? db.prepare('SELECT * FROM prizes WHERE id = ?').get(prizeId) : null;

      const roundId = 'rnd_' + crypto.randomBytes(6).toString('hex');
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO rounds (id, session_id, round_number, status, prize_id, prize_snapshot_json, started_at)
        VALUES (?, ?, 1, 'REGISTRATION_OPEN', ?, ?, ?)
      `).run(roundId, sessionId, prizeId, prizeObj ? JSON.stringify(prizeObj) : null, now);

      db.prepare(`UPDATE sessions SET status = 'REGISTRATION_OPEN' WHERE id = ?`).run(sessionId);
      this.syncRoundToMongo(roundId);
      this.syncSessionToMongo(sessionId);

      currentRound = db.prepare('SELECT * FROM rounds WHERE id = ?').get(roundId);
    }

    return currentRound;
  }

  // Helper to retrieve full authoritative session snapshot
  getSessionSnapshot(sessionId) {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return null;

    // Get current active or latest round (auto-healing if missing)
    const currentRound = this.ensureCurrentRound(sessionId);

    let entries = [];
    let prize = null;

    if (currentRound) {
      entries = db.prepare(`
        SELECT id, number, player_token, nickname, bet_amount, payout_amount, tx_id, age_verified, claimed_at, status 
        FROM entries 
        WHERE round_id = ? AND status = 'ACTIVE'
        ORDER BY number ASC
      `).all(currentRound.id);

      if (currentRound.prize_id) {
        prize = db.prepare('SELECT * FROM prizes WHERE id = ?').get(currentRound.prize_id);
      }
      if (!prize && currentRound.prize_snapshot_json) {
        try {
          prize = JSON.parse(currentRound.prize_snapshot_json);
        } catch {}
      }
    }

    const wheelNumbers = this.getWheelNumbers(session);
    const claimedNumbers = entries.map(e => String(e.number));
    const totalBets = entries.reduce((sum, e) => sum + (Number(e.bet_amount) || 0), 0);
    const isWeightedCash = prize?.prize_type === 'weighted_cash';
    const isCashRound = Boolean(prize?.prize_type === 'cash_multiplier' || isWeightedCash);
    const houseCashStats = this.getHouseCashStats(sessionId);

    const winningEntry = currentRound && currentRound.winning_entry_id
      ? db.prepare('SELECT * FROM entries WHERE id = ?').get(currentRound.winning_entry_id)
      : null;

    let sessionSettings = {};
    if (session.settings_json) {
      try {
        sessionSettings = JSON.parse(session.settings_json);
      } catch {}
    }
    const matchedShop = (hubCache.shops || []).find(
      (s) =>
        (sessionSettings.shopId && s.id === sessionSettings.shopId) ||
        String(s.shopCode || '').toUpperCase() === String(session.short_code || '').toUpperCase()
    );

    return {
      sessionId: session.id,
      shortCode: session.short_code,
      shopId: sessionSettings.shopId || matchedShop?.id || null,
      shopName: sessionSettings.shopName || matchedShop?.name || null,
      shopCode: sessionSettings.shopCode || matchedShop?.shopCode || session.short_code,
      status: currentRound ? currentRound.status : session.status,
      wheelNumbers,
      hasDoubleZero: session.has_double_zero !== 0,
      numberRange: {
        min: session.number_min,
        max: session.number_max,
        totalSlots: wheelNumbers.length
      },
      winnerMode: session.winner_mode || 'TRUE_ODDS',
      playerCount: entries.length,
      totalBets,
      houseCashStats,
      claimedNumbers,
      entries,
      currentRound: currentRound ? {
        id: currentRound.id,
        roundNumber: currentRound.round_number,
        status: currentRound.status,
        isCashRound,
        isWeightedCash,
        minBet: 5,
        defaultSpinPrice: isWeightedCash ? 10 : 5,
        multipliers: isWeightedCash ? [1, 2, 5, 10] : [1.5, 2, 3],
        appliedMultiplier: Number(currentRound.applied_multiplier) || 0,
        prizeTierLabel: currentRound.prize_tier_label || null,
        redemptionCode: currentRound.redemption_code || null,
        totalBets,
        winningNumber: currentRound.winning_number,
        winningEntryId: currentRound.winning_entry_id,
        hasWinner: Boolean(currentRound.winning_entry_id),
        winnerNickname: winningEntry ? winningEntry.nickname : null,
        winnerBetAmount: winningEntry ? (Number(winningEntry.bet_amount) || 0) : 0,
        winnerPayoutAmount: winningEntry ? (Number(winningEntry.payout_amount) || 0) : 0,
        winnerTxId: winningEntry ? (winningEntry.tx_id || null) : null,
        prize,
        startedAt: currentRound.started_at,
        resultAt: currentRound.result_at,
        cancelledAt: currentRound.cancelled_at,
        cancelReason: currentRound.cancel_reason
      } : null,
      tvConnected: Boolean(session.tv_connected),
      tvPairingCode: session.tv_pairing_code,
      mongoStatus: getMongoStatus()
    };
  }

  // Broadcast authoritative session state to all room subscribers
  broadcastSessionState(sessionId) {
    const snapshot = this.getSessionSnapshot(sessionId);
    if (snapshot) {
      this.io.to(sessionId).emit('session:state', snapshot);
    }
    return snapshot;
  }

  // Lookup a session by Shop Code (e.g. CHX-2855, CHX2855, 2855), shortCode, or TV pairing code
  findSessionByCode(rawCode) {
    if (!rawCode) return null;
    const clean = String(rawCode).trim().toUpperCase();
    const alnum = clean.replace(/[^A-Z0-9]/g, '');
    const withChxPrefix = /^\d{3,5}$/.test(clean) ? `CHX-${clean}` : null;

    let session = db.prepare(
      'SELECT * FROM sessions WHERE UPPER(short_code) = ? OR UPPER(tv_pairing_code) = ?'
    ).get(clean, clean);

    if (!session && withChxPrefix) {
      session = db.prepare(
        'SELECT * FROM sessions WHERE UPPER(short_code) = ?'
      ).get(withChxPrefix);
    }

    if (!session && alnum) {
      const allSessions = db.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all();
      session = allSessions.find((s) => {
        const scAlnum = String(s.short_code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const pcAlnum = String(s.tv_pairing_code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        return scAlnum === alnum || pcAlnum === alnum;
      }) || null;
    }

    return session;
  }

  // Ensure an active Spin & Win session exists for a linked Chillax Gaming Hub shop
  async ensureShopSession({ shop, user = null }) {
    if (!shop?.shopCode) return null;
    const cleanShopCode = String(shop.shopCode).trim().toUpperCase();

    const existing = this.findSessionByCode(cleanShopCode);
    if (existing) {
      let existingSettings = {};
      try { existingSettings = existing.settings_json ? JSON.parse(existing.settings_json) : {}; } catch {}
      const mergedSettings = {
        ...existingSettings,
        shopId: shop.id,
        shopName: shop.name,
        shopCode: cleanShopCode
      };
      const settingsJson = JSON.stringify(mergedSettings);
      if (existing.short_code !== cleanShopCode || existing.settings_json !== settingsJson) {
        db.prepare('UPDATE sessions SET short_code = ?, settings_json = ? WHERE id = ?').run(
          cleanShopCode,
          settingsJson,
          existing.id
        );
        this.syncSessionToMongo(existing.id);
      }
      return this.getSessionSnapshot(existing.id);
    }

    const created = await this.createSession({
      numberMin: 1,
      numberMax: 20,
      hostPin: shop.adminPin || user?.pin || '1234',
      shopCode: cleanShopCode,
      shopId: shop.id,
      shopName: shop.name,
      hostId: user?.id || shop.ownerId || 'host_default'
    });
    return created.snapshot;
  }

  // Create a new session with initial round (uses linked shopCode when provided)
  async createSession({
    numberMin = 1,
    numberMax = 20,
    hostPin = '1234',
    defaultPrizeId = null,
    shopCode = null,
    shopId = null,
    shopName = null,
    hostId = 'host_default'
  }) {
    const cleanShopCode = shopCode ? String(shopCode).trim().toUpperCase() : null;

    // Pick a default prize if none provided
    let prizeId = defaultPrizeId;
    if (!prizeId) {
      const firstStandardPrize = db.prepare("SELECT id FROM prizes WHERE enabled = 1 AND prize_type NOT IN ('cash_multiplier', 'weighted_cash') LIMIT 1").get();
      const fallbackPrize = firstStandardPrize || db.prepare('SELECT id FROM prizes WHERE enabled = 1 LIMIT 1').get();
      prizeId = fallbackPrize ? fallbackPrize.id : null;
    }
    const prizeObj = prizeId ? db.prepare('SELECT * FROM prizes WHERE id = ?').get(prizeId) : null;

    // If a session already exists for this shopCode, reuse and open a fresh round on it
    if (cleanShopCode) {
      const existingShopSession = db.prepare('SELECT * FROM sessions WHERE UPPER(short_code) = ?').get(cleanShopCode);
      if (existingShopSession) {
        let existingSettings = {};
        try { existingSettings = existingShopSession.settings_json ? JSON.parse(existingShopSession.settings_json) : {}; } catch {}
        const settingsJson = JSON.stringify({
          ...existingSettings,
          shopId: shopId || existingSettings.shopId || null,
          shopName: shopName || existingSettings.shopName || null,
          shopCode: cleanShopCode
        });
        db.prepare(`
          UPDATE sessions
          SET status = 'REGISTRATION_OPEN',
              number_min = ?,
              number_max = ?,
              host_id = ?,
              host_pin = ?,
              settings_json = ?
          WHERE id = ?
        `).run(numberMin, numberMax, hostId, hostPin, settingsJson, existingShopSession.id);
        this.syncSessionToMongo(existingShopSession.id);

        const activeRound = db.prepare(
          'SELECT * FROM rounds WHERE session_id = ? ORDER BY round_number DESC LIMIT 1'
        ).get(existingShopSession.id);

        if (!activeRound) {
          const roundId = 'rnd_' + crypto.randomBytes(6).toString('hex');
          db.prepare(`
            INSERT INTO rounds (id, session_id, round_number, status, prize_id, prize_snapshot_json, started_at)
            VALUES (?, ?, 1, 'REGISTRATION_OPEN', ?, ?, ?)
          `).run(roundId, existingShopSession.id, prizeId, prizeObj ? JSON.stringify(prizeObj) : null, new Date().toISOString());
          this.syncRoundToMongo(roundId);
        } else if (activeRound.status === 'REGISTRATION_OPEN' && prizeObj) {
          db.prepare('UPDATE rounds SET prize_id = ?, prize_snapshot_json = ? WHERE id = ?').run(
            prizeObj.id,
            JSON.stringify(prizeObj),
            activeRound.id
          );
          this.syncRoundToMongo(activeRound.id);
        } else if (activeRound.status !== 'REGISTRATION_OPEN') {
          this.createNextRound(existingShopSession.id, { prizeId, numberMin, numberMax });
        }

        const joinUrl = `/join?code=${cleanShopCode}`;
        const qrCodeDataUrl = await QRCode.toDataURL(joinUrl, {
          margin: 1,
          color: { dark: '#00f2fe', light: '#070d1e' }
        });

        return {
          sessionId: existingShopSession.id,
          shortCode: cleanShopCode,
          tvPairingCode: existingShopSession.tv_pairing_code || cleanShopCode,
          qrCodeDataUrl,
          joinUrl,
          snapshot: this.broadcastSessionState(existingShopSession.id)
        };
      }
    }

    let shortCode = cleanShopCode || generateShortCode();
    if (!cleanShopCode) {
      while (db.prepare('SELECT id FROM sessions WHERE short_code = ?').get(shortCode)) {
        shortCode = generateShortCode();
      }
    }

    const sessionId = 'sess_' + crypto.randomBytes(6).toString('hex');
    const digitsMatch = cleanShopCode ? cleanShopCode.match(/(\d{3,5})$/) : null;
    const pairingCode = digitsMatch ? digitsMatch[1] : generatePairingCode();
    const createdAt = new Date().toISOString();
    const settingsJson = JSON.stringify({
      shopId: shopId || null,
      shopName: shopName || null,
      shopCode: shortCode,
      financialSettings: { ...DEFAULT_FINANCIAL_SETTINGS }
    });

    db.prepare(`
      INSERT INTO sessions (id, short_code, status, number_min, number_max, created_at, host_id, host_pin, tv_pairing_code, settings_json)
      VALUES (?, ?, 'REGISTRATION_OPEN', ?, ?, ?, ?, ?, ?, ?)
    `).run(sessionId, shortCode, numberMin, numberMax, createdAt, hostId, hostPin, pairingCode, settingsJson);

    // Seed initial R1,000 ring-fenced cash reserve ledger entry
    logReserveLedger({
      sessionId,
      entryType: 'RESERVE_INITIALIZED',
      amount: DEFAULT_FINANCIAL_SETTINGS.monthlyCashReserve,
      committedDelta: 0,
      notes: 'Ring-fenced monthly cash-prize reserve initialized (R1,000)',
      actorId: hostId
    });

    // Create Round 1
    const roundId = 'rnd_' + crypto.randomBytes(6).toString('hex');
    db.prepare(`
      INSERT INTO rounds (id, session_id, round_number, status, prize_id, prize_snapshot_json, started_at)
      VALUES (?, ?, 1, 'REGISTRATION_OPEN', ?, ?, ?)
    `).run(roundId, sessionId, prizeId, prizeObj ? JSON.stringify(prizeObj) : null, createdAt);

    this.syncSessionToMongo(sessionId);
    this.syncRoundToMongo(roundId);
    logAudit(sessionId, 'HOST', hostId, 'SESSION_CREATED', { shortCode, shopId, shopName, numberMin, numberMax });

    // Generate QR code data URL for easy mobile scanning
    const joinUrl = `/join?code=${shortCode}`;
    const qrCodeDataUrl = await QRCode.toDataURL(joinUrl, {
      margin: 1,
      color: {
        dark: '#00f2fe',
        light: '#070d1e'
      }
    });

    return {
      sessionId,
      shortCode,
      tvPairingCode: pairingCode,
      qrCodeDataUrl,
      joinUrl,
      snapshot: this.getSessionSnapshot(sessionId)
    };
  }

  // Pair TV to session using 4-digit pairing code or Shop Code (e.g. CHX-2855)
  pairTv(pairingCodeOrShortCode, tvId = null) {
    const code = String(pairingCodeOrShortCode).trim().toUpperCase();
    const session = this.findSessionByCode(code);

    if (!session) {
      return { success: false, error: 'Session or pairing code not found.' };
    }

    db.prepare('UPDATE sessions SET tv_connected = 1 WHERE id = ?').run(session.id);
    this.syncSessionToMongo(session.id);
    if (tvId) {
      updateHubTvStatus(tvId, { lastHeartbeat: new Date().toISOString(), spinSessionId: session.id });
    }
    logAudit(session.id, 'TV', 'tv_display', 'TV_PAIRED', { code, tvId });

    this.broadcastSessionState(session.id);
    return { success: true, sessionId: session.id, shortCode: session.short_code };
  }

  // Claim a number atomically for a round
  claimNumber(sessionId, { number, playerToken, nickname, betAmount, ageVerified = true }) {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) {
      return { success: false, status: 404, error: 'Session not found.' };
    }

    const currentRound = this.ensureCurrentRound(sessionId);

    if (!currentRound) {
      return { success: false, status: 400, error: 'No active round found.' };
    }

    if (currentRound.status !== 'REGISTRATION_OPEN') {
      return { success: false, status: 409, error: 'Registration is closed for this round.' };
    }

    const stats = this.getHouseCashStats(sessionId);
    if (stats.emergencySuspended) {
      return {
        success: false,
        status: 403,
        error: 'New entries are currently suspended by operator emergency control.'
      };
    }

    if (ageVerified === false) {
      return {
        success: false,
        status: 403,
        error: 'Players must be 18+ and meet eligibility requirements to enter.'
      };
    }

    const cleanNum = normalizeWheelNumber(number);
    const validWheelNums = this.getWheelNumbers(session);
    if (!cleanNum || !validWheelNums.includes(cleanNum)) {
      return {
        success: false,
        status: 400,
        error: `Number #${cleanNum} is not on the active wheel (${validWheelNums.join(', ')}).`
      };
    }

    const prize = currentRound.prize_id
      ? db.prepare('SELECT * FROM prizes WHERE id = ?').get(currentRound.prize_id)
      : (currentRound.prize_snapshot_json ? JSON.parse(currentRound.prize_snapshot_json) : null);
    const isWeightedCash = prize?.prize_type === 'weighted_cash';
    const isCashRound = Boolean(prize?.prize_type === 'cash_multiplier' || isWeightedCash);

    if (isCashRound && stats.isReserveExhausted) {
      return {
        success: false,
        status: 403,
        error: 'New paid entries suspended: Monthly R1,000 cash-prize reserve threshold reached. Replenish reserve to continue.'
      };
    }

    let cleanBetAmount = 0;
    let cleanPayoutAmount = 0;
    if (isCashRound) {
      const parsedBet = Number(betAmount);
      if (!Number.isFinite(parsedBet) || parsedBet < 5) {
        return {
          success: false,
          status: 400,
          error: isWeightedCash
            ? 'Minimum stake is R5 (recommended R10) for Cash Spin rounds.'
            : 'Minimum bet is R5 for Cash Multiplier rounds.'
        };
      }
      cleanBetAmount = Math.round(parsedBet * 100) / 100;
      cleanPayoutAmount = isWeightedCash
        ? cleanBetAmount // Base 1x (R10) tier; can roll R10, R20, R50, or R100 on spin
        : Math.round(cleanBetAmount * 1.5 * 100) / 100;
    }

    const cleanNickname = String(nickname || 'Player').trim().slice(0, 18).replace(/[<>]/g, '');
    const txId = generateTransactionId(session.short_code);

    // Execute atomic claim in SQLite
    try {
      const existingPlayerEntry = db.prepare(`
        SELECT id, number, bet_amount, tx_id FROM entries 
        WHERE round_id = ? AND player_token = ? AND status = 'ACTIVE'
      `).get(currentRound.id, playerToken);

      if (existingPlayerEntry) {
        if (String(existingPlayerEntry.number) === cleanNum) {
          if (isCashRound && existingPlayerEntry.bet_amount !== cleanBetAmount) {
            db.prepare(`
              UPDATE entries SET bet_amount = ?, payout_amount = ?, nickname = ?, tx_id = ? WHERE id = ?
            `).run(cleanBetAmount, cleanPayoutAmount, cleanNickname, txId, existingPlayerEntry.id);
            this.syncEntryToMongo(existingPlayerEntry.id);
            const updatedEntryRow = db.prepare('SELECT * FROM entries WHERE id = ?').get(existingPlayerEntry.id);
            if (updatedEntryRow) {
              recordHubEntryTransaction({
                entry: updatedEntryRow,
                session,
                round: currentRound,
                prize,
                cashierName: 'Mobile QR'
              });
            }
            this.broadcastSessionState(sessionId);
            return {
              success: true,
              number: cleanNum,
              nickname: cleanNickname,
              betAmount: cleanBetAmount,
              payoutAmount: cleanPayoutAmount,
              txId,
              message: `Updated your bet on #${cleanNum} to R${cleanBetAmount} (Tx: ${txId})!`
            };
          }
          return {
            success: true,
            number: cleanNum,
            nickname: cleanNickname,
            betAmount: cleanBetAmount,
            payoutAmount: cleanPayoutAmount,
            txId: existingPlayerEntry.tx_id || txId,
            message: 'You already claimed this number.'
          };
        }
        // Change player's number: delete previous claim and insert new claim atomically
        db.exec('BEGIN TRANSACTION;');
        let newEntryId = null;
        try {
          db.prepare(`
            DELETE FROM entries WHERE round_id = ? AND player_token = ?
          `).run(currentRound.id, playerToken);

          newEntryId = 'ent_' + crypto.randomBytes(6).toString('hex');
          db.prepare(`
            INSERT INTO entries (id, session_id, round_id, number, player_token, nickname, bet_amount, payout_amount, tx_id, age_verified, claimed_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
          `).run(newEntryId, sessionId, currentRound.id, cleanNum, playerToken, cleanNickname, cleanBetAmount, cleanPayoutAmount, txId, ageVerified ? 1 : 0, new Date().toISOString());

          db.exec('COMMIT;');
        } catch (txErr) {
          db.exec('ROLLBACK;');
          throw txErr;
        }
        deleteRecordFromMongo('entries', existingPlayerEntry.id);
        HubTransaction.deleteOne({ id: `tx_spin_entry_${existingPlayerEntry.id}` }).catch(() => {});
        if (newEntryId) {
          this.syncEntryToMongo(newEntryId);
          const newEntryRow = db.prepare('SELECT * FROM entries WHERE id = ?').get(newEntryId);
          if (newEntryRow) {
            recordHubEntryTransaction({
              entry: newEntryRow,
              session,
              round: currentRound,
              prize,
              cashierName: 'Mobile QR'
            });
          }
        }
      } else {
        // Fresh claim
        const entryId = 'ent_' + crypto.randomBytes(6).toString('hex');
        db.prepare(`
          INSERT INTO entries (id, session_id, round_id, number, player_token, nickname, bet_amount, payout_amount, tx_id, age_verified, claimed_at, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
        `).run(entryId, sessionId, currentRound.id, cleanNum, playerToken, cleanNickname, cleanBetAmount, cleanPayoutAmount, txId, ageVerified ? 1 : 0, new Date().toISOString());
        this.syncEntryToMongo(entryId);
        const createdEntryRow = db.prepare('SELECT * FROM entries WHERE id = ?').get(entryId);
        if (createdEntryRow) {
          recordHubEntryTransaction({
            entry: createdEntryRow,
            session,
            round: currentRound,
            prize,
            cashierName: 'Mobile QR'
          });
        }

        if (cleanBetAmount > 0) {
          logReserveLedger({
            sessionId,
            roundId: currentRound.id,
            entryId,
            txId,
            entryType: 'STAKE_RECEIVED',
            amount: cleanBetAmount,
            committedDelta: 0,
            notes: `Player ${cleanNickname} staked R${cleanBetAmount} on #${cleanNum}`,
            actorId: playerToken
          });
        }
      }

      logAudit(sessionId, 'PLAYER', playerToken, 'NUMBER_CLAIMED', {
        number: cleanNum,
        nickname: cleanNickname,
        betAmount: cleanBetAmount,
        payoutAmount: cleanPayoutAmount,
        txId
      });

      this.io.to(sessionId).emit('entry:claimed', {
        number: cleanNum,
        nickname: cleanNickname,
        playerToken,
        betAmount: cleanBetAmount,
        payoutAmount: cleanPayoutAmount,
        txId
      });
      this.broadcastSessionState(sessionId);

      return {
        success: true,
        number: cleanNum,
        nickname: cleanNickname,
        betAmount: cleanBetAmount,
        payoutAmount: cleanPayoutAmount,
        txId
      };
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        return { success: false, status: 409, error: `Number #${cleanNum} was just claimed by someone else!` };
      }
      return { success: false, status: 500, error: 'Database claim error: ' + err.message };
    }
  }

  // Host manually claims a number on behalf of a player without a phone
  hostClaimNumber(sessionId, { number, nickname, betAmount, ageVerified = true }) {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) {
      return { success: false, status: 404, error: 'Session not found.' };
    }

    const currentRound = this.ensureCurrentRound(sessionId);

    if (!currentRound) {
      return { success: false, status: 400, error: 'No active round found.' };
    }

    if (currentRound.status !== 'REGISTRATION_OPEN') {
      return { success: false, status: 409, error: 'Registration is closed for this round.' };
    }

    const stats = this.getHouseCashStats(sessionId);
    if (stats.emergencySuspended) {
      return {
        success: false,
        status: 403,
        error: 'New entries are currently suspended by operator emergency control.'
      };
    }

    const cleanNum = normalizeWheelNumber(number);
    const validWheelNums = this.getWheelNumbers(session);
    if (!cleanNum || !validWheelNums.includes(cleanNum)) {
      return {
        success: false,
        status: 400,
        error: `Number #${cleanNum} is not on the active wheel (${validWheelNums.join(', ')}).`
      };
    }

    const prize = currentRound.prize_id
      ? db.prepare('SELECT * FROM prizes WHERE id = ?').get(currentRound.prize_id)
      : (currentRound.prize_snapshot_json ? JSON.parse(currentRound.prize_snapshot_json) : null);
    const isWeightedCash = prize?.prize_type === 'weighted_cash';
    const isCashRound = Boolean(prize?.prize_type === 'cash_multiplier' || isWeightedCash);

    if (isCashRound && stats.isReserveExhausted) {
      return {
        success: false,
        status: 403,
        error: 'New paid entries suspended: Monthly R1,000 cash-prize reserve threshold reached. Replenish reserve to continue.'
      };
    }

    let cleanBetAmount = 0;
    let cleanPayoutAmount = 0;
    if (isCashRound) {
      const parsedBet = Number(betAmount);
      if (!Number.isFinite(parsedBet) || parsedBet < 5) {
        return {
          success: false,
          status: 400,
          error: isWeightedCash
            ? 'Minimum stake is R5 (recommended R10) for Cash Spin rounds.'
            : 'Minimum bet is R5 for Cash Multiplier rounds.'
        };
      }
      cleanBetAmount = Math.round(parsedBet * 100) / 100;
      cleanPayoutAmount = isWeightedCash
        ? cleanBetAmount
        : Math.round(cleanBetAmount * 1.5 * 100) / 100;
    }

    const rawNickname = String(nickname || '').trim().slice(0, 18).replace(/[<>]/g, '');
    const cleanNickname = rawNickname || `Player #${cleanNum}`;
    const txId = generateTransactionId(session.short_code);

    try {
      const existingEntry = db.prepare(`
        SELECT * FROM entries WHERE round_id = ? AND number = ? AND status = 'ACTIVE'
      `).get(currentRound.id, cleanNum);

      if (existingEntry) {
        return {
          success: false,
          status: 409,
          error: `Number #${cleanNum} is already claimed by ${existingEntry.nickname}!`
        };
      }

      const playerToken = 'host_pick_' + cleanNum + '_' + crypto.randomBytes(4).toString('hex');
      const entryId = 'ent_' + crypto.randomBytes(6).toString('hex');

      db.prepare(`
        INSERT INTO entries (id, session_id, round_id, number, player_token, nickname, bet_amount, payout_amount, tx_id, age_verified, claimed_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
      `).run(entryId, sessionId, currentRound.id, cleanNum, playerToken, cleanNickname, cleanBetAmount, cleanPayoutAmount, txId, ageVerified ? 1 : 0, new Date().toISOString());
      this.syncEntryToMongo(entryId);
      const createdHostEntry = db.prepare('SELECT * FROM entries WHERE id = ?').get(entryId);
      if (createdHostEntry) {
        recordHubEntryTransaction({
          entry: createdHostEntry,
          session,
          round: currentRound,
          prize,
          cashierName: 'Spin & Win Host'
        });
      }

      if (cleanBetAmount > 0) {
        logReserveLedger({
          sessionId,
          roundId: currentRound.id,
          entryId,
          txId,
          entryType: 'STAKE_RECEIVED',
          amount: cleanBetAmount,
          committedDelta: 0,
          notes: `Host recorded R${cleanBetAmount} stake for ${cleanNickname} on #${cleanNum}`,
          actorId: 'host'
        });
      }

      logAudit(sessionId, 'HOST', 'host', 'HOST_NUMBER_CLAIMED', {
        number: cleanNum,
        nickname: cleanNickname,
        betAmount: cleanBetAmount,
        payoutAmount: cleanPayoutAmount,
        playerToken,
        txId
      });

      this.io.to(sessionId).emit('entry:claimed', {
        number: cleanNum,
        nickname: cleanNickname,
        playerToken,
        betAmount: cleanBetAmount,
        payoutAmount: cleanPayoutAmount,
        txId,
        isHostPick: true
      });
      this.broadcastSessionState(sessionId);

      return {
        success: true,
        number: cleanNum,
        nickname: cleanNickname,
        betAmount: cleanBetAmount,
        payoutAmount: cleanPayoutAmount,
        playerToken,
        txId,
        isHostPick: true
      };
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        return { success: false, status: 409, error: `Number #${cleanNum} was just claimed by someone else!` };
      }
      return { success: false, status: 500, error: 'Database claim error: ' + err.message };
    }
  }

  // Host releases/removes a claimed number while registration is open (with traceable refund logging)
  hostUnclaimNumber(sessionId, number) {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) {
      return { success: false, status: 404, error: 'Session not found.' };
    }

    const currentRound = this.ensureCurrentRound(sessionId);

    if (!currentRound) {
      return { success: false, status: 400, error: 'No active round found.' };
    }

    if (currentRound.status !== 'REGISTRATION_OPEN') {
      return { success: false, status: 409, error: 'Cannot remove picks after registration is closed.' };
    }

    const cleanNum = normalizeWheelNumber(number);
    const existingEntry = db.prepare(`
      SELECT * FROM entries WHERE round_id = ? AND number = ? AND status = 'ACTIVE'
    `).get(currentRound.id, cleanNum);

    if (!existingEntry) {
      return { success: false, status: 404, error: `Number #${cleanNum} is not currently claimed.` };
    }

    const refundedAmount = Number(existingEntry.bet_amount) || 0;
    db.prepare('DELETE FROM entries WHERE id = ?').run(existingEntry.id);
    deleteRecordFromMongo('entries', existingEntry.id);
    recordHubEntryTransaction({
      entry: existingEntry,
      session,
      round: currentRound,
      status: 'cancelled',
      cashierName: 'Spin & Win Host',
      notes: `Authorised refund of R${refundedAmount} for ${existingEntry.nickname} (#${cleanNum})`
    });

    if (refundedAmount > 0) {
      logReserveLedger({
        sessionId,
        roundId: currentRound.id,
        entryId: existingEntry.id,
        txId: existingEntry.tx_id || null,
        entryType: 'ENTRY_REFUND',
        amount: -refundedAmount,
        committedDelta: 0,
        notes: `Authorised refund of R${refundedAmount} for ${existingEntry.nickname} (#${cleanNum})`,
        actorId: 'host'
      });
    }

    logAudit(sessionId, 'HOST', 'host', 'HOST_NUMBER_UNCLAIMED', {
      number: cleanNum,
      previousNickname: existingEntry.nickname,
      refundedAmount,
      txId: existingEntry.tx_id || null
    });

    this.broadcastSessionState(sessionId);
    return {
      success: true,
      number: cleanNum,
      removedNickname: existingEntry.nickname,
      refundedAmount,
      txId: existingEntry.tx_id || null
    };
  }

  // Close registration (lock entries)
  closeRegistration(sessionId) {
    const currentRound = this.ensureCurrentRound(sessionId);

    if (!currentRound) return { success: false, error: 'Round not found.' };

    if (currentRound.status !== 'REGISTRATION_OPEN') {
      return { success: false, error: `Cannot close registration when state is ${currentRound.status}.` };
    }

    db.prepare(`UPDATE rounds SET status = 'REGISTRATION_CLOSED' WHERE id = ?`).run(currentRound.id);
    db.prepare(`UPDATE sessions SET status = 'REGISTRATION_CLOSED' WHERE id = ?`).run(sessionId);
    this.syncRoundToMongo(currentRound.id);
    this.syncSessionToMongo(sessionId);

    logAudit(sessionId, 'HOST', 'host', 'REGISTRATION_CLOSED', { roundId: currentRound.id });

    this.io.to(sessionId).emit('registration:closed', { roundId: currentRound.id });
    this.broadcastSessionState(sessionId);

    return { success: true };
  }

  // Re-open registration if needed before spinning
  reopenRegistration(sessionId) {
    const currentRound = this.ensureCurrentRound(sessionId);

    if (!currentRound) return { success: false, error: 'Round not found.' };

    if (currentRound.status !== 'REGISTRATION_CLOSED') {
      return { success: false, error: 'Registration is not closed.' };
    }

    db.prepare(`UPDATE rounds SET status = 'REGISTRATION_OPEN' WHERE id = ?`).run(currentRound.id);
    db.prepare(`UPDATE sessions SET status = 'REGISTRATION_OPEN' WHERE id = ?`).run(sessionId);
    this.syncRoundToMongo(currentRound.id);
    this.syncSessionToMongo(sessionId);

    logAudit(sessionId, 'HOST', 'host', 'REGISTRATION_REOPENED', { roundId: currentRound.id });
    this.broadcastSessionState(sessionId);
    return { success: true };
  }

  // Spin wheel and select winner cryptographically
  spin(sessionId, { idempotencyKey = null } = {}) {
    const currentRound = this.ensureCurrentRound(sessionId);

    if (!currentRound) return { success: false, status: 400, error: 'No round found.' };

    // Check idempotency first before status check
    if (idempotencyKey && currentRound.idempotency_key === idempotencyKey) {
      return {
        success: true,
        message: 'Duplicate spin request ignored (idempotent)',
        winningNumber: currentRound.winning_number,
        redemptionCode: currentRound.redemption_code || null
      };
    }

    if (currentRound.status !== 'REGISTRATION_CLOSED') {
      return {
        success: false,
        status: 409,
        error: `Cannot spin when status is ${currentRound.status}. Please close registration first.`
      };
    }

    // Get all claimed active entries
    const entries = db.prepare(`
      SELECT * FROM entries WHERE round_id = ? AND status = 'ACTIVE' ORDER BY number ASC
    `).all(currentRound.id);

    if (entries.length === 0) {
      return {
        success: false,
        status: 400,
        error: 'Cannot spin: No players have claimed a number in this round.'
      };
    }

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    const winnerMode = session?.winner_mode || 'TRUE_ODDS';
    const roundPrize = currentRound.prize_id
      ? db.prepare('SELECT * FROM prizes WHERE id = ?').get(currentRound.prize_id)
      : (currentRound.prize_snapshot_json ? JSON.parse(currentRound.prize_snapshot_json) : null);
    const isWeightedCash = roundPrize?.prize_type === 'weighted_cash';
    const isCashMultiplier = roundPrize?.prize_type === 'cash_multiplier';

    let winningNumber;
    let winningEntry = null;
    let appliedMultiplier = 0;
    let prizeTierLabel = null;

    if (isWeightedCash) {
      // PDF Section 2: Weighted Cash-Prize Schedule (R10 @ 4%, R20 @ 0.5%, R50 @ 0.1%, R100 @ 0.025%)
      const outcome = this.selectWeightedCashOutcome({
        session,
        currentRound,
        entries,
        winnerMode
      });
      winningNumber = normalizeWheelNumber(outcome.winningNumber);
      winningEntry = outcome.winningEntry;
      appliedMultiplier = outcome.appliedMultiplier;
      prizeTierLabel = outcome.prizeTierLabel;

      if (winningEntry && outcome.payoutAmount > 0) {
        db.prepare('UPDATE entries SET payout_amount = ? WHERE id = ?').run(outcome.payoutAmount, winningEntry.id);
        winningEntry.payout_amount = outcome.payoutAmount;
        this.syncEntryToMongo(winningEntry.id);
      }
    } else if (isCashMultiplier) {
      // Profit-protected smart cash multiplier engine (1.5x, 2x, 3x)
      const outcome = this.selectSmartCashOutcome({
        session,
        currentRound,
        entries,
        winnerMode
      });
      winningNumber = normalizeWheelNumber(outcome.winningNumber);
      winningEntry = outcome.winningEntry;
      appliedMultiplier = outcome.appliedMultiplier;

      if (winningEntry && appliedMultiplier > 0) {
        const finalPayout = Math.round(Number(winningEntry.bet_amount) * appliedMultiplier * 100) / 100;
        db.prepare('UPDATE entries SET payout_amount = ? WHERE id = ?').run(finalPayout, winningEntry.id);
        winningEntry.payout_amount = finalPayout;
        this.syncEntryToMongo(winningEntry.id);
        prizeTierLabel = `R${finalPayout} Cash (${appliedMultiplier}x)`;
      }
    } else if (winnerMode === 'GUARANTEED' && entries.length > 0) {
      // Party / guaranteed promo mode: selects among claimed numbers
      const winningIndex = crypto.randomInt(0, entries.length);
      winningEntry = entries[winningIndex];
      winningNumber = normalizeWheelNumber(winningEntry.number);
      prizeTierLabel = roundPrize?.name || null;
    } else {
      // Default: TRUE_ODDS (Hard arcade challenge: selection across ALL numbers in wheel range!)
      const allWheelNums = this.getWheelNumbers(session);
      winningNumber = normalizeWheelNumber(allWheelNums[crypto.randomInt(0, allWheelNums.length)]);
      winningEntry = entries.find(e => normalizeWheelNumber(e.number) === normalizeWheelNumber(winningNumber)) || null;
      if (winningEntry) {
        prizeTierLabel = roundPrize?.name || null;
      }
    }

    const redemptionCode = winningEntry ? generateRedemptionCode(currentRound.round_number) : null;
    const spinDurationMs = 5000; // 5.0s fast high-energy arcade spin
    const now = new Date().toISOString();

    // Persist result immediately before broadcasting (Reserve Rule: record every winning result immediately)
    db.prepare(`
      UPDATE rounds 
      SET status = 'SPINNING', 
          winning_number = ?, 
          winning_entry_id = ?, 
          applied_multiplier = ?,
          redemption_code = ?,
          prize_tier_label = ?,
          started_at = ?,
          idempotency_key = ?
      WHERE id = ?
    `).run(
      winningNumber,
      winningEntry ? winningEntry.id : null,
      appliedMultiplier,
      redemptionCode,
      prizeTierLabel,
      now,
      idempotencyKey || 'spin_' + Date.now(),
      currentRound.id
    );

    db.prepare(`UPDATE sessions SET status = 'SPINNING' WHERE id = ?`).run(sessionId);
    this.syncRoundToMongo(currentRound.id);
    this.syncSessionToMongo(sessionId);
    this.saveDailyProfitReport(sessionId);

    // Reserve Rule: Record winning cash liability immediately in the cash reserve ledger
    if (winningEntry && Number(winningEntry.payout_amount) > 0) {
      logReserveLedger({
        sessionId,
        roundId: currentRound.id,
        entryId: winningEntry.id,
        txId: winningEntry.tx_id || null,
        entryType: 'PRIZE_COMMITTED',
        amount: Number(winningEntry.payout_amount),
        committedDelta: Number(winningEntry.payout_amount),
        notes: `Winning result committed immediately: ${winningEntry.nickname} (#${winningNumber}) won R${winningEntry.payout_amount} [Code: ${redemptionCode}]`,
        actorId: 'engine'
      });
    }

    logAudit(sessionId, 'HOST', 'host', 'SPIN_STARTED', {
      roundId: currentRound.id,
      winningNumber,
      appliedMultiplier,
      prizeTierLabel,
      redemptionCode,
      hasWinner: Boolean(winningEntry),
      winningPlayer: winningEntry ? winningEntry.nickname : null,
      idempotencyKey
    });

    // Broadcast spin:started event
    this.io.to(sessionId).emit('spin:started', {
      roundId: currentRound.id,
      winningNumber,
      appliedMultiplier,
      prizeTierLabel,
      redemptionCode,
      spinDurationMs,
      hasWinner: Boolean(winningEntry),
      eligibleNumbers: entries.map(e => e.number)
    });
    this.broadcastSessionState(sessionId);

    // Schedule authoritative transition to RESULT state when spin ends
    setTimeout(() => {
      const activeRound = db.prepare('SELECT * FROM rounds WHERE id = ?').get(currentRound.id);
      if (activeRound && activeRound.status === 'SPINNING') {
        const resultTime = new Date().toISOString();
        db.prepare(`UPDATE rounds SET status = 'RESULT', result_at = ? WHERE id = ?`).run(resultTime, currentRound.id);
        db.prepare(`UPDATE sessions SET status = 'RESULT' WHERE id = ?`).run(sessionId);
        this.syncRoundToMongo(currentRound.id);
        this.syncSessionToMongo(sessionId);

        // Fetch prize only if there is an active winning entry
        const prize = winningEntry
          ? (activeRound.prize_id 
              ? db.prepare('SELECT * FROM prizes WHERE id = ?').get(activeRound.prize_id)
              : (activeRound.prize_snapshot_json ? JSON.parse(activeRound.prize_snapshot_json) : null))
          : null;

        // Sync every entry's final outcome (winner payout, redemption code) to chillaxgaminghub.transactions
        for (const ent of entries) {
          const isWin = Boolean(winningEntry && winningEntry.id === ent.id);
          const entPayout = isWin ? (Number(winningEntry.payout_amount) || 0) : 0;
          recordHubEntryTransaction({
            entry: isWin ? { ...ent, payout_amount: entPayout } : ent,
            session,
            round: { ...activeRound, prize_tier_label: prizeTierLabel },
            prize: roundPrize,
            isWinner: isWin,
            payoutAmount: entPayout,
            appliedMultiplier: isWin ? appliedMultiplier : 0,
            redemptionCode: isWin ? redemptionCode : null
          });
        }

        logAudit(sessionId, 'SERVER', 'engine', 'SPIN_RESULT', {
          winningNumber,
          appliedMultiplier,
          prizeTierLabel,
          redemptionCode,
          hasWinner: Boolean(winningEntry),
          winningPlayer: winningEntry ? winningEntry.nickname : null,
          winningToken: winningEntry ? winningEntry.player_token : null
        });

        this.io.to(sessionId).emit('spin:result', {
          roundId: currentRound.id,
          winningNumber,
          appliedMultiplier,
          prizeTierLabel,
          redemptionCode,
          hasWinner: Boolean(winningEntry),
          winnerNickname: winningEntry ? winningEntry.nickname : null,
          winnerToken: winningEntry ? winningEntry.player_token : null,
          winnerBetAmount: winningEntry ? (Number(winningEntry.bet_amount) || 0) : 0,
          winnerPayoutAmount: winningEntry ? (Number(winningEntry.payout_amount) || 0) : 0,
          prize
        });
        this.broadcastSessionState(sessionId);
      }
    }, spinDurationMs);

    return {
      success: true,
      winningNumber,
      appliedMultiplier,
      prizeTierLabel,
      redemptionCode,
      spinDurationMs,
      hasWinner: Boolean(winningEntry),
      winningNickname: winningEntry ? winningEntry.nickname : null,
      winnerBetAmount: winningEntry ? (Number(winningEntry.bet_amount) || 0) : 0,
      winnerPayoutAmount: winningEntry ? (Number(winningEntry.payout_amount) || 0) : 0
    };
  }

  // Update active round prize (enforces Reserve Rule: never change prize/odds after customers have paid)
  setRoundPrize(sessionId, prizeId) {
    const currentRound = this.ensureCurrentRound(sessionId);
    if (!currentRound) return { success: false, status: 404, error: 'Active round not found.' };

    if (currentRound.status !== 'REGISTRATION_OPEN') {
      return { success: false, status: 409, error: 'Can only change prize while registration is open.' };
    }

    const paidEntriesRow = db.prepare(`
      SELECT COUNT(*) as paidCount FROM entries
      WHERE round_id = ? AND status = 'ACTIVE' AND bet_amount > 0
    `).get(currentRound.id);

    if ((paidEntriesRow?.paidCount || 0) > 0) {
      return {
        success: false,
        status: 409,
        error: 'Reserve Rule: Cannot change the prize or odds after customers have already paid in this round.'
      };
    }

    const prizeObj = db.prepare('SELECT * FROM prizes WHERE id = ?').get(prizeId);
    if (!prizeObj) {
      return { success: false, status: 404, error: 'Selected prize not found.' };
    }

    db.prepare(`
      UPDATE rounds SET prize_id = ?, prize_snapshot_json = ? WHERE id = ?
    `).run(prizeObj.id, JSON.stringify(prizeObj), currentRound.id);

    // If switched to cash_multiplier or weighted_cash and any existing free entries exist, set baseline bet
    if (prizeObj.prize_type === 'cash_multiplier') {
      db.prepare(`
        UPDATE entries SET bet_amount = 5, payout_amount = 7.5
        WHERE round_id = ? AND status = 'ACTIVE' AND bet_amount < 5
      `).run(currentRound.id);
      const updatedEntries = db.prepare('SELECT * FROM entries WHERE round_id = ?').all(currentRound.id);
      for (const entry of updatedEntries) {
        syncRecordToMongo('entries', entry);
      }
    } else if (prizeObj.prize_type === 'weighted_cash') {
      db.prepare(`
        UPDATE entries SET bet_amount = 10, payout_amount = 10
        WHERE round_id = ? AND status = 'ACTIVE' AND bet_amount < 5
      `).run(currentRound.id);
      const updatedEntries = db.prepare('SELECT * FROM entries WHERE round_id = ?').all(currentRound.id);
      for (const entry of updatedEntries) {
        syncRecordToMongo('entries', entry);
      }
    }
    this.syncRoundToMongo(currentRound.id);

    logAudit(sessionId, 'HOST', 'host', 'ROUND_PRIZE_UPDATED', {
      roundId: currentRound.id,
      prizeId: prizeObj.id,
      prizeName: prizeObj.name
    });

    this.broadcastSessionState(sessionId);
    return { success: true, prize: prizeObj };
  }

  // Toggle difficulty mode (TRUE_ODDS vs GUARANTEED)
  setWinnerMode(sessionId, mode) {
    const validModes = ['TRUE_ODDS', 'GUARANTEED'];
    const chosenMode = validModes.includes(mode) ? mode : 'TRUE_ODDS';
    db.prepare('UPDATE sessions SET winner_mode = ? WHERE id = ?').run(chosenMode, sessionId);
    this.syncSessionToMongo(sessionId);
    logAudit(sessionId, 'HOST', 'host', 'WINNER_MODE_CHANGED', { winnerMode: chosenMode });
    this.broadcastSessionState(sessionId);
    return { success: true, winnerMode: chosenMode };
  }

  // Create next round (supports updating wheel numbers and double zero option)
  createNextRound(sessionId, { prizeId = null, numberMin = null, numberMax = null, hasDoubleZero = null }) {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return { success: false, error: 'Session not found.' };

    const lastRound = db.prepare(`
      SELECT * FROM rounds WHERE session_id = ? ORDER BY round_number DESC LIMIT 1
    `).get(sessionId);

    const nextRoundNumber = lastRound ? lastRound.round_number + 1 : 1;
    const roundId = 'rnd_' + crypto.randomBytes(6).toString('hex');

    // Update session number range / double zero if host adjusted it
    if (numberMin !== null || numberMax !== null || hasDoubleZero !== null) {
      const newMin = numberMin !== null ? (parseInt(numberMin, 10) || 1) : (session.number_min || 1);
      const newMax = numberMax !== null ? (parseInt(numberMax, 10) || 20) : (session.number_max || 20);
      const newDz = hasDoubleZero !== null ? (hasDoubleZero ? 1 : 0) : (session.has_double_zero !== 0 ? 1 : 0);
      const wheelJson = JSON.stringify(buildWheelNumbers({ min: newMin, max: newMax, hasDoubleZero: Boolean(newDz) }));

      let settings = {};
      try { settings = session.settings_json ? JSON.parse(session.settings_json) : {}; } catch {}
      settings.hasDoubleZero = Boolean(newDz);
      settings.numberMax = newMax;

      db.prepare(`
        UPDATE sessions 
        SET number_min = ?, 
            number_max = ?, 
            has_double_zero = ?, 
            wheel_numbers_json = ?,
            settings_json = ?
        WHERE id = ?
      `).run(newMin, newMax, newDz, wheelJson, JSON.stringify(settings), sessionId);
    }

    let selectedPrizeId = prizeId || (lastRound ? lastRound.prize_id : null);
    if (!selectedPrizeId) {
      const firstPrize = db.prepare('SELECT id FROM prizes WHERE enabled = 1 LIMIT 1').get();
      selectedPrizeId = firstPrize ? firstPrize.id : null;
    }

    const prizeObj = selectedPrizeId ? db.prepare('SELECT * FROM prizes WHERE id = ?').get(selectedPrizeId) : null;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO rounds (id, session_id, round_number, status, prize_id, prize_snapshot_json, started_at)
      VALUES (?, ?, ?, 'REGISTRATION_OPEN', ?, ?, ?)
    `).run(roundId, sessionId, nextRoundNumber, selectedPrizeId, prizeObj ? JSON.stringify(prizeObj) : null, now);

    db.prepare(`UPDATE sessions SET status = 'REGISTRATION_OPEN' WHERE id = ?`).run(sessionId);
    this.syncRoundToMongo(roundId);
    this.syncSessionToMongo(sessionId);

    logAudit(sessionId, 'HOST', 'host', 'ROUND_CREATED', { roundNumber: nextRoundNumber, prizeId: selectedPrizeId });

    this.broadcastSessionState(sessionId);
    return { success: true, roundNumber: nextRoundNumber, roundId };
  }

  // Cancel a round (with logged, authorised, and traceable refunds for paid entries)
  cancelRound(sessionId, roundId, reason = 'Host cancelled') {
    const round = db.prepare('SELECT * FROM rounds WHERE id = ? AND session_id = ?').get(roundId, sessionId);
    if (!round) return { success: false, error: 'Round not found.' };

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    const activeEntries = db.prepare(`
      SELECT * FROM entries WHERE round_id = ? AND status = 'ACTIVE'
    `).all(roundId);
    const activePaidEntries = activeEntries.filter((e) => Number(e.bet_amount) > 0);

    let totalRefunded = 0;
    for (const entry of activeEntries) {
      const amt = Number(entry.bet_amount) || 0;
      if (amt > 0) {
        totalRefunded += amt;
        logReserveLedger({
          sessionId,
          roundId,
          entryId: entry.id,
          txId: entry.tx_id || null,
          entryType: 'ROUND_CANCEL_REFUND',
          amount: -amt,
          committedDelta: 0,
          notes: `Round #${round.round_number} cancelled (${reason}): refunded R${amt} to ${entry.nickname}`,
          actorId: 'host'
        });
      }
      recordHubEntryTransaction({
        entry,
        session,
        round,
        status: 'cancelled',
        cashierName: 'Spin & Win Host',
        notes: `Round #${round.round_number} cancelled (${reason}) — Refunded R${amt}`
      });
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE rounds SET status = 'CANCELLED', cancelled_at = ?, cancel_reason = ? WHERE id = ?
    `).run(now, reason, roundId);

    db.prepare(`UPDATE sessions SET status = 'CANCELLED' WHERE id = ?`).run(sessionId);
    this.syncRoundToMongo(roundId);
    this.syncSessionToMongo(sessionId);

    logAudit(sessionId, 'HOST', 'host', 'ROUND_CANCELLED', { roundId, reason, totalRefunded, refundedEntriesCount: activePaidEntries.length });

    this.broadcastSessionState(sessionId);
    return { success: true, totalRefunded, refundedEntriesCount: activePaidEntries.length };
  }

  // Mark prize redeemed (settles committed cash liability in ledger)
  redeemPrize(roundId, { notes = '', redeemedBy = 'Staff Host' }) {
    const round = db.prepare('SELECT * FROM rounds WHERE id = ?').get(roundId);
    if (!round) return { success: false, error: 'Round not found.' };

    if (!round.winning_entry_id) {
      return { success: false, error: 'Cannot redeem: No winner for this round.' };
    }

    // Check if already redeemed
    const existing = db.prepare('SELECT * FROM redemptions WHERE round_id = ?').get(roundId);
    if (existing) {
      return { success: false, status: 409, error: `Prize was already marked redeemed on ${existing.redeemed_at}.` };
    }

    const winningEntry = db.prepare('SELECT * FROM entries WHERE id = ?').get(round.winning_entry_id);
    const redemptionId = 'red_' + crypto.randomBytes(6).toString('hex');
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO redemptions (id, round_id, prize_id, redeemed_by, redeemed_at, status, notes)
      VALUES (?, ?, ?, ?, ?, 'REDEEMED', ?)
    `).run(redemptionId, roundId, round.prize_id || 'prize_default', redeemedBy, now, notes);

    const redemptionRow = db.prepare('SELECT * FROM redemptions WHERE id = ?').get(redemptionId);
    if (redemptionRow) syncRecordToMongo('redemptions', redemptionRow);

    if (winningEntry) {
      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(round.session_id);
      const prizeObj = round.prize_id
        ? db.prepare('SELECT * FROM prizes WHERE id = ?').get(round.prize_id)
        : null;
      recordHubEntryTransaction({
        entry: winningEntry,
        session,
        round,
        prize: prizeObj,
        isWinner: true,
        payoutAmount: Number(winningEntry.payout_amount) || 0,
        appliedMultiplier: Number(round.applied_multiplier) || 0,
        redemptionCode: round.redemption_code || null,
        redeemedAt: now,
        redeemedBy
      });
    }

    if (winningEntry && Number(winningEntry.payout_amount) > 0) {
      logReserveLedger({
        sessionId: round.session_id,
        roundId,
        entryId: winningEntry.id,
        txId: winningEntry.tx_id || null,
        entryType: 'PRIZE_SETTLED',
        amount: Number(winningEntry.payout_amount),
        committedDelta: 0, // Already committed at spin result time
        notes: `Winner ${winningEntry.nickname} redeemed R${winningEntry.payout_amount} [Code: ${round.redemption_code || 'N/A'}] (${notes || 'Verified by host'})`,
        actorId: redeemedBy
      });
    }

    logAudit(round.session_id, 'HOST', redeemedBy, 'PRIZE_REDEEMED', {
      roundId,
      redemptionCode: round.redemption_code || null,
      payoutAmount: winningEntry ? Number(winningEntry.payout_amount) || 0 : 0,
      notes
    });

    this.io.to(round.session_id).emit('prize:redeemed', {
      roundId,
      redemptionCode: round.redemption_code || null,
      redeemedAt: now,
      redeemedBy,
      notes
    });

    this.broadcastSessionState(round.session_id);
    return {
      success: true,
      redemptionId,
      redemptionCode: round.redemption_code || null,
      redeemedAt: now
    };
  }

  // Replenish the ring-fenced cash-prize reserve (Reserve Rule: only reopen after reserve replenished)
  replenishCashReserve(sessionId, { amount = 500, notes = 'Owner reserve top-up', actorId = 'host' } = {}) {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return { success: false, status: 404, error: 'Session not found.' };

    const cleanAmount = Math.round((Number(amount) || 0) * 100) / 100;
    if (cleanAmount <= 0) {
      return { success: false, status: 400, error: 'Replenishment amount must be greater than R0.' };
    }

    let settings = {};
    try { settings = session.settings_json ? JSON.parse(session.settings_json) : {}; } catch {}
    const fin = { ...DEFAULT_FINANCIAL_SETTINGS, ...(settings.financial || {}), ...(settings.financialSettings || {}) };
    const currentBase = Number(fin.monthlyCashReserve ?? fin.monthlyReserveLimit) || 1000;
    fin.monthlyCashReserve = Math.round((currentBase + cleanAmount) * 100) / 100;
    fin.monthlyReserveLimit = fin.monthlyCashReserve;
    fin.suspensionThreshold = fin.monthlyCashReserve;
    fin.warningThreshold = Math.round(fin.monthlyCashReserve * 0.75 * 100) / 100;
    settings.financialSettings = fin;
    settings.financial = fin;

    db.prepare('UPDATE sessions SET settings_json = ? WHERE id = ?').run(JSON.stringify(settings), sessionId);
    this.syncSessionToMongo(sessionId);

    logReserveLedger({
      sessionId,
      entryType: 'RESERVE_REPLENISHED',
      amount: cleanAmount,
      committedDelta: 0,
      notes: `${notes} (+R${cleanAmount} added; new reserve ceiling R${fin.monthlyCashReserve})`,
      actorId
    });

    logAudit(sessionId, 'HOST', actorId, 'CASH_RESERVE_REPLENISHED', {
      addedAmount: cleanAmount,
      newMonthlyCashReserve: fin.monthlyCashReserve,
      notes
    });

    const snapshot = this.broadcastSessionState(sessionId);
    return {
      success: true,
      addedAmount: cleanAmount,
      newMonthlyCashReserve: fin.monthlyCashReserve,
      houseCashStats: snapshot?.houseCashStats
    };
  }

  // Emergency control: suspend or resume new entries without deleting existing obligations
  setEmergencySuspend(sessionId, { suspended = true, reason = 'Operator emergency control', actorId = 'host' } = {}) {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return { success: false, status: 404, error: 'Session not found.' };

    let settings = {};
    try { settings = session.settings_json ? JSON.parse(session.settings_json) : {}; } catch {}
    const fin = { ...DEFAULT_FINANCIAL_SETTINGS, ...(settings.financialSettings || {}) };
    fin.emergencySuspended = Boolean(suspended);
    settings.financialSettings = fin;

    db.prepare('UPDATE sessions SET settings_json = ? WHERE id = ?').run(JSON.stringify(settings), sessionId);
    this.syncSessionToMongo(sessionId);

    logReserveLedger({
      sessionId,
      entryType: fin.emergencySuspended ? 'EMERGENCY_SUSPEND' : 'EMERGENCY_RESUME',
      amount: 0,
      committedDelta: 0,
      notes: `${fin.emergencySuspended ? 'Suspended' : 'Resumed'} new entries: ${reason}`,
      actorId
    });

    logAudit(sessionId, 'HOST', actorId, fin.emergencySuspended ? 'EMERGENCY_SUSPENDED' : 'EMERGENCY_RESUMED', {
      suspended: fin.emergencySuspended,
      reason
    });

    const snapshot = this.broadcastSessionState(sessionId);
    return {
      success: true,
      emergencySuspended: fin.emergencySuspended,
      houseCashStats: snapshot?.houseCashStats
    };
  }

  // Update commercial & profitability model parameters (Page 6 configurator & daily owner controls)
  updateFinancialSettings(sessionId, newSettings = {}) {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return { success: false, status: 404, error: 'Session not found.' };

    let settings = {};
    try { settings = session.settings_json ? JSON.parse(session.settings_json) : {}; } catch {}
    const currentFin = { ...DEFAULT_FINANCIAL_SETTINGS, ...(settings.financialSettings || {}) };

    const updatedFin = {
      ...currentFin,
      ...(newSettings.dailyCustomers !== undefined ? { dailyCustomers: Math.max(1, Number(newSettings.dailyCustomers) || 50) } : {}),
      ...(newSettings.avgOrdinarySpend !== undefined ? { avgOrdinarySpend: Math.max(0, Number(newSettings.avgOrdinarySpend) || 20) } : {}),
      ...(newSettings.tradingDaysPerMonth !== undefined ? { tradingDaysPerMonth: Math.max(1, Number(newSettings.tradingDaysPerMonth) || 26) } : {}),
      ...(newSettings.ordinaryGrossMarginPct !== undefined ? { ordinaryGrossMarginPct: Math.min(100, Math.max(0, Number(newSettings.ordinaryGrossMarginPct) || 65)) } : {}),
      ...(newSettings.monthlyRent !== undefined ? { monthlyRent: Math.max(0, Number(newSettings.monthlyRent) || 14000) } : {}),
      ...(newSettings.monthlyElectricityLow !== undefined ? { monthlyElectricityLow: Math.max(0, Number(newSettings.monthlyElectricityLow) || 6500) } : {}),
      ...(newSettings.monthlyElectricityHigh !== undefined ? { monthlyElectricityHigh: Math.max(0, Number(newSettings.monthlyElectricityHigh) || 10000) } : {}),
      ...(newSettings.proposedSpinPrice !== undefined ? { proposedSpinPrice: [5, 10, 20].includes(Number(newSettings.proposedSpinPrice)) ? Number(newSettings.proposedSpinPrice) : 10 } : {}),
      ...(newSettings.targetUptakeRatePct !== undefined ? { targetUptakeRatePct: Math.min(100, Math.max(5, Number(newSettings.targetUptakeRatePct) || 50)) } : {}),
      ...(newSettings.operatingRoute !== undefined ? { operatingRoute: ['PARTNER', 'OWN_LICENCE', 'COMPARE'].includes(newSettings.operatingRoute) ? newSettings.operatingRoute : 'PARTNER' } : {}),
      ...(newSettings.operatorSharePct !== undefined ? { operatorSharePct: Math.min(80, Math.max(0, Number(newSettings.operatorSharePct) || 0)) } : {}),
      ...(newSettings.paymentFeePct !== undefined ? { paymentFeePct: Math.min(20, Math.max(0, Number(newSettings.paymentFeePct) || 0)) } : {}),
      ...(newSettings.nonCashPrizeCostMonthly !== undefined ? { nonCashPrizeCostMonthly: Math.max(0, Number(newSettings.nonCashPrizeCostMonthly) || 0) } : {}),
      ...(newSettings.otherDirectCostsMonthly !== undefined ? { otherDirectCostsMonthly: Math.max(0, Number(newSettings.otherDirectCostsMonthly) || 0) } : {}),
      ...(newSettings.monthlyCashReserve !== undefined ? { monthlyCashReserve: Math.max(100, Number(newSettings.monthlyCashReserve) || 1000) } : {}),
      ...(newSettings.weeklyExposureLimit !== undefined ? { weeklyExposureLimit: Math.max(50, Number(newSettings.weeklyExposureLimit) || 250) } : {}),
      ...(newSettings.dailyExposureLimit !== undefined ? { dailyExposureLimit: Math.max(10, Number(newSettings.dailyExposureLimit) || 50) } : {}),
      ...(newSettings.targetProfitMarginPct !== undefined ? { targetProfitMarginPct: Math.min(60, Math.max(20, Number(newSettings.targetProfitMarginPct) || 30)) } : {}),
      ...(newSettings.targetMarginPct !== undefined ? { targetProfitMarginPct: Math.min(60, Math.max(20, Number(newSettings.targetMarginPct) || 30)) } : {})
    };

    settings.financialSettings = updatedFin;
    settings.financial = updatedFin;
    db.prepare('UPDATE sessions SET settings_json = ? WHERE id = ?').run(JSON.stringify(settings), sessionId);
    this.syncSessionToMongo(sessionId);

    logAudit(sessionId, 'HOST', 'host', 'FINANCIAL_SETTINGS_UPDATED', updatedFin);

    const snapshot = this.broadcastSessionState(sessionId);
    return {
      success: true,
      financialSettings: updatedFin,
      houseCashStats: snapshot?.houseCashStats
    };
  }

  // Retrieve ring-fenced cash reserve ledger entries
  getCashReserveLedger(sessionId) {
    const ledger = db.prepare(`
      SELECT * FROM cash_reserve_ledger
      WHERE session_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `).all(sessionId);
    return {
      success: true,
      ledger,
      houseCashStats: this.getHouseCashStats(sessionId)
    };
  }

  // Get session history
  getSessionHistory(sessionId) {
    const rounds = db.prepare(`
      SELECT r.*, 
             e.number as winner_number, e.nickname as winner_nickname,
             e.bet_amount as winner_bet_amount, e.payout_amount as winner_payout_amount,
             e.tx_id as winner_tx_id,
             p.name as prize_name, p.value as prize_value, p.prize_type as prize_type,
             red.redeemed_at, red.redeemed_by
      FROM rounds r
      LEFT JOIN entries e ON r.winning_entry_id = e.id
      LEFT JOIN prizes p ON r.prize_id = p.id
      LEFT JOIN redemptions red ON r.id = red.round_id
      WHERE r.session_id = ?
      ORDER BY r.round_number DESC
    `).all(sessionId);

    const audits = db.prepare(`
      SELECT * FROM audit_events WHERE session_id = ? ORDER BY timestamp DESC LIMIT 50
    `).all(sessionId);

    const reserveLedger = db.prepare(`
      SELECT * FROM cash_reserve_ledger WHERE session_id = ? ORDER BY created_at DESC LIMIT 50
    `).all(sessionId);

    const entries = db.prepare(`
      SELECT e.*,
             r.round_number, r.status as round_status, r.winning_entry_id, r.redemption_code, r.prize_tier_label,
             p.name as prize_name, p.prize_type as prize_type,
             red.redeemed_at, red.redeemed_by
      FROM entries e
      JOIN rounds r ON e.round_id = r.id
      LEFT JOIN prizes p ON r.prize_id = p.id
      LEFT JOIN redemptions red ON r.id = red.round_id
      WHERE e.session_id = ?
      ORDER BY e.claimed_at DESC
      LIMIT 200
    `).all(sessionId);

    return { rounds, entries, audits, reserveLedger };
  }

  // Push & sync all logged entries to Chillax Gaming App (`chillaxgaminghub.transactions`) for sales reports
  async syncEntriesToChillaxHub(sessionId = null) {
    const result = await syncAllSessionEntriesToHub(db, sessionId);
    let dailyReport = null;
    if (sessionId) {
      dailyReport = this.saveDailyProfitReport(sessionId);
      logAudit(sessionId, 'HOST', 'host', 'SALES_REPORT_SYNCED', {
        entriesSynced: result.entriesSynced,
        totalSalesAmount: result.totalSalesAmount,
        totalPayoutAmount: result.totalPayoutAmount,
        netSpinProfit: result.netSpinProfit
      });
    }
    return { ...result, dailyReport };
  }
}
