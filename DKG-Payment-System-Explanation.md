# DKG Payment System - Comprehensive Explanation

This is a **Distributed Key Generation (DKG) Threshold Signature Payment System** using BLS12-381 cryptography.

---

## 1. Cryptographic Foundation

### Key Concept: Threshold Signatures

- Instead of one private key, there are **5 nodes** each holding a **share** of the joint private key
- To sign a transaction, a **threshold** number of nodes must contribute their signatures
- The signatures are **aggregated** into one valid signature that can be verified against the **joint public key**

### Key Generation (`server/config/keys.js`)

```javascript
// JOINT_SECRET = 0xABC123456789n (the actual secret key - not stored anywhere)
const JOINT_SECRET = 0xABC123456789n;

// Each node gets a share: share_i = secret + i + i² (mod ORDER)
function calculateShare(x) {
  return (JOINT_SECRET + x + x*x) % BLS12_381_ORDER;
}
```

- Node 1 gets share: `secret + 1 + 1 = secret + 2`
- Node 2 gets share: `secret + 2 + 4 = secret + 6`
- And so on...
- The joint public key is: `G1_BASE * JOINT_SECRET`

### Threshold Policy

- **Amount < 1000 PHP**: Requires **1 signature** (just the requester)
- **Amount ≥ 1000 PHP**: Requires **3 signatures** (requester + 2 others)

---

## 2. Server Files

### `server/server.js` - Entry Point

- Creates Express HTTP server
- Creates Socket.io server with CORS configuration
- Connects to MongoDB
- Exposes `/health` and `/api/joint-public-key` endpoints
- Initializes group balance on startup

### `server/config/keys.js` - Key Configuration

- Generates private shares for 5 nodes
- Computes joint public key
- Exports: `PRIVATE_SHARES`, `JOINT_PUBLIC_KEY`, `NODE_PUBLIC_KEYS`, `THRESHOLD`

### `server/models/Transaction.js` - Transaction Schema

```javascript
{
  nonce: String,          // Unique transaction ID
  amount: Number,
  requesterId: Number,    // Node that initiated
  status: 'PENDING'|'COMPLETED'|'PAID'|'EXPIRED'|'CANCELLED'|'FAILED',
  threshold: Number,      // 1 or 3
  collectedSignatures: [{ nodeId, signature: {x, y, z}, timestamp }],
  aggregatedSignature: { x, y, z },  // Final signature
  qrData: { amount, timestamp, nonce, signature },
  expiresAt: Date,        // 2 minutes from creation
  qrExpiresAt: Date,      // 2 minutes from completion
  rejectedBy: [String]    // Nodes that rejected
}
```

### `server/models/GroupBalance.js` - Balance Schema

- Single document with `_id: 'joint-account'`
- Tracks: `balance` (starts at 1,000,000 PHP), `currency`, `lastUpdated`

### `server/utils/cryptoUtils.js` - Cryptographic Functions

1. **hashMessage(message)**: SHA-256 hash → reduces mod BLS12-381 ORDER → returns G1 point
2. **signMessage(message, privateShareHex)**: `hash * privateShare` → signature point
3. **aggregateSignatures(signatures, signers)**: Uses **Lagrange coefficients** to combine signatures
   - Each signature is weighted by: `Lagrange(nodeId, allSigners)`
   - This mathematically reconstructs the full signature
4. **verifySignature(publicKey, message, signature)**: Bilinear pairing verification
   - `e(sig, G2) == e(hash(message), PK_G2)`

### `server/controllers/socketHandler.js` - Core Logic

This is the brain. Key functions:

| Event | Description |
|-------|-------------|
| `join_room` | Node logs in, checks if already occupied |
| `request_transaction` | Buyer initiates payment |
| `submit_share` | Node signs a transaction |
| `reject_share` | Node rejects a transaction |
| `verify_payment` | Merchant verifies QR |
| `cancel_transaction` | Requester cancels pending tx |
| `check_transaction` | Query transaction status |

**Key State Management:**
- `activeNodes`: Map of connected node IDs → sockets
- `pendingTransactions`: Map of nonce → transaction (in-memory cache)

---

## 3. Client Files

### `client/src/context/SocketContext.jsx`

- Creates single Socket.io connection
- Provides `socket` and `isConnected` to all components
- Handles auto-reconnection

### `client/src/components/Login.jsx`

- User selects role: Buyer Node 1-5 or Merchant
- Shows occupied nodes to prevent duplicate login
- Sends `join_room` with nodeId and role

### `client/src/components/BuyerDashboard.jsx`

**Three Main Sections:**

1. **Initiate Payment** - Enter amount → `request_transaction`
2. **My Transactions** - Shows your created transactions with QR codes
3. **Pending Approvals** - Shows transactions from others that need your signature

**Key Interactions:**
- `handlePay()` → emits `request_transaction`
- `handleApprove()` → signs message locally, emits `submit_share`
- `handleReject()` → emits `reject_share`
- `handleCancel()` → emits `cancel_transaction`

**Auto-signing**: When buyer creates transaction, server immediately signs with requester's private share

### `client/src/components/MerchantDashboard.jsx`

- Uses `html5-qrcode` library for camera scanning
- Scans QR → parses JSON → emits `verify_payment`
- Server performs full verification:
  1. Transaction exists?
  2. Not from previous session?
  3. Not expired?
  4. Not already paid?
  5. Status is COMPLETED?
- If valid: marks as PAID, deducts balance

### `client/src/utils/cryptoUtils.js`

- Mirrors server crypto functions for client-side signing
- `getPrivateShareForNode(nodeId)` - Returns the node's private share (hardcoded)
- `signMessage()`, `hashMessage()` - Same as server

---

## 4. Complete End-to-End Flow

### Scenario: Buyer Node 1 pays ₱500 (threshold = 1)

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Buyer     │     │   Server    │     │   Other     │
│  Node 1     │     │             │     │   Nodes     │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       │  request_transaction │               │
       │ ──────────────────> │               │
       │                   │                   │
       │                   │ Auto-signs (Node 1)│
       │                   │ threshold=1 met   │
       │                   │                   │
       │ transaction_initiated (COMPLETED)    │
       │ <──────────────────│                   │
       │                   │                   │
       │              transaction_completed    │
       │                   │ ──────────────────>│
       │                   │                   │
       │ QR Generated      │                   │
       │                   │                   │
       ▼                   ▼                   ▼
```

**Step-by-step:**

1. **Buyer enters ₱500 → clicks Pay**
2. **Server receives `request_transaction`**
   - Checks balance (₱1,000,000 > ₱500 ✓)
   - Determines threshold (₱500 < 1000 → threshold = 1)
   - Auto-signs with Node 1's private share
   - Since threshold=1 is met immediately:
     - Aggregates signatures (just Node 1's)
     - Creates QR data with aggregated signature
     - Sets status to COMPLETED
3. **Server broadcasts `transaction_completed`**
4. **Buyer sees QR code modal** with 2-minute countdown
5. **Buyer shows QR to Merchant**
6. **Merchant scans → clicks Verify**
7. **Server verifies:**
   - Transaction exists ✓
   - Not from previous session ✓
   - Not expired ✓
   - Not already paid ✓
   - Status = COMPLETED ✓
8. **Server marks as PAID, deducts ₱500**
9. **All nodes receive `balance_update`**

---

### Scenario: Buyer Node 1 pays ₱5000 (threshold = 3)

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Buyer     │     │   Server    │     │   Other     │
│  Node 1     │     │             │     │   Nodes     │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       │  request_transaction (₱5000)          │
       │ ──────────────────> │               │
       │                   │                   │
       │                   │ Auto-signs (1/3) │
       │                   │ Broadcasts       │
       │                   │ new_transaction │
       │                   │ ──────────────> │
       │                   │                   │
       │  transaction_initiated (PENDING, 1/3)│
       │ <──────────────────│                   │
       │                   │                   │
       │            ┌──────▼──────┐            │
       │            │ Nodes 2,3   │            │
       │            │ see pending │            │
       │            │ approval    │            │
       │            └──────┬──────┘            │
       │                   │                   │
       │                   │  submit_share    │
       │                   │ <─────────────── │
       │                   │                   │
       │                   │  submit_share    │
       │                   │ <─────────────── │
       │                   │                   │
       │                   │ Aggregates (3/3) │
       │                   │ COMPLETES        │
       │                   │                   │
       │ transaction_completed (QR ready)      │
       │ <──────────────────│                   │
       │                   │                   │
       │              transaction_completed    │
       │                   │ ──────────────────>│
       ▼                   ▼                   ▼
```

**Step-by-step:**

1. **Buyer initiates ₱5000 transaction**
2. **Server**: threshold=3, auto-signs (1/3), broadcasts `new_transaction`
3. **Nodes 2, 3, 4, 5** see pending approval in their UI
4. **Node 2 clicks Approve** → signs → `submit_share` → server has (2/3)
5. **Node 3 clicks Approve** → signs → `submit_share` → server has (3/3) ✓
6. **Server**: aggregates 3 signatures using Lagrange → creates QR
7. **All nodes receive `transaction_completed`**
8. **Buyer shows QR to Merchant** → Merchant verifies → payment processed

---

## 5. Security Features

1. **Replay Protection**: Transaction marked PAID after verification prevents reuse
2. **Session Validation**: Rejects QR codes from previous server restarts
3. **Expiration**: 2-minute window for both transaction and QR
4. **Occupied Nodes**: Prevents same node logging in twice
5. **Replay Attack Prevention**: nonce is UUID (unique per transaction)
6. **Bilinear Pairing Verification**: Cryptographically proves signature validity

---

## 6. File Structure Summary

```
thesis-qr/
├── server/
│   ├── server.js              # Express + Socket.io entry point
│   ├── config/
│   │   └── keys.js            # DKG key generation & configuration
│   ├── controllers/
│   │   └── socketHandler.js   # All socket event handlers (main logic)
│   ├── models/
│   │   ├── Transaction.js     # MongoDB schema for transactions
│   │   └── GroupBalance.js    # MongoDB schema for joint account
│   └── utils/
│       └── cryptoUtils.js     # BLS12-381 cryptographic functions
│
└── client/
    ├── src/
    │   ├── main.jsx            # React entry point
    │   ├── App.jsx             # Main app with routing logic
    │   ├── context/
    │   │   └── SocketContext.jsx  # Socket.io provider
    │   ├── components/
    │   │   ├── Login.jsx           # Node selection & login
    │   │   ├── BuyerDashboard.jsx  # Payment initiation & approval
    │   │   └── MerchantDashboard.jsx  # QR scanning & verification
    │   └── utils/
    │       └── cryptoUtils.js     # Client-side signing functions
```

---

## 7. How to Study This System

**Recommended Learning Path:**

1. **Start with crypto** (`server/utils/cryptoUtils.js`):
   - Understand BLS12-381 curve
   - Understand hash-to-point
   - Understand signature aggregation via Lagrange

2. **Key generation** (`server/config/keys.js`):
   - See how shares are computed
   - See how joint public key is derived

3. **Transaction flow** (`server/controllers/socketHandler.js`):
   - Follow `request_transaction` → `submit_share` → `verify_payment`
   - Notice state transitions (PENDING → COMPLETED → PAID)

4. **Client interaction** (`BuyerDashboard.jsx`):
   - See how socket events drive UI state
   - See how local signing works

5. **Merchant verification** (`MerchantDashboard.jsx`):
   - See camera scanning integration
   - See verification flow

---

This system demonstrates **threshold signatures** - a powerful cryptographic primitive where multiple parties must cooperate to produce a valid signature, but no single party ever has the full private key.