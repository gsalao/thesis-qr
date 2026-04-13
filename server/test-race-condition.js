import { io } from 'socket.io-client';
import { signMessage } from './utils/cryptoUtils.js';
import { PRIVATE_SHARES } from './config/keys.js';

const URL = 'http://localhost:5001';
console.log(`Connecting to ${URL}...`);

const socket = io(URL);

socket.on('connect', () => {
  console.log('Connected to server. Initiating a new transaction...');
  socket.emit('request_transaction', { amount: 5000, requesterId: 1 });
});

socket.on('transaction_initiated', async (data) => {
  if (data.status === 'COMPLETED') {
    console.log('Transaction auto-completed somehow, exiting...');
    process.exit(0);
  }

  const { nonce, amount, timestamp } = data;
  console.log(`\n✅ Transaction initiated successfully. Nonce received: ${nonce}`);
  console.log('Now immediately blasting the server with simultaneous approvals with REAL signatures...');

  const spamRequests = [];
  const messageToSign = { amount, timestamp, nonce };

  for (let i = 2; i <= 5; i++) {
    spamRequests.push(new Promise((resolve) => {
      console.log(`Node ${i} is approving...`);
      
      const privateShare = PRIVATE_SHARES[i];
      const realSignature = signMessage(messageToSign, privateShare);

      socket.emit('submit_share', {
        nonce: nonce,
        nodeId: i,
        signature: realSignature
      });
      resolve();
    }));
  }

  await Promise.all(spamRequests);
  console.log('\nAll approvals blasted simultaneously! Check your server console.');
  console.log('If the lock is working, the server logs should process them sequentially.');
  console.log('Wait a few seconds to let them log, then press Ctrl+C to exit.\n');
});

socket.on('error', (err) => {
  console.error('Socket received an error:', err);
});

socket.on('disconnect', () => {
  console.log('Socket disconnected.');
});
