const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const registeradminSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    phone: {
      type: Number,
      required: true,
    },
    password: {
      type: String,
      required: true,
    },
    type: { type: String, enum: ['Admin', 'SuperAdmin'], required: true },
    avatar: { type: String, default: "" },
    otp: {
      type: String,
    },
    otpExpiration: {
      type: Date,
    },
  },
  { timestamps: true }
);

registeradminSchema.methods.generateAuthToken = async function () {
  try {
    let token = jwt.sign(
      { name: this.name, userId: this._id, expiresIn: '30d' },
      process.env.JWT_SECRET
    );
    return token;
  } catch (e) {
    console.log(`Failed to generate token --> ${e}`);
  }
};
const RegisteradminModal = mongoose.model("Admin", registeradminSchema);

module.exports = RegisteradminModal;
