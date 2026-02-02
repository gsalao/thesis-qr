import { bls12_381 } from '@noble/curves/bls12-381.js';
import { sha256 } from '@noble/hashes/sha256.js';
import { JOINT_PUBLIC_KEY } from '../config/keys.js';

const G1 = bls12_381.G1.ProjectivePoint.BASE;

const BLS12_381_G1_MODULUS = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;

function getPointFromHex(x, y, z = '1') {
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
  const hashInt = BigInt('0x' + hashHex);
  return G1.multiply(hashInt);
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
  if (result < 0n) result += m;
  return result;
}

function lagrangeCoefficient(i, signers, modulus) {
  const iBig = BigInt(i);
  let numerator = 1n;
  let denominator = 1n;
  for (const j of signers) {
    if (i !== j) {
      const jBig = BigInt(j);
      numerator = (numerator * jBig) % modulus;
      let diff = iBig - jBig;
      if (diff < 0n) diff += modulus;
      denominator = (denominator * diff) % modulus;
    }
  }
  const denominatorInv = modInverse(denominator, modulus);
  let result = (numerator * denominatorInv) % modulus;
  if (result < 0n) result += modulus;
  return result;
}

export function aggregateSignatures(signatures, signers) {
  if (signatures.length === 0) {
    throw new Error('No signatures to aggregate');
  }

  const modulus = BLS12_381_G1_MODULUS;
  const signersList = signers || signatures.map((_, i) => i + 1);

  if (signersList.length !== signatures.length) {
    throw new Error('Signers length mismatch');
  }

  let aggregated = null;

  for (let i = 0; i < signatures.length; i++) {
    const sig = signatures[i];
    const nodeId = signersList[i];
    const coeff = lagrangeCoefficient(nodeId, signersList, modulus);
    
    if (coeff <= 0n || coeff >= modulus) {
      console.warn(`Invalid Lagrange coefficient for node ${nodeId}: ${coeff}, skipping multiplication`);
      continue;
    }
    
    const sigPoint = getPointFromHex(sig.x, sig.y, sig.z || '1');
    
    const weighted = sigPoint.multiply(coeff);

    if (!aggregated) {
      aggregated = weighted;
    } else {
      aggregated = aggregated.add(weighted);
    }
  }

  if (!aggregated) {
    throw new Error('No valid signatures to aggregate');
  }

  const affine = aggregated.toAffine();
  return {
    x: affine.x.toString(16),
    y: affine.y.toString(16)
  };
}

export function verifySignature(publicKeyHex, message, signatureHex) {
  try {
    console.log('Server verify - publicKey:', JSON.stringify(publicKeyHex));
    console.log('Server verify - message:', JSON.stringify(message));
    console.log('Server verify - signature:', JSON.stringify(signatureHex));

    const publicKey = getPointFromHex(
      publicKeyHex.x,
      publicKeyHex.y,
      publicKeyHex.z || '1'
    );

    const signature = getPointFromHex(
      signatureHex.x,
      signatureHex.y,
      signatureHex.z || '1'
    );

    const messageHash = hashMessage(message);
    console.log('Server - message hash computed');

    const left = bls12_381.pairing(publicKey, messageHash);
    const right = bls12_381.pairing(G1, signature);
    console.log('Server - pairing computed');

    return left.equals(right);
  } catch (error) {
    console.error('Verification error:', error);
    return false;
  }
}

export function getJointPublicKey() {
  return JOINT_PUBLIC_KEY;
}

export function computeLagrangeCoefficient(i, signers, modulus) {
  let numerator = BigInt(1);
  let denominator = BigInt(1);

  for (const j of signers) {
    if (i !== j) {
      const jBigInt = BigInt(j);
      const iBigInt = BigInt(i);
      numerator = (numerator * jBigInt) % modulus;
      denominator = (denominator * (iBigInt - jBigInt)) % modulus;
    }
  }

  const denominatorInv = denominator; // In actual implementation, use modular inverse
  return (numerator * denominatorInv) % modulus;
}
