import { useState, useEffect, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useSocket } from '../context/SocketContext';
import { getPrivateShareForNode, signMessage } from '../utils/cryptoUtils';

export default function BuyerDashboard({ user, onLogout }) {
  const { socket } = useSocket();
  const [amount, setAmount] = useState('');
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [myTransactions, setMyTransactions] = useState([]);
  const [groupBalance, setGroupBalance] = useState(1000000);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notification, setNotification] = useState(null);
  const [selectedQrImage, setSelectedQrImage] = useState(null);

  const showNotification = useCallback((message, type = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 5000);
  }, []);

  const openQrModal = (qrData) => {
    const qrString = JSON.stringify(qrData);
    setSelectedQrImage(qrString);
  };

  const closeQrModal = () => {
    setSelectedQrImage(null);
  };

  useEffect(() => {
    if (!socket) return;

    socket.on('room_joined', (data) => {
      if (data.groupBalance !== undefined) {
        setGroupBalance(data.groupBalance);
      }
    });

    socket.on('balance_update', (data) => {
      setGroupBalance(data.balance);
    });

    socket.on('new_transaction', (data) => {
      setPendingApprovals(prev => {
        const exists = prev.find(p => p.nonce === data.nonce);
        if (exists) return prev;
        return [...prev, data];
      });
      showNotification(`New transaction request: ₱${data.amount} (${data.collectedCount}/${data.threshold})`, 'info');
    });

    socket.on('signature_received', (data) => {
      setPendingApprovals(prev =>
        prev.map(p =>
          p.nonce === data.nonce
            ? { ...p, collectedCount: data.collectedCount }
            : p
        )
      );
    });

    socket.on('pending_transactions', (transactions) => {
      setPendingApprovals(prev => {
        const combined = [...prev];
        transactions.forEach(tx => {
          if (!combined.find(p => p.nonce === tx.nonce)) {
            combined.push(tx);
          }
        });
        return combined;
      });
    });

    socket.on('transaction_completed', (data) => {
      if (data.isForRequester) {
        setPendingApprovals(prev => prev.filter(p => p.nonce !== data.nonce));

        if (data.nonce && user.nodeId) {
          setMyTransactions(prev => {
            const existingTx = prev.find(t => t.nonce === data.nonce);
            if (existingTx) {
              return prev.map(t =>
                t.nonce === data.nonce
                  ? { ...t, ...data, status: 'COMPLETED', signedByMe: data.signers.includes(user.nodeId) }
                  : t
              );
            } else {
              return [{
                ...data,
                status: 'COMPLETED',
                signedByMe: data.signers.includes(user.nodeId)
              }, ...prev];
            }
          });
        }
        showNotification(`Transaction completed! QR Code generated.`, 'success');
      } else {
        setPendingApprovals(prev => prev.filter(p => p.nonce !== data.nonce));
      }
    });

    socket.on('transaction_initiated', (data) => {
      if (data.success) {
        setMyTransactions(prev => [{
          nonce: data.nonce,
          amount: data.amount,
          status: 'PENDING',
          threshold: data.threshold,
          signedByMe: false,
          signers: []
        }, ...prev]);
        setAmount('');
        showNotification(data.message, 'success');
      }
    });

    socket.on('error', (data) => {
      showNotification(data.message, 'error');
    });

    socket.on('share_submitted', (data) => {
      if (data.success) {
        if (data.completed) {
          showNotification('Transaction completed! QR generated.', 'success');
        } else {
          showNotification(`Signature submitted (${data.collectedCount}/${data.requiredThreshold})`, 'info');
        }
      } else if (data.alreadyCompleted) {
        showNotification('Transaction already completed', 'info');
      }
    });

    return () => {
      socket.off('room_joined');
      socket.off('balance_update');
      socket.off('new_transaction');
      socket.off('signature_received');
      socket.off('pending_transactions');
      socket.off('transaction_completed');
      socket.off('transaction_initiated');
      socket.off('error');
      socket.off('share_submitted');
    };
  }, [socket, user.nodeId, showNotification]);

  const handlePay = () => {
    if (!amount || parseFloat(amount) <= 0) {
      showNotification('Please enter a valid amount', 'error');
      return;
    }

    setIsSubmitting(true);
    socket.emit('request_transaction', {
      amount: parseFloat(amount),
      requesterId: user.nodeId
    });
    setIsSubmitting(false);
  };

  const handleApprove = (transaction) => {
    console.log('handleApprove called for nonce:', transaction.nonce);
    console.log('socket exists:', !!socket, 'socket connected:', socket?.connected);
    
    const privateShare = getPrivateShareForNode(user.nodeId);
    if (!privateShare) {
      console.error('No private key found for node:', user.nodeId);
      showNotification('No private key found for this node', 'error');
      return;
    }

    const message = {
      amount: transaction.amount,
      timestamp: transaction.timestamp,
      nonce: transaction.nonce
    };

    const signature = signMessage(message, privateShare);
    console.log('Signature created:', signature);

    socket.emit('submit_share', {
      nonce: transaction.nonce,
      nodeId: user.nodeId,
      signature
    });

    setPendingApprovals(prev =>
      prev.map(p =>
        p.nonce === transaction.nonce
          ? { ...p, approving: true }
          : p
      )
    );

    showNotification('Signature submitted', 'success');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <span className="text-xl font-bold text-gray-800">DKG Payment</span>
              <span className="ml-3 badge badge-success">Node {user.nodeId}</span>
            </div>
            <button
              onClick={onLogout}
              className="text-gray-600 hover:text-gray-800 px-3 py-2 text-sm font-medium"
            >
              Logout
            </button>
          </div>
        </div>
      </nav>

      {notification && (
        <div className={`fixed top-4 right-4 px-6 py-3 rounded-lg shadow-lg z-50 ${
          notification.type === 'success' ? 'bg-success-500 text-white' :
          notification.type === 'error' ? 'bg-danger-500 text-white' :
          'bg-primary-600 text-white'
        }`}>
          {notification.message}
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="space-y-6">
            <div className="card bg-gradient-to-r from-primary-500 to-primary-600 text-white">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm opacity-90">Joint Account Balance</p>
                  <p className="text-3xl font-bold">₱{groupBalance.toLocaleString()}</p>
                </div>
                <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
            </div>

            <div className="card">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">Initiate Payment</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Amount (PHP)
                  </label>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="Enter amount"
                    className="input-field"
                    min="1"
                  />
                </div>
                <div className="p-3 bg-gray-100 rounded-lg">
                  <p className="text-sm text-gray-600">
                    <strong>Policy:</strong>
                    {amount && parseFloat(amount) >= 1000 ? (
                      <span className="text-yellow-600"> Requires 3 signatures</span>
                    ) : (
                      <span className="text-green-600"> Requires 1 signature</span>
                    )}
                  </p>
                </div>
                <button
                  onClick={handlePay}
                  disabled={!amount || isSubmitting}
                  className="btn-primary w-full"
                >
                  {isSubmitting ? 'Processing...' : 'Pay'}
                </button>
              </div>
            </div>

            <div className="card">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold text-gray-800">My Transactions</h2>
                {myTransactions.length > 0 && (
                  <button
                    onClick={() => setMyTransactions([])}
                    className="text-sm text-gray-500 hover:text-gray-700"
                  >
                    Clear All
                  </button>
                )}
              </div>
              {myTransactions.length === 0 ? (
                <p className="text-gray-500 text-sm">No transactions yet</p>
              ) : (
                <div className="space-y-3">
                  {myTransactions.map((tx) => (
                    <div key={tx.nonce} className="p-3 border border-gray-200 rounded-lg">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium">₱{tx.amount.toLocaleString()}</p>
                          <p className="text-xs text-gray-500">{tx.nonce.slice(0, 12)}...</p>
                        </div>
                        <span className={`badge ${
                          tx.status === 'COMPLETED' ? 'badge-success' : 'badge-warning'
                        }`}>
                          {tx.status}
                        </span>
                      </div>
                      {tx.qrData && tx.status === 'COMPLETED' && (
                        <div 
                          className="mt-3 flex flex-col items-center bg-white p-3 rounded border border-success-200 cursor-pointer hover:bg-success-50 transition-colors"
                          onClick={() => openQrModal(tx.qrData)}
                        >
                          <p className="text-xs text-success-600 mb-2 font-medium">Tap to enlarge QR</p>
                          <QRCodeSVG
                            value={JSON.stringify(tx.qrData)}
                            size={140}
                            level="M"
                          />
                          <p className="text-xs text-gray-500 mt-2">Click to view full size</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

            <div className="space-y-6">
            <div className="card">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold text-gray-800">
                  Pending Approvals
                  {pendingApprovals.length > 0 && (
                    <span className="ml-2 badge badge-warning">{pendingApprovals.length}</span>
                  )}
                </h2>
                {pendingApprovals.length > 0 && (
                  <button
                    onClick={() => setPendingApprovals([])}
                    className="text-sm text-gray-500 hover:text-gray-700"
                  >
                    Clear All
                  </button>
                )}
              </div>
              {pendingApprovals.length === 0 ? (
                <p className="text-gray-500 text-sm">No pending approvals</p>
              ) : (
                <div className="space-y-3">
                  {pendingApprovals.map((tx) => (
                    <div key={tx.nonce} className="p-4 border border-gray-200 rounded-lg">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-medium">₱{tx.amount}</p>
                          <p className="text-xs text-gray-500">
                            From Node {tx.requesterId} • {tx.nonce.slice(0, 8)}...
                          </p>
                        </div>
                        <span className="badge badge-warning">
                          {tx.collectedCount}/{tx.threshold}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2 mb-3">
                        <div
                          className="bg-primary-600 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${(tx.collectedCount / tx.threshold) * 100}%` }}
                        />
                      </div>
                      <div className="flex justify-between gap-2">
                        <button
                          onClick={() => handleApprove(tx)}
                          disabled={tx.approving || tx.collectedCount >= tx.threshold}
                          className="btn-success w-full text-sm"
                        >
                          {tx.approving ? 'Signing...' : 'Approve'}
                        </button>
                        <button
                          disabled={tx.approving || tx.collectedCount >= tx.threshold}
                          className="btn-danger w-full text-sm"
                        >
                          {tx.approving ? 'Rejecting...' : 'Reject'}
                        </button>
                      </div>
                      
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">How It Works</h2>
              <ol className="text-sm text-gray-600 space-y-2 list-decimal list-inside">
                <li>Enter amount and click Pay</li>
                <li>Other nodes receive notification</li>
                <li>Approvers click Approve to sign</li>
                <li>When threshold is met, QR is generated</li>
                <li>Show QR to Merchant for verification</li>
              </ol>
            </div>
          </div>
        </div>
      </main>

      {selectedQrImage && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50" onClick={closeQrModal}>
          <div className="relative bg-white rounded-2xl p-8 max-w-lg w-full mx-4" onClick={e => e.stopPropagation()}>
            <button
              onClick={closeQrModal}
              className="absolute top-4 right-4 text-gray-500 hover:text-gray-700 bg-gray-100 rounded-full p-2"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="text-center">
              <h3 className="text-xl font-bold text-gray-800 mb-2">Your Payment QR Code</h3>
              <p className="text-gray-500 text-sm mb-6">Show this to the merchant</p>
              <div className="bg-white p-4 rounded-xl shadow-lg inline-block">
                <QRCodeSVG
                  value={selectedQrImage}
                  size={280}
                  level="H"
                  includeMargin={true}
                />
              </div>
              <p className="text-gray-400 text-sm mt-6">Tap outside to close</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
