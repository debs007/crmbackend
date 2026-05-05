const Attendance = require("../models/Attendance");
const CallBack = require("../models/CallBack");
const Sale = require("../models/Sale");
const Transfer = require("../models/Transfer");
const User = require("../models/User");
const { triggerSoftRefresh } = require("../utils/socket");
const { checkWeekendOrHoliday } = require("../utils/weekHoliday");
const moment = require("moment");
const moments = require("moment-timezone");

// Helper function to calculate working time in minutes
const calculateWorkingTime = (punchIn, punchOut) => {
  const start = moment(punchIn, "HH:mm");
  const end = moment(punchOut, "HH:mm");
  return end.diff(start, "minutes");
};

// Punch-In API
exports.punchIn = async (req, res) => {
  const { userId } = req.user;
  const { clientIp } = req.body;

  if (!clientIp || !userId) {
    return res.status(400).json({ message: "Missing field" });
  }

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const today = moment().tz("Asia/Kolkata").format("YYYY-MM-DD");
    const punchInTime = moment().tz("Asia/Kolkata");

    let attendance = await Attendance.findOne({
      user_id: userId,
      currentDate: today,
    });

    if (attendance && attendance.isPunchedIn) {
      return res.status(400).json({ message: "User already punched in today" });
    }

    if (attendance) {
      attendance.punchIn = punchInTime.toDate();
      attendance.isPunchedIn = true;
      if (!attendance.firstPunchIn) {
        attendance.firstPunchIn = punchInTime.toDate();
      }
      await attendance.save();
      return res
        .status(200)
        .json({ message: "Re-Punch In successful", data: attendance });
    }

    const punchInHour = punchInTime.hour();
    const punchInMinute = punchInTime.minute();
    const shiftType = user?.type;

    let status = "On Time";
    if (
      (shiftType === "Day" &&
        (punchInHour > 10 || (punchInHour === 10 && punchInMinute > 40))) ||
      (shiftType === "Night" &&
        (punchInHour > 20 || (punchInHour === 20 && punchInMinute > 10)))
    ) {
      status = "Late";
    }

    attendance = new Attendance({
      currentDate: today,
      firstPunchIn: punchInTime.toDate(),
      punchIn: punchInTime.toDate(),
      shiftType: shiftType,
      user_id: userId,
      isPunchedIn: true,
      ip: clientIp,
      status: status,
      workingTime: 0, // Start with 0 work time
    });

    await attendance.save();
      await triggerSoftRefresh("Attendence");
    res.status(201).json({ message: "Punch In successful", data: attendance });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ message: "Error during punch in", error: error.message });
  }
};

// Punch-Out API
exports.punchOut = async (req, res) => {
  const { userId } = req.user;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    let today = moment().tz("Asia/Kolkata").format("YYYY-MM-DD");
    if (user?.type === "Night") {
      today = moment().tz("Asia/Kolkata").subtract(1, "day").format("YYYY-MM-DD");
    }
    const attendance = await Attendance.findOne({
      user_id: userId,
      currentDate: today,
    });

    if (!attendance || !attendance.isPunchedIn) {
      return res.status(400).json({ message: "User hasn't punched in today" });
    }

    const punchOutTime = moment().tz("Asia/Kolkata");
    const punchInTime = moment(attendance.punchIn).tz("Asia/Kolkata");
    const sessionWorkTime = punchOutTime.diff(punchInTime, "minutes");
    attendance.punchOut = punchOutTime.toDate();
    attendance.workingTime += sessionWorkTime;
    attendance.isPunchedIn = false;

    // let workStatus = "Absent";
    // if (attendance.workingTime >= 240 && attendance.workingTime < 480) {
    //   workStatus = "Half Day";
    // } else if (attendance.workingTime > 480) {
    //   workStatus = "Full Day";
    // }
    let workStatus = "Absent";
    if (attendance.workingTime >= 300 && attendance.workingTime < 420) {
      workStatus = "Half Day";
    } else if (attendance.workingTime >= 420) {
      workStatus = "Full Day";
    }

    attendance.workStatus = workStatus;
    await attendance.save();
        await triggerSoftRefresh("Attendence");
    res.status(200).json({ message: "Punch Out successful", data: attendance });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ message: "Error during punch out", error: error.message });
  }
};

// Leave Update (Admin or User)
exports.updateLeaveStatus = async (req, res) => {
  const { userId } = req.user;
  const { leaveApproved } = req.body;

  try {
    // Check if the user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if attendance record exists
    const today = moment().format("YYYY-MM-DD");
    const attendance = await Attendance.findOne({
      user_id: userId,
      currentDate: today,
    });
    if (!attendance) {
      return res
        .status(404)
        .json({ message: "Attendance not found for today" });
    }

    // Update leave status if it's pending
    if (attendance.leaveStatus === "Pending") {
      attendance.leaveApproved = leaveApproved;
      attendance.leaveStatus = leaveApproved ? "Approved" : "Rejected";
      attendance.status = leaveApproved ? "Leave" : "Absent";
      attendance.workStatus = leaveApproved ? "Leave" : "Absent";
      await attendance.save();
    await triggerSoftRefresh("Attendence");
      res
        .status(200)
        .json({
          message: `Leave ${leaveApproved ? "Approved" : "Rejected"}`,
          data: attendance,
        });
    } else {
      res.status(400).json({ message: "Leave has already been processed" });
    }
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ message: "Error updating leave status", error: error.message });
  }
};

//forgot puch in, punch out
exports.handlePunch = async (req, res) => {
  const { userId } = req.user;
  const { date, punchIn, punchOut, fix } = req.body; // Optional fix values

  try {
    const today = date || moment().format("YYYY-MM-DD");
    let attendance = await Attendance.findOne({
      user_id: userId,
      currentDate: today,
    });

    if (!attendance) {
      // If no attendance record, create Punch-In
      const shiftType =
        punchIn >= "10:30" && punchIn <= "19:30" ? "Day" : "Night";

      attendance = new Attendance({
        user_id: userId,
        currentDate: today,
        punchIn: punchIn || moment().format("HH:mm"),
        shiftType: shiftType,
        isPunchedIn: true,
        status: "On Time",
      });

      await attendance.save();
      return res
        .status(201)
        .json({ message: "Punch-In recorded", data: attendance });
    }

    if (attendance.isPunchedIn) {
      // User is punched in, process Punch-Out or fix
      let finalPunchOut = punchOut || moment().format("HH:mm");

      if (fix) {
        // If fixing, update Punch-In and/or Punch-Out
        if (punchIn) attendance.punchIn = punchIn;
        if (punchOut) finalPunchOut = punchOut;
      }

      const workingTime = calculateWorkingTime(
        attendance.punchIn,
        finalPunchOut
      );
      attendance.punchOut = finalPunchOut;
      attendance.workingTime = workingTime;
      attendance.isPunchedIn = false;

      await attendance.save();
          await triggerSoftRefresh("Attendence");
      return res
        .status(200)
        .json({ message: "Punch-Out recorded", data: attendance });
    }

    return res.status(400).json({ message: "Already punched out for today" });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ message: "Error processing attendance", error: error.message });
  }
};

//This is for admin
exports.getAllAttendance = async (req, res) => {
  try {
    const allAttendance = await Attendance.find().populate(
      "user_id",
      "name email"
    );
    res
      .status(200)
      .json({ message: "All attendance records", data: allAttendance });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching attendance", error: error.message });
  }
};

exports.getUserAttendance = async (req, res) => {
  const { userId } = req.user;
  const { range } = req.query;

  let startDate, endDate;

  if (range === "today") {
    startDate = moment().format("YYYY-MM-DD");
    endDate = startDate;
  } else if (range === "this_month") {
    startDate = moment().startOf("month").format("YYYY-MM-DD");
    endDate = moment().endOf("month").format("YYYY-MM-DD");
  } else if (range === "last_month") {
    startDate = moment()
      .subtract(1, "months")
      .startOf("month")
      .format("YYYY-MM-DD");
    endDate = moment()
      .subtract(1, "months")
      .endOf("month")
      .format("YYYY-MM-DD");
  } else if (range === "year") {
    startDate = moment().startOf("year").format("YYYY-MM-DD");
    endDate = moment().endOf("year").format("YYYY-MM-DD");
  } else {
    return res.status(400).json({ message: "Invalid range parameter" });
  }

  try {
    const userAttendance = await Attendance.find({
      user_id: userId,
      currentDate: { $gte: startDate, $lte: endDate },
    }).sort({ createdAt: -1 });

    res.status(200).json({
      message: `Attendance records from ${startDate} to ${endDate}`,
      data: userAttendance,
    });
  } catch (error) {
    res.status(500).json({
      message: "Error fetching user attendance",
      error: error.message,
    });
  }
};

// Get Attendance List
exports.getAttendanceList = async (req, res) => {
  const userId = req.params.id;
  const { month, year, date } = req.query;

  try {
    let query = { user_id: userId };

    // Filter by month and year
    if (month && year) {
      const startOfMonth = moments
        .tz([year, month - 1], "Asia/Kolkata")
        .startOf("month")
        .toDate();
      const endOfMonth = moments
        .tz([year, month - 1], "Asia/Kolkata")
        .endOf("month")
        .toDate();

      query.currentDate = {
        $gte: startOfMonth,
        $lte: endOfMonth,
      };
    }

    // Filter by exact date
    if (date) {
      const specificDate = moments
        .tz(date, "Asia/Kolkata")
        .startOf("day")
        .toDate();
      const endOfDay = moments.tz(date, "Asia/Kolkata").endOf("day").toDate();

      query.currentDate = {
        $gte: specificDate,
        $lte: endOfDay,
      };
    }

    const data = await Attendance.find(query).populate("user_id", "name email");

    if (data.length > 0) {
      res.status(200).json({
        message: "Attendance data fetched successfully",
        data: data,
      });
    } else {
      res.status(404).json({ message: "No attendance data found" });
    }
  } catch (error) {
    console.error("Error fetching attendance list:", error);
    res.status(500).send("Internal Server Error");
  }
};

// exports.getUserAttendance = async (req, res) => {
//   try {
//     const user = await User.findById(req.params.id).populate("attendance").select("-password");
//     if (!user) return res.status(404).json({ message: "User not found" });

//     res.status(200).json(user);
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ message: "Internal Server Error" });
//   }
// };

// Get attendance list with filters (month, year, date)
exports.getAttendanceListforadmin = async (req, res) => {
  const { month, year, date, startDate, endDate } = req.query;
  const userId = req.params.id;

  try {
    let query = { user_id: userId };

    if (startDate && endDate) {
      const start = moment.tz(startDate, "Asia/Kolkata").startOf("day").toDate();
      const end = moment.tz(endDate, "Asia/Kolkata").endOf("day").toDate();
      query.currentDate = { $gte: start, $lte: end };
    } else if (startDate || endDate) {
      const singleDate = startDate || endDate;
      const start = moment.tz(singleDate, "Asia/Kolkata").startOf("day").toDate();
      const end = moment.tz(singleDate, "Asia/Kolkata").endOf("day").toDate();
      query.currentDate = { $gte: start, $lte: end };
    } else if (date) {
      const specificDate = moment
        .tz(date, "Asia/Kolkata")
        .startOf("day")
        .toDate();
      const endOfDay = moment.tz(date, "Asia/Kolkata").endOf("day").toDate();
      query.currentDate = { $gte: specificDate, $lte: endOfDay };
    } else if (month) {
      const resolvedYear = year || moment().tz("Asia/Kolkata").year();
      const startOfMonth = moment
        .tz({ year: resolvedYear, month: month - 1 }, "Asia/Kolkata")
        .startOf("month")
        .toDate();
      const endOfMonth = moment
        .tz({ year: resolvedYear, month: month - 1 }, "Asia/Kolkata")
        .endOf("month")
        .toDate();
      query.currentDate = { $gte: startOfMonth, $lte: endOfMonth };
    }

    const data = await Attendance.find(query)
      .select("-__v")
      .sort({ createdAt: -1 });
    if (!data.length) return res.status(404).json({ message: "No Data Found" });

    res.status(200).json({ message: "Data Collected Successfully", data });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

// Get user's punch-in status for today
exports.getAttendanceStatusforadmin = async (req, res) => {
  try {
    const userId = req.params.id;
    const today = moment.tz("Asia/Kolkata").startOf("day").toDate();
    const tomorrow = moment.tz("Asia/Kolkata").endOf("day").toDate();

    const attendanceRecord = await Attendance.findOne({
      user_id: userId,
      currentDate: { $gte: today, $lte: tomorrow },
    }).sort({ createdAt: -1 });

    if (!attendanceRecord)
      return res
        .status(200)
        .json({ isPunchedIn: false, message: "User has not punched in today" });

    const punches = attendanceRecord.punches;
    if (!punches.length)
      return res
        .status(200)
        .json({
          isPunchedIn: false,
          message: "No punch-in records found today",
        });

    const lastPunch = punches[punches.length - 1];

    res.status(200).json({
      isPunchedIn: lastPunch.punchIn && !lastPunch.punchOut,
      message:
        lastPunch.punchIn && !lastPunch.punchOut
          ? "User is currently punched in"
          : "User has punched out",
      punchInTime: lastPunch.punchIn,
      punchOutTime: lastPunch.punchOut || null,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

// Get all attendance records
exports.getAllAttendanceforadmin = async (req, res) => {
  try {
    const data = await Attendance.find().select("-__v");
    res.status(200).json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

// Admin: Get today's attendance
exports.getTodaysAttendanceforadmin = async (req, res) => {
  try {
    const today = moment.tz("Asia/Kolkata").startOf("day").toDate();
    const tomorrow = moment.tz("Asia/Kolkata").endOf("day").toDate();

    const todaysAttendance = await Attendance.find({
      currentDate: { $gte: today, $lte: tomorrow },
    })
      .populate("user_id")
      .select("-__v");

    if (!todaysAttendance.length)
      return res
        .status(404)
        .json({ message: "No attendance records found for today" });

    res
      .status(200)
      .json({
        message: "Today's attendance data collected successfully",
        data: todaysAttendance,
      });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

exports.getEmployeeDashboard = async (req, res) => {
  const userId = req.params.id;

  try {
    const [
      attendanceCount,
      callbackCount,
      saleCount,
      transferCount,
      projectsCount,
    ] = await Promise.all([
      Attendance.countDocuments({ user_id: userId }),
      CallBack.countDocuments({ user_id: userId }),
      Sale.countDocuments({ user_id: userId }),
      Transfer.countDocuments({ user_id: userId }),
    ]);

    res.status(200).json({
      attendance: attendanceCount,
      callback: callbackCount,
      sale: saleCount,
      transfer: transferCount,
      project: projectsCount,
    });
  } catch (error) {
    console.error("Error fetching employee dashboard data:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

const updateTime = async () => {
  try {
    const currentDate = new Date("2025-02-19T00:00:00.000+00:00");

    // Fetch attendance records matching the date and shift type
    const attendances = await Attendance.find({
      currentDate,
      shiftType: "Day",
    });

    for (let record of attendances) {
      let punchInTime = new Date("2025-02-19T10:30:00.000+00:00"); // Default punch-in time

      const punchOutTime = record.punchOut ? new Date(record.punchOut) : null;

      let workingTime = 0;
      let status = "Absent"; // Default status

      if (punchOutTime) {
        // Calculate working time in minutes
        workingTime = Math.floor((punchOutTime - punchInTime) / (1000 * 60));

        // Determine attendance status
        if (workingTime >= 480) {
          status = "On Time"; // 8 hours or more
        } else if (workingTime >= 300) {
          status = "Late"; // 5+ hours but less than 8 hours
        } else {
          status = "Half Day"; // Less than 5 hours
        }
      } else {
        status = "Incomplete"; // Punch out missing
      }

      // Update the record with punchIn time, working time, and status
      // await Attendance.updateOne(
      //   { _id: record._id },
      //   {
      //     $set: {
      //       punchIn: punchInTime, // Update punch-in time
      //       workingTime,
      //       status,
      //     },
      //   }
      // );
    }
    console.log(attendances);

    console.log("✅ Attendance records updated successfully.");
  } catch (error) {
    console.error("❌ Error updating attendance:", error);
  }
};
// updateTime()
