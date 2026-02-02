import { useState } from 'react';
import { SocketProvider } from './context/SocketContext';
import Login from './components/Login';
import BuyerDashboard from './components/BuyerDashboard';
import MerchantDashboard from './components/MerchantDashboard';

function AppContent() {
  const [user, setUser] = useState(null);

  const handleLogin = (userData) => {
    setUser(userData);
  };

  const handleLogout = () => {
    setUser(null);
  };

  if (!user) {
    return <Login onLogin={handleLogin} />;
  }

  if (user.role === 'merchant') {
    return <MerchantDashboard user={user} onLogout={handleLogout} />;
  }

  return <BuyerDashboard user={user} onLogout={handleLogout} />;
}

export default function App() {
  return (
    <SocketProvider>
      <AppContent />
    </SocketProvider>
  );
}
