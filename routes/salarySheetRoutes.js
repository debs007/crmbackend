const express = require("express");
const multer = require("multer");
const { authMiddleware } = require("../middlewares/authMiddleware");
const {
  uploadSalarySheet,
  listSalarySheets,
  deleteSalarySheet,
} = require("../controllers/salarySheetController");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get("/", authMiddleware, listSalarySheets);
router.post("/upload", authMiddleware, upload.single("file"), uploadSalarySheet);
router.delete("/:id", authMiddleware, deleteSalarySheet);

module.exports = router;
