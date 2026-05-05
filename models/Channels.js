const mongoose = require("mongoose");

// Predefined channel status options (Tag #1 in feature spec)
const CHANNEL_STATUS_OPTIONS = ["Active", "Archived", "Paused", "Closed"];

// Predefined "category" tags users can pick from for tags 2 & 3
const PREDEFINED_TAG_OPTIONS = [
  "Sales",
  "Support",
  "Marketing",
  "Internal",
  "Project",
  "Client",
  "Engineering",
  "Finance",
  "HR",
  "Operations",
];

const ChannelSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: "" },
  // Optional channel image URL (Cloudinary). If empty, UI falls back to first-letter avatar.
  image: { type: String, default: "" },
  // Tag 1 — channel status, restricted to predefined options.
  statusTag: {
    type: String,
    enum: CHANNEL_STATUS_OPTIONS,
    default: "Active",
  },
  // Tags 2 & 3 — free-form (predefined or custom). Capped at two entries.
  tags: {
    type: [String],
    default: [],
    validate: {
      validator: (arr) => Array.isArray(arr) && arr.length <= 2,
      message: "A channel can have at most 2 additional tags.",
    },
  },
  // Optional extra channel-detail fields shown in the Channel Details section.
  channelDetails: {
    purpose: { type: String, default: "" },
    industry: { type: String, default: "" },
    website: { type: String, default: "" },
    location: { type: String, default: "" },
  },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  inviteLink: { type: String, unique: true },
  createdAt: { type: Date, default: Date.now },
});

const Channel = mongoose.model("Channel", ChannelSchema);

module.exports = Channel;
module.exports.CHANNEL_STATUS_OPTIONS = CHANNEL_STATUS_OPTIONS;
module.exports.PREDEFINED_TAG_OPTIONS = PREDEFINED_TAG_OPTIONS;
