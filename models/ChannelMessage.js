const mongoose = require("mongoose");

const ChannelMessageSchema = new mongoose.Schema({
  channelId: { type: mongoose.Schema.Types.ObjectId, ref: "Channel", required: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  isSystem: { type: Boolean, default: false },
  systemLabel: { type: String, default: null },
  // When isSystem=true and the message represents a report upload, this
  // stores the ChannelMonthlyReport _id so we can cascade-delete the message
  // when the report is deleted (fix #6b).
  reportId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  // Pin fields — WhatsApp style (fix #5). No time constraint. Anyone can pin.
  isPinned: { type: Boolean, default: false, index: true },
  pinnedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
  pinnedAt: { type: Date, default: null },
  message: {
    type: String,
    // Required only when there are no attachments; an attachment-only post
    // is fine.
    required: function () {
      return !this.attachments || this.attachments.length === 0;
    },
    default: "",
  },
  // Optional list of attachment URLs (Cloudinary). When present, the renderer
  // shows them as a grid/carousel and treats `message` as caption text.
  // Sending one or more files goes here instead of as separate messages so
  // they can be edited/deleted/replied to as a single unit.
  attachments: {
    type: [String],
    default: [],
  },
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
