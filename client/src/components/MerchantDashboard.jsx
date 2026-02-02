import { useState, useEffect, useCallback, useRef } from 'react';
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { sha256 } from '@noble/hashes/sha256.js';
import { useSocket } from '../context/SocketContext';
import { Html5Qrcode } from 'html5-qrcode';

const G1 = bls12_381.G1.ProjectivePoint.BASE;

function getPointFromHex(x, y, z = '1') {
  return new bls12_381.G1.ProjectivePoint(
    BigInt('0x' + x),
    BigInt('0x' + y),
    BigInt('0x' + z)
  );
}

export default function MerchantDashboard({ user, onLogout }) {
  const { socket } = useSocket();
  const [qrInput, setQrInput] = useState('');
  const [verificationResult, setVerificationResult] = useState(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [jointPublicKey, setJointPublicKey] = useState(null);
  const [recentTransactions, setRecentTransactions] = useState([]);
  const [notification, setNotification] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [selectedQrImage, setSelectedQrImage] = useState(null);
  const scannerRef = useRef(null);
  const html5QrCodeRef = useRef(null);

  const showNotification = useCallback((message, type = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 5000);
  }, []);

  useEffect(() => {
    if (!socket) return;

    if (user.jointPublicKey) {
      setJointPublicKey(user.jointPublicKey);
    }

    socket.on('room_joined', (data) => {
      setJointPublicKey(data.jointPublicKey);
    });

    socket.on('transaction_completed', (data) => {
      setRecentTransactions(prev => [data, ...prev.slice(0, 9)]);
      showNotification(`New transaction verified: ₱${data.amount}`, 'success');
    });

    return () => {
      socket.off('room_joined');
      socket.off('transaction_completed');
      stopScanning();
    };
  }, [socket, user, showNotification]);

  const startScanning = async () => {
    try {
      setIsScanning(true);
      
      if (scannerRef.current) {
        scannerRef.current.innerHTML = '';
      }

      html5QrCodeRef.current = new Html5Qrcode("qr-reader");
      
      await html5QrCodeRef.current.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 }
        },
        (decodedText) => {
          console.log(`QR Code detected: ${decodedText}`);
          setQrInput(decodedText);
          stopScanning();
          showNotification('QR Code scanned successfully!', 'success');
        },
        (errorMessage) => {
          console.log(errorMessage);
        }
      );
    } catch (err) {
      console.error('Failed to start scanner:', err);
      showNotification('Failed to access camera. Please check permissions.', 'error');
      setIsScanning(false);
    }
  };

  const stopScanning = async () => {
    try {
      if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
        await html5QrCodeRef.current.stop();
        html5QrCodeRef.current.clear();
      }
    } catch (err) {
      console.error('Error stopping scanner:', err);
    }
    setIsScanning(false);
  };

  const hashMessage = (message) => {
    const messageStr = JSON.stringify(message);
    const messageBytes = new TextEncoder().encode(messageStr);
    const hash = sha256(messageBytes);
    const hashHex = Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');
    const hashInt = BigInt('0x' + hashHex);
    return G1.multiply(hashInt);
  };

  const verifySignature = (publicKey, message, signature) => {
    try {
      console.log('Verifying with publicKey:', JSON.stringify(publicKey));
      console.log('Verifying message:', JSON.stringify(message));
      console.log('Verifying signature:', JSON.stringify(signature));

      const pk = getPointFromHex(publicKey.x, publicKey.y, publicKey.z || '1');
      const sig = getPointFromHex(signature.x, signature.y, signature.z || '1');
      const msgHash = hashMessage(message);

      console.log('Message hash computed');

      const left = bls12_381.pairing(pk, msgHash);
      const right = bls12_381.pairing(G1, sig);

      console.log('Pairing computed, result:', left.equals(right));
      return left.equals(right);
    } catch (error) {
      console.error('Verification error:', error);
      return false;
    }
  };

  const handleVerify = () => {
    if (!qrInput.trim()) {
      showNotification('Please scan or paste QR data', 'error');
      return;
    }

    setIsVerifying(true);

    try {
      const qrData = JSON.parse(qrInput);

      if (!qrData.amount || !qrData.timestamp || !qrData.nonce || !qrData.signature) {
        throw new Error('Invalid QR data format');
      }

      const message = {
        amount: qrData.amount,
        timestamp: qrData.timestamp,
        nonce: qrData.nonce
      };

      const isValid = verifySignature(jointPublicKey, message, qrData.signature);

      const result = {
        valid: isValid,
        amount: qrData.amount,
        timestamp: qrData.timestamp,
        nonce: qrData.nonce,
        time: new Date().toLocaleString()
      };

      setVerificationResult(result);

      if (isValid) {
        showNotification('Signature verified successfully!', 'success');
      } else {
        showNotification('Signature verification failed!', 'error');
      }
    } catch (error) {
      setVerificationResult({
        valid: false,
        error: error.message || 'Invalid QR data format'
      });
      showNotification('Invalid QR data format', 'error');
    }

    setIsVerifying(false);
  };

  const clearVerification = () => {
    setQrInput('');
    setVerificationResult(null);
  };

  const closeQrModal = () => {
    setSelectedQrImage(null);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <span className="text-xl font-bold text-gray-800">Merchant Portal</span>
              <span className="ml-3 badge bg-purple-100 text-purple-600">Merchant</span>
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

      {selectedQrImage && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={closeQrModal}>
          <div className="relative bg-white rounded-lg p-8 max-w-lg w-full mx-4" onClick={e => e.stopPropagation()}>
            <button
              onClick={closeQrModal}
              className="absolute top-4 right-4 text-gray-500 hover:text-gray-700"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <h3 className="text-lg font-semibold text-gray-800 mb-4 text-center">QR Code</h3>
            <div className="flex justify-center">
              <img src={selectedQrImage} alt="QR Code" className="max-w-md w-full rounded-lg" />
            </div>
            <p className="text-center text-gray-500 text-sm mt-4">Scan this code with your camera</p>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="space-y-6">
            <div className="card">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">Verify Payment</h2>
              
              <div className="space-y-4">
                <div id="qr-reader" ref={scannerRef} className="w-full bg-gray-900 rounded-lg overflow-hidden" style={{ display: isScanning ? 'block' : 'none', minHeight: '300px' }}></div>
                
                {!isScanning && (
                  <button
                    onClick={startScanning}
                    className="w-full btn-primary flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Open Camera Scanner
                  </button>
                )}

                {isScanning && (
                  <button
                    onClick={stopScanning}
                    className="w-full btn-danger flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                    </svg>
                    Close Scanner
                  </button>
                )}

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-300"></div>
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-2 bg-white text-gray-500">Or paste manually</span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    QR Data
                  </label>
                  <textarea
                    value={qrInput}
                    onChange={(e) => setQrInput(e.target.value)}
                    placeholder='{"amount":5000,"timestamp":...}'
                    className="input-field font-mono text-sm"
                    rows={6}
                  />
                </div>
                <div className="flex space-x-3">
                  <button
                    onClick={handleVerify}
                    disabled={isVerifying || !qrInput.trim()}
                    className="btn-primary flex-1"
                  >
                    {isVerifying ? 'Verifying...' : 'Verify'}
                  </button>
                  <button
                    onClick={clearVerification}
                    className="btn-danger"
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>

            {verificationResult && (
              <div className={`card border-2 ${
                verificationResult.valid
                  ? 'border-success-500 bg-success-50'
                  : 'border-danger-500 bg-danger-50'
              }`}>
                <div className="flex items-center mb-4">
                  <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
                    verificationResult.valid ? 'bg-success-500' : 'bg-danger-500'
                  }`}>
                    {verificationResult.valid ? (
                      <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    )}
                  </div>
                  <div className="ml-4">
                    <h3 className={`text-xl font-bold ${
                      verificationResult.valid ? 'text-success-600' : 'text-danger-600'
                    }`}>
                      {verificationResult.valid ? 'PAYMENT VERIFIED' : 'VERIFICATION FAILED'}
                    </h3>
                    <p className="text-lg font-semibold text-gray-800">₱{verificationResult.amount.toLocaleString()}</p>
                  </div>
                </div>

                <div className="space-y-3 text-sm">
                  <div className="flex justify-between py-2 border-b border-gray-200">
                    <span className="text-gray-600">Transaction ID</span>
                    <span className="font-mono">{verificationResult.nonce.slice(0, 16)}...</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-200">
                    <span className="text-gray-600">Verified At</span>
                    <span>{verificationResult.time}</span>
                  </div>
                  {verificationResult.valid && (
                    <div className="mt-4 p-3 bg-success-100 rounded-lg">
                      <p className="text-success-700 text-sm font-medium">✓ Signature is valid and authentic</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div className="card">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">Recent Transactions</h2>
              {recentTransactions.length === 0 ? (
                <p className="text-gray-500 text-sm">No transactions yet</p>
              ) : (
                <div className="space-y-3">
                  {recentTransactions.map((tx, index) => (
                    <div key={index} className="p-4 border border-gray-200 rounded-lg hover:shadow-md transition-shadow">
                      <div className="flex justify-between items-center">
                        <div>
                          <p className="text-xl font-bold text-gray-800">₱{tx.amount.toLocaleString()}</p>
                          <p className="text-xs text-gray-500 font-mono">{tx.nonce?.slice(0, 16)}...</p>
                        </div>
                        <span className="badge badge-success text-sm">Verified</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">Verification Info</h2>
              <div className="space-y-3 text-sm">
                <div className="p-4 bg-gradient-to-r from-purple-50 to-purple-100 rounded-lg">
                  <p className="text-purple-800 font-medium mb-2">How to Verify</p>
                  <ol className="text-purple-700 space-y-2 list-decimal list-inside">
                    <li>Click "Open Camera Scanner"</li>
                    <li>Point camera at customer's QR code</li>
                    <li>Or paste QR data manually</li>
                    <li>Click Verify</li>
                  </ol>
                </div>
                <div className="p-3 bg-gray-100 rounded-lg">
                  <p className="text-gray-600 mb-1">Joint Public Key</p>
                  <p className="font-mono text-xs text-gray-800 break-all">
                    {jointPublicKey ? `${jointPublicKey.x.slice(0, 20)}...` : 'Loading...'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
