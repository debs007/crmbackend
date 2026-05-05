const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", 
      default: null 
    },
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    type: {
      type: String,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    // Tracks which users dismissed broadcast notifications
    dismissedBy: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    image: {
      type: String, 
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Notification", notificationSchema);
