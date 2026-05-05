const express = require("express");
const NotesModel = require("../models/Notes");
const { saveNotes, getNotes, getUsersNotesForAdmin } = require("../controllers/notepadController");
const { authMiddleware } = require("../middlewares/authMiddleware");

const router = express.Router();

router.post("/", authMiddleware, saveNotes);
router.get("/", authMiddleware, getNotes);
router.get("/:id", authMiddleware, getUsersNotesForAdmin);


module.exports = router;
