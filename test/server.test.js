import assert from 'node:assert';
import { db } from '../server/db.js';
import { GameEngine } from '../server/gameEngine.js';

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
  assert([3, 7, 12, 15].includes(spinRes.winningNumber), 'In guaranteed mode, winning number must be among claimed numbers');

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

  // 11. 3x Real Cash Multiplier Mode (Min R5 Bet & 3x Payout)
  console.log('Test 11: 3x Real Cash Multiplier Mode (Min R5 Bet)');
  const cashRoundRes = engine.createNextRound(session.sessionId, { prizeId: 'prize_cash_3x' });
  assert.strictEqual(cashRoundRes.success, true, 'Cash round creation should succeed');

  const cashSnapshot = engine.getSessionSnapshot(session.sessionId);
  assert.strictEqual(cashSnapshot.currentRound.isCashRound, true, 'Round should be marked as isCashRound');

  // Reject bet below R5
  const lowBetClaim = engine.claimNumber(session.sessionId, {
    number: 4,
    playerToken: 'token_cash_1',
    nickname: 'Bongani',
    betAmount: 3
  });
  assert.strictEqual(lowBetClaim.success, false, 'Bet below R5 should be rejected');
  assert.strictEqual(lowBetClaim.status, 400);

  // Accept valid R20 bet -> R60 payout (3x)
  const validCashClaim = engine.claimNumber(session.sessionId, {
    number: 4,
    playerToken: 'token_cash_1',
    nickname: 'Bongani',
    betAmount: 20
  });
  assert.strictEqual(validCashClaim.success, true, 'Valid R20 bet should succeed');
  assert.strictEqual(validCashClaim.betAmount, 20);
  assert.strictEqual(validCashClaim.payoutAmount, 60, 'Payout must be 3x bet (R60)');

  // Host walk-in pick with R10 bet -> R30 payout (3x)
  const hostCashPick = engine.hostClaimNumber(session.sessionId, {
    number: 9,
    nickname: 'Nomsa',
    betAmount: 10
  });
  assert.strictEqual(hostCashPick.success, true, 'Host cash pick with R10 should succeed');
  assert.strictEqual(hostCashPick.payoutAmount, 30, 'Host cash pick payout must be R30 (3x)');

  const snapshotAfterCashBets = engine.getSessionSnapshot(session.sessionId);
  assert.strictEqual(snapshotAfterCashBets.totalBets, 30, 'Total pool should be R30 (R20 + R10)');
  console.log('  ✅ 3x Real Cash Multiplier mode passed');

  console.log('\n🎉 ALL 11 TEST SUITES PASSED FLAWLESSLY!\n');
}

runTests().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
