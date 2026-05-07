const ChannelMessage = require("../models/ChannelMessage");
const Channel = require("../models/Channels");
const User = require("../models/User");
const Admin = require("../models/Admin");
const Client = require("../models/Client");
const mongoose = require("mongoose");
const { getIo, emitToUser, isUserOnline } = require("../utils/socket");
const sendMail = require("../services/sendMail");

// ---- 2-hour edit/delete window (matches feature spec for #3 and #5) ----
const EDIT_WINDOW_MS = 2 * 60 * 60 * 1000;
const isWithinEditWindow = (createdAt) => {
  if (!createdAt) return false;
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return false;
  return Date.now() - created <= EDIT_WINDOW_MS;
};

// Resolve any of the three identity types so notifications use the correct sender name.
const resolveUserEntity = async (id) => {
  if (!id) return null;
  return (
    (await User.findById(id)) ||
    (await Admin.findById(id)) ||
    (await Client.findById(id))
  );
};

// ---- Reply-preview helpers (carried over from previous build) ----
const isImageUrl = (value = "") => /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(value);
const isVideoUrl = (value = "") => /\.(mp4|webm|ogg|mov|mkv)$/i.test(value);
const isAudioUrl = (value = "") => /\.(mp3|wav|ogg|m4a|aac)$/i.test(value);
const isPdfUrl = (value = "") => /\.pdf$/i.test(value);
const isDocumentUrl = (value = "") =>
  /\.(pdf|docx|doc|xlsx|xls|pptx|ppt|csv|txt|zip|rar)$/i.test(value);
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

// ---- Mention helpers (feature #4) ----
// The client sends an array of mentioned member ids; we sanitize against the
// channel's actual member list before fanning out notifications/emails so a
// malicious client can't spam non-members.
const sanitizeMentions = (rawMentions = [], channel) => {
  if (!Array.isArray(rawMentions)) return [];
  if (!channel?.members?.length) return [];
  const memberSet = new Set(
    channel.members.map((id) => (id ? id.toString() : "")).filter(Boolean)
  );
  return [
    ...new Set(
      rawMentions
        .filter(Boolean)
        .map((id) => id.toString())
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .filter((id) => memberSet.has(id))
    ),
  ];
};

// ---- Send a new channel message (with optional mentions) ----
exports.sendChannelMessage = async (req, res) => {
  try {
    const {
      sender,
      channelId,
      message,
      replyTo,
      mentions: rawMentions,
      attachments: rawAttachments,
    } = req.body;

    // Sanitize attachments: must be a non-empty array of strings (URLs).
    const attachments = Array.isArray(rawAttachments)
      ? rawAttachments
          .filter((u) => typeof u === "string" && u.trim().length > 0)
          .slice(0, 20) // hard cap
      : [];

    // A message must have either text or at least one attachment.
    const text = typeof message === "string" ? message : "";
    if (!sender || !channelId || (!text.trim() && attachments.length === 0)) {
      return res
        .status(400)
        .json({ success: false, message: "Empty message." });
    }

    const channel = await Channel.findById(channelId);
    if (!channel) {
      return res
        .status(404)
        .json({ success: false, message: "Channel not found." });
    }

    let replyMeta;
    if (replyTo) {
      if (!mongoose.Types.ObjectId.isValid(replyTo)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid replyTo message." });
      }
      const replyDoc = await ChannelMessage.findOne({ _id: replyTo, channelId });
      if (!replyDoc) {
        return res
          .status(400)
          .json({ success: false, message: "Reply target not found." });
      }
      const replySender = await resolveUserEntity(replyDoc.sender);
      const replySenderName = replyDoc.isSystem
        ? replyDoc.systemLabel || "System"
        : replySender?.name || "User";
      replyMeta = {
        replyTo: replyDoc._id,
        replyPreview: {
          message: buildReplyPreview(replyDoc.message),
          sender: replyDoc.sender,
          senderName: replySenderName,
        },
      };
    }

    const mentions = sanitizeMentions(rawMentions, channel);

    const newMessage = new ChannelMessage({
      sender,
      channelId,
      message: text,
      attachments,
      mentions,
      seenBy: sender ? [sender] : [],
      ...(replyMeta || {}),
    });
    await newMessage.save();

    const channelName = channel.name || "Unknown Channel";
    const io = getIo();
    const senderEntity = await resolveUserEntity(sender);
    const senderName = senderEntity?.name || "Unknown Sender";

    io.to(channelId).emit("new-channel-message", newMessage);
    io.to(channelId).emit("receive-notification", {
      title: channelName,
      sender: channelId,
      description: `You have a new message in channel ${channelName}`,
      timestamp: new Date(),
    });

    if (channel?.members?.length) {
      const memberIds = channel.members.map((id) => id?.toString());
      const uniqueMembers = [...new Set(memberIds)];

      uniqueMembers.forEach((memberId) => {
        if (memberId && memberId !== sender?.toString()) {
          emitToUser(memberId, "updateUnread");
        }
      });

      // Channel-wide offline email for normal traffic. We skip mentioned users
      // here because they'll get a more specific mention email below.
      const mentionSet = new Set(mentions);
      const offlineRecipients = uniqueMembers.filter(
        (memberId) =>
          memberId &&
          memberId !== sender?.toString() &&
          !isUserOnline(memberId) &&
          !mentionSet.has(memberId)
      );

      // Build a sensible preview line for the email body — text if any,
      // else a short "[N attachment(s)]" stub.
      const previewLine = (text && text.trim())
        ? text
        : attachments.length
        ? `[${attachments.length} attachment${attachments.length === 1 ? "" : "s"}]`
        : "";

      await Promise.all(
        offlineRecipients.map(async (memberId) => {
          const member = await resolveUserEntity(memberId);
          if (!member?.email) return;
          await sendMail(
            member.email,
            `New message in ${channelName}`,
            `${senderName} sent a message in ${channelName}: ${previewLine}`
          );
        })
      );
    }

    // ---- Mention notifications (feature #4) ----
    // For everyone explicitly mentioned: an in-app notification if online,
    // and an email if offline. Mentioning yourself is a no-op.
    if (mentions.length) {
      const mentionPreview = (text && text.trim())
        ? text
        : attachments.length
        ? `[${attachments.length} attachment${attachments.length === 1 ? "" : "s"}]`
        : "";
      await Promise.all(
        mentions.map(async (mentionedId) => {
          if (!mentionedId || mentionedId === sender?.toString()) return;
          const mentioned = await resolveUserEntity(mentionedId);
          if (!mentioned) return;

          if (isUserOnline(mentionedId)) {
            emitToUser(mentionedId, "receive-notification", {
              title: `You were mentioned in ${channelName}`,
              description: `${senderName}: ${mentionPreview}`,
              sender: channelId,
              name: senderName,
              type: "mention",
              channelId,
              timestamp: new Date(),
            });
          } else if (mentioned.email) {
            try {
              await sendMail(
                mentioned.email,
                `${senderName} mentioned you in ${channelName}`,
                `Hello ${mentioned.name || ""},\n\n${senderName} mentioned you in the channel "${channelName}":\n\n${mentionPreview}\n\nLog in to reply.`
              );
            } catch (mailError) {
              console.warn("mention email failed:", mailError?.message);
            }
          }
        })
      );
    }

    return res
      .status(200)
      .json({ success: true, message: "Message sent successfully.", data: newMessage });
  } catch (error) {
    console.error("Error sending channel message:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
};

// ---- List messages in a channel ----
exports.getChannelMessages = async (req, res) => {
  try {
    const { channelId } = req.params;
    if (!channelId) {
      return res
        .status(400)
        .json({ success: false, message: "Channel ID is required." });
    }
    const messages = await ChannelMessage.find({ channelId }).sort({ createdAt: 1 });
    return res.status(200).json({ success: true, messages });
  } catch (error) {
    console.error("Error fetching channel messages:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
};

exports.markChannelMessagesAsRead = async (req, res) => {
  try {
    const { channelId } = req.params;
    const userId = req.user.userId;

    if (!channelId) {
      return res
        .status(400)
        .json({ success: false, message: "Channel ID is required." });
    }

    await ChannelMessage.updateMany(
      {
        channelId,
        sender: { $ne: userId },
        seenBy: { $ne: userId },
      },
      { $addToSet: { seenBy: userId } }
    );

    emitToUser(userId, "updateUnread");
    return res
      .status(200)
      .json({ success: true, message: "Channel messages marked as read." });
  } catch (error) {
    console.error("Error marking channel messages as read:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
};

// ---- Edit a channel message (feature #5) ----
// PATCH /channels/messages/:messageId
exports.editChannelMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { message: newText, mentions: rawMentions } = req.body;
    const userId = req.user?.userId;

    if (!newText || !newText.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Message content cannot be empty." });
    }

    const target = await ChannelMessage.findById(messageId);
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
      return res
        .status(400)
        .json({
          success: false,
          message: "Edit window expired (2 hours after sending).",
        });
    }

    const channel = await Channel.findById(target.channelId);
    target.message = newText.trim();
    target.editedAt = new Date();
    if (Array.isArray(rawMentions)) {
      target.mentions = sanitizeMentions(rawMentions, channel);
    }
    await target.save();

    try {
      const io = getIo();
      io.to(target.channelId.toString()).emit("channel-message-updated", target);
    } catch (e) {
      // socket optional
    }

    return res.json({ success: true, data: target });
  } catch (error) {
    console.error("editChannelMessage error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
};

// ---- Delete a channel message for everyone (feature #3) ----
// DELETE /channels/messages/:messageId
exports.deleteChannelMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user?.userId;

    const target = await ChannelMessage.findById(messageId);
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
      return res
        .status(400)
        .json({
          success: false,
          message: "Delete window expired (2 hours after sending).",
        });
    }

    target.isDeleted = true;
    target.deletedAt = new Date();
    target.deletedBy = userId;
    // Replace the visible content with a placeholder so old replies still resolve.
    target.message = "This message was deleted";
    target.mentions = [];
    await target.save();

    try {
      const io = getIo();
      io.to(target.channelId.toString()).emit("channel-message-updated", target);
    } catch (e) {
      // socket optional
    }

    return res.json({ success: true, data: target });
  } catch (error) {
    console.error("deleteChannelMessage error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
};

// ---- Mention picker support (feature #4) ----
// Returns the list of mention candidates for a channel: every member resolved
// across User/Admin/Client with their display name + avatar.
exports.getChannelMentionCandidates = async (req, res) => {
  try {
    const { channelId } = req.params;
    const channel = await Channel.findById(channelId).select("members").lean();
    if (!channel) {
      return res
        .status(404)
        .json({ success: false, message: "Channel not found." });
    }

    const memberIds = (channel.members || []).map((id) => id.toString());
    const [users, admins, clients] = await Promise.all([
      User.find({ _id: { $in: memberIds } }, "_id name avatar").lean(),
      Admin.find({ _id: { $in: memberIds } }, "_id name avatar").lean(),
      Client.find({ _id: { $in: memberIds } }, "_id name avatar").lean(),
    ]);

    const candidates = [...users, ...admins, ...clients].map((row) => ({
      _id: row._id,
      name: row.name,
      avatar: row.avatar || "",
    }));

    return res.json({ success: true, candidates });
  } catch (error) {
    console.error("getChannelMentionCandidates error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
};
