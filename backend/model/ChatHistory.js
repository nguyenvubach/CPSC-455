import mongoose from 'mongoose';

const ChatHistorySchema = new mongoose.Schema({
  chatroomName: { type: String, required: true, index: true },
  from: { type: String, required: true },
  message: { type: String },
  encryptedMessage: { type: Array },
  iv: { type: Array },
  encryptedAesKey: { type: Array },
  file: { type: Buffer },
  mimeType: { type: String },
  timestamp: { type: Date, default: Date.now },
});

export default mongoose.model('ChatHiistory', ChatHistorySchema);
