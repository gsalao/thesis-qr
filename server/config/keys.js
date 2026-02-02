import { bls12_381 } from '@noble/curves/bls12-381.js';
import { sha256 } from '@noble/hashes/sha256.js';

const G1 = bls12_381.G1;

const PRIVATE_KEYS = [
  '0000000000000000000000000000000000000000000000000000000000000001',
  '0000000000000000000000000000000000000000000000000000000000000002',
  '0000000000000000000000000000000000000000000000000000000000000003',
  '0000000000000000000000000000000000000000000000000000000000000004',
  '0000000000000000000000000000000000000000000000000000000000000005'
];

function generatePrivateShare(index) {
  const privateValue = BigInt('0x' + PRIVATE_KEYS[index - 1]);
  const basePoint = G1.ProjectivePoint.BASE;
  const publicKey = basePoint.multiply(privateValue);
  return {
    index,
    privateShare: privateValue.toString(16),
    publicKeyRaw: publicKey
  };
}

export function generateKeys() {
  const NUM_NODES = 5;
  const shares = [];
  const publicKeys = [];

  for (let i = 1; i <= NUM_NODES; i++) {
    const { privateShare, publicKeyRaw } = generatePrivateShare(i);
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

  let jointPublicKey = G1.ProjectivePoint.ZERO;
  for (const pk of publicKeys) {
    const point = new G1.ProjectivePoint(
      BigInt('0x' + pk.publicKey.x),
      BigInt('0x' + pk.publicKey.y),
      BigInt('0x' + pk.publicKey.z)
    );
    jointPublicKey = jointPublicKey.add(point);
  }

  const jointAffine = jointPublicKey.toAffine();

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
