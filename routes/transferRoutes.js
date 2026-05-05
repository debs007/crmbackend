const express = require("express");
const {authMiddleware}=require("../middlewares/authMiddleware")
const {
  createTransfer,
  moveTransferToSales,
  moveTransferToCallback,
  getUserTransfers,
  getAllTransfers,
  getTransferById,
  updateTransfer,
  deleteTransfer,
  searchTransfers
} = require("../controllers/transferController");

const router = express.Router();

router.post("/",authMiddleware,  createTransfer);
router.post("/transfer-to-sales", moveTransferToSales);
router.post("/transfer-to-callback", moveTransferToCallback);
router.get("/user/:id", getUserTransfers);
router.get("/all", getAllTransfers);
router.get("/user",authMiddleware, getTransferById);
router.put("/:id", updateTransfer);
router.delete("/:id", deleteTransfer);
router.get("/search", authMiddleware, searchTransfers);

module.exports = router;
