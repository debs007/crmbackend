const DirectMessage = require("../models/DirectMessage");
const mongoose = require("mongoose");
const User = require("../models/User");
const Admin = require("../models/Admin");
const Client = require("../models/Client");

const { emitToUser, isUserOnline } = require("../utils/socket");
const sendMail = require("../services/sendMail");

const EDIT_WINDOW_MS = 2 * 60 * 60 * 1000;
const isWithinEditWindow = (createdAt) => {
  if (!createdAt) return false;
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return false;
  return Date.now() - created <= EDIT_WINDOW_MS;
};

const resolveUserEntity = async (id) => {
  if (!id) return null;
  return (
    (await User.findById(id)) ||
    (await Admin.findById(id)) ||
    (await Client.findById(id))
  );
};

// Reply preview helpers (shared with channel chat) ----
const isImageUrl = (value = "") => /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(value);
const isVideoUrl = (value = "") => /\.(mp4|webm|ogg|mov|mkv)$/i.test(value);
const isAudioUrl = (value = "") => /\.(mp3|wav|ogg|m4a|aac)$/i.test(value);
const isPdfUrl = (value = "") => /\.pdf$/i.test(value);
const isDocumentUrl = (value = "") => /\.(pdf|docx|doc|xlsx|xls|pptx|ppt|csv|txt|zip|rar)$/i.test(value);
const safeDecode = (value = "") => {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
};
const getFileNameFromUrl = (value = "") => {
  if (!value) return "file";
  try {
    const url = new URL(value);
    return safeDecode(url.pathname.split("/").pop() || "file");
  } catch (error) {
    const name = value.split("/").pop() || "file";
    return safeDecode(name.split("?")[0]);
  }
};
const buildReplyPreview = (value = "") => {
  if (!value) return "";
  if (value.startsWith("http")) {
    if (isImageUrl(value)) return "Photo";
    if (isVideoUrl(value)) return `Video: ${getFileNameFromUrl(value)}`;
    if (isAudioUrl(value)) return `Audio: ${getFileNameFromUrl(value)}`;
    if (isPdfUrl(value)) return `PDF: ${getFileNameFromUrl(value)}`;
    if (isDocumentUrl(value)) return `Document: ${getFileNameFromUrl(value)}`;
    return "Link";
  }
  return value.length > 80 ? `${value.slice(0, 80)}...` : value;
};

// ---- Send DM ----
const sendMessage = async (req, res) => {
  try {
    const { sender, receiver, message, replyTo, attachments: rawAttachments } = req.body;

    const attachments = Array.isArray(rawAttachments)
      ? rawAttachments
          .filter((u) => typeof u === "string" && u.trim().length > 0)
          .slice(0, 20)
      : [];

    const text = typeof message === "string" ? message : "";
    if (!sender || !receiver || (!text.trim() && attachments.length === 0)) {
      return res
        .status(400)
        .json({ success: false, message: "Empty message." });
    }

    const senderEntity = await resolveUserEntity(sender);
    const receiverEntity = await resolveUserEntity(receiver);
    const senderName = senderEntity?.name || "Unknown Sender";
    const isSelfMessage =
      sender?.toString && receiver?.toString
        ? sender.toString() === receiver.toString()
        : sender === receiver;

    let replyMeta;
    if (replyTo) {
      if (!mongoose.Types.ObjectId.isValid(replyTo)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid replyTo message." });
      }
      const replyDoc = await DirectMessage.findOne({
        _id: replyTo,
        $or: [
          { sender, receiver },
          { sender: receiver, receiver: sender },
        ],
      });
      if (!replyDoc) {
        return res
          .status(400)
          .json({ success: false, message: "Reply target not found." });
      }
      const replySender = await resolveUserEntity(replyDoc.sender);
      replyMeta = {
        replyTo: replyDoc._id,
        replyPreview: {
          message: buildReplyPreview(replyDoc.message),
          sender: replyDoc.sender,
          senderName: replySender?.name || "User",
        },
      };
    }

    const newMessage = new DirectMessage({
      sender,
      receiver,
      message: text,
      attachments,
      ...(replyMeta || {}),
    });
    await newMessage.save();

    // Preview line — text if any, otherwise mention the attachment count.
    const previewLine = text.trim()
      ? text
      : attachments.length
      ? `[${attachments.length} attachment${attachments.length === 1 ? "" : "s"}]`
      : "";

    const receiverIsOnline = isUserOnline(receiver);
    const senderIsOnline = isUserOnline(sender);

    if (receiverIsOnline) {
      emitToUser(receiver, "new-message", newMessage);
      emitToUser(receiver, "updateUnread");
      if (!isSelfMessage) {
        emitToUser(receiver, "receive-notification", {
          title: `${senderName} sent a message`,
          description: previewLine,
          sender,
          name: senderName,
          type: "DM",
          timestamp: new Date(),
        });
      }
    }

    if (isSelfMessage) {
      if (senderIsOnline) {
        emitToUser(sender, "new-message", newMessage);
        emitToUser(sender, "updateUnread");
      }
    } else if (senderIsOnline) {
      emitToUser(sender, "new-message", newMessage);
      emitToUser(sender, "updateUnread");
    }

    if (!receiverIsOnline && receiverEntity?.email && !isSelfMessage) {
      const mailSent = await sendMail(
        receiverEntity.email,
        `New message from ${senderName}`,
        previewLine
      );
      if (!mailSent) {
        console.warn("Failed to send offline message email.");
      }
    }

    res
      .status(200)
      .json({ success: true, message: "Message sent successfully.", data: newMessage });
  } catch (error) {
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// ---- Get DMs between two users ----
const getMessages = async (req, res) => {
  try {
    const { sender, receiver } = req.params;
    if (!sender || !receiver) {
      return res
        .status(400)
        .json({ success: false, message: "Sender and receiver are required." });
    }

    const messages = await DirectMessage.find({
      $or: [
        { sender, receiver },
        { sender: receiver, receiver: sender },
      ],
    }).sort({ createdAt: 1 });

    res.status(200).json({ success: true, messages });
  } catch (error) {
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// ---- Edit a DM (2-hour window, sender only) ----
// PATCH /message/messages/:messageId
const editMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { message: newText } = req.body;
    const userId = req.user?.userId;

    if (!newText || !newText.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Message content cannot be empty." });
    }

    const target = await DirectMessage.findById(messageId);
    if (!target) {
      return res.status(404).json({ success: false, message: "Message not found." });
    }
    if (target.isDeleted) {
      return res
        .status(400)
        .json({ success: false, message: "Cannot edit a deleted message." });
    }
    if (String(target.sender) !== String(userId)) {
      return res
        .status(403)
        .json({ success: false, message: "You can only edit your own messages." });
    }
    if (!isWithinEditWindow(target.createdAt)) {
      return res.status(400).json({
        success: false,
        message: "Edit window expired (2 hours after sending).",
      });
    }

    target.message = newText.trim();
    target.editedAt = new Date();
    await target.save();

    // Push update to both sides
    emitToUser(target.sender, "direct-message-updated", target);
    emitToUser(target.receiver, "direct-message-updated", target);

    return res.json({ success: true, data: target });
  } catch (error) {
    console.error("editMessage error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
};

// ---- Delete a DM for everyone (2-hour window, sender only) ----
// DELETE /message/messages/:messageId
const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user?.userId;

    const target = await DirectMessage.findById(messageId);
    if (!target) {
      return res.status(404).json({ success: false, message: "Message not found." });
    }
    if (target.isDeleted) {
      return res.json({ success: true, data: target });
    }
    if (String(target.sender) !== String(userId)) {
      return res
        .status(403)
        .json({
          success: false,
          message: "You can only delete your own messages.",
        });
    }
    if (!isWithinEditWindow(target.createdAt)) {
      return res.status(400).json({
        success: false,
        message: "Delete window expired (2 hours after sending).",
      });
    }

    target.isDeleted = true;
    target.deletedAt = new Date();
    target.deletedBy = userId;
    target.message = "This message was deleted";
    await target.save();

    emitToUser(target.sender, "direct-message-updated", target);
    emitToUser(target.receiver, "direct-message-updated", target);

    return res.json({ success: true, data: target });
  } catch (error) {
    console.error("deleteMessage error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
};

// ---- Recent chat users (carried over) ----
const getRecentChatUsers = async (req, res) => {
  try {
    const userId = req.user.userId;

    const lastMessages = await DirectMessage.aggregate([
      {
        $match: { $or: [{ sender: userId }, { receiver: userId }] },
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: {
            $cond: [{ $eq: ["$sender", userId] }, "$receiver", "$sender"],
          },
          lastMessageTime: { $first: "$createdAt" },
          lastMessage: { $first: "$message" },
        },
      },
    ]);

    const lastMessageMap = {};
    lastMessages.forEach((msg) => {
      lastMessageMap[msg._id.toString()] = msg;
    });

    const userIds = lastMessages.map((msg) => msg._id);
    const users = await User.find({ _id: { $in: userIds } }, "name _id avatar");
    const adminUsers = await Admin.find({ _id: { $in: userIds } }, "name _id avatar");
    const clientUsers = await Client.find({ _id: { $in: userIds } }, "name _id avatar");
    const allUsers = [...users, ...adminUsers, ...clientUsers];

    let currentUser = await User.findById({ _id: userId }, "name _id avatar");
    if (!currentUser)
      currentUser = await Admin.findById({ _id: userId }, "name _id avatar");
    if (!currentUser)
      currentUser = await Client.findById({ _id: userId }, "name _id avatar");

    const usersWithDetails = await Promise.all(
      allUsers.map(async (user) => {
        const unseenCount = await DirectMessage.countDocuments({
          sender: user._id,
          receiver: userId,
          seen: false,
        });

        return {
          _id: user._id,
          name: user.name,
          avatar: user.avatar || "",
          unseenMessages: unseenCount,
          lastMessageTime: lastMessageMap[user._id.toString()]?.lastMessageTime || null,
          lastMessage: lastMessageMap[user._id.toString()]?.lastMessage || "",
        };
      })
    );

    usersWithDetails.sort((a, b) => {
      return new Date(b.lastMessageTime) - new Date(a.lastMessageTime);
    });

    res.status(200).json({ success: true, user: currentUser, chatUsers: usersWithDetails });
  } catch (error) {
    console.error("Error fetching recent chat users:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

const getAllUser = async (req, res) => {
  try {
    const loggedInUserId = req.user.userId;

    // Hide soft-deleted employees from the chat sidebar (feature #11).
    const employeeUsers = await User.find(
      { _id: { $ne: loggedInUserId }, isDeleted: { $ne: true } },
      "_id name avatar"
    );
    const adminUsers = await Admin.find(
      { _id: { $ne: loggedInUserId } },
      "_id name avatar"
    );
    const clientUsers = await Client.find(
      { _id: { $ne: loggedInUserId } },
      "_id name avatar"
    );

    const allUsers = [...employeeUsers, ...adminUsers, ...clientUsers];

    const usersWithChatData = await Promise.all(
      allUsers.map(async (user) => {
        const lastMessage = await DirectMessage.findOne({
          $or: [
            { sender: loggedInUserId, receiver: user._id },
            { sender: user._id, receiver: loggedInUserId },
          ],
        }).sort({ createdAt: -1 });

        const unreadCount = await DirectMessage.countDocuments({
          sender: user._id,
          receiver: loggedInUserId,
          seen: false,
        });

        return {
          id: user._id,
          name: user.name,
          avatar: user.avatar || "",
          unreadMessages: unreadCount,
          lastMessageTime: lastMessage ? lastMessage.createdAt : null,
        };
      })
    );

    const sortedUsers = usersWithChatData.sort((a, b) => {
      if (a.unreadMessages !== b.unreadMessages) {
        return b.unreadMessages - a.unreadMessages;
      }
      return new Date(b.lastMessageTime || 0) - new Date(a.lastMessageTime || 0);
    });

    res.json({ success: true, users: sortedUsers });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const readMessage = async (req, res) => {
  try {
    const { senderId } = req.body;
    const receiverId = req.user.userId;

    await DirectMessage.updateMany(
      { sender: senderId, receiver: receiverId, seen: false },
      { $set: { seen: true } }
    );

    res.json({ message: "Messages marked as read" });
  } catch (error) {
    console.error("Error updating messages:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

const clearConversation = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { otherUserId } = req.body;

    if (!otherUserId) {
      return res
        .status(400)
        .json({ success: false, message: "otherUserId is required" });
    }

    const result = await DirectMessage.deleteMany({
      $or: [
        { sender: userId, receiver: otherUserId },
        { sender: otherUserId, receiver: userId },
      ],
    });

    res.json({ success: true, deletedCount: result.deletedCount });
  } catch (error) {
    console.error("Error clearing conversation:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

module.exports = {
  sendMessage,
  getMessages,
  editMessage,
  deleteMessage,
  getRecentChatUsers,
  getAllUser,
  readMessage,
  clearConversation,
};
