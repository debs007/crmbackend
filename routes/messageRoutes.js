// routes/messageRoutes.js
const express = require("express");
const { authMiddleware } = require("../middlewares/authMiddleware");
const {
  sendMessage,
  getMessages,
  editMessage,
  deleteMessage,
  getRecentChatUsers,
  getAllUser,
  readMessage,
  clearConversation,
  togglePinDirectMessage,
  getPinnedDirectMessages,
} = require("../controllers/messageController");

const router = express.Router();

router.post("/send-message", sendMessage);
router.get("/messages/:sender/:receiver", getMessages);
router.get("/recentChats", authMiddleware, getAllUser);
router.post("/messages/mark-as-read", authMiddleware, readMessage);
router.post("/clear", authMiddleware, clearConversation);

// Edit & delete (2-hour window) — features #3 + #5 for direct messages.
router.patch("/messages/:messageId", authMiddleware, editMessage);
router.delete("/messages/:messageId", authMiddleware, deleteMessage);

module.exports = router;

router.patch("/messages/:messageId/pin", authMiddleware, togglePinDirectMessage);
router.get("/pinned", authMiddleware, getPinnedDirectMessages);
