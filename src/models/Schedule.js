const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    userName: { type: String },
    scheduledTime: { type: Date, required: true },
    reason: { type: String },
    status: { type: String, enum: ['pending', 'completed', 'cancelled'], default: 'pending' },
    createdAt: { type: Date, default: Date.now }
});

const Schedule = mongoose.model('Schedule', scheduleSchema);
module.exports = Schedule;
