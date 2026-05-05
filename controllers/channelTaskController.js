const mongoose = require("mongoose");
const ChannelTask = require("../models/ChannelTask");
const TaskCounter = require("../models/TaskCounter");
const Channel = require("../models/Channels");
const ChannelMessage = require("../models/ChannelMessage");
const Notification = require("../models/Notifications");
const User = require("../models/User");
const Admin = require("../models/Admin");
const Client = require("../models/Client");
const sendMail = require("../services/sendMail");
const { getIo, emitToUser, isUserOnline, triggerSoftRefresh } = require("../utils/socket");

const VALID_STATUSES = ["Assigned", "Acknowledged", "Completed"];
const VALID_PRIORITIES = ["Low", "Medium", "High", "Urgent"];
const MAX_TASK_ATTACHMENTS = 15;
const MAX_TASK_COMMENT_LENGTH = 2000;
const MAX_TASK_TAGS = 20;
const MAX_TASK_TAG_LENGTH = 40;
const MAX_ACTIVITY_TAG_PREVIEW = 5;
const DEFAULT_REMINDER_MINUTES = [1440, 60];
const MAX_REMINDER_MINUTES_ENTRIES = 10;
const MAX_REMINDER_MINUTES_VALUE = 60 * 24 * 30; // 30 days
const DEFAULT_ESCALATION_MINUTES_AFTER_DUE = 120;
const MAX_ESCALATION_MINUTES_AFTER_DUE = 60 * 24 * 30; // 30 days

const escapeRegex = (value = "") =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const decodeSafe = (value = "") => {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
};

const getAttachmentNameFromUrl = (url = "") => {
  if (!url) return "file";
  try {
    const parsed = new URL(url);
    const named = parsed.searchParams.get("filename") || parsed.searchParams.get("name");
    if (named) return decodeSafe(named);
    return decodeSafe(parsed.pathname.split("/").pop() || "file");
  } catch (error) {
    const [pathPart, queryPart] = url.split("?");
    if (queryPart) {
      const params = new URLSearchParams(queryPart);
      const named = params.get("filename") || params.get("name");
      if (named) return decodeSafe(named);
    }
    return decodeSafe(pathPart.split("/").pop() || "file");
  }
};

const normalizeTaskAttachments = (attachments, fallbackUploadedBy = null) => {
  if (attachments === undefined) return { attachments: undefined, error: null };
  if (!Array.isArray(attachments)) {
    return { attachments: [], error: "attachments must be an array" };
  }
  if (attachments.length > MAX_TASK_ATTACHMENTS) {
    return {
      attachments: [],
      error: `attachments cannot exceed ${MAX_TASK_ATTACHMENTS} files`,
    };
  }

  const normalized = [];
  for (const attachment of attachments) {
    if (!attachment) continue;

    let url = "";
    let name = "";
    let mimeType = "";
    let size = 0;
    let uploadedAt = new Date();
    let uploadedBy = fallbackUploadedBy;

    if (typeof attachment === "string") {
      url = attachment.trim();
    } else if (typeof attachment === "object") {
      url = attachment.url?.toString().trim() || "";
      name = attachment.name?.toString().trim() || "";
      mimeType = attachment.mimeType?.toString().trim() || "";
      const parsedSize = Number(attachment.size);
      size = Number.isFinite(parsedSize) && parsedSize > 0 ? parsedSize : 0;

      if (attachment.uploadedAt) {
        const parsedUploadedAt = new Date(attachment.uploadedAt);
        if (!Number.isNaN(parsedUploadedAt.getTime())) {
          uploadedAt = parsedUploadedAt;
        }
      }

      if (
        attachment.uploadedBy &&
        mongoose.Types.ObjectId.isValid(attachment.uploadedBy)
      ) {
        uploadedBy = attachment.uploadedBy;
      }
    }

    if (!url) {
      return { attachments: [], error: "each attachment must include a valid url" };
    }

    normalized.push({
      url,
      name: name || getAttachmentNameFromUrl(url),
      mimeType,
      size,
      uploadedBy:
        uploadedBy && mongoose.Types.ObjectId.isValid(uploadedBy)
          ? uploadedBy
          : null,
      uploadedAt,
    });
  }

  return { attachments: normalized, error: null };
};

const getAttachmentsSignature = (attachments = []) =>
  JSON.stringify(
    (attachments || []).map((attachment) => ({
      url: attachment?.url || "",
      name: attachment?.name || "",
      mimeType: attachment?.mimeType || "",
      size: Number(attachment?.size || 0),
    }))
  );

const normalizeMentionUserIds = (mentionUserIds, channel) => {
  if (mentionUserIds === undefined) return { mentionIds: [], error: null };
  if (!Array.isArray(mentionUserIds)) {
    return { mentionIds: [], error: "mentionUserIds must be an array" };
  }

  const memberSet = new Set((channel.members || []).map((id) => id?.toString()));
  memberSet.add(channel.owner?.toString());
  const uniqueMentionIds = [
    ...new Set(
      mentionUserIds
        .filter((id) => id && mongoose.Types.ObjectId.isValid(id))
        .map((id) => id.toString())
    ),
  ];
  const invalidMention = uniqueMentionIds.find((id) => !memberSet.has(id));
  if (invalidMention) {
    return { mentionIds: [], error: "mentions must belong to this channel" };
  }
  return { mentionIds: uniqueMentionIds, error: null };
};

const normalizeTaskPriority = (priority) => {
  if (priority === undefined) return { priority: undefined, error: null };
  const value = priority?.toString().trim();
  if (!value) return { priority: "Medium", error: null };
  if (!VALID_PRIORITIES.includes(value)) {
    return { priority: null, error: "Invalid priority" };
  }
  return { priority: value, error: null };
};

const normalizeTaskTags = (tags) => {
  if (tags === undefined) return { tags: undefined, error: null };

  const rawTags = Array.isArray(tags)
    ? tags
    : tags
        .toString()
        .split(",")
        .map((tag) => tag.trim());

  const normalized = [
    ...new Set(
      rawTags
        .map((tag) => tag?.toString().trim())
        .filter(Boolean)
        .map((tag) => tag.slice(0, MAX_TASK_TAG_LENGTH))
    ),
  ];

  if (normalized.length > MAX_TASK_TAGS) {
    return {
      tags: [],
      error: `tags cannot exceed ${MAX_TASK_TAGS}`,
    };
  }

  return { tags: normalized, error: null };
};

const formatTagsForLog = (tags = []) => {
  const safeTags = Array.isArray(tags)
    ? tags.map((tag) => tag?.toString().trim()).filter(Boolean)
    : [];
  if (safeTags.length === 0) return "";
  const visible = safeTags.slice(0, MAX_ACTIVITY_TAG_PREVIEW).join(", ");
  return safeTags.length > MAX_ACTIVITY_TAG_PREVIEW
    ? `${visible} +${safeTags.length - MAX_ACTIVITY_TAG_PREVIEW} more`
    : visible;
};

const buildTaskActivity = ({ action, message, actor = null, metadata = {} }) => ({
  action: action?.toString().trim() || "TASK_UPDATED",
  message: message?.toString().trim() || "Task updated.",
  actor:
    actor && mongoose.Types.ObjectId.isValid(actor) ? actor : null,
  metadata: metadata && typeof metadata === "object" ? metadata : {},
  createdAt: new Date(),
});

const normalizeReminderMinutes = (minutesBefore) => {
  const raw = Array.isArray(minutesBefore)
    ? minutesBefore
    : minutesBefore
        ?.toString()
        .split(",")
        .map((value) => value.trim()) || [];

  const parsed = raw
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.min(value, MAX_REMINDER_MINUTES_VALUE));

  const unique = [...new Set(parsed)];
  const limited = unique.slice(0, MAX_REMINDER_MINUTES_ENTRIES);
  return limited.sort((a, b) => b - a);
};

const normalizeReminderRules = (incomingRules, currentRules = null) => {
  if (incomingRules === undefined) return { rules: undefined, error: null };
  if (incomingRules !== null && typeof incomingRules !== "object") {
    return { rules: null, error: "reminderRules must be an object" };
  }

  const source = incomingRules || {};
  const current = currentRules || {};
  const enabled =
    source.enabled === undefined
      ? current.enabled === undefined
        ? true
        : !!current.enabled
      : !!source.enabled;

  const baseMinutes =
    source.minutesBefore !== undefined
      ? source.minutesBefore
      : current.minutesBefore !== undefined
      ? current.minutesBefore
      : DEFAULT_REMINDER_MINUTES;
  const normalizedMinutes = normalizeReminderMinutes(baseMinutes);

  if (enabled && normalizedMinutes.length === 0) {
    return {
      rules: null,
      error: "reminderRules.minutesBefore must include at least one positive value",
    };
  }

  const previousSent = normalizeReminderMinutes(current.sentMinutesBefore || []);
  const sentMinutesBefore = previousSent.filter((minutes) =>
    normalizedMinutes.includes(minutes)
  );

  return {
    rules: {
      enabled,
      minutesBefore: normalizedMinutes,
      sentMinutesBefore: enabled ? sentMinutesBefore : [],
    },
    error: null,
  };
};

const normalizeEscalationRules = (incomingRules, currentRules = null) => {
  if (incomingRules === undefined) return { rules: undefined, error: null };
  if (incomingRules !== null && typeof incomingRules !== "object") {
    return { rules: null, error: "escalationRules must be an object" };
  }

  const source = incomingRules || {};
  const current = currentRules || {};
  const enabled =
    source.enabled === undefined
      ? current.enabled === undefined
        ? true
        : !!current.enabled
      : !!source.enabled;

  const rawMinutesAfterDue =
    source.minutesAfterDue !== undefined
      ? source.minutesAfterDue
      : current.minutesAfterDue !== undefined
      ? current.minutesAfterDue
      : DEFAULT_ESCALATION_MINUTES_AFTER_DUE;
  const parsedMinutesAfterDue = Number.parseInt(rawMinutesAfterDue, 10);
  if (!Number.isFinite(parsedMinutesAfterDue) || parsedMinutesAfterDue <= 0) {
    return {
      rules: null,
      error: "escalationRules.minutesAfterDue must be a positive number",
    };
  }

  const minutesAfterDue = Math.min(
    parsedMinutesAfterDue,
    MAX_ESCALATION_MINUTES_AFTER_DUE
  );

  return {
    rules: {
      enabled,
      minutesAfterDue,
      escalatedAt:
        current.escalatedAt && !Number.isNaN(new Date(current.escalatedAt).getTime())
          ? new Date(current.escalatedAt)
          : null,
    },
    error: null,
  };
};

const ensureTaskRuleDefaults = (task) => {
  if (!task.reminderRules || typeof task.reminderRules !== "object") {
    task.reminderRules = {
      enabled: true,
      minutesBefore: [...DEFAULT_REMINDER_MINUTES],
      sentMinutesBefore: [],
    };
  } else {
    const normalizedMinutes = normalizeReminderMinutes(
      task.reminderRules.minutesBefore || DEFAULT_REMINDER_MINUTES
    );
    task.reminderRules.enabled = task.reminderRules.enabled !== false;
    task.reminderRules.minutesBefore = normalizedMinutes.length
      ? normalizedMinutes
      : [...DEFAULT_REMINDER_MINUTES];
    task.reminderRules.sentMinutesBefore = normalizeReminderMinutes(
      task.reminderRules.sentMinutesBefore || []
    ).filter((minutes) => task.reminderRules.minutesBefore.includes(minutes));
  }

  if (!task.escalationRules || typeof task.escalationRules !== "object") {
    task.escalationRules = {
      enabled: true,
      minutesAfterDue: DEFAULT_ESCALATION_MINUTES_AFTER_DUE,
      escalatedAt: null,
    };
  } else {
    const parsedMinutesAfterDue = Number.parseInt(
      task.escalationRules.minutesAfterDue,
      10
    );
    task.escalationRules.enabled = task.escalationRules.enabled !== false;
    task.escalationRules.minutesAfterDue =
      Number.isFinite(parsedMinutesAfterDue) && parsedMinutesAfterDue > 0
        ? Math.min(parsedMinutesAfterDue, MAX_ESCALATION_MINUTES_AFTER_DUE)
        : DEFAULT_ESCALATION_MINUTES_AFTER_DUE;
    if (
      !task.escalationRules.escalatedAt ||
      Number.isNaN(new Date(task.escalationRules.escalatedAt).getTime())
    ) {
      task.escalationRules.escalatedAt = null;
    }
  }
};

const formatReminderTimeLabel = (minutesBefore) => {
  if (!Number.isFinite(minutesBefore) || minutesBefore <= 0) return "soon";
  if (minutesBefore % (24 * 60) === 0) {
    const days = minutesBefore / (24 * 60);
    return days === 1 ? "1 day" : `${days} days`;
  }
  if (minutesBefore % 60 === 0) {
    const hours = minutesBefore / 60;
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  return minutesBefore === 1 ? "1 minute" : `${minutesBefore} minutes`;
};

const resolveUserEntity = async (id) => {
  if (!id) return null;
  return (
    (await User.findById(id)) ||
    (await Admin.findById(id)) ||
    (await Client.findById(id))
  );
};

const resolveUsersMap = async (ids = []) => {
  const objectIds = ids
    .filter(Boolean)
    .map((id) => id.toString());
  if (objectIds.length === 0) return {};

  const [users, admins, clients] = await Promise.all([
    User.find({ _id: { $in: objectIds } }, "_id name email").lean(),
    Admin.find({ _id: { $in: objectIds } }, "_id name email").lean(),
    Client.find({ _id: { $in: objectIds } }, "_id name email").lean(),
  ]);

  const map = {};
  [...users, ...admins, ...clients].forEach((entity) => {
    map[entity._id.toString()] = entity;
  });
  return map;
};

const formatTaskNumber = (seq) => `TASK-${String(seq).padStart(4, "0")}`;

const getNextTaskNumber = async () => {
  const counter = await TaskCounter.findOneAndUpdate(
    { _id: "channel_task" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return formatTaskNumber(counter.seq);
};

const isChannelMember = (channel, userId) => {
  if (!channel || !userId) return false;
  const targetId = userId.toString();
  if (channel.owner?.toString() === targetId) return true;
  return (channel.members || []).some((memberId) => memberId?.toString() === targetId);
};

const getAccessibleChannel = async (channelId, userId) => {
  if (!mongoose.Types.ObjectId.isValid(channelId)) return null;
  const channel = await Channel.findById(channelId).lean();
  if (!channel) return null;
  if (!isChannelMember(channel, userId)) return null;
  return channel;
};

const getAdminIdsForChannel = async (channel) => {
  const admins = await Admin.find({}, "_id").lean();
  if (admins.length === 0) return [];
  const memberSet = new Set((channel.members || []).map((id) => id?.toString()));
  const inChannelAdmins = admins
    .map((admin) => admin?._id?.toString())
    .filter((id) => id && memberSet.has(id));
  if (inChannelAdmins.length > 0) return inChannelAdmins;
  return admins.map((admin) => admin._id.toString());
};

const emitUserNotifications = async ({
  userIds = [],
  title,
  description,
  type,
  sender = null,
}) => {
  const uniqueIds = [...new Set(userIds.filter(Boolean).map((id) => id.toString()))];
  if (uniqueIds.length === 0) return [];

  const notificationDocs = await Notification.insertMany(
    uniqueIds.map((id) => ({
      userId: id,
      title,
      description,
      type,
      sender,
    }))
  );

  const deliveredIds = [];
  const offlineRecipientIds = [];
  uniqueIds.forEach((userId, idx) => {
    const doc = notificationDocs[idx];
    if (!isUserOnline(userId)) {
      offlineRecipientIds.push(userId);
      return;
    }
    emitToUser(userId, "receive-notification", {
      title: doc.title,
      description: doc.description,
      type: doc.type,
      sender: doc.sender,
      timestamp: doc.createdAt,
    });
    deliveredIds.push(doc._id);
  });

  if (deliveredIds.length > 0) {
    await Notification.updateMany(
      { _id: { $in: deliveredIds } },
      { $set: { isRead: true } }
    );
  }

  if (offlineRecipientIds.length > 0) {
    const recipientsMap = await resolveUsersMap(offlineRecipientIds);
    await Promise.all(
      offlineRecipientIds.map(async (userId) => {
        const recipient = recipientsMap[userId];
        if (!recipient?.email) return;
        await sendMail(
          recipient.email,
          `Task update in ${title || "channel"}`,
          description
        );
      })
    );
  }

  return notificationDocs;
};

const postSystemMessage = async (channelId, message) => {
  const systemMessage = await ChannelMessage.create({
    channelId,
    sender: null,
    isSystem: true,
    systemLabel: "System",
    message,
  });
  const io = getIo();
  io.to(channelId.toString()).emit("new-channel-message", systemMessage);
  return systemMessage;
};

const mapTasksWithUsers = async (tasks = []) => {
  const ids = new Set();
  tasks.forEach((task) => {
    if (task?.assignedTo) ids.add(task.assignedTo.toString());
    if (task?.createdBy) ids.add(task.createdBy.toString());
    (task?.activityLog || []).forEach((activity) => {
      if (activity?.actor) ids.add(activity.actor.toString());
    });
    (task?.comments || []).forEach((comment) => {
      if (comment?.author) ids.add(comment.author.toString());
      (comment?.mentions || []).forEach((mentionId) => {
        if (mentionId) ids.add(mentionId.toString());
      });
    });
  });

  const usersMap = await resolveUsersMap([...ids]);
  return tasks.map((task) => {
    const assignedToId = task.assignedTo?.toString();
    const createdById = task.createdBy?.toString();
    const normalizedReminderMinutes = normalizeReminderMinutes(
      task?.reminderRules?.minutesBefore || DEFAULT_REMINDER_MINUTES
    );
    const normalizedSentReminderMinutes = normalizeReminderMinutes(
      task?.reminderRules?.sentMinutesBefore || []
    ).filter((minutes) => normalizedReminderMinutes.includes(minutes));
    const escalationMinutesAfterDue = Number.parseInt(
      task?.escalationRules?.minutesAfterDue,
      10
    );
    return {
      ...task,
      isOverdue:
        task.status !== "Completed" &&
        new Date(task.deadline).getTime() < Date.now(),
      reminderRules: {
        enabled: task?.reminderRules?.enabled !== false,
        minutesBefore: normalizedReminderMinutes,
        sentMinutesBefore: normalizedSentReminderMinutes,
      },
      escalationRules: {
        enabled: task?.escalationRules?.enabled !== false,
        minutesAfterDue:
          Number.isFinite(escalationMinutesAfterDue) && escalationMinutesAfterDue > 0
            ? Math.min(escalationMinutesAfterDue, MAX_ESCALATION_MINUTES_AFTER_DUE)
            : DEFAULT_ESCALATION_MINUTES_AFTER_DUE,
        escalatedAt:
          task?.escalationRules?.escalatedAt &&
          !Number.isNaN(new Date(task.escalationRules.escalatedAt).getTime())
            ? new Date(task.escalationRules.escalatedAt)
            : null,
      },
      assignedToUser: assignedToId ? usersMap[assignedToId] || null : null,
      createdByUser: createdById ? usersMap[createdById] || null : null,
      comments: (task.comments || []).map((comment) => {
        const authorId = comment?.author?.toString();
        const mentionIds = (comment?.mentions || [])
          .map((mentionId) => mentionId?.toString())
          .filter(Boolean);
        return {
          ...comment,
          authorUser: authorId ? usersMap[authorId] || null : null,
          mentionUsers: mentionIds
            .map((mentionId) => usersMap[mentionId])
            .filter(Boolean),
        };
      }),
      activityLog: (task.activityLog || []).map((activity) => {
        const actorId = activity?.actor?.toString();
        return {
          ...activity,
          actorUser: actorId ? usersMap[actorId] || null : null,
        };
      }),
    };
  });
};

const buildTaskQuery = ({
  channelId,
  search,
  status,
  month,
  assignedTo,
  priority,
  tag,
}) => {
  const query = { channelId };

  if (search?.trim()) {
    const term = escapeRegex(search.trim());
    query.$or = [
      { title: { $regex: term, $options: "i" } },
      { taskNumber: { $regex: term, $options: "i" } },
    ];
  }

  if (status && VALID_STATUSES.includes(status)) {
    query.status = status;
  }

  if (priority && VALID_PRIORITIES.includes(priority)) {
    query.priority = priority;
  }

  if (assignedTo && mongoose.Types.ObjectId.isValid(assignedTo)) {
    query.assignedTo = assignedTo;
  }

  if (tag?.trim()) {
    query.tags = { $regex: escapeRegex(tag.trim()), $options: "i" };
  }

  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [year, monthIndex] = month.split("-").map(Number);
    const start = new Date(Date.UTC(year, monthIndex - 1, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, monthIndex, 0, 23, 59, 59, 999));
    query.deadline = { $gte: start, $lte: end };
  }

  return query;
};

const isVersionConflictError = (error) =>
  error?.name === "VersionError" ||
  error instanceof mongoose.Error.VersionError;

const checkAndMarkOverdueTasks = async (channelId = null) => {
  const now = Date.now();
  const query = {
    status: { $ne: "Completed" },
    $or: [
      { overdueNotified: { $ne: true } },
      { "reminderRules.enabled": { $ne: false } },
      { "escalationRules.enabled": { $ne: false } },
    ],
  };
  if (channelId) {
    query.channelId = channelId;
  }

  const tasks = await ChannelTask.find(query);
  if (tasks.length === 0) return 0;

  const channelIds = [...new Set(tasks.map((task) => task.channelId.toString()))];
  const channels = await Channel.find({ _id: { $in: channelIds } }).lean();
  const channelMap = {};
  channels.forEach((channel) => {
    channelMap[channel._id.toString()] = channel;
  });

  const adminCache = {};
  let processedAlerts = 0;
  for (const task of tasks) {
    const taskChannelId = task.channelId.toString();
    const channel = channelMap[taskChannelId];
    if (!channel) continue;
    ensureTaskRuleDefaults(task);
    const deadlineMs = new Date(task.deadline).getTime();
    if (!Number.isFinite(deadlineMs)) continue;

    let hasChanges = false;
    let emittedType = "TASK_UPDATED";
    const queuedNotifications = [];
    const queuedSystemMessages = [];

    if (task.reminderRules?.enabled && now < deadlineMs) {
      const reminderMinutes = normalizeReminderMinutes(task.reminderRules.minutesBefore);
      const sentReminderSet = new Set(
        normalizeReminderMinutes(task.reminderRules.sentMinutesBefore)
      );

      for (const minutesBefore of reminderMinutes) {
        const reminderTriggerAt = deadlineMs - minutesBefore * 60 * 1000;
        if (now < reminderTriggerAt || sentReminderSet.has(minutesBefore)) continue;

        if (task.assignedTo) {
          queuedNotifications.push({
            userIds: [task.assignedTo],
            title: channel.name || "Channel",
            description: `Reminder: Task ${task.taskNumber} is due in ${formatReminderTimeLabel(minutesBefore)}.`,
            type: "TASK_REMINDER",
            sender: channel._id,
          });
        }
        queuedSystemMessages.push(
          `Reminder: ${task.taskNumber} is due in ${formatReminderTimeLabel(minutesBefore)}.`
        );
        task.activityLog.push(
          buildTaskActivity({
            action: "TASK_REMINDER_SENT",
            message: `Reminder sent ${formatReminderTimeLabel(minutesBefore)} before deadline.`,
            actor: null,
            metadata: { minutesBefore, source: "system" },
          })
        );

        sentReminderSet.add(minutesBefore);
        hasChanges = true;
        emittedType = "TASK_REMINDER";
        processedAlerts += 1;
      }

      task.reminderRules.sentMinutesBefore = [...sentReminderSet].sort((a, b) => b - a);
    }

    if (!task.overdueNotified && now >= deadlineMs) {
      if (!adminCache[taskChannelId]) {
        adminCache[taskChannelId] = await getAdminIdsForChannel(channel);
      }
      const adminIds = adminCache[taskChannelId];

      if (adminIds.length > 0) {
        queuedNotifications.push({
          userIds: adminIds,
          title: channel.name || "Channel",
          description: `Task ${task.taskNumber} is overdue.`,
          type: "TASK_OVERDUE",
          sender: channel._id,
        });
      }

      queuedSystemMessages.push(`${task.taskNumber} is now overdue.`);
      task.overdueNotified = true;
      task.activityLog.push(
        buildTaskActivity({
          action: "TASK_OVERDUE",
          message: "Task became overdue.",
          actor: null,
          metadata: { source: "system" },
        })
      );
      hasChanges = true;
      emittedType = "TASK_OVERDUE";
      processedAlerts += 1;
    }

    const escalationDelayMinutes =
      Number.parseInt(task.escalationRules?.minutesAfterDue, 10) ||
      DEFAULT_ESCALATION_MINUTES_AFTER_DUE;
    const shouldEscalate =
      task.escalationRules?.enabled &&
      !task.escalationRules?.escalatedAt &&
      now >= deadlineMs + escalationDelayMinutes * 60 * 1000;

    if (shouldEscalate) {
      if (!adminCache[taskChannelId]) {
        adminCache[taskChannelId] = await getAdminIdsForChannel(channel);
      }
      const adminIds = adminCache[taskChannelId];
      if (adminIds.length > 0) {
        queuedNotifications.push({
          userIds: adminIds,
          title: channel.name || "Channel",
          description: `Task ${task.taskNumber} has been escalated (${escalationDelayMinutes} minutes overdue).`,
          type: "TASK_ESCALATED",
          sender: channel._id,
        });
      }

      queuedSystemMessages.push(`${task.taskNumber} has been escalated to admins.`);
      task.escalationRules.escalatedAt = new Date();
      task.activityLog.push(
        buildTaskActivity({
          action: "TASK_ESCALATED",
          message: `Task escalated after ${escalationDelayMinutes} minutes overdue.`,
          actor: null,
          metadata: {
            minutesAfterDue: escalationDelayMinutes,
            source: "system",
          },
        })
      );
      hasChanges = true;
      emittedType = "TASK_ESCALATED";
      processedAlerts += 1;
    }

    if (!hasChanges) continue;

    try {
      await task.save();
    } catch (error) {
      if (isVersionConflictError(error)) {
        continue;
      }
      throw error;
    }

    for (const notificationPayload of queuedNotifications) {
      try {
        await emitUserNotifications(notificationPayload);
      } catch (error) {
        console.error("Failed to send queued task notification:", error);
      }
    }

    for (const systemMessage of queuedSystemMessages) {
      try {
        await postSystemMessage(channel._id, systemMessage);
      } catch (error) {
        console.error("Failed to post queued task system message:", error);
      }
    }

    getIo().to(taskChannelId).emit("task-updated", {
      type: emittedType,
      channelId: taskChannelId,
      taskId: task._id,
    });
  }

  if (processedAlerts > 0) {
    await triggerSoftRefresh("TASK");
  }
  return processedAlerts;
};

const runTaskMaintenanceSafely = async (channelId = null) => {
  try {
    return await checkAndMarkOverdueTasks(channelId);
  } catch (error) {
    console.error("Task maintenance skipped due to runtime error:", error);
    return 0;
  }
};

const getChannelTasks = async (req, res) => {
  try {
    const { channelId } = req.params;
    const requesterId = req.user?.userId;

    const channel = await getAccessibleChannel(channelId, requesterId);
    if (!channel) {
      return res.status(403).json({ success: false, message: "Not authorized for this channel" });
    }

    await runTaskMaintenanceSafely(channelId);

    const {
      search = "",
      status = "",
      month = "",
      assignedTo = "",
      priority = "",
      tag = "",
    } = req.query;
    const query = buildTaskQuery({
      channelId: channel._id,
      search,
      status,
      month,
      assignedTo,
      priority,
      tag,
    });

    const tasks = await ChannelTask.find(query)
      .sort({ deadline: 1, createdAt: -1 })
      .lean();

    const mappedTasks = await mapTasksWithUsers(tasks);
    res.status(200).json({ success: true, tasks: mappedTasks });
  } catch (error) {
    console.error("Error fetching channel tasks:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

const createChannelTask = async (req, res) => {
  try {
    const { channelId } = req.params;
    const requesterId = req.user?.userId;
    const {
      title,
      description = "",
      deadline,
      assignedTo,
      priority = "Medium",
      tags = [],
      reminderRules = {},
      escalationRules = {},
      attachments = [],
    } = req.body;

    const channel = await getAccessibleChannel(channelId, requesterId);
    if (!channel) {
      return res.status(403).json({ success: false, message: "Not authorized for this channel" });
    }

    if (!title?.trim() || !deadline || !assignedTo) {
      return res.status(400).json({ success: false, message: "title, deadline and assignedTo are required" });
    }

    const { priority: normalizedPriority, error: priorityError } = normalizeTaskPriority(priority);
    if (priorityError) {
      return res.status(400).json({ success: false, message: priorityError });
    }

    const { tags: normalizedTags, error: tagsError } = normalizeTaskTags(tags);
    if (tagsError) {
      return res.status(400).json({ success: false, message: tagsError });
    }

    const { rules: normalizedReminderRules, error: reminderRulesError } =
      normalizeReminderRules(reminderRules);
    if (reminderRulesError) {
      return res.status(400).json({ success: false, message: reminderRulesError });
    }

    const { rules: normalizedEscalationRules, error: escalationRulesError } =
      normalizeEscalationRules(escalationRules);
    if (escalationRulesError) {
      return res.status(400).json({ success: false, message: escalationRulesError });
    }

    const deadlineDate = new Date(deadline);
    if (Number.isNaN(deadlineDate.getTime())) {
      return res.status(400).json({ success: false, message: "Invalid deadline" });
    }

    const memberSet = new Set((channel.members || []).map((id) => id?.toString()));
    memberSet.add(channel.owner?.toString());
    if (!memberSet.has(assignedTo?.toString())) {
      return res.status(400).json({ success: false, message: "assignedTo must be a channel member" });
    }

    const {
      attachments: normalizedAttachments,
      error: attachmentError,
    } = normalizeTaskAttachments(attachments, requesterId);
    if (attachmentError) {
      return res.status(400).json({ success: false, message: attachmentError });
    }

    const [taskNumber, creator, assignee] = await Promise.all([
      getNextTaskNumber(),
      resolveUserEntity(requesterId),
      resolveUserEntity(assignedTo),
    ]);
    const creatorName = creator?.name || "User";
    const assigneeName = assignee?.name || "User";
    const tagsPreview = formatTagsForLog(normalizedTags || []);
    const initialActivity = [
      buildTaskActivity({
        action: "TASK_CREATED",
        message: `Task created by ${creatorName}.`,
        actor: requesterId,
        metadata: { title: title.trim() },
      }),
      buildTaskActivity({
        action: "TASK_ASSIGNED",
        message: `Assigned to ${assigneeName}.`,
        actor: requesterId,
        metadata: { assignedTo: assignedTo?.toString() },
      }),
      buildTaskActivity({
        action: "TASK_PRIORITY_SET",
        message: `Priority set to ${normalizedPriority.toLowerCase()}.`,
        actor: requesterId,
        metadata: { priority: normalizedPriority },
      }),
    ];
    if ((normalizedTags || []).length > 0) {
      initialActivity.push(
        buildTaskActivity({
          action: "TASK_TAGS_SET",
          message: `Tags set: ${tagsPreview}.`,
          actor: requesterId,
          metadata: { tags: normalizedTags },
        })
      );
    }
    if ((normalizedAttachments || []).length > 0) {
      initialActivity.push(
        buildTaskActivity({
          action: "TASK_ATTACHMENTS_SET",
          message: `${normalizedAttachments.length} attachment(s) added.`,
          actor: requesterId,
          metadata: { count: normalizedAttachments.length },
        })
      );
    }
    initialActivity.push(
      buildTaskActivity({
        action: "TASK_REMINDER_RULES_SET",
        message:
          normalizedReminderRules.enabled
            ? `Reminder rules set (${normalizedReminderRules.minutesBefore.join(", ")} minutes before deadline).`
            : "Reminders disabled.",
        actor: requesterId,
        metadata: {
          enabled: normalizedReminderRules.enabled,
          minutesBefore: normalizedReminderRules.minutesBefore,
        },
      })
    );
    initialActivity.push(
      buildTaskActivity({
        action: "TASK_ESCALATION_RULES_SET",
        message:
          normalizedEscalationRules.enabled
            ? `Escalation rule set (${normalizedEscalationRules.minutesAfterDue} minutes after deadline).`
            : "Escalation disabled.",
        actor: requesterId,
        metadata: {
          enabled: normalizedEscalationRules.enabled,
          minutesAfterDue: normalizedEscalationRules.minutesAfterDue,
        },
      })
    );

    const createdTask = await ChannelTask.create({
      channelId: channel._id,
      taskNumber,
      title: title.trim(),
      description: description?.trim() || "",
      deadline: deadlineDate,
      assignedTo,
      createdBy: requesterId,
      status: "Assigned",
      priority: normalizedPriority || "Medium",
      tags: normalizedTags || [],
      reminderRules: normalizedReminderRules,
      escalationRules: normalizedEscalationRules,
      attachments: normalizedAttachments,
      activityLog: initialActivity,
    });

    await postSystemMessage(channel._id, `${taskNumber} created by ${creatorName}.`);
    await postSystemMessage(channel._id, `${taskNumber} assigned to ${assigneeName}.`);

    if (assignedTo?.toString() !== requesterId?.toString()) {
      await emitUserNotifications({
        userIds: [assignedTo],
        title: channel.name || "Channel",
        description: `Task ${taskNumber} assigned to you by ${creatorName}.`,
        type: "TASK_ASSIGNED",
        sender: channel._id,
      });
    }

    await runTaskMaintenanceSafely(channel._id);
    await triggerSoftRefresh("TASK");
    getIo().to(channel._id.toString()).emit("task-updated", {
      type: "TASK_CREATED",
      channelId: channel._id,
      taskId: createdTask._id,
    });

    const mapped = await mapTasksWithUsers([createdTask.toObject()]);
    res.status(201).json({ success: true, task: mapped[0] });
  } catch (error) {
    console.error("Error creating channel task:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

const updateChannelTask = async (req, res) => {
  try {
    const { channelId, taskId } = req.params;
    const requesterId = req.user?.userId;
    const {
      title,
      description,
      deadline,
      assignedTo,
      status,
      priority,
      tags,
      reminderRules,
      escalationRules,
      attachments,
    } = req.body;

    const channel = await getAccessibleChannel(channelId, requesterId);
    if (!channel) {
      return res.status(403).json({ success: false, message: "Not authorized for this channel" });
    }

    const task = await ChannelTask.findOne({ _id: taskId, channelId: channel._id });
    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }
    ensureTaskRuleDefaults(task);

    const previousAssignedTo = task.assignedTo?.toString();
    const previousStatus = task.status;
    const previousDeadline = task.deadline ? new Date(task.deadline).getTime() : null;
    const previousTitle = task.title;
    const previousDescription = task.description || "";
    const previousPriority = task.priority;
    const previousTagsSignature = JSON.stringify(task.tags || []);
    const previousReminderRulesSignature = JSON.stringify({
      enabled: task.reminderRules?.enabled !== false,
      minutesBefore: normalizeReminderMinutes(task.reminderRules?.minutesBefore),
    });
    const previousEscalationRulesSignature = JSON.stringify({
      enabled: task.escalationRules?.enabled !== false,
      minutesAfterDue:
        Number.parseInt(task.escalationRules?.minutesAfterDue, 10) ||
        DEFAULT_ESCALATION_MINUTES_AFTER_DUE,
    });
    const previousAttachmentsSignature = getAttachmentsSignature(task.attachments);

    if (title !== undefined) {
      if (!title?.trim()) {
        return res.status(400).json({ success: false, message: "title cannot be empty" });
      }
      task.title = title.trim();
    }

    if (description !== undefined) {
      task.description = description?.trim() || "";
    }

    if (deadline !== undefined) {
      const parsedDeadline = new Date(deadline);
      if (Number.isNaN(parsedDeadline.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid deadline" });
      }
      task.deadline = parsedDeadline;
      task.overdueNotified = false;
      task.reminderRules.sentMinutesBefore = [];
      task.escalationRules.escalatedAt = null;
    }

    if (assignedTo !== undefined) {
      const memberSet = new Set((channel.members || []).map((id) => id?.toString()));
      memberSet.add(channel.owner?.toString());
      if (!memberSet.has(assignedTo?.toString())) {
        return res.status(400).json({ success: false, message: "assignedTo must be a channel member" });
      }
      task.assignedTo = assignedTo;
      task.reminderRules.sentMinutesBefore = [];
      if (task.status === "Completed") {
        task.status = "Assigned";
        task.completedAt = null;
      }
    }

    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ success: false, message: "Invalid status" });
      }
      task.status = status;
      if (status === "Completed") {
        task.completedAt = new Date();
      } else {
        task.completedAt = null;
        if (previousStatus === "Completed") {
          task.overdueNotified = false;
          task.escalationRules.escalatedAt = null;
        }
      }
    }

    if (priority !== undefined) {
      const { priority: normalizedPriority, error: priorityError } = normalizeTaskPriority(priority);
      if (priorityError) {
        return res.status(400).json({ success: false, message: priorityError });
      }
      task.priority = normalizedPriority;
    }

    if (tags !== undefined) {
      const { tags: normalizedTags, error: tagsError } = normalizeTaskTags(tags);
      if (tagsError) {
        return res.status(400).json({ success: false, message: tagsError });
      }
      task.tags = normalizedTags;
    }

    if (reminderRules !== undefined) {
      const { rules: normalizedReminderRules, error: reminderRulesError } =
        normalizeReminderRules(reminderRules, task.reminderRules);
      if (reminderRulesError) {
        return res.status(400).json({ success: false, message: reminderRulesError });
      }
      task.reminderRules = normalizedReminderRules;
    }

    if (escalationRules !== undefined) {
      const { rules: normalizedEscalationRules, error: escalationRulesError } =
        normalizeEscalationRules(escalationRules, task.escalationRules);
      if (escalationRulesError) {
        return res.status(400).json({ success: false, message: escalationRulesError });
      }
      task.escalationRules = normalizedEscalationRules;
    }

    if (attachments !== undefined) {
      const {
        attachments: normalizedAttachments,
        error: attachmentError,
      } = normalizeTaskAttachments(attachments, requesterId);
      if (attachmentError) {
        return res.status(400).json({ success: false, message: attachmentError });
      }
      task.attachments = normalizedAttachments;
    }

    await task.save();

    const [actor, assignee] = await Promise.all([
      resolveUserEntity(requesterId),
      resolveUserEntity(task.assignedTo),
    ]);
    const actorName = actor?.name || "User";
    const assigneeName = assignee?.name || "User";
    const nextTagsSignature = JSON.stringify(task.tags || []);
    const nextReminderRulesSignature = JSON.stringify({
      enabled: task.reminderRules?.enabled !== false,
      minutesBefore: normalizeReminderMinutes(task.reminderRules?.minutesBefore),
    });
    const nextEscalationRulesSignature = JSON.stringify({
      enabled: task.escalationRules?.enabled !== false,
      minutesAfterDue:
        Number.parseInt(task.escalationRules?.minutesAfterDue, 10) ||
        DEFAULT_ESCALATION_MINUTES_AFTER_DUE,
    });
    const pendingActivity = [];

    if (title !== undefined && previousTitle !== task.title) {
      pendingActivity.push(
        buildTaskActivity({
          action: "TASK_TITLE_UPDATED",
          message: `Title updated by ${actorName}.`,
          actor: requesterId,
          metadata: { from: previousTitle, to: task.title },
        })
      );
    }

    if (description !== undefined && previousDescription !== (task.description || "")) {
      pendingActivity.push(
        buildTaskActivity({
          action: "TASK_DESCRIPTION_UPDATED",
          message: `Description updated by ${actorName}.`,
          actor: requesterId,
          metadata: {
            fromLength: previousDescription.length,
            toLength: (task.description || "").length,
          },
        })
      );
    }

    if (assignedTo !== undefined && previousAssignedTo !== task.assignedTo?.toString()) {
      await postSystemMessage(
        channel._id,
        `${task.taskNumber} assigned to ${assigneeName}.`
      );
      pendingActivity.push(
        buildTaskActivity({
          action: "TASK_ASSIGNED",
          message: `Assigned to ${assigneeName} by ${actorName}.`,
          actor: requesterId,
          metadata: {
            from: previousAssignedTo || null,
            to: task.assignedTo?.toString() || null,
          },
        })
      );
      if (task.assignedTo?.toString() !== requesterId?.toString()) {
        await emitUserNotifications({
          userIds: [task.assignedTo],
          title: channel.name || "Channel",
          description: `Task ${task.taskNumber} assigned to you by ${actorName}.`,
          type: "TASK_ASSIGNED",
          sender: channel._id,
        });
      }
    }

    if (
      deadline !== undefined &&
      previousDeadline !== new Date(task.deadline).getTime()
    ) {
      await postSystemMessage(
        channel._id,
        `${task.taskNumber} deadline updated by ${actorName}.`
      );
      pendingActivity.push(
        buildTaskActivity({
          action: "TASK_DEADLINE_UPDATED",
          message: `Deadline updated by ${actorName}.`,
          actor: requesterId,
          metadata: {
            from: previousDeadline ? new Date(previousDeadline) : null,
            to: task.deadline,
          },
        })
      );
    }

    if (status !== undefined && previousStatus !== task.status) {
      if (task.status === "Completed") {
        const adminIds = await getAdminIdsForChannel(channel);
        if (adminIds.length > 0) {
          await emitUserNotifications({
            userIds: adminIds,
            title: channel.name || "Channel",
            description: `Task ${task.taskNumber} marked as completed by ${actorName}.`,
            type: "TASK_COMPLETED",
            sender: channel._id,
          });
        }
        await postSystemMessage(channel._id, `${task.taskNumber} marked as completed.`);
      } else {
        await postSystemMessage(
          channel._id,
          `${task.taskNumber} status updated to ${task.status.toLowerCase()}.`
        );
      }
      pendingActivity.push(
        buildTaskActivity({
          action: "TASK_STATUS_UPDATED",
          message: `Status changed to ${task.status} by ${actorName}.`,
          actor: requesterId,
          metadata: { from: previousStatus, to: task.status },
        })
      );
    }

    if (priority !== undefined && previousPriority !== task.priority) {
      await postSystemMessage(
        channel._id,
        `${task.taskNumber} priority updated to ${task.priority.toLowerCase()}.`
      );
      pendingActivity.push(
        buildTaskActivity({
          action: "TASK_PRIORITY_UPDATED",
          message: `Priority changed to ${task.priority} by ${actorName}.`,
          actor: requesterId,
          metadata: { from: previousPriority, to: task.priority },
        })
      );
    }

    if (
      tags !== undefined &&
      previousTagsSignature !== nextTagsSignature
    ) {
      await postSystemMessage(
        channel._id,
        `${task.taskNumber} tags updated by ${actorName}.`
      );
      pendingActivity.push(
        buildTaskActivity({
          action: "TASK_TAGS_UPDATED",
          message:
            (task.tags || []).length > 0
              ? `Tags updated by ${actorName}: ${formatTagsForLog(task.tags)}.`
              : `All tags removed by ${actorName}.`,
          actor: requesterId,
          metadata: {
            from: JSON.parse(previousTagsSignature || "[]"),
            to: task.tags || [],
          },
        })
      );
    }

    if (
      reminderRules !== undefined &&
      previousReminderRulesSignature !== nextReminderRulesSignature
    ) {
      const currentReminderRules = task.reminderRules || {
        enabled: true,
        minutesBefore: [...DEFAULT_REMINDER_MINUTES],
      };
      await postSystemMessage(
        channel._id,
        currentReminderRules.enabled
          ? `${task.taskNumber} reminder rules updated by ${actorName}.`
          : `${task.taskNumber} reminders disabled by ${actorName}.`
      );
      pendingActivity.push(
        buildTaskActivity({
          action: "TASK_REMINDER_RULES_UPDATED",
          message: currentReminderRules.enabled
            ? `Reminder rules updated by ${actorName} (${currentReminderRules.minutesBefore.join(", ")} minutes before deadline).`
            : `Reminders disabled by ${actorName}.`,
          actor: requesterId,
          metadata: {
            from: JSON.parse(previousReminderRulesSignature || "{}"),
            to: {
              enabled: currentReminderRules.enabled,
              minutesBefore: currentReminderRules.minutesBefore,
            },
          },
        })
      );
    }

    if (
      escalationRules !== undefined &&
      previousEscalationRulesSignature !== nextEscalationRulesSignature
    ) {
      const currentEscalationRules = task.escalationRules || {
        enabled: true,
        minutesAfterDue: DEFAULT_ESCALATION_MINUTES_AFTER_DUE,
      };
      await postSystemMessage(
        channel._id,
        currentEscalationRules.enabled
          ? `${task.taskNumber} escalation rules updated by ${actorName}.`
          : `${task.taskNumber} escalation disabled by ${actorName}.`
      );
      pendingActivity.push(
        buildTaskActivity({
          action: "TASK_ESCALATION_RULES_UPDATED",
          message: currentEscalationRules.enabled
            ? `Escalation rules updated by ${actorName} (${currentEscalationRules.minutesAfterDue} minutes after deadline).`
            : `Escalation disabled by ${actorName}.`,
          actor: requesterId,
          metadata: {
            from: JSON.parse(previousEscalationRulesSignature || "{}"),
            to: {
              enabled: currentEscalationRules.enabled,
              minutesAfterDue: currentEscalationRules.minutesAfterDue,
            },
          },
        })
      );
    }

    if (
      attachments !== undefined &&
      previousAttachmentsSignature !== getAttachmentsSignature(task.attachments)
    ) {
      await postSystemMessage(
        channel._id,
        `${task.taskNumber} attachments updated by ${actorName}.`
      );
      pendingActivity.push(
        buildTaskActivity({
          action: "TASK_ATTACHMENTS_UPDATED",
          message: `Attachments updated by ${actorName}.`,
          actor: requesterId,
          metadata: { count: (task.attachments || []).length },
        })
      );
    }

    if (pendingActivity.length > 0) {
      task.activityLog.push(...pendingActivity);
      await task.save();
    }

    await runTaskMaintenanceSafely(channel._id);
    await triggerSoftRefresh("TASK");
    getIo().to(channel._id.toString()).emit("task-updated", {
      type: "TASK_UPDATED",
      channelId: channel._id,
      taskId: task._id,
    });

    const mapped = await mapTasksWithUsers([task.toObject()]);
    res.status(200).json({ success: true, task: mapped[0] });
  } catch (error) {
    console.error("Error updating channel task:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

const deleteChannelTask = async (req, res) => {
  try {
    const { channelId, taskId } = req.params;
    const requesterId = req.user?.userId;

    const channel = await getAccessibleChannel(channelId, requesterId);
    if (!channel) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized for this channel" });
    }

    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid task id" });
    }

    const task = await ChannelTask.findOne({ _id: taskId, channelId: channel._id });
    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }

    const actor = await resolveUserEntity(requesterId);
    const actorName = actor?.name || "User";
    const deletedTaskNumber = task.taskNumber;
    const deletedTaskId = task._id;
    const notificationTargets = [
      ...new Set(
        [task.assignedTo?.toString(), task.createdBy?.toString()].filter(
          (id) => id && id !== requesterId?.toString()
        )
      ),
    ];

    await ChannelTask.deleteOne({ _id: task._id, channelId: channel._id });
    await postSystemMessage(
      channel._id,
      `${deletedTaskNumber} deleted by ${actorName}.`
    );

    if (notificationTargets.length > 0) {
      await emitUserNotifications({
        userIds: notificationTargets,
        title: channel.name || "Channel",
        description: `Task ${deletedTaskNumber} was deleted by ${actorName}.`,
        type: "TASK_DELETED",
        sender: channel._id,
      });
    }

    await triggerSoftRefresh("TASK");
    getIo().to(channel._id.toString()).emit("task-updated", {
      type: "TASK_DELETED",
      channelId: channel._id,
      taskId: deletedTaskId,
      taskNumber: deletedTaskNumber,
    });

    return res.status(200).json({
      success: true,
      message: "Task deleted successfully.",
      taskId: deletedTaskId,
      taskNumber: deletedTaskNumber,
    });
  } catch (error) {
    console.error("Error deleting channel task:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

const addTaskComment = async (req, res) => {
  try {
    const { channelId, taskId } = req.params;
    const requesterId = req.user?.userId;
    const { comment = "", mentionUserIds = [] } = req.body;

    const channel = await getAccessibleChannel(channelId, requesterId);
    if (!channel) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized for this channel" });
    }

    const task = await ChannelTask.findOne({ _id: taskId, channelId: channel._id });
    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }

    const content = comment?.toString().trim();
    if (!content) {
      return res
        .status(400)
        .json({ success: false, message: "comment is required" });
    }
    if (content.length > MAX_TASK_COMMENT_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `comment cannot exceed ${MAX_TASK_COMMENT_LENGTH} characters`,
      });
    }

    const { mentionIds, error: mentionError } = normalizeMentionUserIds(
      mentionUserIds,
      channel
    );
    if (mentionError) {
      return res.status(400).json({ success: false, message: mentionError });
    }

    const actor = await resolveUserEntity(requesterId);
    const actorName = actor?.name || "User";

    task.comments.push({
      content,
      author: requesterId,
      mentions: mentionIds,
      createdAt: new Date(),
    });
    task.activityLog.push(
      buildTaskActivity({
        action: "TASK_COMMENT_ADDED",
        message: `Comment added by ${actorName}.`,
        actor: requesterId,
        metadata: {
          mentions: mentionIds.length,
          contentLength: content.length,
        },
      })
    );
    await task.save();

    const mentionTargets = mentionIds.filter(
      (mentionId) => mentionId !== requesterId?.toString()
    );
    if (mentionTargets.length > 0) {
      await emitUserNotifications({
        userIds: mentionTargets,
        title: channel.name || "Channel",
        description: `${actorName} mentioned you in task ${task.taskNumber}.`,
        type: "TASK_MENTION",
        sender: channel._id,
      });
    }

    await triggerSoftRefresh("TASK");
    getIo().to(channel._id.toString()).emit("task-updated", {
      type: "TASK_COMMENTED",
      channelId: channel._id,
      taskId: task._id,
    });

    const mapped = await mapTasksWithUsers([task.toObject()]);
    res.status(201).json({ success: true, task: mapped[0] });
  } catch (error) {
    console.error("Error adding task comment:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

module.exports = {
  getChannelTasks,
  createChannelTask,
  updateChannelTask,
  deleteChannelTask,
  addTaskComment,
  checkAndMarkOverdueTasks,
};
