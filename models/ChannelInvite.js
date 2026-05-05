
const mongoose = require('mongoose')

const ChannelInviteSchema = new mongoose.Schema({
    channel: { type: mongoose.Schema.Types.ObjectId, ref: "Channel", required: true },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    email: { type: String, required: true }, // Email of the invited user
    status: { type: String, enum: ["pending", "accepted", "declined"], default: "pending" },
    createdAt: { type: Date, default: Date.now },
  });
  
  const ChannelInvite = mongoose.model("ChannelInvite", ChannelInviteSchema);
  module.exports = ChannelInvite;
  