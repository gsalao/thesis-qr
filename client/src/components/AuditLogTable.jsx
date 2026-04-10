import { useEffect, useState, useMemo } from 'react';
import { useSocket } from '../context/SocketContext';

const EVENT_TYPE_COLORS = {
  NODE_ONLINE: 'bg-green-100 text-green-800',
  NODE_OFFLINE: 'bg-gray-100 text-gray-800',
  PAYMENT_INITIATED: 'bg-blue-100 text-blue-800',
  PAYMENT_APPROVED: 'bg-success-100 text-success-800',
  PAYMENT_REJECTED: 'bg-danger-100 text-danger-800',
  QR_GENERATED: 'bg-purple-100 text-purple-800',
  PAYMENT_VERIFIED: 'bg-yellow-100 text-yellow-800',
  THRESHOLD_REACHED: 'bg-primary-100 text-primary-800'
};

function formatPHTDate(date) {
  if (!date) return '';
  const d = new Date(date);
  const options = {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  };
  const formatted = d.toLocaleString('en-PH', options);
  return formatted.replace(',', '');
}

export default function AuditLogTable({ user, onHome, isMerchantView = false }) {
  const { socket, auditLogs, lastSeen, fetchAuditLogs, clearDisplayLogs } = useSocket();
  const [displayedLogs, setDisplayedLogs] = useState([]);

  useEffect(() => {
    fetchAuditLogs(50);
  }, [fetchAuditLogs]);

  useEffect(() => {
    setDisplayedLogs(auditLogs);
  }, [auditLogs]);

  const filteredLogs = useMemo(() => {
    if (isMerchantView) {
      return displayedLogs.filter(log => 
        log.eventType === 'PAYMENT_VERIFIED' ||
        log.eventType === 'QR_GENERATED' ||
        log.eventType === 'PAYMENT_INITIATED' ||
        log.eventType === 'PAYMENT_APPROVED' ||
        log.eventType === 'PAYMENT_REJECTED' ||
        log.eventType === 'THRESHOLD_REACHED'
      );
    }
    
    const nodeId = user?.nodeId;
    return displayedLogs.filter(log => {
      if (log.eventType === 'NODE_ONLINE' || log.eventType === 'NODE_OFFLINE') {
        return log.actorNode === nodeId;
      }
      if (log.eventType === 'PAYMENT_INITIATED') {
        return log.actorNode === nodeId;
      }
      if (log.eventType === 'PAYMENT_APPROVED' || log.eventType === 'PAYMENT_REJECTED') {
        return log.actorNode === nodeId;
      }
      if (log.eventType === 'PAYMENT_VERIFIED') {
        return false;
      }
      return true;
    });
  }, [displayedLogs, user?.nodeId, isMerchantView]);

  const getLastSeenTime = (nodeId) => {
    const lastSeenTime = lastSeen[nodeId];
    if (!lastSeenTime) return 'Offline';
    return formatPHTDate(lastSeenTime);
  };

  const handleClearLog = () => {
    setDisplayedLogs([]);
    clearDisplayLogs();
  };

  const handleRefresh = () => {
    fetchAuditLogs(50);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <button
                onClick={onHome}
                className="text-gray-600 hover:text-gray-800 px-3 py-2 text-sm font-medium flex items-center gap-1"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                Home
              </button>
              <span className="text-xl font-bold text-gray-800 mx-2">Audit Logs</span>
              <span className="badge bg-gray-100 text-gray-600">{filteredLogs.length} entries</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleRefresh}
                className="text-gray-600 hover:text-gray-800 px-3 py-2 text-sm font-medium flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
              <button
                onClick={handleClearLog}
                className="text-danger-600 hover:text-danger-800 px-3 py-2 text-sm font-medium"
              >
                Clear Display
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!isMerchantView && Object.keys(lastSeen).length > 0 && (
          <div className="card mb-6">
            <h3 className="text-sm font-semibold text-gray-600 mb-3">Node Status (Last Seen)</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {Object.entries(lastSeen).map(([nodeId, time]) => (
                <div key={nodeId} className="p-2 bg-gray-50 rounded-lg text-center">
                  <span className="text-sm font-medium text-gray-700">
                    {nodeId === "99" ? "Merchant Node" : `Node ${nodeId}`}
                  </span>
                  <p className="text-xs text-gray-500 mt-1">{getLastSeenTime(nodeId)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-800">
              {isMerchantView ? 'Verification & Transaction Events' : 'Audit Log Events'}
            </h2>
            <span className="text-sm text-gray-500">Showing {filteredLogs.length} of {filteredLogs.length} entries</span>
          </div>
          
          {filteredLogs.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No audit logs to display</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Timestamp (PHT)
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Event Type
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Description
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actor
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredLogs.map((log, index) => (
                    <tr key={log._id || index} className="hover:bg-gray-50">
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600 font-mono">
                        {formatPHTDate(log.timestamp)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${EVENT_TYPE_COLORS[log.eventType] || 'bg-gray-100 text-gray-800'}`}>
                          {log.eventType}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-800">
                        {log.description}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        {log.actorNode ? (
                          <span className="badge bg-primary-50 text-primary-700">Node {log.actorNode}</span>
                        ) : log.eventType === 'PAYMENT_VERIFIED' ? (
                          <span className="badge bg-purple-50 text-purple-700">Merchant</span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}