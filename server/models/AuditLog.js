import mongoose from 'mongoose';

const EVENT_TYPES = [
  'NODE_ONLINE',
  'NODE_OFFLINE',
  'PAYMENT_INITIATED',
  'PAYMENT_APPROVED',
  'PAYMENT_REJECTED',
  'QR_GENERATED',
  'PAYMENT_VERIFIED',
  'THRESHOLD_REACHED'
];

const AuditLogSchema = new mongoose.Schema({
  eventType: {
    type: String,
    required: true,
    enum: EVENT_TYPES
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  actorNode: {
    type: Number,
    default: null
  },
  description: {
    type: String,
    required: true
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
});

AuditLogSchema.index({ timestamp: -1 });
AuditLogSchema.index({ actorNode: 1, timestamp: -1 });

export default mongoose.model('AuditLog', AuditLogSchema);