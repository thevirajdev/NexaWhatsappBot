const { GoogleGenerativeAI } = require('@google/generative-ai');
const AdminChat = require('../models/AdminChat');
const Chat = require('../models/Chat');
const Lead = require('../models/Lead');
const Schedule = require('../models/Schedule');
const Contact = require('../models/Contact');

class AdminAIService {
    constructor() {
        this.apiKey = process.env.GEMINI_API_KEY;
        this.genAI = new GoogleGenerativeAI(this.apiKey);
        // Using specified flash lite preview model
        this.model = this.genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' });
    }

    async getSystemContext() {
        const startOfDay = new Date();
        startOfDay.setHours(0,0,0,0);

        const newLeads = await Lead.find({ capturedAt: { $gte: startOfDay } }).lean();
        const recentChats = await Chat.find().sort({ lastInteraction: -1 }).limit(10).lean();
        const todaySchedules = await Schedule.find({ scheduledTime: { $gte: startOfDay } }).lean();

        let contextText = `Today's Overview:\n\n`;
        
        contextText += `--- RECENT CHATS ---\n`;
        recentChats.forEach(c => {
            contextText += `[${c.userName || 'Unknown'} (${c.userId})]: ${c.messages.length} total msgs, last at ${c.lastInteraction.toLocaleTimeString()}\n`;
        });

        contextText += `\n--- TODAY'S NEW LEADS ---\n`;
        newLeads.forEach(l => {
            if(l.isLead) {
                contextText += `[${l.userName}] Focus: ${l.interest}, Phone: ${l.phone}\n`;
            } else {
                contextText += `[INFORMATION CAPTURED: ${l.userName}] Phone: ${l.phone}, Details: ${l.requirements}\n`;
            }
        });

        contextText += `\n--- TODAY'S CALL SCHEDULES ---\n`;
        todaySchedules.forEach(s => {
            contextText += `[${new Date(s.scheduledTime).toLocaleTimeString()}] Call with ${s.userName} (${s.userId}) - Reason: ${s.reason}\n`;
        });

        const allContacts = await Contact.find().lean();
        contextText += `\n--- GLOBAL CONTACT DIRECTORY ---\n`;
        allContacts.forEach(c => {
            contextText += `Name: ${c.name}, Phone: ${c.phone}, Relation: ${c.relationship}\n`;
        });

        return contextText;
    }

    async generateAdminReply(userMessage) {
        // Fetch Admin History
        const adminHistory = await AdminChat.find().sort({ timestamp: 1 }).limit(10);
        
        let historyText = adminHistory.map(h => `${h.role === 'user' ? 'Admin' : 'You'}: ${h.content}`).join('\n');
        
        const systemData = await this.getSystemContext();

        const prompt = `
You are the internal 'Admin AI Assistant' for NexAutomate. You are embedded on the dashboard and taking orders from Viraj (the admin).
Your job is to answer questions about the current state of the DB AND execute actions on Viraj's command.

### SYSTEM DATA (Real-Time Database Context):
${systemData}

### TOOLS (Crucial):
If Viraj asks you to DO something, output the specific tool tag AT THE END of your reply. The backend will parse it and execute it.
1. Send WhatsApp Message: [TOOL: SEND_MSG, phone: "EXACT_PHONE", msg: "MESSAGE_TEXT"]
2. Schedule a Call: [TOOL: SCHEDULE_CALL, phone: "EXACT_PHONE", time: "YYYY-MM-DD HH:MM"]
3. Initiate Voice API Call: [TOOL: VOICE_CALL, phone: "EXACT_PHONE", mode: "sales" or "friend"]

### INSTRUCTIONS:
- You are talking directly to Viraj.
- Do NOT output the tool tag unless Viraj explicitly asks you to send a message, call, or schedule something.
- If asked "who messaged me?" or "how many leads?", read the SYSTEM DATA above to formulate your helpful answer.

### CONVERSATION HISTORY:
${historyText}

Admin (Viraj): ${userMessage}
You (Admin Assistant): `;

        try {
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            return response.text();
        } catch (error) {
            console.error("Error generating admin reply:", error);
            return "Error communicating with AI model.";
        }
    }
}

module.exports = new AdminAIService();
