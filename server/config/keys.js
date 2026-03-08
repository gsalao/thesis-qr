import { bls12_381 } from '@noble/curves/bls12-381.js';

const G1 = bls12_381.G1;
const BLS12_381_ORDER = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;

const JOINT_SECRET = 0xABC123456789n;

function calculateShare(x) {
  const xBig = BigInt(x);
  const val = (JOINT_SECRET + xBig + (xBig * xBig)) % BLS12_381_ORDER;
  return val;
}

export function generateKeys() {
  const NUM_NODES = 5;
  const shares = [];
  const publicKeys = [];

  for (let i = 1; i <= NUM_NODES; i++) {
    const privateShare = calculateShare(i);
    const publicKeyRaw = G1.ProjectivePoint.BASE.multiply(privateShare);
    const affine = publicKeyRaw.toAffine();
    
    shares.push({
      nodeId: i,
      privateShare: privateShare.toString(16)
    });
    
    publicKeys.push({
      nodeId: i,
      publicKey: {
        x: affine.x.toString(16),
        y: affine.y.toString(16),
        z: '1'
      }
    });
  }

  const jointPublicKeyRaw = G1.ProjectivePoint.BASE.multiply(JOINT_SECRET);
  const jointAffine = jointPublicKeyRaw.toAffine();

  return {
    shares,
    publicKeys,
    jointPublicKey: {
      x: jointAffine.x.toString(16),
      y: jointAffine.y.toString(16),
      z: '1'
    },
    threshold: {
      low: 1,
      high: 3
    }
  };
}

const KEY_CONFIG = generateKeys();

export const PRIVATE_SHARES = Object.fromEntries(
  KEY_CONFIG.shares.map(s => [s.nodeId, s.privateShare])
);

export const JOINT_PUBLIC_KEY = KEY_CONFIG.jointPublicKey;

export const NODE_PUBLIC_KEYS = Object.fromEntries(
  KEY_CONFIG.publicKeys.map(p => [p.nodeId, p.publicKey])
);

export const THRESHOLD = KEY_CONFIG.threshold;

export default KEY_CONFIG;
