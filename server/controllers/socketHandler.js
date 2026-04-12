import { v4 as uuidv4 } from 'uuid';
import Transaction from '../models/Transaction.js';
import GroupBalance from '../models/GroupBalance.js';
import { THRESHOLD, JOINT_PUBLIC_KEY, PRIVATE_SHARES } from '../config/keys.js';
import { aggregateSignatures, verifySignature, signMessage } from '../utils/cryptoUtils.js';

const activeNodes = new Map();
const pendingTransactions = new Map();
const SERVER_START_TIME = new Date();
let expirationCheckerStarted = false;

const transactionLocks = new Map();
async function withLock(nonce, fn) {
  const prior = transactionLocks.get(nonce) || Promise.resolve();
  const next = prior.catch(() => {}).then(fn);
  transactionLocks.set(nonce, next);
  try {
    return await next;
  } finally {
    if (transactionLocks.get(nonce) === next) transactionLocks.delete(nonce);
  }
}

function startExpirationChecker(io) {
  if (expirationCheckerStarted) return;
  expirationCheckerStarted = true;
  
  console.log('Starting transaction expiration checker...');
  setInterval(async () => {
    try {
      const now = new Date();
      // Find pending and completed transactions that have passed their expiresAt
      const expiredTxs = await Transaction.find({
        status: { $in: ['PENDING', 'COMPLETING', 'COMPLETED'] },
        expiresAt: { $lt: now }
      });

      for (const tx of expiredTxs) {
        tx.status = 'EXPIRED';
        await tx.save();
        
        // Remove from memory if present
        pendingTransactions.delete(tx.nonce);

        // Broadcast to all nodes to clear their UI
        io.emit('transaction_expired', {
          nonce: tx.nonce,
          requesterId: tx.requesterId
        });
        
        console.log(`Transaction ${tx.nonce} expired and broadcasted.`);
      }
    } catch (err) {
      console.error('Error in expiration checker:', err);
    }
  }, 10000); // Check every 10 seconds
}

function getThresholdForAmount(amount) {
  return amount >= 1000 ? THRESHOLD.high : THRESHOLD.low;
}

function broadcastToNodes(io, event, data, excludeNodeId = null) {
  activeNodes.forEach((socket, nodeId) => {
    if (nodeId !== excludeNodeId && socket.connected) {
      socket.emit(event, data);
    }
  });
}

function sendToNode(io, nodeId, event, data) {
  const socket = activeNodes.get(nodeId);
  if (socket && socket.connected) {
    socket.emit(event, data);
  }
}

async function getGroupBalance() {
  let balance = await GroupBalance.findById('joint-account');
  if (!balance) {
    balance = new GroupBalance({ _id: 'joint-account', balance: 1000000, currency: 'PHP' });
    await balance.save();
  }
  return balance;
}

async function deductBalance(amount) {
  const result = await GroupBalance.findOneAndUpdate(
    { _id: 'joint-account' },
    { $inc: { balance: -amount }, $set: { lastUpdated: new Date() } },
    { new: true, upsert: false }
  );
  if (!result) {
    throw new Error('Joint account not found for balance deduction');
  }
  return result.balance;
}

export async function initializeBalance() {
  let balance = await GroupBalance.findById('joint-account');
  if (!balance) {
    balance = new GroupBalance({ _id: 'joint-account', balance: 1000000, currency: 'PHP' });
  } else {
    balance.balance = 1000000;
    balance.lastUpdated = new Date();
  }
  await balance.save();
  console.log('Group balance reset/initialized to: ₱1,000,000');
}

function broadcastOccupiedNodes(io) {
  const occupiedIds = Array.from(activeNodes.keys());
  io.emit('occupied_nodes_update', occupiedIds);
}

export function handleSocketConnection(io, socket) {
  console.log(`Socket connected: ${socket.id}`);
  
  // Initialize the expiration job once
  startExpirationChecker(io);

  // Send current occupied nodes to the newly connected socket
  socket.emit('occupied_nodes_update', Array.from(activeNodes.keys()));

  socket.on('join_room', async (data) => {
    const { nodeId, role } = data;

    // CHECK IF NODE IS ALREADY OCCUPIED
    if (activeNodes.has(nodeId)) {
      console.log(`Node ${nodeId} is already occupied. Denying join.`);
      socket.emit('room_joined', {
        success: false,
        message: `Node ${nodeId} (${role}) is already logged in on another device/tab.`
      });
      return;
    }

    activeNodes.set(nodeId, socket);
    socket.nodeId = nodeId;
    socket.role = role;

    console.log(`Node ${nodeId} (${role}) joined`);

    broadcastOccupiedNodes(io);

    const balance = await getGroupBalance();

    socket.emit('room_joined', {
      success: true,
      nodeId,
      role,
      jointPublicKey: JOINT_PUBLIC_KEY,
      groupBalance: balance.balance
    });

    const pending = await Transaction.find({ status: 'PENDING' }).sort({ createdAt: -1 });
    socket.emit('pending_transactions', pending.map(tx => ({
      nonce: tx.nonce,
      amount: tx.amount,
      requesterId: tx.requesterId,
      collectedCount: tx.collectedSignatures.length,
      threshold: tx.threshold,
      timestamp: tx.createdAt.getTime(),
      expiresAt: tx.expiresAt ? tx.expiresAt.toISOString() : null,
      rejectedBy: tx.rejectedBy || []
    })));

    // Send the user's COMPLETED transactions so QR codes are restored on reconnect
    const myCompleted = await Transaction.find({
      requesterId: nodeId,
      status: { $in: ['COMPLETED', 'PAID'] }
    }).sort({ createdAt: -1 });

    if (myCompleted.length > 0) {
      socket.emit('my_completed_transactions', myCompleted.map(tx => ({
        nonce: tx.nonce,
        amount: tx.amount,
        requesterId: tx.requesterId,
        status: tx.status,
        threshold: tx.threshold,
        collectedCount: tx.collectedSignatures.length,
        signers: tx.collectedSignatures.map(s => s.nodeId),
        qrData: tx.qrData,
        expiresAt: tx.expiresAt ? tx.expiresAt.toISOString() : null,
        qrExpiresAt: tx.qrExpiresAt ? tx.qrExpiresAt.toISOString() : null,
        timestamp: tx.createdAt.getTime()
      })));
    }
  });

  socket.on('leave_room', () => {
    const nodeId = socket.nodeId;
    if (nodeId) {
      activeNodes.delete(nodeId);
      delete socket.nodeId;
      delete socket.role;
      console.log(`Node ${nodeId} left the room (logout)`);
      broadcastOccupiedNodes(io);
    }
  });

  socket.on('get_balance', async () => {
    const balance = await getGroupBalance();
    socket.emit('balance_update', { balance: balance.balance });
  });

  socket.on('request_transaction', async (data) => {
    const { amount, requesterId } = data;
    const balance = await getGroupBalance();

    if (amount > balance.balance) {
      socket.emit('error', { message: 'Insufficient funds in joint account.' });
      return;
    }

    const nonce = uuidv4();
    const threshold = getThresholdForAmount(amount);
    const timestamp = Date.now();

    const transaction = new Transaction({
      nonce,
      amount,
      requesterId,
      status: 'PENDING',
      threshold,
      createdAt: new Date(timestamp),
      expiresAt: new Date(Date.now() + 2 * 60 * 1000), // 2 Minutes Expiry
      collectedSignatures: []
    });

    // Automatically add requester's signature
    const privateShare = PRIVATE_SHARES[requesterId];
    if (privateShare) {
      const messageToSign = { amount, timestamp, nonce };
      const signature = signMessage(messageToSign, privateShare);
      transaction.collectedSignatures.push({
        nodeId: requesterId,
        signature,
        timestamp: new Date(timestamp)
      });
      console.log(`Auto-signed transaction ${nonce} for requester ${requesterId}`);
    }

    if (transaction.collectedSignatures.length >= threshold) {
      try {
        const signers = transaction.collectedSignatures.map(s => s.nodeId);
        const signatures = transaction.collectedSignatures.map(s => s.signature);
        const aggregated = aggregateSignatures(signatures, signers);
        
        transaction.status = 'COMPLETED';
        transaction.aggregatedSignature = aggregated;
        transaction.qrData = { amount, timestamp, nonce, signature: aggregated };
        transaction.qrExpiresAt = new Date(Date.now() + 2 * 60 * 1000);
        await transaction.save();

        socket.emit('transaction_initiated', {
          success: true,
          nonce,
          amount,
          threshold,
          status: 'COMPLETED',
          expiresAt: transaction.expiresAt.toISOString(),
          qrExpiresAt: transaction.qrExpiresAt.toISOString(),
          qrData: transaction.qrData,
          signers,
          message: 'Transaction completed immediately (Threshold met)'
        });

        broadcastToNodes(io, 'transaction_completed', {
          nonce,
          amount,
          qrData: transaction.qrData,
          signers,
          isForRequester: false
        }, requesterId);

        return;
      } catch (error) {
        console.error('Auto-aggregation error:', error);
      }
    }

    await transaction.save();
    pendingTransactions.set(nonce, transaction);

    console.log(`Transaction requested: ${nonce} (Amount: ${amount}, Threshold: ${threshold})`);

    broadcastToNodes(io, 'new_transaction', {
      nonce,
      amount,
      requesterId,
      threshold,
      timestamp,
      expiresAt: transaction.expiresAt.toISOString(),
      collectedCount: transaction.collectedSignatures.length
    }, requesterId);

    socket.emit('transaction_initiated', {
      success: true,
      nonce,
      amount,
      threshold,
      status: 'PENDING',
      expiresAt: transaction.expiresAt.toISOString(),
      collectedCount: transaction.collectedSignatures.length,
      message: `Transaction initiated. Requires ${threshold} signatures (1/${threshold} collected)`
    });
  });

  socket.on('submit_share', async (data) => {
    const { nonce, nodeId, signature } = data;
    try {
      await withLock(nonce, async () => {
        console.log(`submit_share received from Node ${nodeId} for nonce ${nonce}`);

        // STEP 1: Atomic push — only succeeds if:
        //   - the transaction exists with this nonce
        //   - status is still PENDING
        //   - this nodeId hasn't signed yet ($ne guard)
        //   - the transaction hasn't expired
        const updated = await Transaction.findOneAndUpdate(
          {
            nonce,
            status: 'PENDING',
            'collectedSignatures.nodeId': { $ne: nodeId },
            expiresAt: { $gt: new Date() }
          },
          {
            $push: { collectedSignatures: { nodeId, signature, timestamp: new Date() } },
            $set: { updatedAt: new Date() }
          },
          { new: true }
        );

        // If the atomic push returned null, figure out why and inform the caller
        if (!updated) {
          const existing = await Transaction.findOne({ nonce });
          if (!existing) {
            socket.emit('error', { message: 'Transaction not found' });
          } else if (existing.status === 'COMPLETED' || existing.status === 'COMPLETING') {
            socket.emit('share_submitted', { success: true, alreadyCompleted: true });
          } else if (existing.expiresAt && new Date() > existing.expiresAt) {
            socket.emit('share_rejected', { nonce, message: 'Transaction has expired' });
          } else if (existing.collectedSignatures.some(s => s.nodeId === nodeId)) {
            socket.emit('error', { message: 'Node already signed this transaction' });
          } else {
            socket.emit('error', { message: `Cannot sign transaction with status: ${existing.status}` });
          }
          return;
        }

        const requiredThreshold = updated.threshold;
        const currentCount = updated.collectedSignatures.length;

        console.log(`Signature received from Node ${nodeId} for ${nonce} (${currentCount}/${requiredThreshold})`);

        // Broadcast signature progress to all nodes
        broadcastToNodes(io, 'signature_received', {
          nonce,
          nodeId,
          collectedCount: currentCount,
          threshold: requiredThreshold
        });

        if (currentCount >= requiredThreshold) {
          // STEP 2: Atomically claim the "completer" role.
          // Only one node can transition PENDING → COMPLETING.
          const claimed = await Transaction.findOneAndUpdate(
            { nonce, status: 'PENDING' },
            { $set: { status: 'COMPLETING' } },
            { new: true }
          );

          if (!claimed) {
            // Another concurrent request already claimed it
            console.log(`Node ${nodeId}: threshold met but another node is already completing ${nonce}`);
            socket.emit('share_submitted', { success: true, alreadyCompleted: true });
            return;
          }

          // This node won the race — proceed with aggregation
          try {
            const signers = claimed.collectedSignatures.map(s => s.nodeId);
            const signatures = claimed.collectedSignatures.map(s => s.signature);
            console.log(`Aggregating ${signatures.length} signatures from signers: ${signers}`);

            const aggregated = aggregateSignatures(signatures, signers);
            console.log(`Aggregation successful:`, aggregated);

            const qrData = {
              amount: claimed.amount,
              timestamp: claimed.createdAt.getTime(),
              nonce: claimed.nonce,
              signature: aggregated
            };

            // Finalize: COMPLETING → COMPLETED with all aggregation results
            await Transaction.updateOne(
              { nonce, status: 'COMPLETING' },
              {
                $set: {
                  status: 'COMPLETED',
                  aggregatedSignature: aggregated,
                  qrData: qrData,
                  qrExpiresAt: new Date(Date.now() + 2 * 60 * 1000),
                  updatedAt: new Date()
                }
              }
            );

            // Remove from pending map if present
            pendingTransactions.delete(nonce);

            const messageToVerify = {
              amount: claimed.amount,
              timestamp: claimed.createdAt.getTime(),
              nonce: claimed.nonce
            };

            const isValid = verifySignature(JOINT_PUBLIC_KEY, messageToVerify, aggregated);
            console.log(`Transaction ${nonce} completed. Verification: ${isValid}`);

            const completionData = {
              success: true,
              nonce: claimed.nonce,
              amount: claimed.amount,
              expiresAt: claimed.expiresAt.toISOString(),
              qrExpiresAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
              qrData,
              signers: signers,
              verificationResult: isValid
            };

            broadcastToNodes(io, 'transaction_completed', {
              ...completionData,
              isForRequester: false
            }, claimed.requesterId);

            sendToNode(io, claimed.requesterId, 'transaction_completed', {
              ...completionData,
              isForRequester: true,
              status: 'COMPLETED'
            });

            socket.emit('share_submitted', {
              success: true,
              completed: true,
              qrData
            });

          } catch (error) {
            console.error('Aggregation error:', error);
            // Roll back: COMPLETING → FAILED
            await Transaction.updateOne(
              { nonce, status: 'COMPLETING' },
              { $set: { status: 'FAILED', updatedAt: new Date() } }
            );
            pendingTransactions.delete(nonce);

            socket.emit('error', { message: 'Failed to aggregate signatures' });
          }
        } else {
          socket.emit('share_submitted', {
            success: true,
            completed: false,
            collectedCount: currentCount,
            requiredThreshold
          });
        }
      }); // end withLock
    } catch (e) {
      console.error('Unhandled error in submit_share lock:', e);
    }
  });

  socket.on('check_transaction', async (data) => {
    const { nonce } = data;
    const transaction = await Transaction.findOne({ nonce });

    if (!transaction) {
      socket.emit('transaction_status', { found: false });
      return;
    }

    socket.emit('transaction_status', {
      found: true,
      status: transaction.status,
      amount: transaction.amount,
      collectedCount: transaction.collectedSignatures.length,
      threshold: transaction.threshold,
      qrData: transaction.qrData
    });
  });

  socket.on('verify_payment', async (data) => {
    const { nonce, amount } = data;
    try {
      await withLock(nonce, async () => {
        console.log(`Payment verification request from merchant for transaction ${nonce}, amount: ${amount}`);

    let transaction = await Transaction.findOne({ nonce });
    
    if (!transaction) {
      socket.emit('error', { message: 'Transaction not found or has expired from records.' });
      return;
    }

    // 1. REJECT PAST SESSIONS (Any transaction created before the current server startup)
    if (transaction.createdAt < SERVER_START_TIME) {
      socket.emit('error', { message: 'This QR code is from a previous session and is no longer valid.' });
      return;
    }

    // 2. REJECT EXPIRED (Check qrExpiresAt for completed transactions)
    if (transaction.status === 'COMPLETED' && transaction.qrExpiresAt && new Date() > transaction.qrExpiresAt) {
      socket.emit('error', { message: 'QR code has expired' });
      return;
    }
    if (transaction.status === 'EXPIRED') {
      socket.emit('error', { message: 'Transaction has expired' });
      return;
    }

    // 3. REPLAY PROTECTION
    if (transaction.status === 'PAID') {
      socket.emit('error', { message: 'This transaction has already been paid and processed.' });
      return;
    }

    // 4. ENSURE COMPLETED (Must be signed properly)
    if (transaction.status !== 'COMPLETED') {
      socket.emit('error', { message: `Transaction status is ${transaction.status}. Only fully signed transactions can be paid.` });
      return;
    }

    // Update status to PAID to prevent replay
    transaction.status = 'PAID';
    await transaction.save();
    
    const newBalance = await deductBalance(amount);
    broadcastToNodes(io, 'balance_update', { balance: newBalance });

        broadcastToNodes(io, 'payment_received', {
          nonce,
          amount,
          timestamp: Date.now(),
          verifiedBy: 'merchant'
        });
        
        socket.emit('payment_processed', { success: true, nonce });
      });
    } catch (e) {
      console.error('Unhandled error in verify_payment lock:', e);
    }
  });

  socket.on('cancel_transaction', async (data) => {
    const { nonce, requesterId } = data;
    try {
      await withLock(nonce, async () => {
        console.log(`Transaction cancellation request from Node ${requesterId} for nonce ${nonce}`);

    try {
      const transaction = await Transaction.findOne({ nonce });
      
      if (!transaction) {
        socket.emit('error', { message: 'Transaction not found.' });
        return;
      }

      // Verify that the person cancelling is the one who requested it
      if (String(transaction.requesterId) !== String(requesterId)) {
        socket.emit('error', { message: 'Unauthorized: Only the requester can cancel this transaction.' });
        return;
      }

      if (transaction.status !== 'PENDING') {
        socket.emit('error', { message: `Cannot cancel transaction with status: ${transaction.status}` });
        return;
      }

      transaction.status = 'CANCELLED';
      await transaction.save();
      
      // Remove from pending map if it exists there
      pendingTransactions.delete(nonce);

      // Broadcast to everyone to remove it from their UI
      io.emit('transaction_cancelled', { nonce, requesterId });
      
          console.log(`Transaction ${nonce} cancelled by requester ${requesterId}`);
        } catch (error) {
          console.error('Error cancelling transaction:', error);
          socket.emit('error', { message: 'Failed to cancel transaction.' });
        }
      });
    } catch (e) {
      console.error('Unhandled error in cancel_transaction lock:', e);
    }
  });

  socket.on('reject_share', async (data) => {
    const { nonce, nodeId, signature } = data;
    try {
      await withLock(nonce, async () => {
        // Atomically add rejection — $addToSet prevents duplicates
        const transaction = await Transaction.findOneAndUpdate(
          { nonce, status: 'PENDING' },
          { $addToSet: { rejectedBy: nodeId }, $set: { updatedAt: new Date() } },
          { new: true }
        );

        if (!transaction) {
          const existing = await Transaction.findOne({ nonce });
          if (!existing) {
            socket.emit('error', { message: 'Transaction not found' });
          } else {
            socket.emit('error', { message: `Cannot reject transaction with status: ${existing.status}` });
          }
          return;
        }

        console.log(`Node ${nodeId} rejected transaction ${nonce}. Total rejections: ${transaction.rejectedBy.length}`);

        // Check if it's still possible to meet the threshold
        // Total nodes = 5.
        // Remaining possible signers = Total Nodes - Nodes who rejected
        const totalNodes = 5;
        const possibleSigners = totalNodes - transaction.rejectedBy.length;

        if (possibleSigners < transaction.threshold) {
          console.log(`Transaction ${nonce} is now impossible to complete. Marking as FAILED.`);
          await Transaction.updateOne(
            { nonce, status: 'PENDING' },
            { $set: { status: 'FAILED', updatedAt: new Date() } }
          );
          pendingTransactions.delete(nonce);

          io.emit('transaction_denied', {
            nonce: transaction.nonce,
            requesterId: transaction.requesterId,
            reason: 'Too many rejections'
          });
          return;
        }

        sendToNode(io, transaction.requesterId, 'share_rejected_notification', {
          message: `Node ${nodeId} rejected your transaction`,
          nonce: transaction.nonce
        });

        socket.emit('share_rejected', { nonce: transaction.nonce });
      });
    } catch (e) {
      console.error('Unhandled error in reject_share lock:', e);
    }
  });

  socket.on('disconnect', () => {
    const nodeId = socket.nodeId;
    if (nodeId) {
      activeNodes.delete(nodeId);
      console.log(`Node ${nodeId} disconnected`);
      broadcastOccupiedNodes(io);
    }
  });
}
