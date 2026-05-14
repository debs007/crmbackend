const express = require("express");
const {
  sendChannelMessage,
  getChannelMessages,
  markChannelMessagesAsRead,
  editChannelMessage,
  deleteChannelMessage,
  getChannelMentionCandidates,
  togglePinChannelMessage,
  getPinnedChannelMessages,
} = require("../controllers/channelChatsController");
const {
  getChannelTasks,
  getAllTasks,
  getPendingTasksCount,
  createChannelTask,
  updateChannelTask,
  deleteChannelTask,
  addTaskComment,
} = require("../controllers/channelTaskController");
const {
  uploadMonthlyReport,
  listMonthlyReports,
  deleteMonthlyReport,
} = require("../controllers/channelReportController");
const { authMiddleware } = require("../middlewares/authMiddleware");
const { upload } = require("../utils/fileUpload");

const router = express.Router();

// Channel messaging
router.post("/send", sendChannelMessage);
router.post("/:channelId/read", authMiddleware, markChannelMessagesAsRead);

// Per-message actions (edit / delete / pin)
router.patch("/messages/:messageId", authMiddleware, editChannelMessage);
router.delete("/messages/:messageId", authMiddleware, deleteChannelMessage);
router.patch("/messages/:messageId/pin", authMiddleware, togglePinChannelMessage);

// Pinned messages for a channel
router.get("/:channelId/pinned", authMiddleware, getPinnedChannelMessages);

// Mention candidates - feature #4
router.get(
  "/:channelId/mention-candidates",
  authMiddleware,
  getChannelMentionCandidates
);

// All tasks across channels (admin = all, employee = assigned to them)
router.get("/tasks/all", authMiddleware, getAllTasks);
router.get("/tasks/count", authMiddleware, getPendingTasksCount);

// Tasks
router.get("/:channelId/tasks", authMiddleware, getChannelTasks);
router.post("/:channelId/tasks", authMiddleware, createChannelTask);
router.patch("/:channelId/tasks/:taskId", authMiddleware, updateChannelTask);
router.delete("/:channelId/tasks/:taskId", authMiddleware, deleteChannelTask);
router.post(
  "/:channelId/tasks/:taskId/comments",
  authMiddleware,
  addTaskComment
);

// Monthly reports - feature #6
router.post(
  "/:channelId/reports",
  authMiddleware,
  upload.single("file"),
  uploadMonthlyReport
);
router.get("/:channelId/reports", authMiddleware, listMonthlyReports);
router.delete(
  "/:channelId/reports/:id",
  authMiddleware,
  deleteMonthlyReport
);

// Get all messages from a channel (kept last so other paths match first)
router.get("/:channelId", getChannelMessages);

module.exports = router;
