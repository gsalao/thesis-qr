import { bls12_381 } from '@noble/curves/bls12-381.js';
import { sha256 } from '@noble/hashes/sha256.js';

const G1_BASE = bls12_381.G1.ProjectivePoint.BASE;
const BLS12_381_ORDER = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;

// Polynomial f(x) = secret + x + x^2 mod r
// secret = 0xABC123456789n
const JOINT_SECRET = 0xABC123456789n;

export function getPrivateShareForNode(nodeId) {
  const xBig = BigInt(nodeId);
  const share = (JOINT_SECRET + xBig + (xBig * xBig)) % BLS12_381_ORDER;
  return share.toString(16);
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

export function formatSignatureForQR(signature) {
  return JSON.stringify({
    x: signature.x,
    y: signature.y,
    z: signature.z
  });
}

export function parseSignatureFromQR(qrData) {
  try {
    const parsed = JSON.parse(qrData);
    if (parsed.signature) {
      return parsed.signature;
    }
    return parsed;
  } catch {
    return null;
  }
}
