const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    userName: { type: String },
    phone: { type: String },
    interest: { type: String },
    budget: { type: String }, // AI extracted budget (if any)
    requirements: { type: String }, // AI extracted project details/needs
    notes: { type: String }, // Additional details discovered by AI
    isLead: { type: Boolean, default: false }, // Track if they are a marketing lead or just general info
    status: { type: String, enum: ['new', 'interested', 'hot', 'converted'], default: 'new' },
    capturedAt: { type: Date, default: Date.now }
});

const Lead = mongoose.model('Lead', leadSchema);

module.exports = Lead;
