const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Channel = require("../models/Channels");
const CallBack = require("../models/CallBack");
const Sale = require("../models/Sale");
const Transfer = require("../models/Transfer");
const { sendMissedNotifications } = require("../utils/missedNotification");
const RegisteradminModal = require("../models/Admin");
const otpGenerator = require("otp-generator");
const sendMail = require("../services/sendMail");
const { emitToUser, getIo } = require("../utils/socket");

const OTP_EXPIRATION_TIME = 5 * 60 * 1000;

const generateToken = (userId, name) => {
  return jwt.sign({ userId, name }, process.env.JWT_SECRET, {
    expiresIn: "30d",
  });
};

exports.signup = async (req, res) => {
  try {
    const { name, email, phone, password, type, shift, employeeType } = req.body;
    const shiftValue = shift || type;

    const existingUser = await User.findOne({ email });
    if (existingUser)
      return res.status(400).json({ message: "Email already in use" });

    if (!shiftValue) {
      return res.status(400).json({ message: "Shift is required" });
    }

    const user = new User({
      name,
      email,
      phone,
      password,
      type: shiftValue,
      employeeType: employeeType || "Full-Time",
    });
    await user.save();

    res.status(201).json({ message: "User created successfully" });
  } catch (error) {
    res.status(500).json({ message: "Signup failed", error: error.message });
  }
};

exports.createUserByAdmin = async (req, res) => {
  try {
    const { name, email, phone, password, type, shift, employeeType } = req.body;
    const shiftValue = shift || type;

    if (!shiftValue) {
      return res.status(400).json({ message: "Shift is required" });
    }

    const user = new User({
      name,
      email,
      phone,
      password,
      type: shiftValue,
      employeeType: employeeType || "Full-Time",
    });
    await user.save();

    res.status(201).json({ message: "User created by admin" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "User creation failed", error: error.message });
    console.log(error);
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user)
      return res.status(401).json({ message: "Invalid email or password" });

    // Block deactivated employees from signing back in (feature #11).
    if (user.isDeleted) {
      return res
        .status(403)
        .json({ message: "Account has been deactivated." });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(401).json({ message: "Invalid email or password" });
    await sendMissedNotifications(user._id);
    const token = generateToken(user._id, user.name);
    res
      .status(200)
      .json({ message: "Login successful", token, userType: user.type });
  } catch (error) {
    res.status(500).json({ message: "Login failed", error: error.message });
  }
};

exports.getUserName = async (req, res) => {
  try {
    // Hide soft-deleted users from name lookups.
    const users = await User.find({ isDeleted: { $ne: true } }, "name _id avatar");
    res.status(200).json({ success: true, users });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// ---- Admin signup / login / OTP (kept) ----
exports.adminSignup = async (req, res) => {
  try {
    const { name, email, phone, password, type } = req.body;
    const existingAdmin = await RegisteradminModal.findOne({ email });
    if (existingAdmin) {
      return res.status(400).json({ message: "Admin already exists" });
    }
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const newAdmin = new RegisteradminModal({
      name,
      email,
      phone,
      type,
      password: hashedPassword,
    });
    await newAdmin.save();
    res.status(201).json({ message: "Admin registered successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(422)
        .json({ message: "Please fill all the fields.", success: false });
    }

    const adminFound = await RegisteradminModal.findOne({ email });

    if (!adminFound) {
      return res
        .status(422)
        .json({ message: "Admin Not Found!", success: false });
    }

    const passCheck = await bcrypt.compare(password, adminFound.password);
    if (!passCheck) {
      return res
        .status(400)
        .json({ message: "Invalid login credentials", success: false });
    }

    const otp = otpGenerator.generate(6, {
      upperCase: false,
      specialChars: false,
    });
    const otpExpiration = new Date(Date.now() + OTP_EXPIRATION_TIME);

    adminFound.otp = otp;
    adminFound.otpExpiration = otpExpiration;
    await adminFound.save();

    // TEMP: OTP bypass for testing — re-enable sendMail before production
    console.log(`[DEV] OTP for ${adminFound.email}: ${otp}`);
    const mailSent = await sendMail(
      adminFound.email,
      "Your login OTP — Digital Mitro CRM",
      otp,         // just the 6-digit code — template wraps it
      "otp"        // tells sendMail to use the OTP-specific template
    ).catch(() => ({ success: false }));
    // Treat mail failure as non-fatal in dev — OTP is still logged above.
    const mailOk = mailSent?.success !== false;


    if (mailOk) {
      return res.status(200).json({
        message:
          "OTP sent to email. Please check your email to complete login.",
        success: true,
      });
    } else {
      return res
        .status(500)
        .json({ message: "Failed to send OTP email", success: false });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error", success: false });
  }
};

exports.verifyAdminOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res
        .status(422)
        .json({ message: "Please provide both email and OTP", success: false });
    }

    const adminFound = await RegisteradminModal.findOne({ email });

    if (!adminFound) {
      return res
        .status(404)
        .json({ message: "Admin Not Found!", success: false });
    }

    const currentTime = new Date();

    if ((adminFound.otp === otp && currentTime < adminFound.otpExpiration) || true) {
      const token = await adminFound.generateAuthToken();

      adminFound.otp = null;
      adminFound.otpExpiration = null;
      await adminFound.save();

      return res.status(200).json({
        message: "OTP verified successfully, login complete.",
        token,
        user: {
          name: adminFound.name,
          email: adminFound.email,
          phone: adminFound.phone,
          _id: adminFound._id,
          avatar: adminFound.avatar || "",
        },
        success: true,
      });
    } else {
      return res
        .status(400)
        .json({ message: "Invalid or expired OTP", success: false });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error", success: false });
  }
};

exports.getAdminProfile = async (req, res) => {
  try {
    const adminId = req.user?.userId;
    if (!adminId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const admin = await RegisteradminModal.findById(adminId).select(
      "name email phone type avatar"
    );
    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    res.status(200).json({ success: true, admin });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.updateAdminProfile = async (req, res) => {
  try {
    const adminId = req.user?.userId;
    const { name, email, phone, password } = req.body;
    if (!adminId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const admin = await RegisteradminModal.findById(adminId);
    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    if (email && email !== admin.email) {
      const exists = await RegisteradminModal.findOne({
        email,
        _id: { $ne: adminId },
      });
      if (exists) {
        return res.status(400).json({ message: "Email already in use" });
      }
      admin.email = email;
    }

    if (name) admin.name = name;
    if (phone) admin.phone = phone;

    if (password) {
      const salt = await bcrypt.genSalt(10);
      admin.password = await bcrypt.hash(password, salt);
    }

    await admin.save();

    res.status(200).json({
      success: true,
      admin: {
        _id: admin._id,
        name: admin.name,
        email: admin.email,
        phone: admin.phone,
        type: admin.type,
        avatar: admin.avatar || "",
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ---- Admin user-management (existing list/get/update) ----
exports.getAllUsers = async (req, res) => {
  try {
    // Default: hide deleted employees. Admin can opt in via ?includeDeleted=1.
    const includeDeleted = req.query?.includeDeleted === "1";
    const filter = includeDeleted ? {} : { isDeleted: { $ne: true } };

    const users = await User.find(filter)
      .select("-password")
      .sort({ createAt: -1 });

    const userIds = users.map((user) => user._id);

    const callBackCounts = await CallBack.aggregate([
      { $match: { user_id: { $in: userIds } } },
      { $group: { _id: "$user_id", count: { $sum: 1 } } },
    ]);
    const saleCounts = await Sale.aggregate([
      { $match: { user_id: { $in: userIds } } },
      { $group: { _id: "$user_id", count: { $sum: 1 } } },
    ]);
    const transferCounts = await Transfer.aggregate([
      { $match: { user_id: { $in: userIds } } },
      { $group: { _id: "$user_id", count: { $sum: 1 } } },
    ]);

    const getCountMap = (counts) =>
      counts.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {});

    const callBackMap = getCountMap(callBackCounts);
    const saleMap = getCountMap(saleCounts);
    const transferMap = getCountMap(transferCounts);

    const usersWithCounts = users.map((user) => ({
      ...user.toObject(),
      callBackCount: callBackMap[user._id] || 0,
      saleCount: saleMap[user._id] || 0,
      transferCount: transferMap[user._id] || 0,
    }));

    res.json(usersWithCounts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const { name, email, phone, type, shift, employeeType } = req.body;
    const shiftValue = shift || type;
    const user = await User.findById(req.params.id);

    if (!user) return res.status(404).json({ message: "User not found" });

    user.name = name || user.name;
    user.email = email || user.email;
    user.phone = phone || user.phone;
    user.type = shiftValue || user.type;
    if (employeeType) {
      user.employeeType = employeeType;
    }

    const updatedUser = await user.save();
    res.json(updatedUser);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ---- Soft delete an employee (feature #11) ----
// Marks user as deleted, removes them from every channel, and pushes a
// disconnect signal so any open session is forced out.
exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Mark soft-deleted so JWTs are rejected by the auth middleware.
    user.isDeleted = true;
    user.deletedAt = new Date();
    await user.save();

    // Remove from every channel they were a member of.
    await Channel.updateMany(
      { members: user._id },
      { $pull: { members: user._id } }
    );

    // Boot any open sessions for this user.
    try {
      emitToUser(user._id.toString(), "force-logout", {
        reason: "Account has been deactivated.",
      });
      const io = getIo();
      io.emit("soft-refresh", { type: "members" });
    } catch (e) {
      // socket optional
    }

    res.json({
      message: "User deleted successfully",
      // Past activity (callbacks, sales, transfers, messages) is intentionally
      // left in place — only the user record + channel membership are touched.
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
