const ChannelMonthlyReport = require("../models/ChannelMonthlyReport");
const Channel = require("../models/Channels");
const Admin = require("../models/Admin");
const { uploadToCloudinary } = require("../utils/fileUpload");
const { getIo } = require("../utils/socket");

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

// POST /channels/:channelId/reports — admin uploads a monthly report
// multipart: { file, year, month, title, note }
exports.uploadMonthlyReport = async (req, res) => {
  try {
    const isAdmin = await isAdminCaller(req.user?.userId);
    if (!isAdmin) {
      return res
        .status(403)
        .json({ success: false, message: "Only admins can upload reports." });
    }

    const { channelId } = req.params;
    const channel = await Channel.findById(channelId).select("_id name");
    if (!channel) {
      return res
        .status(404)
        .json({ success: false, message: "Channel not found." });
    }

    const file = req.file;
    if (!file) {
      return res
        .status(400)
        .json({ success: false, message: "Report file is required." });
    }

    const year = parseInteger(req.body.year);
    const month = parseInteger(req.body.month);
    if (Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12) {
      return res
        .status(400)
        .json({ success: false, message: "Valid year and month are required." });
    }

    const fileName =
      file.originalname || `report-${channel.name || "channel"}-${year}-${month}.pdf`;
    const url = await uploadToCloudinary(file.buffer, fileName, "channel_reports");

    const report = await ChannelMonthlyReport.findOneAndUpdate(
      { channelId, year, month },
      {
        channelId,
        year,
        month,
        fileUrl: url,
        fileName,
        title: req.body.title || "",
        note: req.body.note || "",
        uploadedBy: req.user.userId,
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    // Notify everyone currently in the channel room.
    try {
      const io = getIo();
      io.to(channelId).emit("channel-report-updated", {
        channelId,
        year,
        month,
      });
    } catch (e) {
      // socket optional
    }

    return res
      .status(201)
      .json({ success: true, message: "Report uploaded.", report });
  } catch (error) {
    console.error("uploadMonthlyReport error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

// GET /channels/:channelId/reports — anyone in the channel can list
exports.listMonthlyReports = async (req, res) => {
  try {
    const { channelId } = req.params;
    const allowed = await isChannelMember(channelId, req.user?.userId);
    const isAdmin = await isAdminCaller(req.user?.userId);
    if (!allowed && !isAdmin) {
      return res
        .status(403)
        .json({ success: false, message: "Not a channel member." });
    }

    const reports = await ChannelMonthlyReport.find({ channelId })
      .sort({ year: -1, month: -1 })
      .lean();

    return res.json({ success: true, reports });
  } catch (error) {
    console.error("listMonthlyReports error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

// DELETE /channels/:channelId/reports/:id — admin only
exports.deleteMonthlyReport = async (req, res) => {
  try {
    const isAdmin = await isAdminCaller(req.user?.userId);
    if (!isAdmin) {
      return res
        .status(403)
        .json({ success: false, message: "Only admins can delete reports." });
    }
    const report = await ChannelMonthlyReport.findOneAndDelete({
      _id: req.params.id,
      channelId: req.params.channelId,
    });
    if (!report) {
      return res
        .status(404)
        .json({ success: false, message: "Report not found." });
    }
    return res.json({ success: true, message: "Report deleted." });
  } catch (error) {
    console.error("deleteMonthlyReport error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};
