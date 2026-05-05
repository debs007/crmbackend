const Notification = require("../models/Notifications");
const { getIo, emitToUser, isUserOnline } = require("../utils/socket");

const sendNotification = async (req, res) => {
  try {
    let { userId, title, description, type, sender } = req.body;

    // Normalize recipients; accept single id, array of ids, or "ALL"
    const targets = Array.isArray(userId) ? userId : [userId].filter(Boolean);
    const wantsBroadcast = targets.some((id) => id === "ALL");
    const io = getIo();
    const dedupWindowMs = 60 * 1000; // 1 minute window to guard against duplicates
    const dedupSince = new Date(Date.now() - dedupWindowMs);

    if (wantsBroadcast) {
      const existingQuery = {
        userId: null,
        title,
        description,
        createdAt: { $gte: dedupSince },
      };
      if (type) existingQuery.type = type;
      if (sender) existingQuery.sender = sender;
      const existing = await Notification.findOne(existingQuery);

      if (existing) {
        return res.status(200).json({ success: true, notification: existing, deduped: true });
      }

      const notification = await Notification.create({ userId: null, title, description, type, sender });
      io.emit("receive-notification", {
        title: notification.title,
        description: notification.description,
        type: notification.type,
        sender: notification.sender,
        timestamp: notification.createdAt,
      });
      return res.status(200).json({ success: true, notification });
    }

    // Deduplicate per-user targets and persist individually
    const uniqueTargets = [...new Set(targets)].filter(Boolean);
    if (uniqueTargets.length === 0) {
      return res.status(400).json({ success: false, message: "No valid recipients supplied" });
    }

    // Filter out targets that already have a recent identical notification
    const dedupedTargets = [];
    const existingByUserQuery = {
      userId: { $in: uniqueTargets },
      title,
      description,
      createdAt: { $gte: dedupSince },
    };
    if (type) existingByUserQuery.type = type;
    if (sender) existingByUserQuery.sender = sender;
    const existingByUser = await Notification.find(existingByUserQuery).lean();
    const seen = new Set(existingByUser.map((n) => n.userId?.toString()));
    uniqueTargets.forEach((id) => {
      if (!seen.has(id?.toString())) {
        dedupedTargets.push(id);
      }
    });

    if (dedupedTargets.length === 0) {
      return res.status(200).json({ success: true, deduped: true, notifications: existingByUser });
    }

    const notificationDocs = await Notification.insertMany(
      dedupedTargets.map((id) => ({ userId: id, title, description, type, sender }))
    );

    const deliveredIds = [];
    dedupedTargets.forEach((id, idx) => {
      if (!isUserOnline(id?.toString())) {
        return;
      }
      const doc = notificationDocs[idx];
      emitToUser(id?.toString(), "receive-notification", {
        title: doc.title,
        description: doc.description,
        type: doc.type,
        sender: doc.sender,
        timestamp: doc.createdAt,
      });
      if (doc?._id) {
        deliveredIds.push(doc._id);
      }
    });

    if (deliveredIds.length > 0) {
      await Notification.updateMany(
        { _id: { $in: deliveredIds } },
        { $set: { isRead: true } }
      );
    }

    res.status(200).json({ success: true, notifications: notificationDocs });
  } catch (error) {
    console.error("Error sending notification:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

const getNotification = async (req, res) => {
  try {
    const { userId } = req.user;
    const notifications = await Notification.find({
      $or: [
        { userId },
        { userId: null, dismissedBy: { $ne: userId } },
      ],
    }).sort({ createdAt: -1 });

    res.status(200).json({ success: true, notifications });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

const clearAllNotifications = async (req, res) => {
  try {
    const { userId } = req.user;
    if (!userId) {
      return res.status(400).json({ success: false, message: "Missing userId" });
    }

    await Notification.deleteMany({ userId });
    await Notification.updateMany(
      { userId: null },
      { $addToSet: { dismissedBy: userId } }
    );

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error clearing notifications:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

module.exports = { sendNotification, getNotification, clearAllNotifications };
