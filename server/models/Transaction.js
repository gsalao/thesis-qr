import mongoose from 'mongoose';

const SignatureSchema = new mongoose.Schema({
  nodeId: { type: Number, required: true },
  signature: {
    x: { type: String, required: true },
    y: { type: String, required: true },
    z: { type: String }
  },
  timestamp: { type: Date, default: Date.now }
});

const TransactionSchema = new mongoose.Schema({
  nonce: { type: String, required: true, unique: true },
  amount: { type: Number, required: true },
  requesterId: { type: Number, required: true },
  status: {
    type: String,
    enum: ['PENDING', 'COMPLETED', 'FAILED', 'EXPIRED'],
    default: 'PENDING'
  },
  threshold: { type: Number, required: true },
  collectedSignatures: [SignatureSchema],
  aggregatedSignature: {
    x: String,
    y: String,
    z: String
  },
  qrData: {
    amount: Number,
    timestamp: Number,
    nonce: String,
    signature: {
      x: String,
      y: String,
      z: String
    }
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date },
  rejectedBy: { type: [String], default: [] }
});

TransactionSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

TransactionSchema.index({ status: 1 });
TransactionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 3600 });

export default mongoose.model('Transaction', TransactionSchema);
