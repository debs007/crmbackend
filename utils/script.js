const fs = require('fs').promises;
const mongoose = require('mongoose');

const formatDate = (dateString) => {
    if (!dateString) return null; // Handle missing date

    if (typeof dateString === 'object' && dateString.$date) {
        return { "$date": dateString.$date.split('T')[0] };
    }

    if (typeof dateString === 'string') {
        return { "$date": dateString.split('T')[0] };
    }

    return null; // Return null for invalid formats
};



const attendanceMerge = async () => {
    try {
        const data = await fs.readFile('./utils/CRM.attendances.json', 'utf8');
        const jsonData = JSON.parse(data);

        if (!Array.isArray(jsonData)) {
            throw new Error("Invalid JSON structure. Expected an array.");
        }

        const newDataArray = jsonData.map((entry) => {
           
            const punches = entry.punches || [];
            const lastPunch = punches.findLast(p => p.punchOut) || null;
            const firstPunch = punches.length > 0 ? punches[0] : null;

            return {
                "_id": entry._id,  // ✅ Generates a valid MongoDB ObjectId
                "user_id": entry.user_id,
                "currentDate": formatDate(entry.currentDate),
                "firstPunchIn": firstPunch?.punchIn || null,
                "punchIn": firstPunch?.punchIn || null,
                "punchOut": lastPunch?.punchOut || null,
                "workingTime": entry.totalWorkingTime || 0,
                "shiftType": "Day",
                "status": entry.status,
                "workStatus": entry.workStatus,
                "ip": entry.ip,
                "isPunchedIn": true,
                "leaveStatus": "Pending",
                "leaveApproved": false,
                "createdAt": entry.createdAt,
                "updatedAt": entry.updatedAt,
                "__v": 0
            };
        });
        //  console.log(newDataArray)
        await fs.writeFile('./utils/output1.json', JSON.stringify(newDataArray, null, 2));
        console.log('Converted JSON saved successfully!');
    } catch (error) {
        console.error('Error:', error);
    }
};

// Run function
attendanceMerge();
