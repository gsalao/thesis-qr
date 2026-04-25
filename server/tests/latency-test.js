/**
 * Latency Benchmark — QR Generation + Payment Verification
 *
 * Measures end-to-end socket round-trip times for:
 *   1. QR generation  (request_transaction → transaction_initiated COMPLETED)
 *   2. Payment verification (verify_payment → payment_processed)
 *
 * Run: node server/tests/latency-test.js
 * Requires the server to be running on localhost:5001
 */

import { io } from 'socket.io-client';

const SERVER_URL = 'http://localhost:5001';
const TRIALS = 30;
const TRIAL_DELAY_MS = 300; // gap between trials to avoid lock contention

function stats(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const n = arr.length;
  const mean = arr.reduce((s, v) => s + v, 0) / n;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);
  const p50 = sorted[Math.floor(n * 0.50)];
  const p90 = sorted[Math.floor(n * 0.90)];
  const p95 = sorted[Math.floor(n * 0.95)];
  const p99 = sorted[Math.floor(n * 0.99)] ?? sorted[n - 1];
  return {
    n,
    min: sorted[0],
    max: sorted[n - 1],
    mean: +mean.toFixed(2),
    stddev: +stddev.toFixed(2),
    p50,
    p90,
    p95,
    p99,
  };
}

function connectNode(nodeId, role) {
  return new Promise((resolve, reject) => {
    const socket = io(SERVER_URL, { transports: ['websocket'] });
    const timeout = setTimeout(() => reject(new Error(`Connection timeout for node ${nodeId}`)), 8000);

    socket.on('connect', () => {
      socket.emit('join_room', { nodeId, role });
    });

    socket.on('room_joined', (data) => {
      clearTimeout(timeout);
      if (data.success) {
        resolve(socket);
      } else {
        socket.disconnect();
        reject(new Error(`join_room failed for nodeId=${nodeId}: ${data.message}`));
      }
    });

    socket.on('connect_error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function createAndCompleteTransaction(requesterSocket, amount) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('transaction_initiated timeout')), 8000);

    requesterSocket.once('transaction_initiated', (data) => {
      clearTimeout(timeout);
      if (data.status === 'COMPLETED' && data.qrData) {
        resolve({ nonce: data.nonce, qrData: data.qrData, amount: data.amount });
      } else {
        reject(new Error(`Unexpected status: ${data.status}`));
      }
    });

    requesterSocket.emit('request_transaction', { amount, requesterId: 1 });
  });
}

function verifyPayment(merchantSocket, nonce, amount) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('payment_processed timeout')), 8000);

    merchantSocket.once('payment_processed', (data) => {
      clearTimeout(timeout);
      resolve(data);
    });

    merchantSocket.once('error', (data) => {
      clearTimeout(timeout);
      reject(new Error(`Server error: ${data.message}`));
    });

    merchantSocket.emit('verify_payment', { nonce, amount });
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runBenchmark() {
  console.log('='.repeat(60));
  console.log('  DKG Payment System — Latency Benchmark');
  console.log(`  Trials: ${TRIALS}  |  Server: ${SERVER_URL}`);
  console.log('='.repeat(60));

  let requesterSocket, merchantSocket;

  try {
    process.stdout.write('Connecting sockets… ');
    requesterSocket = await connectNode(1, 'node');
    merchantSocket  = await connectNode(99, 'merchant');
    console.log('OK\n');
  } catch (err) {
    console.error('Connection failed:', err.message);
    process.exit(1);
  }

  const qrLatencies     = [];
  const verifyLatencies = [];
  const totalLatencies  = [];
  const trialLog        = [];

  console.log(`${'Trial'.padEnd(7)} ${'QR Gen (ms)'.padEnd(14)} ${'Verify (ms)'.padEnd(14)} ${'Total (ms)'.padEnd(12)}`);
  console.log('-'.repeat(50));

  for (let t = 1; t <= TRIALS; t++) {
    try {
      const amount = 100 + (t % 10); // small amounts, below 1000 PHP threshold

      // --- Phase 1: QR Generation ---
      const t0 = Date.now();
      const tx = await createAndCompleteTransaction(requesterSocket, amount);
      const qrMs = Date.now() - t0;

      // --- Phase 2: Verification ---
      const t1 = Date.now();
      await verifyPayment(merchantSocket, tx.nonce, tx.amount);
      const verifyMs = Date.now() - t1;

      const totalMs = qrMs + verifyMs;

      qrLatencies.push(qrMs);
      verifyLatencies.push(verifyMs);
      totalLatencies.push(totalMs);

      trialLog.push({ trial: t, qrMs, verifyMs, totalMs });

      console.log(
        `${String(t).padEnd(7)} ${String(qrMs).padEnd(14)} ${String(verifyMs).padEnd(14)} ${String(totalMs).padEnd(12)}`
      );

      await sleep(TRIAL_DELAY_MS);
    } catch (err) {
      console.error(`  Trial ${t} ERROR: ${err.message}`);
    }
  }

  requesterSocket.disconnect();
  merchantSocket.disconnect();

  console.log('\n' + '='.repeat(60));
  console.log('  STATISTICS SUMMARY');
  console.log('='.repeat(60));

  const sections = [
    { label: 'QR Generation Latency',       data: qrLatencies     },
    { label: 'Verification Latency',         data: verifyLatencies },
    { label: 'Total End-to-End Latency',     data: totalLatencies  },
  ];

  for (const { label, data } of sections) {
    if (data.length === 0) continue;
    const s = stats(data);
    console.log(`\n  ${label}`);
    console.log(`  ${'Metric'.padEnd(12)} Value`);
    console.log(`  ${'-'.repeat(25)}`);
    console.log(`  ${'n'.padEnd(12)} ${s.n}`);
    console.log(`  ${'min'.padEnd(12)} ${s.min} ms`);
    console.log(`  ${'max'.padEnd(12)} ${s.max} ms`);
    console.log(`  ${'mean'.padEnd(12)} ${s.mean} ms`);
    console.log(`  ${'std dev'.padEnd(12)} ${s.stddev} ms`);
    console.log(`  ${'p50'.padEnd(12)} ${s.p50} ms`);
    console.log(`  ${'p90'.padEnd(12)} ${s.p90} ms`);
    console.log(`  ${'p95'.padEnd(12)} ${s.p95} ms`);
    console.log(`  ${'p99'.padEnd(12)} ${s.p99} ms`);
  }

  // Verification-specific pass/fail against 200 ms target
  const verifyStats = stats(verifyLatencies);
  const passingTrials = verifyLatencies.filter(v => v < 200).length;
  console.log('\n' + '='.repeat(60));
  console.log(`  TARGET CHECK: Verification latency < 200 ms`);
  console.log(`  Passed: ${passingTrials}/${TRIALS} trials (${((passingTrials/TRIALS)*100).toFixed(1)}%)`);
  console.log(`  Result: ${verifyStats.p95 < 200 ? 'PASS ✓' : 'FAIL ✗'} (p95 = ${verifyStats.p95} ms)`);
  console.log('='.repeat(60));

  // Machine-readable JSON for the report generator
  const output = {
    timestamp: new Date().toISOString(),
    trials: TRIALS,
    trialLog,
    qr: stats(qrLatencies),
    verify: stats(verifyLatencies),
    total: stats(totalLatencies),
    target200msPass: passingTrials,
    target200msPassPct: +((passingTrials / TRIALS) * 100).toFixed(1),
  };

  process.stdout.write('\n__LATENCY_JSON__');
  process.stdout.write(JSON.stringify(output));
  process.stdout.write('__LATENCY_JSON_END__\n');
}

runBenchmark().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
