const nodePath = require("path");
const fs = require("fs");
const Payslip = require("../models/Payslip");
const User = require("../models/User");
const Admin = require("../models/Admin");
const sendMail = require("../services/sendMail");
const { emitToUser } = require("../utils/socket");

// Ensure uploads/payslips folder exists
const PAYSLIPS_DIR = nodePath.join(__dirname, "..", "uploads", "payslips");
if (!fs.existsSync(PAYSLIPS_DIR)) {
  fs.mkdirSync(PAYSLIPS_DIR, { recursive: true });
}

const parseInteger = (value) => {
  const num = Number(value);
  return Number.isInteger(num) ? num : NaN;
};

const isAdminCaller = async (userId) => {
  if (!userId) return false;
  const admin = await Admin.findById(userId).select("_id").lean();
  return !!admin;
};

// POST /payslips — admin uploads a payslip for one employee
// multipart: { file, employeeId, year, month, note }
exports.uploadPayslip = async (req, res) => {
  try {
    const isAdmin = await isAdminCaller(req.user?.userId);
    if (!isAdmin) {
      return res
        .status(403)
        .json({ success: false, message: "Only admins can upload payslips." });
    }

    const file = req.file;
    if (!file) {
      return res
        .status(400)
        .json({ success: false, message: "Payslip file is required." });
    }

    const { employeeId, note } = req.body;
    const year = parseInteger(req.body.year);
    const month = parseInteger(req.body.month);

    if (!employeeId || Number.isNaN(year) || Number.isNaN(month)) {
      return res.status(400).json({
        success: false,
        message: "employeeId, year and month are required.",
      });
    }
    if (month < 1 || month > 12) {
      return res
        .status(400)
        .json({ success: false, message: "month must be between 1 and 12." });
    }

    const employee = await User.findById(employeeId);
    if (!employee) {
      return res
        .status(404)
        .json({ success: false, message: "Employee not found." });
    }

    const originalName = file.originalname || `payslip-${year}-${month}.pdf`;
    // Build a unique filename: employeeId_year_month_originalName
    const safeOriginal = originalName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const diskFileName = `${employeeId}_${year}_${month}_${Date.now()}_${safeOriginal}`;
    const diskFilePath = nodePath.join(PAYSLIPS_DIR, diskFileName);

    // Remove old file for this employee/year/month if one exists
    const existing = await Payslip.findOne({ employeeId, year, month }).lean();
    if (existing?.filePath) {
      const oldPath = nodePath.join(__dirname, "..", existing.filePath);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    // Write new file to disk
    fs.writeFileSync(diskFilePath, file.buffer);

    // Store relative path so it's portable
    const relPath = nodePath.join("uploads", "payslips", diskFileName);

    const payslip = await Payslip.findOneAndUpdate(
      { employeeId, year, month },
      {
        employeeId,
        year,
        month,
        fileUrl: "",          // no longer used
        filePath: relPath,
        fileName: originalName,
        note: note || "",
        uploadedBy: req.user.userId,
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    // Best-effort notification — never fail the upload because the email failed.
    try {
      if (employee.email) {
        const monthLabel = new Date(year, month - 1, 1).toLocaleString(
          "en-US",
          { month: "long" }
        );
        await sendMail(
          employee.email,
          `Your payslip for ${monthLabel} ${year} is ready`,
          `Hello ${employee.name},\n\nYour payslip for ${monthLabel} ${year} is now available in your dashboard. Sign in to download it.\n\nBest regards,\nDigital Mitro`
        );
      }
    } catch (mailError) {
      console.warn("payslip email failed:", mailError?.message);
    }

    // Push a soft-refresh event so any open employee dashboard updates.
    try {
      emitToUser(employeeId, "payslip-updated", {
        year,
        month,
      });
    } catch (socketError) {
      // socket is optional; ignore
    }

    return res
      .status(201)
      .json({ success: true, message: "Payslip uploaded.", payslip });
  } catch (error) {
    console.error("uploadPayslip error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

// GET /payslips/employee/:employeeId — list all payslips for one employee
// Employees can fetch their own; admins can fetch any.
exports.listEmployeePayslips = async (req, res) => {
  try {
    const requesterId = req.user?.userId;
    const targetId = req.params.employeeId;

    const isAdmin = await isAdminCaller(requesterId);
    const isOwner = requesterId?.toString() === targetId?.toString();
    if (!isAdmin && !isOwner) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized." });
    }

    const payslips = await Payslip.find({ employeeId: targetId })
      .sort({ year: -1, month: -1 })
      .lean();

    return res.json({ success: true, payslips });
  } catch (error) {
    console.error("listEmployeePayslips error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

// GET /payslips/me — convenience endpoint for the signed-in employee
exports.listMyPayslips = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const payslips = await Payslip.find({ employeeId: userId })
      .sort({ year: -1, month: -1 })
      .lean();
    return res.json({ success: true, payslips });
  } catch (error) {
    console.error("listMyPayslips error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

// DELETE /payslips/:id — admin only
exports.deletePayslip = async (req, res) => {
  try {
    const isAdmin = await isAdminCaller(req.user?.userId);
    if (!isAdmin) {
      return res
        .status(403)
        .json({ success: false, message: "Only admins can delete payslips." });
    }
    const slip = await Payslip.findByIdAndDelete(req.params.id);
    if (!slip) {
      return res
        .status(404)
        .json({ success: false, message: "Payslip not found." });
    }
    // Remove the file from disk
    if (slip.filePath) {
      const fullPath = nodePath.join(__dirname, "..", slip.filePath);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }
    return res.json({ success: true, message: "Payslip deleted." });
  } catch (error) {
    console.error("deletePayslip error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

// GET /payslips/download/:id — authenticated download; employee can only download their own
exports.downloadPayslip = async (req, res) => {
  try {
    const requesterId = req.user?.userId;
    const slip = await Payslip.findById(req.params.id).lean();
    if (!slip) {
      return res.status(404).json({ success: false, message: "Payslip not found." });
    }

    const isAdmin = await isAdminCaller(requesterId);
    const isOwner = slip.employeeId?.toString() === requesterId?.toString();
    if (!isAdmin && !isOwner) {
      return res.status(403).json({ success: false, message: "Not authorized." });
    }

    if (!slip.filePath) {
      return res.status(404).json({ success: false, message: "File path missing." });
    }

    const fullPath = nodePath.join(__dirname, "..", slip.filePath);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ success: false, message: "File not found on server." });
    }

    res.download(fullPath, slip.fileName || "payslip.pdf");
  } catch (error) {
    console.error("downloadPayslip error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};
