const mongoose = require("mongoose");

// One document per CSV upload batch. Each batch has many rows.
const SalarySheetSchema = new mongoose.Schema(
  {
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    year: { type: Number, required: true },
    title: { type: String, default: "" },
    rows: [
      {
        empId: { type: String, required: true },      // matches User.empId
        name: { type: String, default: "" },
        position: { type: String, default: "" },
        grossSalary: { type: String, default: "" },
        attendance: { type: String, default: "" },
        totalAbsent: { type: String, default: "" },
        inHandSalary: { type: String, default: "" },
        ptax: { type: String, default: "" },
        remarks: { type: String, default: "" },
      },
    ],
  },
  { timestamps: true }
);

// Index so employee queries by empId are fast.
SalarySheetSchema.index({ year: 1, month: 1 });
SalarySheetSchema.index({ "rows.empId": 1 });

module.exports = mongoose.model("SalarySheet", SalarySheetSchema);
