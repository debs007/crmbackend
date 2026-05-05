const mongoose = require("mongoose");

const payslipSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Year + month form a logical unique pair per employee.
    year: { type: Number, required: true, index: true },
    // 1 = January, 12 = December
    month: {
      type: Number,
      required: true,
      min: 1,
      max: 12,
      index: true,
    },
    fileUrl: { type: String, required: true },
    fileName: { type: String, default: "payslip" },
    note: { type: String, default: "" },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
  },
  { timestamps: true }
);

// Enforce one payslip per employee per (year, month). Re-uploading replaces the row.
payslipSchema.index({ employeeId: 1, year: 1, month: 1 }, { unique: true });

const Payslip = mongoose.model("Payslip", payslipSchema);
module.exports = Payslip;
