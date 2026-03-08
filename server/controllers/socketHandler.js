import { v4 as uuidv4 } from 'uuid';
import Transaction from '../models/Transaction.js';
import GroupBalance from '../models/GroupBalance.js';
import { THRESHOLD, JOINT_PUBLIC_KEY } from '../config/keys.js';
import { aggregateSignatures, verifySignature } from '../utils/cryptoUtils.js';

const activeNodes = new Map();
const pendingTransactions = new Map();

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
  const balance = await getGroupBalance();
  balance.balance -= amount;
  balance.lastUpdated = new Date();
  await balance.save();
  return balance.balance;
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
      timestamp: tx.createdAt.getTime()
    })));
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
      socket.emit('error', { message: 'Insufficient funds in joint account' });
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
      expiresAt: new Date(Date.now() + 5 * 60 * 1000)
    });

    await transaction.save();
    pendingTransactions.set(nonce, transaction);

    console.log(`Transaction requested: ${nonce} (Amount: ${amount}, Threshold: ${threshold})`);

    broadcastToNodes(io, 'new_transaction', {
      nonce,
      amount,
      requesterId,
      threshold,
      timestamp
    }, requesterId);

    socket.emit('transaction_initiated', {
      success: true,
      nonce,
      amount,
      threshold,
      message: threshold === 1
        ? 'Transaction requires 1 signature'
        : `Transaction requires ${threshold} signatures`
    });
  });

  socket.on('submit_share', async (data) => {
    const { nonce, nodeId, signature } = data;
    console.log(`submit_share received from Node ${nodeId} for nonce ${nonce}`);

    let transaction = pendingTransactions.get(nonce);
    if (!transaction) {
      transaction = await Transaction.findOne({ nonce });
      if (!transaction) {
        socket.emit('error', { message: 'Transaction not found' });
        return;
      }
    }

    console.log(`Transaction found: ${transaction._id}, status: ${transaction.status}`);

    if (transaction.status === 'COMPLETED') {
      socket.emit('share_submitted', { success: true, alreadyCompleted: true });
      return;
    }

    const existingSig = transaction.collectedSignatures.find(s => s.nodeId === nodeId);
    if (existingSig) {
      socket.emit('error', { message: 'Node already signed this transaction' });
      return;
    }

    transaction.collectedSignatures.push({
      nodeId,
      signature
    });
    await transaction.save();

    const requiredThreshold = transaction.threshold;
    const currentCount = transaction.collectedSignatures.length;

    console.log(`Signature received from Node ${nodeId} for ${nonce} (${currentCount}/${requiredThreshold})`);

    broadcastToNodes(io, 'signature_received', {
      nonce,
      nodeId,
      collectedCount: currentCount,
      threshold: requiredThreshold
    });

    if (currentCount >= requiredThreshold) {
      try {
        const signers = transaction.collectedSignatures.map(s => s.nodeId);
        const signatures = transaction.collectedSignatures.map(s => s.signature);
        console.log(`Aggregating ${signatures.length} signatures from signers: ${signers}`);

        const aggregated = aggregateSignatures(signatures, signers);
        console.log(`Aggregation successful:`, aggregated);

        const qrData = {
          amount: transaction.amount,
          timestamp: transaction.createdAt.getTime(),
          nonce: transaction.nonce,
          signature: aggregated
        };

        transaction.status = 'COMPLETED';
        transaction.aggregatedSignature = aggregated;
        transaction.qrData = qrData;
        await transaction.save();

        const messageToVerify = {
          amount: transaction.amount,
          timestamp: transaction.createdAt.getTime(),
          nonce: transaction.nonce
        };

        const isValid = verifySignature(JOINT_PUBLIC_KEY, messageToVerify, aggregated);

        console.log(`Transaction ${nonce} completed. Verification: ${isValid}`);

        const completionData = {
          success: true,
          nonce: transaction.nonce,
          amount: transaction.amount,
          qrData,
          signers: signers,
          verificationResult: isValid
        };

        broadcastToNodes(io, 'transaction_completed', {
          ...completionData,
          isForRequester: false
        });

        sendToNode(io, transaction.requesterId, 'transaction_completed', {
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
        transaction.status = 'FAILED';
        await transaction.save();

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
    console.log(`Payment verified by merchant for transaction ${nonce}, amount: ${amount}`);

    let transaction = await Transaction.findOne({ nonce });
    
    const newBalance = await deductBalance(amount);
    broadcastToNodes(io, 'balance_update', { balance: newBalance });

    broadcastToNodes(io, 'payment_received', {
      nonce,
      amount,
      timestamp: Date.now(),
      verifiedBy: 'merchant'
    });
  });

  socket.on('reject_share', async (data) => {
    const { nonce, nodeId, signature } = data;
    let transaction = pendingTransactions.get(nonce);
    if (!transaction) {
      transaction = await Transaction.findOne({ nonce });
      if (!transaction) {
        socket.emit('error', { message: 'Transaction not found' });
        return;
      }
    }
    console.log(`Transaction found: ${transaction._id}, status: ${transaction.status}`);

    // UPDATE DB
    try {
      // 1. Permanently update the status in your MongoDB database
      await Transaction.updateOne({ nonce }, { $addToSet : {rejectedBy : nodeId} });
      
      // Update the memory map so the server knows this node rejected it
      if (!transaction.rejectedBy) transaction.rejectedBy = [];
      if (!transaction.rejectedBy.includes(nodeId)) {
        transaction.rejectedBy.push(nodeId);
      }
      
      console.log(`Transaction ${nonce} successfully marked as REJECTED in database.`);
    } catch (err) {
      console.error('Failed to save rejection to DB:', err.message);
      socket.emit('error', { message: 'Failed to update transaction status' });
      return; // Stop execution if database fails
    }

    try {
      sendToNode(io, transaction.requesterId, 'share_rejected_notification', {
        message: `Node ${nodeId} rejected your transaction`,
        nonce: transaction.nonce
      });
    } catch (error) {
      console.log(error.message);
    }
    socket.emit('share_rejected', { nonce: transaction.nonce });
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
