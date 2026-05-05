const { checkAndMarkOverdueTasks } = require("../controllers/channelTaskController");

let overdueInterval = null;

const startTaskOverdueScheduler = (intervalMs = 60 * 1000) => {
  if (overdueInterval) return;

  overdueInterval = setInterval(async () => {
    try {
      await checkAndMarkOverdueTasks();
    } catch (error) {
      console.error("Error in task overdue scheduler:", error);
    }
  }, intervalMs);
};

module.exports = { startTaskOverdueScheduler };
