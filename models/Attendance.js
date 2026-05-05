// models/attendance.js
const mongoose = require("mongoose");
const moment = require("moment");

const attendanceSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  currentDate: { type: Date, required: true },
  firstPunchIn:{ type: Date},
  punchIn: { type: Date },
  punchOut: { type: Date },
  
  workingTime: { type: Number, default: 0 }, // Time in minutes
  shiftType: {
    type: String,
    enum: ['Day', 'Night'],
    required: true
  },
  status: {
    type: String,
    enum: ['On Time', 'Late', 'Holiday', 'Weekend', 'Week-Off', 'Leave', 'Absent'],
    default: 'Absent'
  },
  workStatus: {
    type: String,
    enum: ['Half Day', 'Full Day', 'Absent', 'Leave', 'Week-Off', 'Holiday', 'Weekend'],
    default: 'Absent'
  },
  ip: { type: String },
  isPunchedIn: { type: Boolean, default: false },
  leaveStatus: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected'],
    default: 'Pending'
  },
  leaveApproved: { type: Boolean, default: false },
}, { timestamps: true });

const Attendance = mongoose.model('Attendance', attendanceSchema);
module.exports = Attendance;
