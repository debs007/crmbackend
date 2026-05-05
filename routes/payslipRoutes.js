const express = require("express");
const router = express.Router();

const { authMiddleware } = require("../middlewares/authMiddleware");
const { upload } = require("../utils/fileUpload");
const payslipController = require("../controllers/payslipController");

router.post(
  "/",
  authMiddleware,
  upload.single("file"),
  payslipController.uploadPayslip
);
router.get("/me", authMiddleware, payslipController.listMyPayslips);
router.get(
  "/employee/:employeeId",
  authMiddleware,
  payslipController.listEmployeePayslips
);
router.delete("/:id", authMiddleware, payslipController.deletePayslip);

module.exports = router;
