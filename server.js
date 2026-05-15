const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { initSocket } = require('./utils/socket');
const connectDB = require('./config/db');
const { startCronJobs } = require('./utils/autoUpdateAttandance');
const { startScheduler } = require("./utils/callbackScheduler");
const { startTaskOverdueScheduler } = require("./utils/taskOverdueScheduler");
const attendanceRoutes = require('./routes/attendanceRoutes');
const authRoutes = require("./routes/authRoutes");
const callbackRoutes = require("./routes/callbackRoutes");
const transferRoutes = require("./routes/transferRoutes");
const saleRoutes = require("./routes/saleRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const messageRoutes = require("./routes/messageRoutes");
const concernRoutes = require("./routes/concernRoutes");
const channelRoutes = require("./routes/channelRoutes");
const channelChatsRoutes = require("./routes/channelChatsRoutes");
const notesRoutes = require("./routes/notepadRoutes");
const fileUploadRoutes = require("./routes/fileUpload");
const clientRoutes = require("./routes/clientRoutes");
const profileRoutes = require("./routes/profileRoutes");
const payslipRoutes = require("./routes/payslipRoutes");
dotenv.config();
connectDB();

const app = express();
const server = http.createServer(app);
initSocket(server);

// startCronJobs(48,15)
startScheduler(0, 20);
startScheduler(17, 18);
startTaskOverdueScheduler();
app.use(express.json());
app.use(
  cors({
    origin: [process.env.Client_Url, process.env.Admin_Url, process.env.Guest_Url],
    credentials: true,
  })
);

// ✅ Define API routes
app.use('/attendance', attendanceRoutes);
app.use('/auth', authRoutes);
app.use("/callback", callbackRoutes);
app.use("/transfer", transferRoutes);
app.use("/sale", saleRoutes);
app.use("/notification", notificationRoutes);
app.use("/message", messageRoutes);
app.use("/concern", concernRoutes);
app.use("/api", channelRoutes);
app.use("/channels", channelChatsRoutes);
app.use("/notepad", notesRoutes);
app.use("/files", fileUploadRoutes);
app.use("/client", clientRoutes);
// New endpoints
app.use("/profile", profileRoutes);   // feature #1 — avatars
app.use("/payslips", payslipRoutes);  // feature #2 — payslips
app.use("/salary-sheet", require("./routes/salarySheetRoutes")); // salary CSV

// ✅ Serve uploaded files (reports etc.) from local disk (fix #7)
// Files are stored at /uploads/reports/<filename> on the server.
// They are served publicly at /uploads/<filename>.
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const reportsDir = path.join(uploadsDir, "reports");
if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
app.use("/uploads", express.static(uploadsDir));

// ✅ Basic API health check
app.get('/', (req, res) => {
  res.status(200).json({ message: "🚀 Welcome to CRM Server" });
});

// ✅ Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
