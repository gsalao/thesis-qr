import { v4 as uuidv4 } from 'uuid';
import Transaction from '../models/Transaction.js';
import GroupBalance from '../models/GroupBalance.js';
import AuditLog from '../models/AuditLog.js';
import { THRESHOLD, JOINT_PUBLIC_KEY, PRIVATE_SHARES } from '../config/keys.js';
import { aggregateSignatures, verifySignature, signMessage } from '../utils/cryptoUtils.js';

const activeNodes = new Map();
const pendingTransactions = new Map();
const SERVER_START_TIME = new Date();
const lastSeenMap = new Map();
let expirationCheckerStarted = false;
let lastSeenIntervalStarted = false;
let ioInstance = null;

function startExpirationChecker(io) {
  if (expirationCheckerStarted) return;
  expirationCheckerStarted = true;
  
  console.log('Starting transaction expiration checker...');
  setInterval(async () => {
    try {
      const now = new Date();
      // Find pending and completed transactions that have passed their expiresAt
      const expiredTxs = await Transaction.find({
        status: { $in: ['PENDING', 'COMPLETED'] },
        expiresAt: { $lt: now }
      });

      for (const tx of expiredTxs) {
        tx.status = 'EXPIRED';
        await tx.save();
        
        await createAuditLog(
          'QR_EXPIRED',
          `${formatPHP(tx.amount)} payment expired - QR code no longer valid`,
          tx.requesterId,
          { nonce: tx.nonce, amount: tx.amount }
        );
        
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
  const balance = await getGroupBalance();
  balance.balance -= amount;
  balance.lastUpdated = new Date();
  await balance.save();
  return balance.balance;
}

function formatPHP(amount) {
  return `₱${amount.toLocaleString()}`;
}

function formatNodeName(nodeId) {
  return nodeId === 99 ? 'Merchant Node' : `Node ${nodeId}`;
}

async function createAuditLog(eventType, description, actorNode = null, metadata = {}) {
  try {
    const logEntry = new AuditLog({
      eventType,
      description,
      actorNode,
      metadata,
      timestamp: new Date()
    });
    await logEntry.save();
    
    if (ioInstance) {
      ioInstance.emit('audit_log_new', {
        eventType,
        timestamp: logEntry.timestamp,
        actorNode,
        description,
        metadata
      });
    }
    
    return logEntry;
  } catch (err) {
    console.error('Failed to create audit log:', err);
  }
}

function broadcastAuditLogs() {
  if (!ioInstance) return;
  ioInstance.emit('audit_logs_broadcast', {
    logs: [],
    lastSeen: Object.fromEntries(lastSeenMap)
  });
}

function startLastSeenUpdater(socket) {
  if (lastSeenIntervalStarted) return;
  lastSeenIntervalStarted = true;
  
  setInterval(async () => {
    const now = new Date();
    for (const [nodeId, socketData] of activeNodes) {
      lastSeenMap.set(nodeId, now.toISOString());
    }
    
    broadcastAuditLogs();
  }, 30000);
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
  
  ioInstance = io;
  
  // Initialize the expiration job once
  startExpirationChecker(io);
  startLastSeenUpdater(socket);

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
    lastSeenMap.set(nodeId, new Date().toISOString());

    console.log(`Node ${nodeId} (${role}) joined`);
    
    if (role !== 'merchant') {
      await createAuditLog('NODE_ONLINE', `${formatNodeName(nodeId)} came online`, nodeId, { role });
    }

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
    const role = socket.role;
    if (nodeId) {
      activeNodes.delete(nodeId);
      lastSeenMap.delete(nodeId);
      delete socket.nodeId;
      delete socket.role;
      console.log(`Node ${nodeId} left the room (logout)`);
      
      if (role !== 'merchant') {
        createAuditLog('NODE_OFFLINE', `${formatNodeName(nodeId)} went offline`, nodeId, { role });
      }
      
      broadcastOccupiedNodes(io);
    }
  });

  socket.on('get_balance', async () => {
    const balance = await getGroupBalance();
    socket.emit('balance_update', { balance: balance.balance });
  });

  socket.on('get_audit_logs', async (data) => {
    try {
      const limit = data?.limit || 50;
      const logs = await AuditLog.find()
        .sort({ timestamp: -1 })
        .limit(limit)
        .lean();
      
      socket.emit('audit_logs_response', {
        logs: logs.map(log => ({
          _id: log._id,
          eventType: log.eventType,
          timestamp: log.timestamp,
          actorNode: log.actorNode,
          description: log.description,
          metadata: log.metadata
        })),
        lastSeen: Object.fromEntries(lastSeenMap)
      });
    } catch (err) {
      console.error('Failed to fetch audit logs:', err);
      socket.emit('error', { message: 'Failed to fetch audit logs' });
    }
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
        
        await createAuditLog(
          'QR_GENERATED',
          `QR generated for ${formatPHP(amount)} payment (threshold met)`,
          requesterId,
          { nonce, amount, signers }
        );
        
        if (threshold > 1) {
          await createAuditLog(
            'THRESHOLD_REACHED',
            `Signature threshold (${threshold}) reached for ${formatPHP(amount)}`,
            requesterId,
            { nonce, amount, threshold, signers }
          );
        }

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
    
    await createAuditLog(
      'PAYMENT_INITIATED',
      `${formatPHP(amount)} payment initiated by ${formatNodeName(requesterId)}`,
      requesterId,
      { nonce, amount, threshold }
    );

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

    if (transaction.expiresAt && new Date() > transaction.expiresAt) {
      socket.emit('share_rejected', { nonce, message: 'Transaction has expired' });
      return;
    }

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
    
    await createAuditLog(
      'PAYMENT_APPROVED',
      `Payment approved by ${formatNodeName(nodeId)} (${currentCount}/${requiredThreshold})`,
      nodeId,
      { nonce, amount: transaction.amount, threshold: requiredThreshold, collectedCount: currentCount }
    );

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
        transaction.qrExpiresAt = new Date(Date.now() + 2 * 60 * 1000);
        await transaction.save();
        
        await createAuditLog(
          'QR_GENERATED',
          `QR generated for ${formatPHP(transaction.amount)} payment`,
          transaction.requesterId,
          { nonce: transaction.nonce, amount: transaction.amount, signers }
        );
        
        if (requiredThreshold > 1) {
          await createAuditLog(
            'THRESHOLD_REACHED',
            `Signature threshold (${requiredThreshold}) reached for ${formatPHP(transaction.amount)}`,
            transaction.requesterId,
            { nonce: transaction.nonce, amount: transaction.amount, threshold: requiredThreshold, signers }
          );
        }

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
          expiresAt: transaction.expiresAt.toISOString(),
          qrExpiresAt: transaction.qrExpiresAt.toISOString(),
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
    
    await createAuditLog(
      'PAYMENT_VERIFIED',
      `Payment of ${formatPHP(amount)} verified by merchant`,
      null,
      { nonce, amount, requesterId: transaction.requesterId }
    );

    broadcastToNodes(io, 'payment_received', {
      nonce,
      amount,
      timestamp: Date.now(),
      verifiedBy: 'merchant'
    });
    
    socket.emit('payment_processed', { success: true, nonce });
  });

  socket.on('cancel_transaction', async (data) => {
    const { nonce, requesterId } = data;
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
      
      await createAuditLog(
        'PAYMENT_CANCELLED',
        `${formatPHP(transaction.amount)} payment cancelled by ${formatNodeName(requesterId)}`,
        requesterId,
        { nonce: transaction.nonce, amount: transaction.amount }
      );
      
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
      
      console.log(`Node ${nodeId} rejected transaction ${nonce}. Total rejections: ${transaction.rejectedBy.length}`);
      
      await createAuditLog(
        'PAYMENT_REJECTED',
        `Payment rejected by ${formatNodeName(nodeId)}`,
        nodeId,
        { nonce, amount: transaction.amount }
      );

      // Check if it's still possible to meet the threshold
      // Total nodes = 5. 
      // Remaining possible signers = Total Nodes - Nodes who rejected
      const totalNodes = 5;
      const possibleSigners = totalNodes - transaction.rejectedBy.length;
      
      if (possibleSigners < transaction.threshold) {
        console.log(`Transaction ${nonce} is now impossible to complete. Marking as FAILED.`);
        transaction.status = 'FAILED';
        await transaction.save();
        pendingTransactions.delete(nonce);

        await createAuditLog(
          'THRESHOLD_NOT_MET',
          `Payment of ${formatPHP(transaction.amount)} declined - too many rejections`,
          transaction.requesterId,
          { nonce: transaction.nonce, amount: transaction.amount, rejectedBy: transaction.rejectedBy }
        );

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
    } catch (err) {
      console.error('Failed to save rejection to DB:', err.message);
      socket.emit('error', { message: 'Failed to update transaction status' });
      return; // Stop execution if database fails
    }

    socket.emit('share_rejected', { nonce: transaction.nonce });
  });

  socket.on('disconnect', () => {
    const nodeId = socket.nodeId;
    const role = socket.role;
    if (nodeId) {
      activeNodes.delete(nodeId);
      lastSeenMap.delete(nodeId);
      console.log(`Node ${nodeId} disconnected`);
      
      if (role !== 'merchant') {
        createAuditLog('NODE_OFFLINE', `Node ${nodeId} went offline`, nodeId, { role });
      }
      
      broadcastOccupiedNodes(io);
    }
  });
}
