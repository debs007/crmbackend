// name, email, concern, date, status, user_id 

const mongoose = require("mongoose");

const concernSchema = new mongoose.Schema({
    ConcernDate: { type: String },
    ActualPunchIn: { type: String },
    ActualPunchOut: { type: String },
    message: { type: String },
    currenDate: { type: String },
    status: {
        type: String,
        enum: ["Pending", "Approved", "Rejected"], 
        default: "Pending",
      },
    concernType: { type: String },
    user_id: {type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true},
}, {timestamps: true});

const ConcernModel = mongoose.model("concern",concernSchema);

module.exports = { ConcernModel };
