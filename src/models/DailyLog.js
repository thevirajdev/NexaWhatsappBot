const mongoose = require('mongoose');

const dailyLogSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    date: { type: Date, required: true },
    summary: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

const DailyLog = mongoose.model('DailyLog', dailyLogSchema);
module.exports = DailyLog;
