const mongoose = require("mongoose");

const ChannelMessageSchema = new mongoose.Schema({
  channelId: { type: mongoose.Schema.Types.ObjectId, ref: "Channel", required: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  isSystem: { type: Boolean, default: false },
  systemLabel: { type: String, default: null },
  message: { type: String, required: true },
  // Mentioned user IDs (any of User/Admin/Client) at time of send.
  mentions: {
    type: [mongoose.Schema.Types.ObjectId],
    default: [],
  },
  seenBy: [{ type: mongoose.Schema.Types.ObjectId, default: [] }],
  replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "ChannelMessage", default: null },
  replyPreview: {
    message: { type: String },
    sender: { type: mongoose.Schema.Types.ObjectId, default: null },
    senderName: { type: String },
  },
  // Edit / delete tracking. We keep a tombstone so chat history stays consistent.
  editedAt: { type: Date, default: null },
  isDeleted: { type: Boolean, default: false, index: true },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
  createdAt: { type: Date, default: Date.now },
});

const ChannelMessage = mongoose.model("ChannelMessage", ChannelMessageSchema);
module.exports = ChannelMessage;
