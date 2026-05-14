const path = require("path");
const fs = require("fs");
const ChannelMonthlyReport = require("../models/ChannelMonthlyReport");
const Channel = require("../models/Channels");
const Admin = require("../models/Admin");
const { getIo } = require("../utils/socket");

// Reports are stored locally on the server under uploads/reports/.
// They are served via /uploads/reports/<filename> (static middleware
// registered in server.js). This replaces the previous Cloudinary upload
// so the files stay on the dedicated server (fix #7).
const REPORTS_DIR = path.join(__dirname, "..", "uploads", "reports");

const parseInteger = (value) => {
  const num = Number(value);
  return Number.isInteger(num) ? num : NaN;
};

const isAdminCaller = async (userId) => {
  if (!userId) return false;
  const admin = await Admin.findById(userId).select("_id").lean();
  return !!admin;
};

const isChannelMember = async (channelId, userId) => {
  if (!channelId || !userId) return false;
  const channel = await Channel.findById(channelId).select("members owner").lean();
  if (!channel) return false;
  const memberIds = (channel.members || []).map((id) => id.toString());
  if (memberIds.includes(userId.toString())) return true;
  if (channel.owner?.toString() === userId.toString()) return true;
  return false;
};

// POST /channels/:channelId/reports — admin uploads a report.
// Multiple reports per (channel, year, month) are now allowed (fix #8).
// File is saved to local disk, not Cloudinary (fix #7).
exports.uploadMonthlyReport = async (req, res) => {
  try {
    const isAdmin = await isAdminCaller(req.user?.userId);
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: "Only admins can upload reports." });
    }

    const { channelId } = req.params;
    const channel = await Channel.findById(channelId).select("_id name");
    if (!channel) {
      return res.status(404).json({ success: false, message: "Channel not found." });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: "Report file is required." });
    }

    const year = parseInteger(req.body.year);
    const month = parseInteger(req.body.month);
    if (Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12) {
      return res.status(400).json({ success: false, message: "Valid year and month are required." });
    }

    // Ensure the upload directory exists.
    if (!fs.existsSync(REPORTS_DIR)) {
      fs.mkdirSync(REPORTS_DIR, { recursive: true });
    }

    // Save file to disk with a unique timestamped name so multiple uploads
    // in the same month don't clash on disk (fix #8).
    const sanitizedOriginal = (file.originalname || "report.pdf")
      .replace(/[^a-zA-Z0-9._-]/g, "_");
    const diskFileName = `${channelId}-${year}-${month}-${Date.now()}-${sanitizedOriginal}`;
    const diskPath = path.join(REPORTS_DIR, diskFileName);
    fs.writeFileSync(diskPath, file.buffer);

    // The public URL served by Express static middleware.
    const fileUrl = `/uploads/reports/${diskFileName}`;
    const fileName = file.originalname || diskFileName;

    // Insert a new document — NOT upsert. Each upload is its own record
    // (fix #8: no override of previous reports for the same month).
    const report = await ChannelMonthlyReport.create({
      channelId,
      year,
      month,
      fileUrl,
      fileName,
      title: req.body.title || "",
      note: req.body.note || "",
      uploadedBy: req.user.userId,
    });

    // Post a system message so the report appears in the channel chat timeline.
    // We store the report _id on the message so we can delete the message
    // when the report is deleted (fix #6b — deleted reports in chat).
    try {
      const ChannelMessage = require("../models/ChannelMessage");
      const monthLabelFor = (m) =>
        ["January","February","March","April","May","June",
         "July","August","September","October","November","December"][m - 1] || String(m);
      const reportLabel = req.body.title || `${monthLabelFor(month)} ${year} task report`;
      const systemMessage = await new ChannelMessage({
        channelId,
        sender: null,
        isSystem: true,
        systemLabel: "Monthly Report",
        message: fileUrl,
        // Store report id so we can delete this message when the report is removed.
        reportId: report._id,
        replyPreview: {
          message: reportLabel,
          senderName: "Monthly Report",
        },
        seenBy: [],
      }).save();
      const io = getIo();
      io.to(channelId.toString()).emit("new-channel-message", systemMessage);
    } catch (chatPostError) {
      console.warn("Could not post report system message:", chatPostError?.message);
    }

    try {
      const io = getIo();
      io.to(channelId).emit("channel-report-updated", { channelId, year, month });
    } catch (e) { /* socket optional */ }

    return res.status(201).json({ success: true, message: "Report uploaded.", report });
  } catch (error) {
    console.error("uploadMonthlyReport error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// GET /channels/:channelId/reports
exports.listMonthlyReports = async (req, res) => {
  try {
    const { channelId } = req.params;
    const allowed = await isChannelMember(channelId, req.user?.userId);
    const isAdmin = await isAdminCaller(req.user?.userId);
    if (!allowed && !isAdmin) {
      return res.status(403).json({ success: false, message: "Not a channel member." });
    }
    const reports = await ChannelMonthlyReport.find({ channelId })
      .sort({ year: -1, month: -1, createdAt: -1 })
      .lean();
    return res.json({ success: true, reports });
  } catch (error) {
    console.error("listMonthlyReports error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// DELETE /channels/:channelId/reports/:id — admin only.
// Also deletes the associated system message in the chat (fix #6b).
exports.deleteMonthlyReport = async (req, res) => {
  try {
    const isAdmin = await isAdminCaller(req.user?.userId);
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: "Only admins can delete reports." });
    }

    const report = await ChannelMonthlyReport.findOneAndDelete({
      _id: req.params.id,
      channelId: req.params.channelId,
    });
    if (!report) {
      return res.status(404).json({ success: false, message: "Report not found." });
    }

    // Delete the file from disk.
    try {
      if (report.fileUrl && report.fileUrl.startsWith("/uploads/")) {
        const diskPath = path.join(__dirname, "..", report.fileUrl);
        if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
      }
    } catch (fsErr) {
      console.warn("Could not delete report file from disk:", fsErr?.message);
    }

    // Delete the system message in the channel chat (fix #6b).
    try {
      const ChannelMessage = require("../models/ChannelMessage");
      const deleted = await ChannelMessage.findOneAndDelete({
        channelId: req.params.channelId,
        isSystem: true,
        reportId: report._id,
      });
      if (deleted) {
        // Notify clients so the message disappears without a reload.
        const io = getIo();
        io.to(req.params.channelId).emit("channel-message-deleted", {
          messageId: deleted._id,
        });
      }
    } catch (msgErr) {
      console.warn("Could not delete report system message:", msgErr?.message);
    }

    return res.json({ success: true, message: "Report deleted." });
  } catch (error) {
    console.error("deleteMonthlyReport error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};
