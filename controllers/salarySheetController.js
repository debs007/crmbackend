const SalarySheet = require("../models/SalarySheet");
const Admin = require("../models/Admin");
const User = require("../models/User");

const isAdmin = async (userId) => !!(await Admin.findById(userId).select("_id").lean());

// Expected CSV column headers with aliases so common variations all match.
// Normalize: lowercase, remove all spaces/underscores/dashes/dots.
const normalizeHeader = (h) => (h || "").replace(/[\s_\-\.]/g, "").toLowerCase();

const HEADER_ALIASES = {
  empid:        ["empid","empno","employeeid","employeeno","emp"],
  email:        ["email","emailaddress","employeeemail","mail"],
  name:         ["name","employeename","empname","fullname"],
  position:     ["position","designation","role","jobtitle"],
  grosssalary:  ["grosssalary","gross","grossamount","ctc"],
  attendance:   ["attendance","presentdays","working","daysworked","workingdays"],
  totalabsent:  ["totalabsent","absent","absentdays","totalabsents","leaves"],
  inhandsalary: ["inhandsalary","inhand","netsalary","netpay","nettakeaway","takehome"],
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
      empId: "", email: "", name: "", position: "", grossSalary: "",
      attendance: "", totalAbsent: "", inHandSalary: "", ptax: "", remarks: "",
    };
    const keyMap = {
      empid: "empId", email: "email", name: "name", position: "position",
      grosssalary: "grossSalary", attendance: "attendance",
      totalabsent: "totalAbsent", inhandsalary: "inHandSalary",
      ptax: "ptax", remarks: "remarks",
    };
    colToField.forEach((field, colIdx) => {
      if (field && keyMap[field] !== undefined) {
        row[keyMap[field]] = (cols[colIdx] ?? "").trim();
      }
    });
    // Skip rows where every field is empty (blank lines in the CSV)
    const hasData = Object.values(row).some((v) => v !== "");
    if (!hasData) continue;
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

    // Strip BOM if present (common in Excel-exported CSVs)
    let text = file.buffer.toString("utf-8").replace(/^\uFEFF/, "");
    const { rows, error: parseError } = parseCsv(text);

    if (parseError) {
      return res.status(400).json({ success: false, message: parseError });
    }
    if (!rows.length) {
      return res.status(400).json({ success: false, message: "CSV has no data rows. Check that headers match: EmpId, Name, Position, Gross Salary, Attendance, Total Absent, In Hand Salary, Ptax, Remarks" });
    }
    // Sanity cap — if parsed row count is suspiciously large, reject
    if (rows.length > 5000) {
      return res.status(400).json({ success: false, message: `CSV parsing produced ${rows.length} rows which seems wrong. Check the file format.` });
    }

    const sheet = await SalarySheet.create({
      uploadedBy: req.user.userId,
      month,
      year,
      title: req.body.title || "",
      rows,
    });

    return res.status(201).json({ success: true, sheet, rowCount: rows.length });
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
    // Employee — find their email and match against CSV rows
    const user = await User.findById(req.user?.userId).select("email name").lean();
    if (!user?.email) {
      return res.json({ success: true, sheets: [], message: "No email on your profile." });
    }
    const sheets = await SalarySheet.find({ "rows.email": user.email.toLowerCase() })
      .sort({ year: -1, month: -1 })
      .lean();
    // Trim each sheet to only this employee's row
    const trimmed = sheets.map((s) => ({
      ...s,
      rows: s.rows.filter((r) => r.email?.toLowerCase() === user.email.toLowerCase()),
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
