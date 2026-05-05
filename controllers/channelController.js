const Channel = require("../models/Channels");
const ChannelInvite = require("../models/ChannelInvite");
const User = require("../models/User");
const Admin = require("../models/Admin");
const Client = require("../models/Client");
const ChannelMessage = require("../models/ChannelMessage");
const sendMail = require("../services/sendMail");
const { uploadToCloudinary } = require("../utils/fileUpload");

const {
  CHANNEL_STATUS_OPTIONS,
  PREDEFINED_TAG_OPTIONS,
} = require("../models/Channels");

const normalizeMemberIds = (members = []) => [
  ...new Set(
    (Array.isArray(members) ? members : [])
      .filter(Boolean)
      .map((member) => member.toString())
      .filter(Boolean)
  ),
];

const mapResolvedMembers = (members = [], memberMap = {}) =>
  normalizeMemberIds(members)
    .map((memberId) => memberMap[memberId] || null)
    .filter(Boolean);

const sanitizeTags = (tags) => {
  if (!Array.isArray(tags)) return [];
  // Trim, dedupe, drop empties, cap at 2 entries (the spec allows 2 free tags
  // beyond the status tag).
  const cleaned = [
    ...new Set(
      tags
        .filter((tag) => typeof tag === "string")
        .map((tag) => tag.trim())
        .filter(Boolean)
    ),
  ];
  return cleaned.slice(0, 2);
};

const sanitizeStatus = (status) => {
  if (!status) return undefined;
  return CHANNEL_STATUS_OPTIONS.includes(status) ? status : undefined;
};

// ---- Create channel ----
exports.createChannel = async (req, res) => {
  try {
    const { name, description, members, image, statusTag, tags, channelDetails } =
      req.body;
    const owner = req.user.userId;

    if (!name || !owner) {
      return res.status(400).json({ error: "Name and owner are required" });
    }
    const uniqueMembers = normalizeMemberIds([
      ...(Array.isArray(members) ? members : []),
      owner,
    ]);
    const newChannel = new Channel({
      name,
      description: description || "",
      image: image || "",
      statusTag: sanitizeStatus(statusTag) || "Active",
      tags: sanitizeTags(tags),
      channelDetails: {
        purpose: channelDetails?.purpose || "",
        industry: channelDetails?.industry || "",
        website: channelDetails?.website || "",
        location: channelDetails?.location || "",
      },
      members: uniqueMembers,
      owner,
      inviteLink: `https://yourapp.com/invite/${Math.random()
        .toString(36)
        .substr(2, 8)}`,
    });

    await newChannel.save();
    res.status(201).json({ message: "Channel created successfully", channel: newChannel });
  } catch (error) {
    res.status(500).json({ error: "Server error", details: error.message });
  }
};

// ---- Update channel (covers features #7, #8, #13 — details / tags / image) ----
exports.updateChannel = async (req, res) => {
  try {
    const channelId = req.params.id;
    const {
      name,
      description,
      members,
      image,
      statusTag,
      tags,
      channelDetails,
    } = req.body;
    const userId = req.user.userId;

    const channel = await Channel.findById(channelId);
    if (!channel) return res.status(404).json({ error: "Channel not found" });

    // Only the owner can update.
    if (channel.owner.toString() !== userId.toString()) {
      return res
        .status(403)
        .json({ error: "Not authorized to update this channel" });
    }

    if (typeof name === "string" && name.trim()) channel.name = name.trim();
    if (typeof description === "string") channel.description = description;
    if (typeof image === "string") channel.image = image; // empty string clears it
    const cleanStatus = sanitizeStatus(statusTag);
    if (cleanStatus) channel.statusTag = cleanStatus;
    if (Array.isArray(tags)) channel.tags = sanitizeTags(tags);
    if (channelDetails && typeof channelDetails === "object") {
      channel.channelDetails = {
        purpose: channelDetails.purpose ?? channel.channelDetails?.purpose ?? "",
        industry: channelDetails.industry ?? channel.channelDetails?.industry ?? "",
        website: channelDetails.website ?? channel.channelDetails?.website ?? "",
        location: channelDetails.location ?? channel.channelDetails?.location ?? "",
      };
    }
    if (members && Array.isArray(members)) {
      const uniqueMembers = normalizeMemberIds([
        ...members,
        channel.owner?.toString(),
      ]);
      channel.members = uniqueMembers;
    }

    await channel.save();

    res.status(200).json({ message: "Channel updated successfully", channel });
  } catch (error) {
    console.error("Error updating channel:", error);
    res.status(500).json({ error: "Server error", details: error.message });
  }
};

// ---- Channel image upload (feature #13) ----
// POST /api/:id/image  — multipart with field "image"
exports.uploadChannelImage = async (req, res) => {
  try {
    const channelId = req.params.id;
    const userId = req.user.userId;
    const channel = await Channel.findById(channelId);
    if (!channel) return res.status(404).json({ error: "Channel not found" });

    if (channel.owner.toString() !== userId.toString()) {
      return res
        .status(403)
        .json({ error: "Only the channel owner can update the image" });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "Image file is required" });
    }

    const url = await uploadToCloudinary(
      file.buffer,
      file.originalname || "channel-image",
      "channel_images"
    );

    channel.image = url;
    await channel.save();
    return res.json({ success: true, image: url, channel });
  } catch (error) {
    console.error("uploadChannelImage error:", error);
    return res
      .status(500)
      .json({ error: "Server error", details: error.message });
  }
};

// ---- Remove member (owner-only) ----
exports.removeMember = async (req, res) => {
  try {
    const channelId = req.params.id;
    const { memberId } = req.body;
    const requesterId = req.user.userId;

    if (!memberId) {
      return res.status(400).json({ error: "memberId is required" });
    }

    const channel = await Channel.findById(channelId);
    if (!channel) return res.status(404).json({ error: "Channel not found" });

    if (channel.owner?.toString() !== requesterId?.toString()) {
      return res
        .status(403)
        .json({ error: "Only the channel owner can remove members" });
    }

    const normalizedMembers = normalizeMemberIds(channel.members);
    const beforeCount = normalizedMembers.length;
    channel.members = normalizedMembers.filter(
      (m) => m !== memberId.toString()
    );

    if (channel.members.length === beforeCount) {
      return res.status(400).json({ error: "Member not found in channel" });
    }

    await channel.save();
    res.status(200).json({ message: "Member removed successfully", channel });
  } catch (error) {
    console.error("Error removing member:", error);
    res.status(500).json({ error: "Server error", details: error.message });
  }
};

// ---- Get all channels for the signed-in user ----
exports.getAllChannels = async (req, res) => {
  try {
    const userId = req.user.userId;

    const channels = await Channel.find({ members: { $in: [userId] } }).lean();

    const memberIds = [
      ...new Set(channels.flatMap((channel) => normalizeMemberIds(channel.members))),
    ];

    const users = await User.find(
      { _id: { $in: memberIds } },
      "name email avatar"
    ).lean();
    const admins = await Admin.find(
      { _id: { $in: memberIds } },
      "name email avatar"
    ).lean();
    const clients = await Client.find(
      { _id: { $in: memberIds } },
      "name email avatar"
    ).lean();

    const allMembers = [...users, ...admins, ...clients];

    const memberMap = {};
    allMembers.forEach((member) => {
      memberMap[member._id.toString()] = member;
    });

    const channelsWithMembers = await Promise.all(
      channels.map(async (channel) => {
        const [unreadMessages, lastMessage] = await Promise.all([
          ChannelMessage.countDocuments({
            channelId: channel._id,
            sender: { $ne: userId },
            seenBy: { $ne: userId },
          }),
          ChannelMessage.findOne({ channelId: channel._id })
            .sort({ createdAt: -1 })
            .select("createdAt")
            .lean(),
        ]);

        return {
          ...channel,
          members: mapResolvedMembers(channel.members, memberMap),
          unreadMessages,
          lastMessageTime: lastMessage?.createdAt || channel.createdAt || null,
        };
      })
    );

    channelsWithMembers.sort((a, b) => {
      if ((a.unreadMessages || 0) !== (b.unreadMessages || 0)) {
        return (b.unreadMessages || 0) - (a.unreadMessages || 0);
      }
      return new Date(b.lastMessageTime || 0) - new Date(a.lastMessageTime || 0);
    });

    res.status(200).json(channelsWithMembers);
  } catch (error) {
    console.error("Error fetching channels:", error);
    res.status(500).json({ error: "Server error", details: error.message });
  }
};

// ---- Single channel ----
exports.getChannelById = async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id).lean();
    if (!channel) return res.status(404).json({ error: "Channel not found" });

    const memberIds = normalizeMemberIds(channel.members);
    const users = await User.find(
      { _id: { $in: memberIds } },
      "name email avatar"
    ).lean();
    const admins = await Admin.find(
      { _id: { $in: memberIds } },
      "name email avatar"
    ).lean();
    const clients = await Client.find(
      { _id: { $in: memberIds } },
      "name email avatar"
    ).lean();

    const allMembers = [...users, ...admins, ...clients];

    const memberMap = {};
    allMembers.forEach((member) => {
      memberMap[member._id.toString()] = member;
    });

    const channelWithMembers = {
      ...channel,
      members: mapResolvedMembers(channel.members, memberMap),
    };

    res.status(200).json(channelWithMembers);
  } catch (error) {
    console.error("Error fetching channel:", error);
    res.status(500).json({ error: "Server error", details: error.message });
  }
};

// ---- Tag option metadata for the UI ----
// GET /api/tags/options
exports.getTagOptions = async (_req, res) => {
  return res.json({
    success: true,
    statusTagOptions: CHANNEL_STATUS_OPTIONS,
    predefinedTagOptions: PREDEFINED_TAG_OPTIONS,
  });
};

// ---- Delete channel ----
exports.deleteChannel = async (req, res) => {
  try {
    const channel = await Channel.findByIdAndDelete(req.params.id);
    if (!channel) return res.status(404).json({ error: "Channel not found" });

    res.status(200).json({ message: "Channel deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Server error", details: error.message });
  }
};

// ---- Invite link ----
exports.getInviteLink = async (req, res) => {
  try {
    const { channelId } = req.params;
    const channel = await Channel.findById(channelId);
    if (!channel) return res.status(404).json({ message: "Channel not found" });

    res.json({ inviteLink: `/join/${channel.inviteLink}` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ---- Single email invite (kept for backwards compatibility) ----
exports.inviteByEmail = async (req, res) => {
  try {
    const { channelId, email, invitedBy } = req.body;

    const channel = await Channel.findById(channelId);
    if (!channel) return res.status(404).json({ message: "Channel not found" });
    const user = await User.findOne({ email });
    const invite = new ChannelInvite({ channel: channelId, invitedBy, email });
    await invite.save();

    const inviteLink = `https://api.digitalmitro.info/api/join/${invite._id}`;
    const signupLink = `https://client.digitalmitro.info/signup`;
    const subject = `You're invited to join ${channel.name}`;
    const text = user
      ? `Hello,\n\nYou have been invited to join the channel "${channel.name}". \nClick the link below to accept the invitation:\n\n${inviteLink}\n\nBest regards,\nDigital Mitro Team`
      : `Hello,\n\nYou have been invited to join the channel "${channel.name}". However, it looks like you don't have an account yet.\n\nPlease sign up first by clicking the link below:\n\n${signupLink}\n\nAfter signing up, return to this email and click the invitation link to join the channel:\n\n${inviteLink}\n\nBest regards,\nDigital Mitro Team`;

    await sendMail(email, subject, text);

    res.json({ message: "Invite sent successfully", inviteLink });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", details: err.message });
  }
};

// ---- Multi-email invite (feature #10) ----
// POST /api/invite-multiple   body: { channelId, emails: [...], invitedBy }
exports.inviteByMultipleEmails = async (req, res) => {
  try {
    const { channelId, emails, invitedBy } = req.body;
    const inviterId = invitedBy || req.user?.userId;

    if (!channelId) {
      return res
        .status(400)
        .json({ success: false, message: "channelId is required" });
    }
    if (!Array.isArray(emails) || emails.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "At least one email is required" });
    }

    const channel = await Channel.findById(channelId);
    if (!channel) {
      return res
        .status(404)
        .json({ success: false, message: "Channel not found" });
    }

    // Validate + dedupe + lower-case the input list.
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const cleanedEmails = [
      ...new Set(
        emails
          .filter((value) => typeof value === "string")
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean)
      ),
    ];

    const results = await Promise.all(
      cleanedEmails.map(async (email) => {
        if (!emailRegex.test(email)) {
          return { email, status: "invalid", reason: "Invalid email format" };
        }
        try {
          const user = await User.findOne({ email });
          const invite = new ChannelInvite({
            channel: channelId,
            invitedBy: inviterId,
            email,
          });
          await invite.save();

          const inviteLink = `https://api.digitalmitro.info/api/join/${invite._id}`;
          const signupLink = `https://client.digitalmitro.info/signup`;
          const subject = `You're invited to join ${channel.name}`;
          const text = user
            ? `Hello,\n\nYou have been invited to join the channel "${channel.name}". \nClick the link below to accept the invitation:\n\n${inviteLink}\n\nBest regards,\nDigital Mitro Team`
            : `Hello,\n\nYou have been invited to join the channel "${channel.name}". However, it looks like you don't have an account yet.\n\nPlease sign up first by clicking the link below:\n\n${signupLink}\n\nAfter signing up, return to this email and click the invitation link to join the channel:\n\n${inviteLink}\n\nBest regards,\nDigital Mitro Team`;

          await sendMail(email, subject, text);
          return { email, status: "sent", inviteLink };
        } catch (err) {
          console.error(`Invite failed for ${email}:`, err?.message);
          return { email, status: "error", reason: "Send failed" };
        }
      })
    );

    const summary = results.reduce(
      (acc, r) => {
        acc.total += 1;
        if (r.status === "sent") acc.sent += 1;
        else if (r.status === "invalid") acc.invalid += 1;
        else acc.failed += 1;
        return acc;
      },
      { total: 0, sent: 0, invalid: 0, failed: 0 }
    );

    return res.json({ success: true, summary, results });
  } catch (err) {
    console.error("inviteByMultipleEmails error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Server error", details: err.message });
  }
};

// ---- Accept invite ----
exports.joinChannel = async (req, res) => {
  try {
    const { inviteLink } = req.params;
    if (!inviteLink) return res.status(401).json({ message: " missing params" });
    const invite = await ChannelInvite.findById({ _id: inviteLink });
    if (!invite)
      return res.status(404).json({ message: "Invalid or expired invite link" });

    const user = await User.findOne({ email: invite.email });
    const client = await Client.findOne({ email: invite.email });
    if (!user && !client) {
      return res.status(302).redirect("https://client.digitalmitro.info/signup");
    }
    const channel = await Channel.findById({ _id: invite.channel });
    if (!channel) return res.status(404).json({ message: "Channel not found" });

    const memberId = user ? user?._id : client?._id;

    const normalizedMembers = normalizeMemberIds(channel.members);
    if (!normalizedMembers.includes(memberId.toString())) {
      channel.members.push(memberId);
      await channel.save();
    }
    invite.status = "accepted";
    await invite.save();
    const redirectUrl =
      client?.email === invite.email
        ? "https://client.digitalmitro.info"
        : "https://digitalmitro.info";

    res.status(302).redirect(redirectUrl);
  } catch (err) {
    console.error("Error in joinChannel:", err);
    res.status(500).json({ message: "Server error", details: err.message });
  }
};
