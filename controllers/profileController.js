const User = require("../models/User");
const Admin = require("../models/Admin");
const Client = require("../models/Client");
const { uploadToCloudinary } = require("../utils/fileUpload");

/**
 * Locates a person by id across the three identity tables and reports which
 * collection they came from. Used by every profile/avatar endpoint so the
 * caller never has to know whether they are an employee, admin, or client.
 */
const findIdentity = async (id) => {
  if (!id) return { entity: null, type: null };
  const user = await User.findById(id);
  if (user) return { entity: user, type: "user" };
  const admin = await Admin.findById(id);
  if (admin) return { entity: admin, type: "admin" };
  const client = await Client.findById(id);
  if (client) return { entity: client, type: "client" };
  return { entity: null, type: null };
};

const sanitizeIdentity = (entity, type) => {
  if (!entity) return null;
  return {
    _id: entity._id,
    name: entity.name,
    email: entity.email,
    phone: entity.phone,
    avatar: entity.avatar || "",
    type,
  };
};

// GET /profile/me — returns the signed-in user's profile (any of the 3 types)
exports.getMyProfile = async (req, res) => {
  try {
    const { entity, type } = await findIdentity(req.user?.userId);
    if (!entity) {
      return res.status(404).json({ success: false, message: "Profile not found" });
    }
    return res.json({ success: true, profile: sanitizeIdentity(entity, type) });
  } catch (error) {
    console.error("getMyProfile error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

// POST /profile/avatar — multipart upload of a new profile picture.
// Cloudinary URL is saved on the matching identity record.
//
// Note: we use save({ validateBeforeSave: false }) because some identity
// schemas (especially Admin, where the `password` field is `required` and
// already hashed in storage) will throw spurious validation errors when we
// try to save just the avatar field. We're only changing the one field so
// skipping validation is safe here.
exports.uploadAvatar = async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res
        .status(400)
        .json({ success: false, message: "No file uploaded" });
    }
    if (!file.mimetype || !file.mimetype.startsWith("image/")) {
      return res
        .status(400)
        .json({ success: false, message: "File must be an image" });
    }

    const { entity, type } = await findIdentity(req.user?.userId);
    if (!entity) {
      return res
        .status(404)
        .json({ success: false, message: "Profile not found for the signed-in user" });
    }

    let url;
    try {
      url = await uploadToCloudinary(
        file.buffer,
        file.originalname || "avatar",
        "avatars"
      );
    } catch (uploadError) {
      console.error("Cloudinary upload failed:", uploadError);
      return res.status(502).json({
        success: false,
        message: "Image upload to storage failed: " + (uploadError?.message || "unknown"),
      });
    }

    entity.avatar = url;
    try {
      await entity.save({ validateBeforeSave: false });
    } catch (saveError) {
      console.error("Saving avatar to identity failed:", saveError);
      return res.status(500).json({
        success: false,
        message: "Could not persist avatar: " + (saveError?.message || "unknown"),
      });
    }

    return res.json({
      success: true,
      avatar: url,
      profile: sanitizeIdentity(entity, type),
    });
  } catch (error) {
    console.error("uploadAvatar error:", error);
    return res
      .status(500)
      .json({ success: false, message: error?.message || "Internal server error" });
  }
};

// DELETE /profile/avatar — clears the saved avatar URL (back to letter-avatar)
exports.removeAvatar = async (req, res) => {
  try {
    const { entity, type } = await findIdentity(req.user?.userId);
    if (!entity) {
      return res.status(404).json({ success: false, message: "Profile not found" });
    }
    entity.avatar = "";
    await entity.save({ validateBeforeSave: false });
    return res.json({ success: true, profile: sanitizeIdentity(entity, type) });
  } catch (error) {
    console.error("removeAvatar error:", error);
    return res
      .status(500)
      .json({ success: false, message: error?.message || "Internal server error" });
  }
};

// Public-style lookup so the UI can render avatars beside any user's name.
// GET /profile/avatars?ids=id1,id2,id3
exports.getAvatarsBatch = async (req, res) => {
  try {
    const raw = req.query?.ids || "";
    const ids = raw
      .toString()
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    if (ids.length === 0) {
      return res.json({ success: true, avatars: {} });
    }

    const [users, admins, clients] = await Promise.all([
      User.find({ _id: { $in: ids } }, "_id name avatar").lean(),
      Admin.find({ _id: { $in: ids } }, "_id name avatar").lean(),
      Client.find({ _id: { $in: ids } }, "_id name avatar").lean(),
    ]);

    const avatars = {};
    [...users, ...admins, ...clients].forEach((row) => {
      avatars[row._id.toString()] = {
        name: row.name,
        avatar: row.avatar || "",
      };
    });

    return res.json({ success: true, avatars });
  } catch (error) {
    console.error("getAvatarsBatch error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};
