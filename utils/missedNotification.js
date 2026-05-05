const Notification = require("../models/Notifications");


const sendMissedNotifications = async (userId) => {
  try {
    const { emitToUser, isUserOnline } = require("../utils/socket");

    if (!isUserOnline(userId)) return;

    // ✅ Fetch unread notifications
    const unreadNotifications = await Notification.find({ userId, isRead: false });
     if(!unreadNotifications) return 
    // ✅ Send them via Socket.io
    unreadNotifications.forEach((notification) => {
      emitToUser(userId, "receive-notification", {
        title: notification.title,
        description: notification.description,
        type: notification.type,
        sender: notification.sender,
        timestamp: notification.createdAt,
      });
    });

    // ✅ Mark notifications as read
    await Notification.updateMany({ userId, isRead: false }, { $set: { isRead: true } });

    console.log(`📨 Sent missed notifications to user ${userId}`);
  } catch (error) {
    console.error("❌ Error sending missed notifications:", error);
  }
};

module.exports = { sendMissedNotifications };
