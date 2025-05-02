import mongoose from 'mongoose';


const ChatHistorySchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true },
  },
  { timestamps: true }
);

export default mongoose.model('User', ChatHistorySchema);
