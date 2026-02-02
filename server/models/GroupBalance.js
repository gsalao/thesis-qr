import mongoose from 'mongoose';

const GroupBalanceSchema = new mongoose.Schema({
  _id: { type: String, default: 'joint-account' },
  balance: { type: Number, default: 1000000 },
  currency: { type: String, default: 'PHP' },
  lastUpdated: { type: Date, default: Date.now }
});

export default mongoose.model('GroupBalance', GroupBalanceSchema);
