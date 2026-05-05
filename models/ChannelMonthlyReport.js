const mongoose = require("mongoose");

const channelMonthlyReportSchema = new mongoose.Schema(
  {
    channelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Channel",
      required: true,
      index: true,
    },
    year: { type: Number, required: true, index: true },
    month: {
      type: Number,
      required: true,
      min: 1,
      max: 12,
      index: true,
    },
    fileUrl: { type: String, required: true },
    fileName: { type: String, default: "report.pdf" },
    title: { type: String, default: "" },
    note: { type: String, default: "" },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
  },
  { timestamps: true }
);

// One report per channel per (year, month). Re-uploads replace.
channelMonthlyReportSchema.index({ channelId: 1, year: 1, month: 1 }, { unique: true });

const ChannelMonthlyReport = mongoose.model(
  "ChannelMonthlyReport",
  channelMonthlyReportSchema
);
module.exports = ChannelMonthlyReport;
