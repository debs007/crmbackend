const express = require("express");
const {authMiddleware}=require("../middlewares/authMiddleware")
const {
  createCallback,
  moveCallbackToSales,
  getUserCallbacks,
  getAllCallbacks,
  getCallbackById,
  updateCallback,
  deleteCallback,
  searchCallbacks
} = require("../controllers/callbackController");

const router = express.Router();

router.post("/",authMiddleware, createCallback);
router.post("/callback-to-sales", moveCallbackToSales);
router.get("/user/:id", getUserCallbacks);
router.get("/all", getAllCallbacks);
router.get("/user",authMiddleware, getCallbackById);
router.put("/:id", updateCallback);
router.delete("/:id", deleteCallback);
router.get("/search", searchCallbacks)

module.exports = router;
