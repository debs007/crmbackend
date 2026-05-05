const socketIo = require("socket.io");
const jwt = require("jsonwebtoken");
const { sendMissedNotifications } = require("../utils/missedNotification");
const onlineUsers = new Map(); // Store connected users

let io;

const normalizeUserId = (userId) => (userId ? userId.toString() : null);

const getUserSocketIds = (userId) => {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return [];

  const socketIds = onlineUsers.get(normalizedUserId);
  if (!socketIds) return [];
  if (socketIds instanceof Set) {
    return [...socketIds];
  }
  return [socketIds].filter(Boolean);
};

const isUserOnline = (userId) => getUserSocketIds(userId).length > 0;

const emitToUser = (userId, eventName, payload) => {
  if (!io) return 0;
  const socketIds = getUserSocketIds(userId);
  socketIds.forEach((socketId) => {
    io.to(socketId).emit(eventName, payload);
  });
  return socketIds.length;
};

const initSocket = (server) => {
  io = socketIo(server, {
    cors: {
      origin: [process.env.Client_Url, process.env.Admin_Url, process.env.Guest_Url], // Update based on frontend URL
      methods: ["GET", "POST"],
    },
  });

  // ✅ Middleware for authentication
  io.use((socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.headers.authorization;

    if (!token) {
      console.log("❌ No token provided, rejecting connection.");
      return next(new Error("Authentication error"));
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) {
        console.log("❌ JWT verification failed:", err.message);
        return next(new Error("Authentication error"));
      }

      const normalizedUserId = normalizeUserId(decoded.userId);
      socket.userId = normalizedUserId;
      const activeSockets = onlineUsers.get(normalizedUserId);
      if (activeSockets instanceof Set) {
        activeSockets.add(socket.id);
      } else {
        onlineUsers.set(normalizedUserId, new Set([socket.id]));
      }
      // console.log(`✅ User connected: ${decoded.userId} | Socket ID: ${socket.id}`);
      next();
    });
  });

  // ✅ Handle events
  io.on("connection", async (socket) => {
    console.log(`✅ Socket connected: ${socket.id}`);

    socket.emit("authenticated", { message: "User authenticated", userId: socket.userId });
    await sendMissedNotifications(socket.userId);
    socket.emit("updateUserStatus", { userId: socket.userId, status: "online" });
    socket.on("joinChannel", (channelId) => {
      socket.join(channelId);
      console.log(`User ${socket.id} joined channel ${channelId}`);
    });

    //  // ✅ Handle user requesting the list of online users
    socket.on("getOnlineUsers", () => {
      const onlineUserIds = Array.from(onlineUsers.keys());
      socket.emit("onlineUsersList", onlineUserIds);
    });
    socket.on("disconnect", () => {
      console.log(`⚠️ User disconnected: ${socket.userId}`);
      const activeSockets = onlineUsers.get(socket.userId);
      if (activeSockets instanceof Set) {
        activeSockets.delete(socket.id);
        if (activeSockets.size === 0) {
          onlineUsers.delete(socket.userId);
        }
      } else {
        onlineUsers.delete(socket.userId);
      }
    });

   
  });

  return io;
};

const getIo = () => {
  if (!io) {
    throw new Error("Socket.io not initialized!");
  }
  return io;
};

const triggerSoftRefresh = (type, targetUserId = null) => {
  const socketIoInstance = getIo();

  if (targetUserId) {
    const deliveredCount = emitToUser(targetUserId, "soft-refresh", { type });
    if (deliveredCount > 0) {
      console.log(`📡 Soft refresh sent to user ${targetUserId} for type: ${type}`);
    }
  } else {
    socketIoInstance.emit("soft-refresh", { type });
    console.log(`🌍 Broadcast soft refresh for type: ${type}`);
  }
};

module.exports = {
  initSocket,
  getIo,
  onlineUsers,
  triggerSoftRefresh,
  getUserSocketIds,
  isUserOnline,
  emitToUser,
};
