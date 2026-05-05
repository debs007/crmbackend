const moment = require("moment");

const holidays = [
  "2025-02-14",  
  "2025-12-25",  
  // Add more holidays here
];


const checkWeekendOrHoliday = (date) => {
  const dayOfWeek = moment(date).day(); // Sunday = 0, Saturday = 6
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6; // Check if it's a weekend

  const isHoliday = holidays.includes(moment(date).format("YYYY-MM-DD")); // Check if the date is a holiday

  if (isHoliday) {
    return "Holiday";
  } else if (isWeekend) {
    return "Week-Off";
  }

  return null;
};

module.exports = { checkWeekendOrHoliday };
