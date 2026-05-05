// routes/attendanceRoutes.js
const express = require("express");
const router = express.Router();
const { punchIn, punchOut, updateLeaveStatus, handlePunch, getUserAttendance, getAllAttendance, getAttendanceList,
    getAllAttendanceforadmin, getAttendanceListforadmin, getAttendanceStatusforadmin, getTodaysAttendanceforadmin,
    getEmployeeDashboard
} = require("../controllers/attendanceController");
const { authMiddleware } = require("../middlewares/authMiddleware");

router.post("/punch-in", authMiddleware, punchIn);
router.post("/punch-out", authMiddleware, punchOut);
router.post("/punch", authMiddleware, handlePunch);
router.post("/leave-status", authMiddleware, updateLeaveStatus);
router.get("/user", authMiddleware, getUserAttendance);
router.get("/admin", getAllAttendance);
// router.get("/:id", getAttendanceList);

// router.get("/:id", getAllAttendanceforadmin); 
router.get("/list/:id", getAttendanceListforadmin); 
// router.get("/status/:id", getAttendanceStatusforadmin); 
router.get("/today",getTodaysAttendanceforadmin);
router.get("/employeesdashboard/:id", getEmployeeDashboard)


module.exports = router;
