const SalarySheet = require("../models/SalarySheet");
const Admin = require("../models/Admin");
const User = require("../models/User");

const isAdmin = async (userId) => !!(await Admin.findById(userId).select("_id").lean());

// Expected CSV column headers with aliases so common variations all match.
// Normalize: lowercase, remove all spaces/underscores/dashes/dots.
const normalizeHeader = (h) => (h || "").replace(/[\s_\-\.]/g, "").toLowerCase();

const HEADER_ALIASES = {
  empid:        ["empid","empno","employeeid","employeeno","emp"],
  name:         ["name","employeename","empname","fullname"],
  position:     ["position","designation","role","jobtitle"],
  grosssalary:  ["grosssalary","gross","grossamount","ctc"],
  attendance:   ["attendance","presentdays","working","daysworked","workingdays"],
  totalabsent:  ["totalabsent","absent","absentdays","totalabsents","leaves"],
  inhandsalary: ["inhandsalary","inhand","netsalary","netpay","nettakeaway","takehome","netsalary"],
  ptax:         ["ptax","professionaltax","ptaxamount","tax"],
  remarks:      ["remarks","note","notes","comment","comments"],
};

// Build a map from any alias → canonical key
const ALIAS_MAP = {};
Object.entries(HEADER_ALIASES).forEach(([canonical, aliases]) => {
  aliases.forEach((a) => { ALIAS_MAP[a] = canonical; });
});

// Very lightweight CSV parser — handles quoted fields with commas inside.
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
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

  // Map each column index → canonical field name (or null if unknown)
  const colToField = rawHeaders.map((h) => ALIAS_MAP[normalizeHeader(h)] || null);

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = splitLine(lines[i]);
    const row = {
      empId: "", name: "", position: "", grossSalary: "",
      attendance: "", totalAbsent: "", inHandSalary: "", ptax: "", remarks: "",
    };
    // Camel-case field names for the canonical keys
    const keyMap = {
      empid: "empId", name: "name", position: "position",
      grosssalary: "grossSalary", attendance: "attendance",
      totalabsent: "totalAbsent", inhandsalary: "inHandSalary",
      ptax: "ptax", remarks: "remarks",
    };
    colToField.forEach((field, colIdx) => {
      if (field && keyMap[field] !== undefined) {
        row[keyMap[field]] = cols[colIdx] ?? "";
      }
    });
    rows.push(row);
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
    console.error("uploadSalarySheet error:", err?.message, err?.stack?.split("\n")[1]);
    return res.status(500).json({ success: false, message: err?.message || "Internal server error." });
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
