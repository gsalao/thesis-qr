/**
 * Functional / Unit Tests — BLS12-381 Threshold Cryptography
 * Run with: cd server && npm test
 */
import { describe, it, expect } from 'vitest';
import {
  hashMessage,
  signMessage,
  aggregateSignatures,
  verifySignature
} from '../utils/cryptoUtils.js';
import { PRIVATE_SHARES, JOINT_PUBLIC_KEY, THRESHOLD } from '../config/keys.js';

// Canonical test transactions
const TX_LOW  = { amount: 500,  timestamp: 1714000000000, nonce: 'test-nonce-low-001' };
const TX_HIGH = { amount: 2500, timestamp: 1714000000001, nonce: 'test-nonce-high-001' };

// ─────────────────────────────────────────────
// 1. HASH FUNCTION
// ─────────────────────────────────────────────
describe('hashMessage', () => {
  it('returns a non-zero G1 point', () => {
    const h = hashMessage(TX_LOW);
    const a = h.toAffine();
    expect(a.x).not.toBe(0n);
    expect(a.y).not.toBe(0n);
  });

  it('is deterministic — same input always same output', () => {
    const a = hashMessage(TX_LOW).toAffine();
    const b = hashMessage(TX_LOW).toAffine();
    expect(a.x).toBe(b.x);
    expect(a.y).toBe(b.y);
  });

  it('avalanche effect — different messages produce different points', () => {
    const a = hashMessage(TX_LOW).toAffine();
    const b = hashMessage(TX_HIGH).toAffine();
    expect(a.x).not.toBe(b.x);
  });

  it('handles plain string input without throwing', () => {
    expect(() => hashMessage('plain-string-input')).not.toThrow();
  });

  it('single-bit amount change produces a different hash', () => {
    const a = hashMessage({ ...TX_HIGH, amount: TX_HIGH.amount }).toAffine();
    const b = hashMessage({ ...TX_HIGH, amount: TX_HIGH.amount + 1 }).toAffine();
    expect(a.x).not.toBe(b.x);
  });
});

// ─────────────────────────────────────────────
// 2. PARTIAL SIGNATURE GENERATION
// ─────────────────────────────────────────────
describe('signMessage', () => {
  it('returns a point with hex x and y fields', () => {
    const sig = signMessage(TX_HIGH, PRIVATE_SHARES[1]);
    expect(sig).toHaveProperty('x');
    expect(sig).toHaveProperty('y');
    expect(typeof sig.x).toBe('string');
    expect(typeof sig.y).toBe('string');
    expect(sig.x.length).toBeGreaterThan(8);
  });

  it('is deterministic — same key + same message → same signature', () => {
    const s1 = signMessage(TX_HIGH, PRIVATE_SHARES[1]);
    const s2 = signMessage(TX_HIGH, PRIVATE_SHARES[1]);
    expect(s1.x).toBe(s2.x);
    expect(s1.y).toBe(s2.y);
  });

  it('different nodes produce different partial signatures', () => {
    const s1 = signMessage(TX_HIGH, PRIVATE_SHARES[1]);
    const s2 = signMessage(TX_HIGH, PRIVATE_SHARES[2]);
    expect(s1.x).not.toBe(s2.x);
  });

  it('same key, different message → different signature', () => {
    const s1 = signMessage(TX_HIGH, PRIVATE_SHARES[1]);
    const s2 = signMessage(TX_LOW, PRIVATE_SHARES[1]);
    expect(s1.x).not.toBe(s2.x);
  });

  it('all 5 nodes can each produce a partial signature', () => {
    for (let i = 1; i <= 5; i++) {
      const sig = signMessage(TX_HIGH, PRIVATE_SHARES[i]);
      expect(sig.x).toBeTruthy();
      expect(sig.y).toBeTruthy();
    }
  });
});

// ─────────────────────────────────────────────
// 3. THRESHOLD CONFIG
// ─────────────────────────────────────────────
describe('Threshold configuration', () => {
  it('low-value threshold is 1', () => expect(THRESHOLD.low).toBe(1));
  it('high-value threshold is 3', () => expect(THRESHOLD.high).toBe(3));
  it('has 5 private key shares', () => {
    expect(Object.keys(PRIVATE_SHARES).length).toBe(5);
  });
  it('share IDs are 1 through 5', () => {
    const ids = Object.keys(PRIVATE_SHARES).map(Number).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2, 3, 4, 5]);
  });
  it('all shares are distinct hex strings', () => {
    const vals = Object.values(PRIVATE_SHARES);
    const unique = new Set(vals);
    expect(unique.size).toBe(5);
  });
  it('joint public key has x, y, z fields', () => {
    expect(JOINT_PUBLIC_KEY).toHaveProperty('x');
    expect(JOINT_PUBLIC_KEY).toHaveProperty('y');
    expect(JOINT_PUBLIC_KEY).toHaveProperty('z');
  });
});

// ─────────────────────────────────────────────
// 4. 3-of-5 THRESHOLD — CORRECT COMBINATIONS
// ─────────────────────────────────────────────
describe('3-of-5 threshold — valid combos reconstruct secret', () => {
  const combinations = [
    [1, 2, 3],
    [1, 2, 4],
    [1, 2, 5],
    [1, 3, 4],
    [1, 3, 5],
    [1, 4, 5],
    [2, 3, 4],
    [2, 3, 5],
    [2, 4, 5],
    [3, 4, 5],
  ];

  for (const combo of combinations) {
    it(`signers [${combo}] → verifies correctly`, () => {
      const sigs = combo.map(i => signMessage(TX_HIGH, PRIVATE_SHARES[i]));
      const agg  = aggregateSignatures(sigs, combo);
      expect(verifySignature(JOINT_PUBLIC_KEY, TX_HIGH, agg)).toBe(true);
    });
  }
});

// ─────────────────────────────────────────────
// 5. INSUFFICIENT SIGNERS — MUST FAIL
// ─────────────────────────────────────────────
describe('Insufficient signers — signature must NOT verify', () => {
  it('2-of-5 (below threshold) does not reconstruct secret', () => {
    const sigs = [1, 2].map(i => signMessage(TX_HIGH, PRIVATE_SHARES[i]));
    const agg  = aggregateSignatures(sigs, [1, 2]);
    expect(verifySignature(JOINT_PUBLIC_KEY, TX_HIGH, agg)).toBe(false);
  });

  it('any 2-of-5 pair fails', () => {
    const pairs = [[1,3],[2,4],[3,5],[1,5],[2,5]];
    for (const pair of pairs) {
      const sigs = pair.map(i => signMessage(TX_HIGH, PRIVATE_SHARES[i]));
      const agg  = aggregateSignatures(sigs, pair);
      expect(verifySignature(JOINT_PUBLIC_KEY, TX_HIGH, agg)).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────
// 6. TAMPER-RESISTANCE (MITM payload attacks)
// ─────────────────────────────────────────────
describe('Tamper-resistance — payload mutation invalidates signature', () => {
  let validAgg;

  // Compute a valid 3-of-5 aggregate before these tests
  const setup = () => {
    const sigs = [1, 2, 3].map(i => signMessage(TX_HIGH, PRIVATE_SHARES[i]));
    return aggregateSignatures(sigs, [1, 2, 3]);
  };

  it('modifying amount → verification fails', () => {
    const agg = setup();
    expect(verifySignature(JOINT_PUBLIC_KEY, { ...TX_HIGH, amount: 1 }, agg)).toBe(false);
  });

  it('modifying nonce → verification fails', () => {
    const agg = setup();
    expect(verifySignature(JOINT_PUBLIC_KEY, { ...TX_HIGH, nonce: 'forged-nonce' }, agg)).toBe(false);
  });

  it('modifying timestamp → verification fails', () => {
    const agg = setup();
    expect(verifySignature(JOINT_PUBLIC_KEY, { ...TX_HIGH, timestamp: 0 }, agg)).toBe(false);
  });

  it('random forged signature → verification fails', () => {
    const fakeAgg = { x: 'deadbeef'.repeat(16), y: 'cafebabe'.repeat(16) };
    expect(verifySignature(JOINT_PUBLIC_KEY, TX_HIGH, fakeAgg)).toBe(false);
  });

  it('all-zero forged signature → verification fails', () => {
    const zeroAgg = { x: '0'.repeat(96), y: '0'.repeat(96) };
    expect(verifySignature(JOINT_PUBLIC_KEY, TX_HIGH, zeroAgg)).toBe(false);
  });

  it('signature from a different transaction → verification fails on this tx', () => {
    // Sign a totally different transaction
    const otherTx = { amount: 9999, timestamp: 1111111111111, nonce: 'other-tx-nonce' };
    const sigs    = [1, 2, 3].map(i => signMessage(otherTx, PRIVATE_SHARES[i]));
    const aggOther = aggregateSignatures(sigs, [1, 2, 3]);
    // That sig should NOT verify against TX_HIGH
    expect(verifySignature(JOINT_PUBLIC_KEY, TX_HIGH, aggOther)).toBe(false);
  });
});

// ─────────────────────────────────────────────
// 7. AGGREGATION ERROR HANDLING
// ─────────────────────────────────────────────
describe('aggregateSignatures — error handling', () => {
  it('throws on empty signature array', () => {
    expect(() => aggregateSignatures([], [])).toThrow();
  });
});
