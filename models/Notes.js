const mongoose = require("mongoose");

const notesSchema = new mongoose.Schema({
   
    notes: [{ type: String }],
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
});

module.exports = mongoose.model("notes", notesSchema);
