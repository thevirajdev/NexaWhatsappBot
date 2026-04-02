const mongoose = require('mongoose');

const adminChatSchema = new mongoose.Schema({
    role: { type: String, enum: ['user', 'ai'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
});

const AdminChat = mongoose.model('AdminChat', adminChatSchema);
module.exports = AdminChat;
