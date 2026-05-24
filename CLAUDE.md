# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Thesis project: a real-time **Distributed Key Generation (DKG) threshold payment system** using BLS12-381 cryptographic signatures. Five nodes collectively hold key shares; transactions above 1000 PHP require 3-of-5 nodes to sign before a verified QR code is generated.

## Commands

```bash
# Install all dependencies (run from repo root)
npm run install:all

# Development — runs server + client concurrently
npm run dev

# Server only (Node.js --watch, port 5001)
cd server && npm run dev

# Client only (Vite, port 5173)
cd client && npm run dev

# Production build
cd client && npm run build
npm start   # server only, no hot-reload
```

**Prerequisites:** Node.js 18+, MongoDB 8+ (`mongod --dbpath ./data/db`)

> **Port note:** The server runs on **5001**, not 5000. `vite.config.js` proxies `/api` and `/socket.io` to `http://localhost:5001`. The AGENTS.md and README say 5000 — trust the Vite config.

## Testing

```bash
# Functional/unit tests (Vitest, no server needed) — 35 tests, ~700ms
cd server && npm test          # run once
cd server && npm run test:watch  # watch mode

# Latency benchmark — requires server running on localhost:5001
cd server && npm run test:latency

# MITM / attack simulation — requires server running on localhost:5001
cd server && npm run test:mitm

# Race condition test — requires server running on localhost:5001
node server/test-race-condition.js
```

Test files live in `server/tests/`:
- `functional.test.js` — BLS12-381 crypto correctness (hash, sign, aggregate, verify)
- `latency-test.js` — End-to-end QR generation + payment verification latency (30 trials, outputs p50/p90/p95/p99)
- `mitm-test.js` — Attack simulations: replay, forged nonce, premature verify, amount tampering, signature forgery, cross-tx reuse

## Architecture

Monorepo with `client/` (React 18 + Vite + TailwindCSS) and `server/` (Node.js + Express + Socket.io + MongoDB).

### Communication

All real-time state flows over **Socket.io**, not REST. HTTP endpoints are minimal (`/health`, `/api/joint-public-key`). The Socket events are the API:

| Event | Direction | Purpose |
|-------|-----------|---------|
| `join_room` | C→S | Authenticate as node 1–5 or merchant (99) |
| `request_transaction` | C→S | Initiate payment |
| `submit_share` / `reject_share` | C→S | Node signs or declines |
| `verify_payment` | C→S | Merchant scans QR |
| `new_transaction`, `transaction_completed` | S→C | Broadcast state changes |
| `balance_update`, `occupied_nodes_update` | S→C | Real-time UI sync |

### Transaction Lifecycle

```
PENDING → COMPLETING → COMPLETED → PAID
                              ↘ EXPIRED (2 min QR TTL)
       ↘ CANCELLED / FAILED
```

- Amount < 1000 PHP: threshold = 1 (requester only)
- Amount ≥ 1000 PHP: threshold = 3 (requester + 2 others)
- Background job checks expiry every 10 seconds

### Cryptography (`server/config/keys.js`, `server/utils/cryptoUtils.js`)

- **Curve:** BLS12-381 (`@noble/curves`)
- **Order:** `0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n`
- **Key shares:** `share_i = (secret + i + i²) mod ORDER` for i = 1..5
- **Dev secret:** `0xABC123456789n` (hardcoded)
- Signature aggregation uses Lagrange interpolation
- All BLS field arithmetic uses `BigInt`; never use regular numbers for these values

### Race Condition Handling

`socketHandler.js` uses a `transactionLocks` Map to serialize concurrent `submit_share` calls on the same transaction. This is critical — do not remove or bypass it.

### MongoDB Collections

- `Transaction` — payments with signature shares and status
- `GroupBalance` — single doc (`_id: 'joint-account'`), starts at 1,000,000 PHP
- `AuditLog` — 12 event types, real-time broadcast to all clients

## Code Conventions

- **Plain JavaScript only** — no TypeScript, no `.ts`/`.tsx` files
- ES modules (`import`/`export`) throughout — always include `.js` extension in server imports
- Socket event names: `snake_case`
- React components: PascalCase `.jsx`, default exports, cleanup `socket.off` in `useEffect` return
- Tailwind custom classes: `card`, `btn-primary`, `badge`, `badge-success`, `badge-danger`

## Environment Variables

```
# server/.env
PORT=5001
MONGODB_URI=mongodb://localhost:27017/dkg_payment
CORS_ORIGIN=http://localhost:5173

# client/.env
VITE_API_URL=http://localhost:5001
```

Production is deployed to `https://thesis-qr.onrender.com/` via Vercel CI (`auto-deploy.yml` on push to `main`).
