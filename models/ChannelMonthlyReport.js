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
    // fileUrl now points to a local path served by the backend, e.g.
    // /uploads/reports/filename.pdf — NOT a Cloudinary URL (fix #7).
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

// Multiple reports per (channel, year, month) are allowed — fix #8.
// The old unique index is intentionally removed.
// Query by (channelId, year, month) to list all reports for a period.
channelMonthlyReportSchema.index({ channelId: 1, year: 1, month: 1 });

const ChannelMonthlyReport = mongoose.model(
  "ChannelMonthlyReport",
  channelMonthlyReportSchema
);
module.exports = ChannelMonthlyReport;
