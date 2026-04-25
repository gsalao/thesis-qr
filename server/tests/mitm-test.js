/**
 * MITM Attack Simulation — DKG Threshold Payment System
 *
 * Demonstrates the cryptographic and protocol-level defenses against:
 *   1. Replay attack (reusing a paid QR code)
 *   2. Unknown / forged nonce
 *   3. Premature verification (PENDING transaction)
 *   4. Amount inflation (socket-level tampering)
 *   5. Amount deflation (socket-level tampering)
 *   6. Signature forgery via BLS unit test (verified offline)
 *   7. Cross-transaction signature reuse
 *
 * Run: node server/tests/mitm-test.js
 * Requires the server to be running on localhost:5001
 */

import { io } from 'socket.io-client';
import {
  signMessage,
  aggregateSignatures,
  verifySignature
} from '../utils/cryptoUtils.js';
import { PRIVATE_SHARES, JOINT_PUBLIC_KEY } from '../config/keys.js';

const SERVER_URL = 'http://localhost:5001';

const PASS = '\x1b[32mBLOCKED ✓\x1b[0m';
const FAIL = '\x1b[31mALLOWED ✗\x1b[0m';
const INFO = '\x1b[33mINFO\x1b[0m';

const results = [];

function record(scenario, expected, actual, serverMsg) {
  const passed = actual === expected;
  results.push({ scenario, expected, actual, serverMsg, passed });
  const badge = passed ? PASS : FAIL;
  console.log(`  [${badge}] ${scenario}`);
  if (serverMsg) console.log(`         Server: "${serverMsg}"`);
}

function connectNode(nodeId, role) {
  return new Promise((resolve, reject) => {
    const socket  = io(SERVER_URL, { transports: ['websocket'] });
    const timeout = setTimeout(() => reject(new Error('Connection timeout')), 8000);

    socket.on('connect', () => socket.emit('join_room', { nodeId, role }));
    socket.on('room_joined', (data) => {
      clearTimeout(timeout);
      if (data.success) {
        // Seed the tracked balance from the room_joined payload
        socket._trackedBalance = data.groupBalance ?? null;
        // Keep it updated with every subsequent broadcast
        socket.on('balance_update', (bd) => { socket._trackedBalance = bd.balance; });
        resolve(socket);
      } else {
        socket.disconnect();
        reject(new Error(data.message));
      }
    });
    socket.on('connect_error', (err) => { clearTimeout(timeout); reject(err); });
  });
}

function createTransaction(socket, amount, requesterId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('transaction_initiated timeout')), 8000);
    socket.once('transaction_initiated', (data) => {
      clearTimeout(timeout);
      resolve(data);
    });
    socket.once('error', (data) => { clearTimeout(timeout); reject(new Error(data.message)); });
    socket.emit('request_transaction', { amount, requesterId });
  });
}

function tryVerify(socket, nonce, amount) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve({ success: false, msg: 'TIMEOUT' }), 5000);

    socket.once('payment_processed', (data) => {
      clearTimeout(timeout);
      resolve({ success: true, msg: 'payment_processed' });
    });
    socket.once('error', (data) => {
      clearTimeout(timeout);
      resolve({ success: false, msg: data.message });
    });

    socket.emit('verify_payment', { nonce, amount });
  });
}

// Verify payment while tracking the actual balance deduction.
// nodeSocket._trackedBalance is updated by the persistent balance_update listener added in connectNode.
function tryVerifyAndCheckBalance(merchantSocket, nodeSocket, nonce, sentAmount, storedAmount) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve({ success: false, msg: 'TIMEOUT', correct: false }), 8000);
    const balanceBefore = nodeSocket._trackedBalance;

    const onBalanceChange = (bd) => {
      const deducted = balanceBefore - bd.balance;
      const correct  = deducted === storedAmount;
      clearTimeout(timeout);
      merchantSocket.off('error', onError);
      resolve({
        success: true, deducted, storedAmount, correct,
        msg: correct
          ? `Deducted ₱${deducted} = stored ₱${storedAmount} (BLOCKED ✓)`
          : `Deducted ₱${deducted} ≠ stored ₱${storedAmount} (VULNERABILITY ✗)`
      });
    };

    const onError = (errData) => {
      clearTimeout(timeout);
      nodeSocket.off('balance_update', onBalanceChange);
      resolve({ success: false, deducted: 0, correct: true, msg: errData.message });
    };

    // Register BEFORE emitting verify_payment to avoid race
    nodeSocket.once('balance_update', onBalanceChange);
    merchantSocket.once('error', onError);
    merchantSocket.emit('verify_payment', { nonce, amount: sentAmount });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────────
// OFFLINE CRYPTO TESTS (no socket needed)
// ─────────────────────────────────────────────
function runOfflineCryptoTests() {
  console.log('\n── OFFLINE CRYPTOGRAPHIC INTEGRITY TESTS ──\n');

  const TX = { amount: 2500, timestamp: 1714000000001, nonce: 'mitm-test-tx-001' };

  // Test A: BLS signature forgery
  const fakeAgg = { x: 'deadbeef'.repeat(16), y: 'cafebabe'.repeat(16) };
  const forged  = verifySignature(JOINT_PUBLIC_KEY, TX, fakeAgg);
  record(
    'BLS forgery: random bytes as signature',
    false, forged,
    forged ? 'Accepted (CRITICAL)' : 'Pairing mismatch — rejected'
  );

  // Test B: All-zeros signature
  const zeroAgg = { x: '0'.repeat(96), y: '0'.repeat(96) };
  const zeros   = verifySignature(JOINT_PUBLIC_KEY, TX, zeroAgg);
  record(
    'BLS forgery: all-zero signature bytes',
    false, zeros,
    zeros ? 'Accepted (CRITICAL)' : 'Zero-point rejected'
  );

  // Test C: Valid 3-of-5 sig but tampered amount
  const sigs3 = [1,2,3].map(i => signMessage(TX, PRIVATE_SHARES[i]));
  const agg3  = aggregateSignatures(sigs3, [1,2,3]);
  const tampered = verifySignature(JOINT_PUBLIC_KEY, { ...TX, amount: 1 }, agg3);
  record(
    'BLS tamper: valid sig, amount changed to ₱1',
    false, tampered,
    tampered ? 'Accepted (CRITICAL)' : 'Hash mismatch — rejected'
  );

  // Test D: Valid 3-of-5 sig but nonce swapped
  const nonceSwap = verifySignature(JOINT_PUBLIC_KEY, { ...TX, nonce: 'attacker-nonce' }, agg3);
  record(
    'BLS tamper: valid sig, nonce replaced',
    false, nonceSwap,
    nonceSwap ? 'Accepted (CRITICAL)' : 'Hash mismatch — rejected'
  );

  // Test E: Cross-transaction signature reuse
  const OTHER = { amount: 9999, timestamp: 1111111111111, nonce: 'other-tx' };
  const sigsOther = [1,2,3].map(i => signMessage(OTHER, PRIVATE_SHARES[i]));
  const aggOther  = aggregateSignatures(sigsOther, [1,2,3]);
  const crossTx   = verifySignature(JOINT_PUBLIC_KEY, TX, aggOther);
  record(
    'BLS tamper: signature from a different transaction reused',
    false, crossTx,
    crossTx ? 'Accepted (CRITICAL)' : 'Hash mismatch — rejected'
  );

  // Test F: 2-of-5 (below threshold) signature presented as valid
  const sigs2 = [1,2].map(i => signMessage(TX, PRIVATE_SHARES[i]));
  const agg2  = aggregateSignatures(sigs2, [1,2]);
  const under = verifySignature(JOINT_PUBLIC_KEY, TX, agg2);
  record(
    'Threshold attack: 2-of-5 shares presented as full signature',
    false, under,
    under ? 'Accepted (CRITICAL)' : 'Lagrange reconstruction fails — rejected'
  );

  // Test G: Legitimate 3-of-5 verifies correctly (positive control)
  const legit = verifySignature(JOINT_PUBLIC_KEY, TX, agg3);
  record(
    'Positive control: legitimate 3-of-5 signature verifies',
    true, legit,
    legit ? 'Valid signature accepted' : 'UNEXPECTED FAILURE'
  );
}

// ─────────────────────────────────────────────
// ONLINE PROTOCOL TESTS (socket-level)
// ─────────────────────────────────────────────
async function runOnlineProtocolTests() {
  console.log('\n── ONLINE PROTOCOL ATTACK TESTS ──\n');

  // Use different node IDs to avoid "already occupied" conflicts
  // We'll use node IDs 2 and 99 here
  let requesterSocket, merchantSocket;

  try {
    requesterSocket = await connectNode(2, 'node');
    merchantSocket  = await connectNode(99, 'merchant');
  } catch (err) {
    console.error('  Could not connect:', err.message);
    console.log('  (Skipping online tests — is the server running?)\n');
    return;
  }

  // --- Create a valid completed transaction ---
  let completedTx;
  try {
    completedTx = await createTransaction(requesterSocket, 100, 2);
    console.log(`  [${INFO}] Created test transaction: nonce=${completedTx.nonce}, amount=₱${completedTx.amount}`);
  } catch (err) {
    console.error('  Failed to create transaction:', err.message);
    requesterSocket.disconnect();
    merchantSocket.disconnect();
    return;
  }

  await sleep(200);

  // Attack 1: Unknown nonce
  const r1 = await tryVerify(merchantSocket, 'aaaaaaaa-0000-0000-0000-000000000000', 100);
  record(
    'Protocol: verify_payment with nonexistent nonce',
    false, r1.success, r1.msg
  );

  await sleep(200);

  // Attack 2: Amount inflation (send higher amount than stored)
  // The payment will be processed but the server must deduct the STORED amount, not the inflated one.
  let inflationTx;
  try {
    inflationTx = await createTransaction(requesterSocket, 100, 2);
    await sleep(150);
    const r_inflate = await tryVerifyAndCheckBalance(merchantSocket, requesterSocket, inflationTx.nonce, 999999, 100);
    record(
      'Protocol: amount inflation (socket ₱999,999 vs stored ₱100) — deduction correct?',
      true, r_inflate.correct, r_inflate.msg
    );
  } catch (err) {
    console.log(`  Could not run inflation test: ${err.message}`);
  }

  await sleep(200);

  // Attack 3: Amount deflation (send lower amount)
  let deflationTx;
  try {
    deflationTx = await createTransaction(requesterSocket, 500, 2);
    await sleep(150);
    const r_deflate = await tryVerifyAndCheckBalance(merchantSocket, requesterSocket, deflationTx.nonce, 1, 500);
    record(
      'Protocol: amount deflation (socket ₱1 vs stored ₱500) — deduction correct?',
      true, r_deflate.correct, r_deflate.msg
    );
  } catch (err) {
    console.log(`  Could not run deflation test: ${err.message}`);
  }

  await sleep(200);

  // Attack 4: Verify a legitimate transaction (positive control)
  let goodTx;
  try {
    goodTx = await createTransaction(requesterSocket, 50, 2);
    await sleep(100);
    const r_good = await tryVerify(merchantSocket, goodTx.nonce, goodTx.amount);
    record(
      'Positive control: legitimate verify_payment accepted',
      true, r_good.success, r_good.msg
    );
  } catch (err) {
    console.log(`  Could not run positive control: ${err.message}`);
  }

  await sleep(200);

  // Attack 5: Replay — re-use the same nonce after it's been paid
  if (goodTx) {
    const r5 = await tryVerify(merchantSocket, goodTx.nonce, goodTx.amount);
    record(
      'Protocol: replay attack — re-verify an already-PAID transaction',
      false, r5.success, r5.msg
    );
  }

  await sleep(200);

  // Attack 6: Verify a PENDING (not yet complete) transaction
  // Create a high-value tx (threshold=3) which stays PENDING since only 1 auto-sig
  let pendingTx;
  try {
    pendingTx = await createTransaction(requesterSocket, 5000, 2);
    // This stays PENDING (threshold=3, only 1 collected)
    await sleep(100);
    const r6 = await tryVerify(merchantSocket, pendingTx.nonce, 5000);
    record(
      'Protocol: verify PENDING transaction (threshold not yet met)',
      false, r6.success, r6.msg
    );

    // Clean up the pending tx so it doesn't linger
    await sleep(100);
    requesterSocket.emit('cancel_transaction', { nonce: pendingTx.nonce, requesterId: 2 });
  } catch (err) {
    console.log(`  Pending tx test: ${err.message}`);
  }

  requesterSocket.disconnect();
  merchantSocket.disconnect();
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────
async function main() {
  console.log('='.repeat(60));
  console.log('  DKG Payment System — MITM Attack Simulation');
  console.log(`  Server: ${SERVER_URL}`);
  console.log('='.repeat(60));

  runOfflineCryptoTests();
  await runOnlineProtocolTests();

  // Summary table
  console.log('\n' + '='.repeat(60));
  console.log('  RESULTS SUMMARY');
  console.log('='.repeat(60));
  console.log(`  ${'Scenario'.padEnd(52)} ${'Pass?'}`);
  console.log('  ' + '-'.repeat(58));
  for (const r of results) {
    const badge = r.passed ? '✓' : '✗';
    const trunc = r.scenario.length > 50 ? r.scenario.slice(0, 47) + '...' : r.scenario;
    console.log(`  ${trunc.padEnd(52)} ${badge}`);
  }

  const passed = results.filter(r => r.passed).length;
  console.log(`\n  Score: ${passed}/${results.length} passed`);
  console.log('='.repeat(60));

  // Machine-readable JSON for report generator
  process.stdout.write('\n__MITM_JSON__');
  process.stdout.write(JSON.stringify({ timestamp: new Date().toISOString(), results }));
  process.stdout.write('__MITM_JSON_END__\n');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
