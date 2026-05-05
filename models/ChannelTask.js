const mongoose = require("mongoose");

const taskAttachmentSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      default: "file",
      trim: true,
    },
    mimeType: {
      type: String,
      default: "",
      trim: true,
    },
    size: {
      type: Number,
      default: 0,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const taskCommentSchema = new mongoose.Schema({
  content: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2000,
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },
  mentions: {
    type: [mongoose.Schema.Types.ObjectId],
    default: [],
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const taskActivitySchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { _id: true }
);

const channelTaskSchema = new mongoose.Schema(
  {
    channelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Channel",
      required: true,
      index: true,
    },
    taskNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    description: {
      type: String,
      default: "",
      trim: true,
      maxlength: 2000,
    },
    deadline: {
      type: Date,
      required: true,
      index: true,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["Assigned", "Acknowledged", "Completed"],
      default: "Assigned",
      index: true,
    },
    priority: {
      type: String,
      enum: ["Low", "Medium", "High", "Urgent"],
      default: "Medium",
      index: true,
    },
    tags: {
      type: [String],
      default: [],
      index: true,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    overdueNotified: {
      type: Boolean,
      default: false,
      index: true,
    },
    reminderRules: {
      enabled: {
        type: Boolean,
        default: true,
      },
      // Minutes before deadline when reminders should be sent
      minutesBefore: {
        type: [Number],
        default: [1440, 60],
      },
      // Internal tracker to prevent duplicate reminder sends
      sentMinutesBefore: {
        type: [Number],
        default: [],
      },
    },
    escalationRules: {
      enabled: {
        type: Boolean,
        default: true,
      },
      // Minutes after deadline before escalation triggers
      minutesAfterDue: {
        type: Number,
        default: 120,
      },
      // Internal tracker to prevent duplicate escalations
      escalatedAt: {
        type: Date,
        default: null,
      },
    },
    attachments: {
      type: [taskAttachmentSchema],
      default: [],
    },
    comments: {
      type: [taskCommentSchema],
      default: [],
    },
    activityLog: {
      type: [taskActivitySchema],
      default: [],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ChannelTask", channelTaskSchema);
