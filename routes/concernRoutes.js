const express = require("express");
const {
  submitConcern,
  getAllConcerns,
  getPendingConcernsCount,
  getConcernsByUser,
  updateConcernStatus,
  approveConcern,
  rejectConcern
} = require("../controllers/concernController");
const {authMiddleware} = require("../middlewares/authMiddleware")
const router = express.Router();

// Routes
router.post("/submit", authMiddleware, submitConcern);
router.get("/all", getAllConcerns);
router.get("/pending-count", authMiddleware, getPendingConcernsCount);
router.get("/user",authMiddleware, getConcernsByUser);
router.put("/update/:concernId", updateConcernStatus);
router.patch("/approve/:user_id/:concern_id",approveConcern);
router.patch("/reject/:user_id/:concern_id", rejectConcern);

module.exports = router;
