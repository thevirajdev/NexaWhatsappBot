const Chat = require('../models/Chat');

class ChatService {
    async addMessage(userId, userName, text, sender, isImportant = false, authorName = null, isManual = false) {
        try {
            const chat = await Chat.findOneAndUpdate(
                { userId },
                { 
                    userName,
                    $push: { 
                        messages: { 
                            $each: [{ text, sender, isImportant, authorName, isManual, timestamp: new Date() }],
                            $slice: -30 // Deep memory for long conversations
                        } 
                    },
                    lastInteraction: new Date()
                },
                { upsert: true, returnDocument: 'after' }
            );
            return chat;
        } catch (error) {
            console.error('Error adding message to DB:', error);
        }
    }

    async getHistory(userId, limit = 30) {
        try {
            const chat = await Chat.findOne({ userId });
            if (!chat) return [];
            return chat.messages.slice(-limit);
        } catch (error) {
            console.error('Error getting history from DB:', error);
            return [];
        }
    }
}

module.exports = new ChatService();
