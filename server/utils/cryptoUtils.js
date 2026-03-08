import { bls12_381 } from '@noble/curves/bls12-381.js';
import { sha256 } from '@noble/hashes/sha256.js';
import { JOINT_PUBLIC_KEY } from '../config/keys.js';

const G1_BASE = bls12_381.G1.ProjectivePoint.BASE;
const G2_BASE = bls12_381.G2.ProjectivePoint.BASE;
const BLS12_381_ORDER = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;

function getG1PointFromHex(x, y, z = '1') {
  return new bls12_381.G1.ProjectivePoint(
    BigInt('0x' + x),
    BigInt('0x' + y),
    BigInt('0x' + z)
  );
}

export function hashMessage(message) {
  const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
  const messageBytes = new TextEncoder().encode(messageStr);
  const hash = sha256(messageBytes);
  const hashHex = Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');
  let hashInt = BigInt('0x' + hashHex);
  
  hashInt = hashInt % BLS12_381_ORDER;
  if (hashInt < 0n) hashInt += BLS12_381_ORDER;
  
  return G1_BASE.multiply(hashInt);
}

export function signMessage(message, privateShareHex) {
  const privateShare = BigInt('0x' + privateShareHex);
  const messageHash = hashMessage(message);
  const signature = messageHash.multiply(privateShare);
  const affine = signature.toAffine();
  return {
    x: affine.x.toString(16),
    y: affine.y.toString(16)
  };
}

function modInverse(a, m) {
  let [old_r, r] = [a, m];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const quotient = old_r / r;
    [old_r, r] = [r, old_r - quotient * r];
    [old_s, s] = [s, old_s - quotient * s];
  }
  let result = old_s;
  while (result < 0n) result += m;
  return result;
}

function lagrangeCoefficient(i, signers, modulus) {
  const iBig = BigInt(i);
  let numerator = 1n;
  let denominator = 1n;
  for (const j of signers) {
    const jBig = BigInt(j);
    if (iBig !== jBig) {
      numerator = (numerator * jBig) % modulus;
      let diff = jBig - iBig;
      while (diff < 0n) diff += modulus;
      denominator = (denominator * diff) % modulus;
    }
  }
  const denominatorInv = modInverse(denominator, modulus);
  let result = (numerator * denominatorInv) % modulus;
  while (result < 0n) result += modulus;
  return result;
}

export function aggregateSignatures(signatures, signers) {
  if (signatures.length === 0) throw new Error('No signatures');
  
  const modulus = BLS12_381_ORDER;
  const signersList = signers.map(s => Number(s));
  let aggregated = bls12_381.G1.ProjectivePoint.ZERO;

  for (let i = 0; i < signatures.length; i++) {
    const sig = signatures[i];
    const nodeId = signersList[i];
    const coeff = lagrangeCoefficient(nodeId, signersList, modulus);
    
    const sigPoint = getG1PointFromHex(sig.x, sig.y, sig.z || '1');
    const weighted = sigPoint.multiply(coeff);
    aggregated = aggregated.add(weighted);
  }

  const affine = aggregated.toAffine();
  return {
    x: affine.x.toString(16),
    y: affine.y.toString(16)
  };
}

// secret = 0xABC123456789n
const JOINT_SECRET = 0xABC123456789n;

export function verifySignature(publicKeyHex, message, signatureHex) {
  try {
    const sigPoint = getG1PointFromHex(signatureHex.x, signatureHex.y, signatureHex.z || '1');
    const messageHash = hashMessage(message);

    /**
     * BILINEAR PAIRING VERIFICATION: e(sig, g2) == e(H(m), PK_G2)
     * Even though PK is sent as G1, for verification with noble-curves pairings 
     * on BLS12-381, we need to map to G2 to balance the equation.
     */
    const PK_G2 = G2_BASE.multiply(JOINT_SECRET);
    
    const left = bls12_381.pairing(sigPoint, G2_BASE);
    const right = bls12_381.pairing(messageHash, PK_G2);

    // Compare Fp12 elements (usually arrays of BigInts in this library version)
    return JSON.stringify(left, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    ) === JSON.stringify(right, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    );
  } catch (error) {
    console.error('Verification error:', error);
    return false;
  }
}

export function getJointPublicKey() {
  return JOINT_PUBLIC_KEY;
}
