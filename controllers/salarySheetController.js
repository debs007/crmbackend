const SalarySheet = require("../models/SalarySheet");
const Admin = require("../models/Admin");
const User = require("../models/User");

const isAdmin = async (userId) => !!(await Admin.findById(userId).select("_id").lean());

// Expected CSV column headers (case-insensitive, spaces/underscores flexible).
const HEADERS = ["empid","name","position","grosssalary","attendance","totalabsent","inhandsalary","ptax","remarks"];
const normalizeHeader = (h) => h.replace(/[\s_-]/g, "").toLowerCase();

// Very lightweight CSV parser — handles quoted fields with commas inside.
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { headers: [], rows: [] };

  const splitLine = (line) => {
    const out = [];
    let cur = "";
    let inQuote = false;
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === "," && !inQuote) { out.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    out.push(cur.trim());
    return out;
  };

  const rawHeaders = splitLine(lines[0]);
  const normalizedHeaders = rawHeaders.map(normalizeHeader);

  const idx = {};
  HEADERS.forEach((h) => {
    const i = normalizedHeaders.indexOf(h);
    idx[h] = i;
  });

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i]);
    if (!cols.length) continue;
    rows.push({
      empId:        cols[idx.empid] ?? "",
      name:         cols[idx.name] ?? "",
      position:     cols[idx.position] ?? "",
      grossSalary:  cols[idx.grosssalary] ?? "",
      attendance:   cols[idx.attendance] ?? "",
      totalAbsent:  cols[idx.totalabsent] ?? "",
      inHandSalary: cols[idx.inhandsalary] ?? "",
      ptax:         cols[idx.ptax] ?? "",
      remarks:      cols[idx.remarks] ?? "",
    });
  }
  return { headers: rawHeaders, rows };
}

// POST /salary-sheet/upload — admin uploads a CSV
exports.uploadSalarySheet = async (req, res) => {
  try {
    if (!(await isAdmin(req.user?.userId))) {
      return res.status(403).json({ success: false, message: "Admins only." });
    }
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, message: "CSV file required." });

    const month = Number(req.body.month);
    const year = Number(req.body.year);
    if (!month || !year || month < 1 || month > 12) {
      return res.status(400).json({ success: false, message: "Valid month and year required." });
    }

    const text = file.buffer.toString("utf-8");
    const { rows } = parseCsv(text);
    if (!rows.length) {
      return res.status(400).json({ success: false, message: "CSV has no data rows." });
    }

    const sheet = await SalarySheet.create({
      uploadedBy: req.user.userId,
      month,
      year,
      title: req.body.title || "",
      rows,
    });

    return res.status(201).json({ success: true, sheet });
  } catch (err) {
    console.error("uploadSalarySheet:", err);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
};

// GET /salary-sheet — admin: list all sheets; employee: only sheets where their empId appears
exports.listSalarySheets = async (req, res) => {
  try {
    const adminCaller = await isAdmin(req.user?.userId);
    if (adminCaller) {
      const sheets = await SalarySheet.find().sort({ year: -1, month: -1 }).lean();
      return res.json({ success: true, sheets });
    }
    // Employee — find their empId
    const user = await User.findById(req.user?.userId).select("empId name").lean();
    if (!user?.empId) {
      return res.json({ success: true, sheets: [], message: "No employee ID on your profile." });
    }
    const sheets = await SalarySheet.find({ "rows.empId": user.empId })
      .sort({ year: -1, month: -1 })
      .lean();
    // Trim each sheet to only the employee's row
    const trimmed = sheets.map((s) => ({
      ...s,
      rows: s.rows.filter((r) => r.empId === user.empId),
    }));
    return res.json({ success: true, sheets: trimmed });
  } catch (err) {
    console.error("listSalarySheets:", err);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
};

// DELETE /salary-sheet/:id — admin only
exports.deleteSalarySheet = async (req, res) => {
  try {
    if (!(await isAdmin(req.user?.userId))) {
      return res.status(403).json({ success: false, message: "Admins only." });
    }
    await SalarySheet.findByIdAndDelete(req.params.id);
    return res.json({ success: true });
  } catch (err) {
    console.error("deleteSalarySheet:", err);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
};
