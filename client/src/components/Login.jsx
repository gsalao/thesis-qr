import { useState, useEffect } from 'react';
import { useSocket } from '../context/SocketContext';

const ROLES = [
  { id: 1, name: 'Buyer Node 1', type: 'buyer' },
  { id: 2, name: 'Buyer Node 2', type: 'buyer' },
  { id: 3, name: 'Buyer Node 3', type: 'buyer' },
  { id: 4, name: 'Buyer Node 4', type: 'buyer' },
  { id: 5, name: 'Buyer Node 5', type: 'buyer' },
  { id: 99, name: 'Merchant', type: 'merchant' }
];

export default function Login({ onLogin }) {
  const { socket, isConnected } = useSocket();
  const [selectedRole, setSelectedRole] = useState(null);
  const [isJoining, setIsJoining] = useState(false);
  const [occupiedNodes, setOccupiedNodes] = useState([]);

  useEffect(() => {
    if (!socket) return;

    socket.on('occupied_nodes_update', (nodes) => {
      console.log('Occupied nodes update:', nodes);
      setOccupiedNodes(nodes);
    });

    return () => {
      socket.off('occupied_nodes_update');
    };
  }, [socket]);

  const handleLogin = async () => {
    if (!selectedRole || !socket) return;

    setIsJoining(true);

    socket.emit('join_room', {
      nodeId: selectedRole.id,
      role: selectedRole.type
    });

    socket.once('room_joined', (data) => {
      if (data.success) {
        onLogin({
          nodeId: data.nodeId,
          role: data.role,
          jointPublicKey: data.jointPublicKey
        });
      } else {
        alert(data.message || 'Failed to join room');
      }
      setIsJoining(false);
    });

    setTimeout(() => {
      if (isJoining) {
        setIsJoining(false);
        alert('Connection timeout. Please try again.');
      }
    }, 10000);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-600 to-primary-800">
      <div className="card w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">DKG Payment System</h1>
          <p className="text-gray-500 mt-2">Threshold Signature Authentication</p>
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select Your Role
          </label>
          <select
            className="input-field"
            value={selectedRole?.id || ''}
            onChange={(e) => {
              const role = ROLES.find(r => r.id === parseInt(e.target.value));
              setSelectedRole(role);
            }}
            disabled={!isConnected || isJoining}
          >
            <option value="">Choose a role...</option>
            {ROLES.map(role => {
              const isOccupied = occupiedNodes.includes(role.id);
              return (
                <option key={role.id} value={role.id} disabled={isOccupied}>
                  {role.name} {isOccupied ? '(Already Logged In)' : ''}
                </option>
              );
            })}
          </select>
        </div>

        <div className="flex items-center justify-between mb-6 p-3 bg-gray-100 rounded-lg">
          <span className="text-sm text-gray-600">Connection Status</span>
          <span className={`badge ${isConnected ? 'badge-success' : 'badge-danger'}`}>
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>

        <button
          onClick={handleLogin}
          disabled={!selectedRole || !isConnected || isJoining || occupiedNodes.includes(selectedRole.id)}
          className="btn-primary w-full disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {isJoining ? 'Connecting...' : occupiedNodes.includes(selectedRole?.id) ? 'Role Already Taken' : 'Login'}
        </button>

        <div className="mt-6 p-4 bg-blue-50 rounded-lg">
          <h3 className="text-sm font-medium text-blue-800 mb-2">Policy Rules</h3>
          <ul className="text-xs text-blue-700 space-y-1">
            <li>• Amount &lt; 1000 PHP: Requires 1 signature</li>
            <li>• Amount ≥ 1000 PHP: Requires 3 signatures</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
