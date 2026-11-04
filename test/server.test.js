import assert from 'node:assert';
import { db } from '../server/db.js';
import { GameEngine } from '../server/gameEngine.js';
import { buildMongoUri, getMongoStatus, hubCache, resolveLinkedShopForUser } from '../server/mongo.js';

// Mock Socket.io for testing
class MockSocketIO {
  constructor() {
    this.events = [];
    this.rooms = new Map();
  }
  to(room) {
    return {
      emit: (event, data) => {
        this.events.push({ room, event, data });
      }
    };
  }
  emit(event, data) {
    this.events.push({ room: 'all', event, data });
  }
}

async function runTests() {
  console.log('🧪 Starting Chillax Spin & Win Test Suite...\n');

  const mockIo = new MockSocketIO();
  const engine = new GameEngine(mockIo);

  // 1. Host PIN verification & rate limiting
  console.log('Test 1: Host PIN verification & Rate Limiting');
  const validPinRes = engine.verifyHostPin('127.0.0.1', '1234');
  assert.strictEqual(validPinRes.success, true, 'Valid PIN should succeed');

  const invalidPinRes = engine.verifyHostPin('127.0.0.2', 'wrong');
  assert.strictEqual(invalidPinRes.success, false, 'Invalid PIN should fail');

  // Trigger rate limit for IP 127.0.0.3
  for (let i = 0; i < 5; i++) {
    engine.verifyHostPin('127.0.0.3', 'bad');
  }
  const rateLimitedRes = engine.verifyHostPin('127.0.0.3', '1234');
  assert.strictEqual(rateLimitedRes.success, false, 'Should be locked out after 5 bad attempts');
  assert(rateLimitedRes.error.includes('Too many failed attempts'), 'Rate limit message returned');
  console.log('  ✅ Host PIN & Rate Limiting passed');

  // 2. Session Creation
  console.log('Test 2: Create Session');
  const session = await engine.createSession({ numberMin: 1, numberMax: 20 });
  assert(session.sessionId, 'Session ID must exist');
  assert.strictEqual(session.shortCode.length, 5, 'Short code must be 5 chars');
  assert(session.qrCodeDataUrl.startsWith('data:image/png;base64,'), 'QR code must be data URL');
  assert.strictEqual(session.snapshot.status, 'REGISTRATION_OPEN', 'Initial status must be REGISTRATION_OPEN');
  console.log('  ✅ Session creation & QR generation passed');

  // 3. TV Pairing
  console.log('Test 3: TV Pairing');
  const pairRes = engine.pairTv(session.tvPairingCode);
  assert.strictEqual(pairRes.success, true, 'TV pairing with 4-digit code should succeed');
  const sessionAfterPair = engine.getSessionSnapshot(session.sessionId);
  assert.strictEqual(sessionAfterPair.tvConnected, true, 'Session should reflect TV connected');
  console.log('  ✅ TV pairing passed');

  // 4. Atomic Number Claims & Concurrency Check
  console.log('Test 4: Atomic Number Claims & Conflict Handling');
  // Player 1 claims #7
  const claim1 = engine.claimNumber(session.sessionId, {
    number: 7,
    playerToken: 'token_player_1',
    nickname: 'Thabo'
  });
  assert.strictEqual(claim1.success, true, 'Player 1 should successfully claim #7');

  // Player 2 tries to claim #7 as well (conflict)
  const claim2 = engine.claimNumber(session.sessionId, {
    number: 7,
    playerToken: 'token_player_2',
    nickname: 'Sipho'
  });
  assert.strictEqual(claim2.success, false, 'Player 2 should be blocked from claiming #7');
  assert.strictEqual(claim2.status, 409, 'Status must be 409 conflict');

  // Player 2 claims #12 instead
  const claim3 = engine.claimNumber(session.sessionId, {
    number: 12,
    playerToken: 'token_player_2',
    nickname: 'Sipho'
  });
  assert.strictEqual(claim3.success, true, 'Player 2 claims #12');

  // Player 1 changes their number to #3
  const claimChange = engine.claimNumber(session.sessionId, {
    number: 3,
    playerToken: 'token_player_1',
    nickname: 'Thabo'
  });
  assert.strictEqual(claimChange.success, true, 'Player 1 changes number to #3');

  // Verify #7 is now free and can be claimed by Player 3
  const claim4 = engine.claimNumber(session.sessionId, {
    number: 7,
    playerToken: 'token_player_3',
    nickname: 'Zandi'
  });
  assert.strictEqual(claim4.success, true, 'Now freed #7 can be claimed by Player 3');

  const snapshotWithClaims = engine.getSessionSnapshot(session.sessionId);
  assert.strictEqual(snapshotWithClaims.playerCount, 3, 'Should have exactly 3 active players');

  // 4b. Host Manual Picks for Players Without Phones
  console.log('Test 4b: Host Manual Picks (Walk-in / No-Phone Players)');
  const hostPick1 = engine.hostClaimNumber(session.sessionId, {
    number: 15,
    nickname: 'Lerato'
  });
  assert.strictEqual(hostPick1.success, true, 'Host should claim #15 for Lerato');
  assert.strictEqual(hostPick1.nickname, 'Lerato');
  assert.strictEqual(hostPick1.isHostPick, true);

  // Host claims a second number for another walk-in player without providing a name (defaults to Player #18)
  const hostPick2 = engine.hostClaimNumber(session.sessionId, {
    number: 18,
    nickname: ''
  });
  assert.strictEqual(hostPick2.success, true, 'Host should claim #18 for second walk-in player');
  assert.strictEqual(hostPick2.nickname, 'Player #18', 'Should default nickname to Player #18');

  // Host tries to claim already-taken number #3
  const hostPickConflict = engine.hostClaimNumber(session.sessionId, {
    number: 3,
    nickname: 'WalkIn'
  });
  assert.strictEqual(hostPickConflict.success, false, 'Host should not overwrite already claimed #3');
  assert.strictEqual(hostPickConflict.status, 409);

  // Host frees #18 before locking registration
  const hostUnclaim = engine.hostUnclaimNumber(session.sessionId, 18);
  assert.strictEqual(hostUnclaim.success, true, 'Host should be able to free #18');

  const snapshotAfterHostPicks = engine.getSessionSnapshot(session.sessionId);
  assert.strictEqual(snapshotAfterHostPicks.playerCount, 4, 'Should have 4 active players (3 phone + 1 host pick)');
  console.log('  ✅ Atomic claims, host manual picks, and conflict handling passed');

  // 5. Close Registration
  console.log('Test 5: Close Registration');
  const closeRes = engine.closeRegistration(session.sessionId);
  assert.strictEqual(closeRes.success, true, 'Close registration should succeed');

  // Further claims should be rejected
  const lateClaim = engine.claimNumber(session.sessionId, {
    number: 19,
    playerToken: 'token_player_4',
    nickname: 'Latecomer'
  });
  assert.strictEqual(lateClaim.success, false, 'Late claim after registration closed should fail');
  assert.strictEqual(lateClaim.status, 409, 'Status 409 for closed registration');
  console.log('  ✅ Registration locking passed');

  // 6. Cryptographic Spin & Winner Selection (Testing both Party and Hard True Odds modes)
  console.log('Test 6: Spin & Winner Selection');
  engine.setWinnerMode(session.sessionId, 'GUARANTEED');
  const spinRes = engine.spin(session.sessionId, { idempotencyKey: 'idemp_key_101' });
  assert.strictEqual(spinRes.success, true, 'Spin should succeed');
  assert(['3', '7', '12', '15'].includes(String(spinRes.winningNumber)), 'In guaranteed mode, winning number must be among claimed numbers');

  // Duplicate spin request with same idempotency key
  const dupSpin = engine.spin(session.sessionId, { idempotencyKey: 'idemp_key_101' });
  assert.strictEqual(dupSpin.success, true, 'Duplicate spin handled gracefully');
  assert.strictEqual(dupSpin.winningNumber, spinRes.winningNumber, 'Result identical for idempotent request');

  // Test Hard True Odds mode
  engine.setWinnerMode(session.sessionId, 'TRUE_ODDS');
  const snapshotMode = engine.getSessionSnapshot(session.sessionId);
  assert.strictEqual(snapshotMode.winnerMode, 'TRUE_ODDS', 'Session should now be in TRUE_ODDS hard arcade mode');
  console.log('  ✅ Spin, idempotency, and True Odds difficulty passed');

  // 7. Prize Redemption
  console.log('Test 7: Prize Redemption');
  const activeRound = db.prepare('SELECT id FROM rounds WHERE session_id = ? ORDER BY round_number DESC LIMIT 1').get(session.sessionId);
  const redeemRes = engine.redeemPrize(activeRound.id, { redeemedBy: 'Staff Cashier', notes: 'Given to winner at front desk' });
  assert.strictEqual(redeemRes.success, true, 'Redemption should succeed');

  // Duplicate redemption should fail
  const dupRedeem = engine.redeemPrize(activeRound.id, { redeemedBy: 'Staff 2' });
  assert.strictEqual(dupRedeem.success, false, 'Duplicate redemption must fail');
  assert.strictEqual(dupRedeem.status, 409, 'Must return 409 for duplicate redemption');
  console.log('  ✅ Prize redemption & duplicate prevention passed');

  // 8. Next Round Creation
  console.log('Test 8: Next Round Transition');
  const nextRoundRes = engine.createNextRound(session.sessionId, {});
  assert.strictEqual(nextRoundRes.success, true, 'Create next round should succeed');
  assert.strictEqual(nextRoundRes.roundNumber, 2, 'Next round should be Round 2');

  const snapshotR2 = engine.getSessionSnapshot(session.sessionId);
  assert.strictEqual(snapshotR2.status, 'REGISTRATION_OPEN', 'Round 2 starts with REGISTRATION_OPEN');
  assert.strictEqual(snapshotR2.playerCount, 0, 'Round 2 starts fresh with 0 claims');
  console.log('  ✅ Next round creation passed');

  // 9. Round Cancellation
  console.log('Test 9: Round Cancellation');
  const currentR2 = snapshotR2.currentRound;
  const cancelRes = engine.cancelRound(session.sessionId, currentR2.id, 'Accidental host action');
  assert.strictEqual(cancelRes.success, true, 'Cancel round should succeed');
  const snapshotCancelled = engine.getSessionSnapshot(session.sessionId);
  assert.strictEqual(snapshotCancelled.status, 'CANCELLED', 'Status should be CANCELLED');
  console.log('  ✅ Round cancellation passed');

  // 10. Audit Log Inspection
  console.log('Test 10: Audit Log Verification');
  const history = engine.getSessionHistory(session.sessionId);
  assert(history.rounds.length >= 2, 'Should have recorded at least 2 rounds');
  assert(history.audits.length >= 5, 'Should have recorded audit trail');
  console.log('  ✅ Audit trail inspection passed');

  // 11. Smart Profit-Protected Cash Multiplier Engine (1.5x, 2x, 3x | Min R5 Bet)
  console.log('Test 11: Smart Profit-Protected Cash Multiplier Engine (1.5x, 2x, 3x)');
  const cashRoundRes = engine.createNextRound(session.sessionId, { prizeId: 'prize_cash_3x' });
  assert.strictEqual(cashRoundRes.success, true, 'Cash round creation should succeed');

  const cashSnapshot = engine.getSessionSnapshot(session.sessionId);
  assert.strictEqual(cashSnapshot.currentRound.isCashRound, true, 'Round should be marked as isCashRound');
  assert.deepStrictEqual(cashSnapshot.currentRound.multipliers, [1.5, 2, 3]);

  // Reject bet below R5
  const lowBetClaim = engine.claimNumber(session.sessionId, {
    number: 4,
    playerToken: 'token_cash_1',
    nickname: 'Bongani',
    betAmount: 3
  });
  assert.strictEqual(lowBetClaim.success, false, 'Bet below R5 should be rejected');
  assert.strictEqual(lowBetClaim.status, 400);

  // Accept valid R20 bet -> baseline 1.5x (R30) before spin
  const validCashClaim = engine.claimNumber(session.sessionId, {
    number: 4,
    playerToken: 'token_cash_1',
    nickname: 'Bongani',
    betAmount: 20
  });
  assert.strictEqual(validCashClaim.success, true, 'Valid R20 bet should succeed');
  assert.strictEqual(validCashClaim.betAmount, 20);
  assert.strictEqual(validCashClaim.payoutAmount, 30, 'Initial baseline payout is 1.5x (R30)');

  // Host walk-in pick with R10 bet -> baseline 1.5x (R15)
  const hostCashPick = engine.hostClaimNumber(session.sessionId, {
    number: 9,
    nickname: 'Nomsa',
    betAmount: 10
  });
  assert.strictEqual(hostCashPick.success, true, 'Host cash pick with R10 should succeed');
  assert.strictEqual(hostCashPick.payoutAmount, 15, 'Host cash pick baseline payout is R15 (1.5x)');

  const snapshotAfterCashBets = engine.getSessionSnapshot(session.sessionId);
  assert.strictEqual(snapshotAfterCashBets.totalBets, 30, 'Total pool should be R30 (R20 + R10)');

  // Close registration & spin in GUARANTEED mode: with R30 pool, maxSafePayout is R22.50,
  // so the smart engine must pick Nomsa (R10 bet, 1.5x = R15 or 2x = R20) and NEVER 3x (R30 > R22.50)!
  engine.setWinnerMode(session.sessionId, 'GUARANTEED');
  engine.closeRegistration(session.sessionId);
  const cashSpinRes = engine.spin(session.sessionId, { idempotencyKey: 'cash_spin_1' });
  assert.strictEqual(cashSpinRes.success, true, 'Cash spin should succeed');
  assert.strictEqual(String(cashSpinRes.winningNumber), '9', 'Engine should select the affordable R10 bet (#9) to protect house profit');
  assert([1.5, 2].includes(cashSpinRes.appliedMultiplier), 'Engine must choose 1.5x or 2x and lock 3x when reserve is low');
  assert.strictEqual(cashSpinRes.winnerPayoutAmount, 10 * cashSpinRes.appliedMultiplier);

  const postSpinStats = engine.getHouseCashStats(session.sessionId);
  assert(postSpinStats.netProfit >= 10, 'House must remain in positive net profit after spin');

  // Test True Odds Cash Multiplier: Authentic arcade odds across all wheel pockets (unclaimed pocket = NO WINNER)
  const trueOddsCashRound = engine.createNextRound(session.sessionId, { prizeId: 'prize_cash_3x' });
  assert.strictEqual(trueOddsCashRound.success, true);
  engine.setWinnerMode(session.sessionId, 'TRUE_ODDS');
  engine.claimNumber(session.sessionId, {
    number: 11,
    playerToken: 'token_single_bettor',
    nickname: 'SoloPlayer',
    betAmount: 50
  });
  engine.closeRegistration(session.sessionId);

  let winCount = 0;
  let noWinCount = 0;
  for (let i = 0; i < 50; i++) {
    const outcome = engine.selectSmartCashOutcome({
      session: { id: session.sessionId, winner_mode: 'TRUE_ODDS', wheel_numbers_json: null },
      currentRound: { id: trueOddsCashRound.roundId },
      entries: [{ number: '11', bet_amount: 50 }],
      winnerMode: 'TRUE_ODDS'
    });
    if (outcome.winningEntry) {
      assert.strictEqual(String(outcome.winningNumber), '11');
      winCount++;
    } else {
      assert.notStrictEqual(String(outcome.winningNumber), '11');
      noWinCount++;
    }
  }
  assert(noWinCount >= 35, `True odds must produce mostly unclaimed spins (got ${noWinCount} no-winners and ${winCount} wins out of 50)`);
  console.log(`  ✅ True Odds Cash Multiplier verified (${noWinCount}/50 unclaimed, ${winCount}/50 wins)`);
  console.log('  ✅ Smart Profit-Protected Cash Multiplier (1.5x / 2x / 3x) passed');

  // 12. MongoDB `chillaxgaminghub` Integration Verification
  console.log('Test 12: MongoDB "chillaxgaminghub" Integration');
  const builtUri = buildMongoUri({
    username: 'chillax_admin',
    password: 'MySecret#Password',
    clusterHost: 'cluster0.q1kwbvb.mongodb.net',
    dbName: 'chillaxgaminghub'
  });
  assert(
    builtUri.includes('mongodb+srv://chillax_admin:MySecret%23Password@cluster0.q1kwbvb.mongodb.net/chillaxgaminghub'),
    'URI builder must properly encode credentials and target chillaxgaminghub on cluster0.q1kwbvb.mongodb.net'
  );

  const mStatus = getMongoStatus();
  assert.strictEqual(mStatus.dbName, 'chillaxgaminghub', 'Default database name must be chillaxgaminghub');
  assert.strictEqual(mStatus.clusterHost, 'cluster0.q1kwbvb.mongodb.net', 'Cluster host must be cluster0.q1kwbvb.mongodb.net');
  assert.strictEqual(mStatus.permanentDb, true, 'MongoDB must be configured as default permanent DB');
  assert(snapshotAfterCashBets.mongoStatus, 'Session snapshot must expose real-time mongoStatus');

  // Verify hub user PIN integration
  hubCache.users.push({ id: 'usr_test_hub', username: 'nexus_mgr', pin: '7878' });
  const hubPinRes = engine.verifyHostPin('127.0.0.9', '7878');
  assert.strictEqual(hubPinRes.success, true, 'Host PIN verification must accept PINs from chillaxgaminghub.users');
  console.log('  ✅ MongoDB "chillaxgaminghub" integration passed');

  // 13. Chillax Gaming App Synced Login & Linked Shop Code Session
  console.log('Test 13: Chillax Gaming App Synced Login & Linked Shop Code Session');
  hubCache.shops.push({
    id: 'shop_test_2855',
    shopCode: 'CHX-2855',
    name: 'Gaming Lounge',
    ownerId: 'usr_test_owner',
    currency: 'R'
  });
  const testUser = {
    id: 'usr_test_owner',
    username: 'fortuinem',
    name: 'Fortuin',
    shopId: 'shop_test_2855',
    pin: '1234'
  };
  const linkedShop = await resolveLinkedShopForUser(testUser);
  assert.strictEqual(linkedShop.shopCode, 'CHX-2855', 'Linked shop must resolve shopCode CHX-2855');
  assert.strictEqual(linkedShop.name, 'Gaming Lounge', 'Linked shop must resolve shop name');

  const shopSessionSnapshot = await engine.ensureShopSession({ shop: linkedShop, user: testUser });
  assert.strictEqual(shopSessionSnapshot.shortCode, 'CHX-2855', 'Session shortCode must come from the linked shopCode');
  assert.strictEqual(shopSessionSnapshot.shopCode, 'CHX-2855', 'Session shopCode must match linked shopCode');
  assert.strictEqual(shopSessionSnapshot.shopName, 'Gaming Lounge', 'Session shopName must match linked shop name');

  // Verify lookup works with exact CHX-2855, without hyphen CHX2855, or digits 2855
  assert(engine.findSessionByCode('CHX-2855'), 'Should find session by exact Shop Code CHX-2855');
  assert(engine.findSessionByCode('CHX2855'), 'Should find session by Shop Code without hyphen CHX2855');
  assert(engine.findSessionByCode('2855'), 'Should find session by 4-digit Shop Code suffix 2855');
  console.log('  ✅ Chillax Gaming App synced login & linked Shop Code passed');

  // 14. Wheel Numbers Configuration & 2 Zeros (0 & 00)
  console.log('Test 14: Wheel Numbers Selection & 2 Zeros (0 & 00)');
  const wheelSnap = engine.getSessionSnapshot(session.sessionId);
  assert(wheelSnap.wheelNumbers.includes('0'), 'Wheel numbers must include single zero "0"');
  assert(wheelSnap.wheelNumbers.includes('00'), 'Wheel numbers must include double zero "00"');
  assert.strictEqual(wheelSnap.wheelNumbers[0], '0', '0 should be at top');
  assert.strictEqual(
    wheelSnap.wheelNumbers[Math.floor(wheelSnap.wheelNumbers.length / 2)],
    '00',
    'Double zero "00" must be positioned directly opposite single zero "0" across the wheel'
  );

  // Create a new round on session to test claiming 0 and 00
  const rZerosRes = engine.createNextRound(session.sessionId, { prizeId: 'prize_1', numberMax: 10, hasDoubleZero: true });
  assert.strictEqual(rZerosRes.success, true);
  const snapZeros = engine.getSessionSnapshot(session.sessionId);
  assert.strictEqual(snapZeros.numberRange.max, 10);
  assert.strictEqual(snapZeros.wheelNumbers.length, 12, '10 numbers + 2 zeros = 12 wheel pockets');

  // Claim '0' as player
  const claim0 = engine.claimNumber(session.sessionId, {
    number: '0',
    playerToken: 'tok_zero_player',
    nickname: 'ZeroHero'
  });
  assert.strictEqual(claim0.success, true, 'Should successfully claim single zero "0"');
  assert.strictEqual(claim0.number, '0');

  // Claim '00' as host walk-in
  const claim00 = engine.hostClaimNumber(session.sessionId, {
    number: '00',
    nickname: 'DoubleZeroFan'
  });
  assert.strictEqual(claim00.success, true, 'Should successfully claim double zero "00"');
  assert.strictEqual(claim00.number, '00');

  // Changing wheel config updates live pockets
  const updateCfg = engine.setWheelConfig(session.sessionId, { numberMax: 30, hasDoubleZero: true });
  assert.strictEqual(updateCfg.success, true);
  assert.strictEqual(updateCfg.snapshot.wheelNumbers.length, 32, '30 numbers + 2 zeros = 32 wheel pockets');

  console.log('  ✅ Wheel numbers selection & 2 zeros (0 & 00) passed');

  // 15. Weighted Cash-Prize Schedule (4.625% / R0.575 EV), R1,000 Ring-Fenced Reserve, Odds-Lock & Profitability Model
  console.log('Test 15: Weighted Cash-Prize Schedule, R1,000 Ring-Fenced Reserve & Profitability Model');
  const finSession = await engine.createSession({
    numberMin: 1,
    numberMax: 20,
    hostPin: '1234',
    defaultPrizeId: 'prize_weighted_cash',
    shopCode: 'CHX-9901',
    shopId: 'shop_9901',
    shopName: 'Chillax Flagship'
  });

  const finSnap = finSession.snapshot;
  assert.strictEqual(finSnap.currentRound.isWeightedCash, true, 'Round must recognize weighted_cash prize mode');
  assert.strictEqual(finSnap.currentRound.defaultSpinPrice, 10, 'Weighted cash round default spin price must be R10');

  // Verify PDF Section 1, 2, 4, 5, 10 Profitability Model calculations
  const pModel = finSnap.houseCashStats.profitabilityModel;
  assert.strictEqual(pModel.monthlyCustomerVisits, 1300, '50 customers/day * 26 days = 1,300 visits/month');
  assert.strictEqual(pModel.monthlyOrdinarySales, 26000, '1,300 visits * R20 = R26,000 ordinary sales');
  assert.strictEqual(pModel.ordinaryGrossContribution, 16900, '65% of R26,000 = R16,900 ordinary contribution');
  assert.strictEqual(pModel.expectedPayoutPerSpin, 0.575, 'Expected cash payout per R10 spin must be R0.575');
  const sc50 = pModel.scenarios.find((s) => s.uptakePct === 50);
  assert.strictEqual(sc50.monthlySpins, 650, '50% uptake = 650 spins/month');
  assert.strictEqual(sc50.grossSpinRevenue, 6500, '650 spins * R10 = R6,500 gross revenue');
  assert.strictEqual(sc50.expectedCashPayout, 373.75, '650 spins * R0.575 = R373.75 expected cash payout');
  assert.strictEqual(sc50.netSpinContribution, 6126.25, 'Net contribution at 50% uptake (0% share) = R6,126.25');
  assert.strictEqual(sc50.reserveRemaining, 626.25, 'R1,000 reserve - R373.75 = R626.25 remaining');

  // Verify 18+ age check enforcement
  const underageClaim = engine.claimNumber(finSession.sessionId, {
    number: '1',
    playerToken: 'tok_underage',
    nickname: 'Kid',
    betAmount: 10,
    ageVerified: false
  });
  assert.strictEqual(underageClaim.success, false, 'Underage entry must be rejected');
  assert.strictEqual(underageClaim.status, 403);

  // Claim a paid R10 entry and verify unique transaction ID (txId)
  const paidClaim = engine.claimNumber(finSession.sessionId, {
    number: '5',
    playerToken: 'tok_weighted_p1',
    nickname: 'Sipho',
    betAmount: 10,
    ageVerified: true
  });
  assert.strictEqual(paidClaim.success, true);
  assert(paidClaim.txId && paidClaim.txId.startsWith('TX-'), 'Paid entry must generate a unique transaction ID');

  // Verify Reserve Rule: Cannot change prize/odds after customers have paid in a round
  const lockCheck = engine.setRoundPrize(finSession.sessionId, 'prize_1');
  assert.strictEqual(lockCheck.success, false, 'Must block changing prize/odds after paid entry');
  assert.strictEqual(lockCheck.status, 409);

  // VerifyGuaranteed win in Weighted Cash mode produces a valid tier (R10/R20/R50/R100), redemptionCode, and unredeemed liability
  engine.setWinnerMode(finSession.sessionId, 'GUARANTEED');
  engine.closeRegistration(finSession.sessionId);
  const wSpin = engine.spin(finSession.sessionId, { idempotencyKey: 'wspin_1' });
  assert.strictEqual(wSpin.success, true);
  assert.strictEqual(wSpin.hasWinner, true);
  assert(wSpin.redemptionCode && wSpin.redemptionCode.startsWith('CLX-R1-'), 'Winner must receive a unique redemption code');
  assert([10, 20, 50, 100].includes(wSpin.winnerPayoutAmount), `Weighted cash payout must be R10, R20, R50, or R100 (got R${wSpin.winnerPayoutAmount})`);

  // Verify unredeemed winning is counted as committed liability immediately (never counted as available cash)
  const statsBeforeRedeem = engine.getHouseCashStats(finSession.sessionId);
  assert.strictEqual(statsBeforeRedeem.outstandingCashLiabilities, wSpin.winnerPayoutAmount, 'Unredeemed prize must be tracked as outstanding liability');
  assert.strictEqual(statsBeforeRedeem.committedCashTotal, wSpin.winnerPayoutAmount, 'Committed cash must include unredeemed liability');
  assert.strictEqual(statsBeforeRedeem.availableCashReserve, 1000 - wSpin.winnerPayoutAmount, 'Available reserve must deduct unredeemed liability');

  // Redeem prize and verify liability transitions from outstanding to settled paid
  const roundAfterWSpin = engine.getSessionSnapshot(finSession.sessionId).currentRound;
  const wRedeem = engine.redeemPrize(roundAfterWSpin.id, { notes: 'Verified code ' + wSpin.redemptionCode, redeemedBy: 'Manager' });
  assert.strictEqual(wRedeem.success, true);
  const statsAfterRedeem = engine.getHouseCashStats(finSession.sessionId);
  assert.strictEqual(statsAfterRedeem.outstandingCashLiabilities, 0, 'Outstanding liability must be 0 after redemption');
  assert.strictEqual(statsAfterRedeem.settledCashPaid, wSpin.winnerPayoutAmount, 'Settled cash paid must equal redeemed amount');

  // Verify Reserve Replenishment & Emergency Suspension controls
  const repRes = engine.replenishCashReserve(finSession.sessionId, { amount: 500, notes: 'Top up' });
  assert.strictEqual(repRes.success, true);
  assert.strictEqual(repRes.newMonthlyCashReserve, 1500, 'Reserve ceiling must increase from R1,000 to R1,500');

  engine.createNextRound(finSession.sessionId, { prizeId: 'prize_weighted_cash' });
  engine.setEmergencySuspend(finSession.sessionId, { suspended: true, reason: 'Audit check' });
  const blockedClaim = engine.claimNumber(finSession.sessionId, {
    number: '8',
    playerToken: 'tok_blocked',
    nickname: 'Bongani',
    betAmount: 10
  });
  assert.strictEqual(blockedClaim.success, false, 'Emergency suspend must block new entries');
  assert.strictEqual(blockedClaim.status, 403);
  engine.setEmergencySuspend(finSession.sessionId, { suspended: false, reason: 'Audit done' });

  console.log('  ✅ Weighted Cash-Prize Schedule, R1,000 Ring-Fenced Reserve & Profitability Model passed');

  console.log('\n🎉 ALL 15 TEST SUITES PASSED FLAWLESSLY!\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
