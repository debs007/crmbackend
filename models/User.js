// models/user.js
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phone: { type: Number, required: true },
    password: { type: String, required: true },
    // Employee ID — used to match rows in the salary CSV upload.
    // e.g. "EMP001". Unique per workspace; optional for backward compat.
    empId: { type: String, default: "", index: true },
    employeeType: { type: String, enum: ["Full-Time", "Part-Time"], default: "Full-Time" },
    type: { type: String, enum: ["Day", "Night"], required: true },
    avatar: { type: String, default: "" },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

const User = mongoose.model("User", userSchema);
module.exports = User;
