const mongoose = require("mongoose");

const callbackSchema = new mongoose.Schema({
  employeeName: { type: String },
  employeeEmail: { type: String },
  name: { type: String },
  email: { type: String },
  phone: { type: String, required: true },
  domainName: { type: String },
  address: { type: String },
  country: { type: String },
  comments: { type: String },
  buget: { type: String },
  calldate: { type: String },
  createdDate: { type: String },
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
},{timestamps:true});

const CallbackModel = mongoose.model("callback", callbackSchema);

module.exports = CallbackModel ;
