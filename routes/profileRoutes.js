const express = require("express");
const router = express.Router();

const { authMiddleware } = require("../middlewares/authMiddleware");
const { upload } = require("../utils/fileUpload");
const profileController = require("../controllers/profileController");

router.get("/me", authMiddleware, profileController.getMyProfile);
router.post(
  "/avatar",
  authMiddleware,
  upload.single("avatar"),
  profileController.uploadAvatar
);
router.delete("/avatar", authMiddleware, profileController.removeAvatar);
router.get("/avatars", authMiddleware, profileController.getAvatarsBatch);

module.exports = router;
