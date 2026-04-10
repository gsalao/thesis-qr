# AGENTS.md - Thesis QR Code DKG Payment System

## Project Overview

This is a monorepo containing a real-time DKG (Distributed Key Generation) payment system with:
- **Client**: React 18 + Vite + TailwindCSS (port 5173)
- **Server**: Node.js + Express + Socket.io + MongoDB (port 5000)

## Build/Lint/Test Commands

### Installation
```bash
npm run install:all        # Install all dependencies (server + client)
```

### Development
```bash
npm run dev                # Run both client and server concurrently
cd server && npm run dev   # Server only with --watch flag
cd client && npm run dev   # Client only on port 5173
```

### Production
```bash
cd client && npm run build # Build client (outputs to client/dist/)
npm start                  # Start server only
```

### Prerequisites
- Node.js 18+
- MongoDB 6+ (run `mongod --dbpath ./data/db`)

**Note**: No test framework is configured. The project has no automated tests.

## Code Style Guidelines

### File Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| React Components | PascalCase + .jsx | `Login.jsx`, `BuyerDashboard.jsx` |
| JavaScript Modules | camelCase or kebab-case | `socketHandler.js`, `cryptoUtils.js` |
| Context/Hooks | camelCase + Context suffix | `SocketContext.jsx` |
| Models | PascalCase | `Transaction.js`, `GroupBalance.js` |

### Import Conventions

**Server (ES Modules with .js extension):**
```javascript
import express from 'express';
import mongoose from 'mongoose';
import { handleSocketConnection } from './controllers/socketHandler.js';
import { JOINT_PUBLIC_KEY } from './config/keys.js';
```

**Client (React):**
```javascript
import { useState, useEffect } from 'react';
import { useSocket } from '../context/SocketContext';
```

**Import ordering in React files:**
1. React imports
2. External libraries
3. Internal imports (context, utils, components)

### React Component Patterns

**Default exports preferred:**
```javascript
export default function ComponentName({ prop1, prop2 }) {
  const [state, setState] = useState(initialValue);
  const { socket } = useSocket();

  useEffect(() => {
    if (!socket) return;
    socket.on('event_name', handleEvent);
    return () => socket.off('event_name', handleEvent);
  }, [socket]);

  // ... component logic
}
```

**Use useCallback for event handlers passed to children:**
```javascript
const showNotification = useCallback((message, type = 'info') => {
  setNotification({ message, type });
  setTimeout(() => setNotification(null), 5000);
}, []);
```

### Socket.io Event Patterns

**Event naming convention:** snake_case with underscores

| Direction | Pattern | Example |
|-----------|---------|---------|
| Client → Server | `emit('event_name', data)` | `socket.emit('join_room', { nodeId, role })` |
| Server → Client | `socket.emit('event_name', data)` | `io.to(socketId).emit('room_joined', data)` |

**Socket events used in this project:**
- `join_room`, `leave_room` - Authentication
- `request_transaction`, `cancel_transaction` - Transaction lifecycle
- `submit_share`, `reject_share` - Signature collection
- `verify_payment` - Merchant verification
- `new_transaction`, `transaction_completed`, `transaction_expired` - Broadcasts
- `signature_received`, `share_submitted` - Responses
- `error`, `balance_update`, `occupied_nodes_update` - Notifications

### Error Handling

**Server-side (Socket.io):**
```javascript
try {
  // async operations
} catch (err) {
  console.error('Error description:', err);
  socket.emit('error', { message: 'User-friendly error message' });
}
```

**Client-side:**
```javascript
socket.on('error', (data) => {
  showNotification(data.message, 'error');
});
```

### MongoDB/Mongoose Patterns

**Schema definitions:**
```javascript
const TransactionSchema = new mongoose.Schema({
  field: { type: Type, required: true },
  status: {
    type: String,
    enum: ['PENDING', 'COMPLETED', 'FAILED', 'EXPIRED', 'PAID', 'CANCELLED'],
    default: 'PENDING'
  }
});

TransactionSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

export default mongoose.model('Transaction', TransactionSchema);
```

### BigInt Usage (BLS Cryptography)

When working with BLS12-381 operations:
```javascript
const BLS12_381_ORDER = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;
const value = BigInt('0x' + hexString);
```

### CSS/Tailwind Patterns

**Use custom utility classes defined in index.css:**
```html
<div className="card w-full max-w-md">
  <button className="btn-primary w-full">Submit</button>
  <span className="badge badge-success">Active</span>
  <span className="badge badge-danger">Error</span>
</div>
```

**Custom colors available:**
- `primary-*` (blue palette)
- `success-*` (green palette)
- `danger-*` (red palette)

### TypeScript

This project uses **plain JavaScript**, not TypeScript. Do not add .ts/.tsx files.

### Logging

**Server logging:**
```javascript
console.log('Server running on port', PORT);
console.error('MongoDB connection error:', err);
```

### Constants

**Policy thresholds:**
```javascript
threshold.low = 1;    // Amount < 1000 PHP
threshold.high = 3;   // Amount >= 1000 PHP
```

## Environment Variables

Create `.env` files in server/ and client/ directories:

**server/.env:**
```
PORT=5000
MONGODB_URI=mongodb://localhost:27017/dkg_payment
CORS_ORIGIN=http://localhost:5173
```

**client/.env:**
```
VITE_API_URL=http://localhost:5000
```

## Key Cryptographic Constants

- BLS12-381 curve order: `0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n`
- Joint secret (development): `0xABC123456789n`
- Joint public key: Generated in `server/config/keys.js`
