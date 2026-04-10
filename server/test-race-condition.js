import { io } from 'socket.io-client';

const URL = 'http://localhost:5001';
console.log(`Connecting to ${URL}...`);

const socket = io(URL);

socket.on('connect', () => {
  console.log('Connected to server. Initiating a new transaction...');

  // Step 1: Create a real transaction to give us a valid 'nonce'
  // Threshold will be low (<1000 amount typically)
  socket.emit('request_transaction', { amount: 5000, requesterId: 1 });
});

socket.on('transaction_initiated', async (data) => {
  if (data.status === 'COMPLETED') {
    console.log('Transaction auto-completed somehow, exiting...');
    process.exit(0);
  }

  const { nonce } = data;
  console.log(`\n✅ Transaction initiated successfully. Nonce received: ${nonce}`);
  console.log('Now immediately blasting the server with simultaneous approvals from multiple fake nodes...');

  // Step 2: Blast `submit_share` exactly at the same time to force a race condition
  const spamRequests = [];

  for (let i = 2; i <= 5; i++) {
    spamRequests.push(new Promise((resolve) => {
      console.log(`Node ${i} is approving...`);
      socket.emit('submit_share', {
        nonce: nonce,
        nodeId: i,
        // using fake signatures to trigger parallel saves. 
        // the aggregation might fail with 'Failed to aggregate signatures', 
        // but that's fine, we are testing the database/lock.
        signature: { x: '1', y: '2' }
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
