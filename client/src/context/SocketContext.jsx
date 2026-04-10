import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [auditLogs, setAuditLogs] = useState([]);
  const [lastSeen, setLastSeen] = useState({});

  useEffect(() => {
    const newSocket = io(import.meta.env.VITE_API_URL || 'http://localhost:5001', {
      transports: ['websocket', 'polling']
    });

    newSocket.on('connect', () => {
      console.log('Connected to server');
      setIsConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from server');
      setIsConnected(false);
    });

    newSocket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      setIsConnected(false);
    });

    newSocket.on('audit_log_new', (data) => {
      setAuditLogs(prev => {
        const newLog = {
          _id: data._id || Date.now().toString(),
          eventType: data.eventType,
          timestamp: new Date(data.timestamp),
          actorNode: data.actorNode,
          description: data.description,
          metadata: data.metadata
        };
        return [newLog, ...prev].slice(0, 50);
      });
    });

    newSocket.on('audit_logs_response', (data) => {
      if (data.logs && Array.isArray(data.logs)) {
        setAuditLogs(data.logs.map(log => ({
          ...log,
          timestamp: new Date(log.timestamp)
        })));
      }
      if (data.lastSeen) {
        setLastSeen(data.lastSeen);
      }
    });

    newSocket.on('audit_logs_broadcast', (data) => {
      if (data.lastSeen) {
        setLastSeen(data.lastSeen);
      }
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, []);

  const fetchAuditLogs = useCallback((limit = 50) => {
    if (socket) {
      socket.emit('get_audit_logs', { limit });
    }
  }, [socket]);

  const clearDisplayLogs = useCallback(() => {
    setAuditLogs([]);
  }, []);

  return (
    <SocketContext.Provider value={{ socket, isConnected, auditLogs, lastSeen, fetchAuditLogs, clearDisplayLogs }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
}