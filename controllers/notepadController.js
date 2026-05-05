const NotesModel = require("../models/Notes");
const RegisterUserModel = require("../models/User");
const { triggerSoftRefresh } = require("../utils/socket");

// Create or update notes
const saveNotes = async (req, res) => {
    try {
        const { notes } = req.body;
        const { userId } = req.user;

        if (!userId) {
            return res.status(400).json({ error: "User ID is required" });
        }

        // Upsert logic: Find existing notes or create a new one
        const updatedNotes = await NotesModel.findOneAndUpdate(
            { user_id: userId },
            { $set: { notes } },
            { new: true, upsert: true }
        );

        await triggerSoftRefresh("Notes");

        // // Update the user's notes reference
        // await RegisterUserModel.findByIdAndUpdate(
        //     { user_id: userId },
        //     { notes: updatedNotes._id },
        //     { new: true }
        // );

        res.json({ message: "Notes saved successfully", data: updatedNotes });
    } catch (error) {
        console.error("Error saving notes:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

const getNotes = async (req, res) => {
    try {
        const user_id = req.user.userId; // Ensure this comes from middleware

        // Find notes based on user_id, not _id
        const notes = await NotesModel.findOne({ user_id });

        if (!notes) {
            return res.status(404).json({ error: "Notes not found for this user" });
        }

        res.json(notes);
    } catch (error) {
        console.error("Error fetching notes:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
};
const getUsersNotesForAdmin = async (req, res) => {
    try {
        const userId = req.params.id;

        if (!userId) {
            return res.status(400).json({ error: "User ID is required" });
        }

        const notes = await NotesModel.findOne({ user_id: userId });

        if (!notes) {
            return res.status(404).json({ error: "No notes found for this user" });
        }

        res.status(200).json({
            message: "Notes fetched successfully",
            data: notes
        });

    } catch (error) {
        console.error("Error fetching notes:", error);
        res.status(500).json({ error: "Something went wrong while fetching notes" });
    }
}

module.exports = { saveNotes, getNotes, getUsersNotesForAdmin };
