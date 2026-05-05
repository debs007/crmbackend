const mongoose = require("mongoose");

const holidaySchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true }, 
  name: { type: String, required: true }, 
  description: { type: String },
}, { timestamps: true });

const Holiday = mongoose.model("Holiday", holidaySchema);
module.exports = Holiday;
