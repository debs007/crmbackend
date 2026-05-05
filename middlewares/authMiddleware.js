// backend/middleware/authMiddleware.js
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Admin = require("../models/Admin");
const Client = require("../models/Client");

/**
 * Resolves the type of authenticated identity behind a userId.
 * Returns one of: "user" (employee), "admin", "client", or null.
 */
const resolveUserType = async (userId) => {
  if (!userId) return null;
  const user = await User.findById(userId).lean();
  if (user) {
    if (user.isDeleted) return "deleted";
    return "user";
  }
  const admin = await Admin.findById(userId).lean();
  if (admin) return "admin";
  const client = await Client.findById(userId).lean();
  if (client) return "client";
  return null;
};

exports.authMiddleware = (req, res, next) => {
  const token = req.header("Authorization")?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Unauthorized" });
  jwt.verify(token, process.env.JWT_SECRET, async (err, user) => {
    if (err) return res.status(403).json({ message: "Forbidden" });

    // Reject access for soft-deleted employees so existing JWTs become useless
    // immediately when an admin removes them. Other identity types pass through.
    try {
      if (user?.userId) {
        const employee = await User.findById(user.userId)
          .select("isDeleted")
          .lean();
        if (employee?.isDeleted) {
          return res
            .status(401)
            .json({ message: "Account has been deactivated." });
        }
      }
    } catch (lookupError) {
      // If the lookup itself fails we fall through to allow the request rather
      // than locking out every signed-in user on a transient DB hiccup.
      console.error("authMiddleware lookup failed:", lookupError?.message);
    }

    req.user = user;
    next();
  });
};

exports.resolveUserType = resolveUserType;
