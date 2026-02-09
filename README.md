# DKG Threshold Payment System

A Distributed Key Generation (DKG) Threshold Payment System using MERN Stack + BLS12-381 cryptography.

## Overview

This system enables a group of users (Joint Account) to approve transactions based on threshold rules:
- **Amount < 1000 PHP**: Requires 1 signature (t=1)
- **Amount ≥ 1000 PHP**: Requires 3 signatures (t=3)

The result is a QR code presented to a Merchant for verification.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENT (React)                        │
│  ┌──────────────┐  ┌──────────────────┐  ┌───────────────┐ │
│  │    Login     │  │  BuyerDashboard  │  │ MerchantDashboard│
│  │  (Role Sim)  │  │  (Pay/Approve)   │  │  (Verify)     │ │
│  └──────────────┘  └──────────────────┘  └───────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                    Socket.io (Real-time)
                              │
┌─────────────────────────────────────────────────────────────┐
│                      SERVER (Node.js)                        │
│  ┌──────────────┐  ┌──────────────────┐  ┌───────────────┐ │
│  │  Express.js  │  │   Socket.io      │  │   MongoDB     │ │
│  │  (REST API)  │  │  (Events)        │  │   (Storage)   │ │
│  └──────────────┘  └──────────────────┘  └───────────────┘ │
│                              │                               │
│                    BLS12-381 Crypto Utils                    │
│              (Sign/Aggregate/Verify)                         │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

- Node.js 18+
- MongoDB 6+
- npm or yarn

## Installation

1. **Clone the repository**
   ```bash
   cd dkg-threshold-payment-system
   ```

2. **Install all dependencies**
   ```bash
   npm run install:all
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your MongoDB URI and port
   ```

4. **OPTIONAL FOR DEVELOPMENT: Install MongoDB Community Server**
   - MacOS
      ```bash
      brew tap mongodb/brew
      brew update
      brew install mongodb-community@8.0
      ```
   - Linux
      ```bash
      sudo apt-get install gnupg curl
      curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | \
      sudo gpg -o /usr/share/keyrings/mongodb-server-8.0.gpg \
      --dearmor
      echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list
      sudo apt-get update
      sudo apt-get install -y mongodb-org
      ```
## Running the Application

### Start MongoDB
```bash
mongod --dbpath ./data/db
```

### Start both server and client
```bash
npm run dev
```

### Or start individually:
```bash
# Terminal 1 - Server
cd server && npm run dev

# Terminal 2 - Client
cd client && npm run dev
```

## Usage

### 1. Start the Application
- Server runs on `http://localhost:5000`
- Client runs on `http://localhost:5173`

### 2. Login as Different Nodes
Open multiple browser tabs and login as:
- **Tab 1**: Buyer Node 1 (Initiator)
- **Tab 2**: Buyer Node 2 (Approver)
- **Tab 3**: Buyer Node 3 (Approver)
- **Tab 4**: Merchant (Verifier)

### 3. Test a Transaction

**Low Value (< 1000 PHP):**
1. Node 1 logs in, enters "500", clicks Pay
2. QR code is immediately generated
3. Merchant scans/verifies

**High Value (≥ 1000 PHP):**
1. Node 1 logs in, enters "5000", clicks Pay
2. Nodes 2 and 3 see pending approval
3. Nodes 2 and 3 click Approve
4. Once 3 signatures collected, QR code is generated
5. Merchant scans/verifies

## Project Structure

```
dkg-threshold-payment-system/
├── server/
│   ├── config/
│   │   └── keys.js              # Runtime BLS12-381 key generation
│   ├── controllers/
│   │   └── socketHandler.js     # Socket events & threshold logic
│   ├── models/
│   │   └── Transaction.js       # MongoDB schema
│   ├── utils/
│   │   └── cryptoUtils.js       # BLS12-381 operations
│   ├── server.js                # Express + Socket.io + MongoDB
│   └── package.json
├── client/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Login.jsx        # Role selection dropdown
│   │   │   ├── BuyerDashboard.jsx
│   │   │   └── MerchantDashboard.jsx
│   │   ├── context/
│   │   │   └── SocketContext.jsx
│   │   ├── utils/
│   │   │   └── cryptoUtils.js
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── tailwind.config.js
│   └── package.json
├── .env.example
├── package.json
└── README.md
```

## Cryptography Details

- **Curve**: BLS12-381 (Ethereum standard)
- **Key Generation**: 5 private shares generated at runtime
- **Joint Public Key**: Sum of individual public keys
- **Threshold Signing**: Lagrange interpolation for signature aggregation
- **Verification**: Pairing-based verification

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/api/joint-public-key` | Get the joint public key |

## Socket Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `join_room` | Client → Server | Join as a node |
| `request_transaction` | Client → Server | Initiate payment |
| `submit_share` | Client → Server | Submit partial signature |
| `new_transaction` | Server → Client | Broadcast new request |
| `signature_received` | Server → Client | Notify signature collected |
| `transaction_completed` | Server → Client | QR code ready |

## License

MIT
