const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    text: { type: String, required: true },
    sender: { type: String, enum: ['user', 'bot'], required: true },
    authorName: { type: String }, // Specifically for group chats or manual tracking
    isManual: { type: Boolean, default: false }, // To distinguish manual replies from AI replies
    isImportant: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now }
});

const chatSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true }, // For private, this is JID. For group, this might be groupJID:authorJID
    userName: { type: String },
    messages: [messageSchema],
    lastInteraction: { type: Date, default: Date.now }
});

const Chat = mongoose.model('Chat', chatSchema);

module.exports = Chat;
