console.log('--- BOT STARTUP INITIATED ---');
require('dotenv').config();
const { MessageMedia } = require('whatsapp-web.js');
const express = require('express');
const connectDB = require('./services/db');
const whatsappClient = require('./client/whatsapp');
const chatService = require('./services/chatService');
const aiService = require('./services/aiService');
const leadService = require('./services/leadService');
const notificationService = require('./services/notificationService');
const cron = require('node-cron');
const path = require('path');
const Chat = require('./models/Chat');
const Lead = require('./models/Lead');
const Schedule = require('./models/Schedule');
const Settings = require('./models/Settings');
const Contact = require('./models/Contact');
const DailyLog = require('./models/DailyLog');
const excelService = require('./services/excelService');
const voiceService = require('./services/voiceService');
const adminAIService = require('./services/adminAIService');
const contactService = require('./services/contactService');
const multer = require('multer');
const xlsxLib = require('xlsx');
const vapiWebhook = require('./routes/vapiWebhook');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const qrcodeLib = require('qrcode');

// Multer setup for Excel uploads
const upload = multer({ dest: 'uploads/' });

// Daily Midnight CRON Job for Conversational Logs
cron.schedule('59 23 * * *', async () => {
    console.log('[CRON] Running daily interaction summarizer...');
    try {
        const startOfDay = new Date();
        startOfDay.setHours(0,0,0,0);
        // Find chats active today
        const activeChats = await Chat.find({ lastInteraction: { $gte: startOfDay } });
        for (const chat of activeChats) {
            const msgs = chat.messages.filter(m => m.timestamp >= startOfDay).map(m => `${m.sender === 'user' ? 'User' : 'AI'}: ${m.text}`).join('\n');
            if(msgs.trim()) {
                const summary = await aiService.generateSummaryOnly(msgs);
                await DailyLog.create({ userId: chat.userId, date: new Date(), summary });
            }
        }
        console.log('[CRON] Daily logs compiled successfully.');
    } catch (e) {
        console.error('[CRON] Error during daily summarization:', e);
    }
});

// Track pending AI replies to cancel them if a manual reply is detected
const pendingReplies = new Map();

// Track recent AI-generated messages to distinguish them from manual phone replies
const recentBotMessages = new Map(); // chatId -> { body: string, timestamp: number }

const app = express();
const PORT = process.env.PORT || 3000;

// Connect to Database
connectDB();

// Middleware
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
    secret: process.env.SESSION_SECRET || 'nex-automate-super-secret',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days
}));
app.use('/vapi-webhook', vapiWebhook);

// Authentication Middleware
const isAuthenticated = (req, res, next) => {
    if (req.session.authenticated) {
        return next();
    }
    res.redirect('/login');
};

// Routes
let currentQR = null;
let isReady = false;

app.get('/', isAuthenticated, async (req, res) => {
    // If WhatsApp is NOT ready, show the QR code page instead of the dashboard
    if (!isReady) {
        let qrDataUrl = null;
        if (currentQR) {
            qrDataUrl = await qrcodeLib.toDataURL(currentQR);
        }
        return res.render('connect', { qrDataUrl });
    }

    try {
        // Fetch Stats
        const totalChats = await Chat.countDocuments();
        const totalMessages = await Chat.aggregate([
            { $unwind: "$messages" },
            { $group: { _id: null, count: { $sum: 1 } } }
        ]);
        const totalLeads = await Lead.countDocuments();

        // Fetch Recent Chats (last 5)
        const recentChats = await Chat.find()
            .sort({ lastInteraction: -1 })
            .limit(5);

        // Fetch Recent Leads (last 5)
        const recentLeads = await Lead.find()
            .sort({ capturedAt: -1 })
            .limit(5);

        res.render('dashboard', { 
            isReady, 
            currentQR, 
            manualOverride: process.env.MANUAL_OVERRIDE === 'true',
            stats: {
                chats: totalChats,
                messages: totalMessages.length > 0 ? totalMessages[0].count : 0,
                leads: totalLeads
            },
            recentChats,
            recentLeads,
            dbStatus: require('mongoose').connection.readyState === 1
        });
    } catch (error) {
        console.error('Dashboard data fetch error:', error);
        res.render('dashboard', { 
            isReady, 
            currentQR, 
            manualOverride: process.env.MANUAL_OVERRIDE === 'true',
            stats: { chats: 0, messages: 0, leads: 0 },
            recentChats: [],
            recentLeads: [],
            dbStatus: false
        });
    }
});

app.get('/login', async (req, res) => {
    if (req.session.authenticated) return res.redirect('/');
    
    // If WhatsApp is NOT ready, we can't send an OTP. 
    // They must scan the QR on the main page first.
    if (!isReady) {
        return res.redirect('/');
    }

    res.render('login', { error: null, step: 'request' });
});

app.get('/send-otp', async (req, res) => {
    if (!isReady) return res.json({ success: false, error: 'WhatsApp is not connected.' });
    
    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    req.session.otp = otp;
    req.session.otpExpiry = Date.now() + 5 * 60 * 1000; // 5 mins

    try {
        // Find owner ID or use admin phone
        const myId = whatsappClient.client.info.wid._serialized;
        console.log(`[AUTH] Sending OTP ${otp} to owner: ${myId}`);
        await whatsappClient.sendMessage(myId, `🔐 *NexAutomate Security*\n\nYour dashboard login OTP is: *${otp}*\n\nValid for 5 minutes. If you did not request this, ignore.`);
        res.json({ success: true });
    } catch (err) {
        console.error("OTP send failed:", err);
        res.json({ success: false, error: 'Failed to send OTP to WhatsApp.' });
    }
});

app.post('/verify-otp', (req, res) => {
    const { otp } = req.body;
    
    if (!req.session.otp || Date.now() > req.session.otpExpiry) {
        return res.render('login', { error: 'OTP expired or not found. Request a new one.', step: 'verify' });
    }

    if (otp === req.session.otp) {
        req.session.authenticated = true;
        delete req.session.otp;
        delete req.session.otpExpiry;
        res.redirect('/');
    } else {
        res.render('login', { error: 'Invalid OTP. Please try again.', step: 'verify' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

app.post('/toggle-override', (req, res) => {
    process.env.MANUAL_OVERRIDE = process.env.MANUAL_OVERRIDE === 'true' ? 'false' : 'true';
    res.json({ success: true, manualOverride: process.env.MANUAL_OVERRIDE === 'true' });
});

app.get('/force-report', async (req, res) => {
    try {
        console.log('Manually triggering daily report...');
        await generateAndSendReport();
        res.json({ success: true, message: 'Report generated and sent to email.' });
    } catch (error) {
        console.error('Manual report failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/download-excel', async (req, res) => {
    try {
        const filePath = await excelService.generateExcel();
        if (filePath) {
            res.download(path.join(__dirname, '../public/data.xlsx'));
        } else {
            res.status(500).send('Error generating Excel file');
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('Error downloading Excel file');
    }
});

app.get('/settings', async (req, res) => {
    try {
        let settings = await Settings.findOne();
        if (!settings) settings = await Settings.create({});
        res.render('settings', { settings });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading settings');
    }
});

app.post('/settings', async (req, res) => {
    try {
        const { voiceProvider, blandApiKey, retellApiKey, vapiApiKey, vapiAssistantId } = req.body;
        let settings = await Settings.findOne();
        if (!settings) {
            settings = new Settings();
        }
        settings.voiceProvider = voiceProvider;
        settings.blandApiKey = blandApiKey;
        settings.retellApiKey = retellApiKey;
        settings.vapiApiKey = vapiApiKey;
        settings.vapiAssistantId = vapiAssistantId;
        settings.updatedAt = Date.now();
        await settings.save();
        res.redirect('/settings?success=true');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error saving settings');
    }
});

app.get('/campaign', (req, res) => {
    res.render('campaign');
});

app.post('/campaign', async (req, res) => {
    try {
        const { numbers, mode } = req.body;
        if (!numbers) return res.status(400).send('Numbers required');
        
        const numberList = numbers.split(',').map(n => n.trim());
        const results = [];
        for (const num of numberList) {
            try {
                const callResult = await voiceService.initiateCall(num, mode || 'sales', whatsappClient);
                results.push({ number: num, status: 'success', data: callResult });
            } catch (err) {
                results.push({ number: num, status: 'failed', error: err.message });
            }
        }
        res.json({ success: true, results });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/agent', (req, res) => {
    res.render('agent');
});

app.post('/api/agent-chat', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) return res.status(400).json({ success: false });

        // Save User msg
        await AdminChat.create({ role: 'user', content: message });

        let replyText = await adminAIService.generateAdminReply(message);
        let actionsTaken = [];

        // Intercept MESSAGING
        const msgMatch = replyText.match(/\[TOOL:\s*SEND_MSG,\s*phone:\s*"([^"]+)",\s*msg:\s*"([^"]+)"\]/);
        if (msgMatch) {
            const phoneStr = msgMatch[1].replace(/[^0-9]/g, '');
            const msgStr = msgMatch[2];
            try {
                await whatsappClient.sendMessage(phoneStr + '@c.us', msgStr);
                actionsTaken.push(`✅ Sent WhatsApp message to ${phoneStr}`);
            } catch(e) {
                actionsTaken.push(`❌ Failed to send message to ${phoneStr}: ${e.message}`);
            }
            replyText = replyText.replace(msgMatch[0], '').trim();
        }

        // Intercept SCHEDULING
        const schMatch = replyText.match(/\[TOOL:\s*SCHEDULE_CALL,\s*phone:\s*"([^"]+)",\s*time:\s*"([^"]+)"\]/);
        if (schMatch) {
            const phoneStr = schMatch[1].replace(/[^0-9]/g, '');
            const timeStr = schMatch[2];
            try {
                await Schedule.create({
                    userId: phoneStr + '@c.us',
                    userName: 'Manual Override',
                    scheduledTime: new Date(timeStr),
                    reason: 'Admin AI Scheduled'
                });
                actionsTaken.push(`✅ Scheduled call for ${phoneStr} at ${timeStr}`);
            } catch(e) {
                actionsTaken.push(`❌ Failed to schedule for ${phoneStr}: ${e.message}`);
            }
            replyText = replyText.replace(schMatch[0], '').trim();
        }

        // Intercept CALLING
        const callMatch = replyText.match(/\[TOOL:\s*VOICE_CALL,\s*phone:\s*"([^"]+)",\s*mode:\s*"([^"]+)"\]/);
        if (callMatch) {
            const phoneStr = callMatch[1].replace(/[^0-9+]/g, '');
            const modeStr = callMatch[2];
            try {
                await voiceService.initiateCall(phoneStr, modeStr, whatsappClient);
                actionsTaken.push(`✅ Initiated ${modeStr} voice API call to ${phoneStr}`);
            } catch(e) {
                actionsTaken.push(`❌ Failed voice call to ${phoneStr}: ${e.message}`);
            }
            replyText = replyText.replace(callMatch[0], '').trim();
        }

        if (actionsTaken.length > 0) {
            replyText += "\n\n_System Note: " + actionsTaken.join(", ") + "_";
        }

        await AdminChat.create({ role: 'ai', content: replyText });

        res.json({ success: true, reply: replyText });
    } catch (error) {
        console.error("Agent logic failed:", error);
        res.status(500).json({ success: false, error: 'Internal failure' });
    }
});

// Excel File Upload for Dashboard AI
app.post('/api/agent-upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });
        
        // Parse the Excel File
        const workbook = xlsxLib.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const data = xlsxLib.utils.sheet_to_json(workbook.Sheets[sheetName]);
        
        const dataString = JSON.stringify(data, null, 2);
        
        const aiPrompt = `Here is an Excel file Viraj uploaded containing bulk numbers and instructions. Determine if you need to run specific tools (VOICE_CALL, SEND_MSG, etc.) to process them accurately.\n\nData:\n${dataString}`;
        
        await AdminChat.create({ role: 'user', content: "Uploaded a dataset for you to process." });
        
        let replyText = await adminAIService.generateAdminReply(aiPrompt);
        
        // Basic interceptor replication since it generates tools dynamically
        let actionsTaken = [];
        
        const msgsMatch = [...replyText.matchAll(/\[TOOL:\s*SEND_MSG,\s*phone:\s*"([^"]+)",\s*msg:\s*"([^"]+)"\]/g)];
        for (const msgMatch of msgsMatch) {
            try {
                const phoneStr = msgMatch[1].replace(/[^0-9]/g, '');
                await whatsappClient.sendMessage(phoneStr + '@c.us', msgMatch[2]);
                actionsTaken.push(`✅ Handled message to ${phoneStr}`);
            } catch(e) { }
            replyText = replyText.replace(msgMatch[0], '').trim();
        }
        
        const callsMatch = [...replyText.matchAll(/\[TOOL:\s*VOICE_CALL,\s*phone:\s*"([^"]+)",\s*mode:\s*"([^"]+)"\]/g)];
        for (const callMatch of callsMatch) {
            try {
                const phoneStr = callMatch[1].replace(/[^0-9]/g, '');
                await voiceService.initiateCall(phoneStr, callMatch[2], whatsappClient);
                actionsTaken.push(`✅ Initiated Call to ${phoneStr}`);
            } catch(e) { }
            replyText = replyText.replace(callMatch[0], '').trim();
        }

        if (actionsTaken.length > 0) {
            replyText += "\n\n_System Note: " + actionsTaken.join(", ") + "_";
        }
        
        await AdminChat.create({ role: 'ai', content: replyText });

        res.json({ success: true, reply: replyText });
    } catch(err) {
        console.error("Upload Logic Failed:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// WhatsApp Events
const botStartTime = Math.floor(Date.now() / 1000);

whatsappClient.on('qr', (qr) => {
    currentQR = qr;
    isReady = false;
});

// LISTEN FOR INCOMING VOICE CALLS
whatsappClient.on('incoming_call', async (call) => {
    console.log(`[CALL-HANDLER] Processing call from: ${call.from || call.id}`);
    const settings = await Settings.findOne();
    
    // Normalize phone number (handle object vs string)
    let phone = (typeof call.from === 'string' ? call.from : call.from?._serialized || call.id || '').split('@')[0];
    
    if (settings && settings.voiceProvider === 'vapi') {
        try {
            console.log(`[CALL-HANDLER] Triggering Vapi Bridge for ${phone}...`);
            await voiceService.callVapi(settings.vapiApiKey, phone, 'sales', whatsappClient);
        } catch (err) {
            console.error("[CALL-HANDLER] Execution Error:", err.message);
        }
    } else {
        console.log("[CALL-HANDLER] Vapi not active for this call.");
    }
});

whatsappClient.on('ready', async () => {
    isReady = true;
    currentQR = null;
    console.log('WhatsApp Bot is live!');

    // Catch up on unread messages
    console.log('Checking for unread messages...');
    const chats = await whatsappClient.getChats();
    const unreadChats = chats.filter(chat => chat.unreadCount > 0);
    
    for (const chat of unreadChats) {
        console.log(`Processing ${chat.unreadCount} unread messages from ${chat.name}`);
        const messages = await chat.fetchMessages({ limit: chat.unreadCount });
        for (const msg of messages) {
            // Only process if it's from a user (not bot) and within last 24h
            if (!msg.fromMe && (msg.timestamp > (Date.now() / 1000) - 86400)) {
                await handleIncomingMessage(msg, true);
            } else if (msg.fromMe) {
                // Also sync our own manual messages to history so the bot knows what we've already handled!
                const manualContextId = chat.id._serialized; // Unified Group JID for groups
                const text = msg.body;
                const isManual = !text.includes('[This message is automated by NexAutomate]');
                await chatService.addMessage(manualContextId, 'Viraj Singh', text, 'bot', false, 'Viraj Singh', isManual);
            }
        }
        await chat.sendSeen(); // Mark as read after processing
    }
    console.log('Catch-up sync complete.');
});

whatsappClient.on('disconnected', async (reason) => {
    isReady = false;
    console.warn('Bot disconnected:', reason);
    await notificationService.sendAlert(`WhatsApp Bot disconnected: ${reason}`);
});

whatsappClient.on('message', async (message) => {
    // 1. Handle Outgoing Messages (Manual Replies from phone or Bot Replies)
    if (message.fromMe) {
        const chatId = message.to;
        
        // Cancel pending bot reply if manually replied
        // If there's a pending timeout for this chat, it means the bot hadn't replied yet.
        if (pendingReplies.has(chatId)) {
            clearTimeout(pendingReplies.get(chatId));
            pendingReplies.delete(chatId);
            console.log(`[MANUAL REPLY DETECTED] for ${chatId}. Canceling scheduled AI response.`);
        }

        // 1b. Determine if this message is MANUAL (phone) vs AUTOMATED (AI)
        const recentMsg = recentBotMessages.get(chatId);
        let isManualManual = true;

        if (recentMsg && (Date.now() - recentMsg.timestamp < 15000) && (message.body === recentMsg.body)) {
            // This is actually the bot reply we just sent
            isManualManual = false;
            recentBotMessages.delete(chatId); // Clear after matching
        }

        if (isManualManual) {
            console.log(`[MANUAL PHONE MSG] detected for ${chatId}. Syncing to history.`);
        }

        // Context Synchronization
        const isGroup = chatId.endsWith('@g.us');
        const userIdForContext = chatId;

        // Store our own manual/bot messages in context history so AI knows what we said
        // This is now the ONLY place where outgoing messages are added to the DB
        await chatService.addMessage(userIdForContext, 'Viraj Singh', message.body, 'bot', false, 'Viraj Singh', isManualManual);
        return;
    }

    // 2. Handle Incoming Messages (Standard Logic)
    try {
        await handleIncomingMessage(message);
    } catch (error) {
        console.error('[CRITICAL ERROR] in handleIncomingMessage:', error.message);
    }
});

async function handleIncomingMessage(message, isSync = false) {
    // 1. Ignore old messages (older than bot startup) UNLESS it's a startup sync for unread messages
    if (!isSync && message.timestamp < botStartTime) {
        return;
    }

    // 2. Ignore newsletters and broadcasts
    if (message.from.includes('@newsletter') || message.from.includes('@broadcast')) {
        return;
    }

    const isGroup = message.from.endsWith('@g.us');
    const chat = await message.getChat();
    const groupName = isGroup ? chat.name : null;
    
    // REDESIGN: For groups, we use the Group JID ONLY as the contextId.
    // This solves the context/history missing problem by giving the AI a single group scroll.
    const contextId = message.from; 

    // 3. Check for Manual Override
    if (process.env.MANUAL_OVERRIDE === 'true') {
        console.log('Manual override is ON. Bot is silent.');
        return;
    }

    const userId = contextId; // Thread Context ID (JID or GroupJID)
    const senderPhone = (message.author || message.from).split('@')[0]; // Actual person sending
    const userName = message._data.notifyName || 'User';
    let text = message.body || "";

    // Global Contact Registration (Name to Number Mapping)
    const contactRecord = await contactService.captureContact(senderPhone, userName);

    // 4. Exclude Verified Businesses
    const contact = await message.getContact();
    if (contact.isVerified || contact.isEnterprise) {
        console.log(`Skipping reply to verified business: ${userName}`);
        await chatService.addMessage(userId, userName, text || "[Business System Message]", 'user');
        return;
    }

    // 5. Handle Attachments & Voice Notes
    let mediaData = null;
    let isVoiceMessage = message.type === 'ptt' || message.type === 'audio';

    if (message.hasMedia) {
        try {
            const media = await message.downloadMedia();
            if (!media) throw new Error("Failed to download media");

            if (isVoiceMessage) {
                console.log(`Transcribing voice message from ${userName}...`);
                const audioBuffer = Buffer.from(media.data, 'base64');
                const transcription = await aiService.transcribeAudio(audioBuffer, media.mimetype);
                if (transcription) {
                    text = transcription;
                    console.log(`Transcription: "${text}"`);
                } else {
                    text = "[Empty Voice Message]";
                }
            } else if (media.mimetype.includes('image') || media.mimetype.includes('pdf')) {
                mediaData = { 
                    inlineData: { data: media.data, mimeType: media.mimetype } 
                };
                text = text || "[USER SENT AN ATTACHMENT. Describe the contents.]";
                console.log(`Processing supported media attachment: ${media.mimetype}`);
            } else {
                throw new Error("Unsupported media type");
            }
        } catch (error) {
            console.log(`Media fallback triggered for ${userName}:`, error.message);
            if (!isVoiceMessage) { // Voice messages shouldn't fail with "unsupported" if they just failed download
                const mediaReply = "Currently I cannot process this type of attachment, or I am out of processing credits. I will inform Viraj.";
                const signature = "\n\n_*[This message is automated by NexAutomate]*_";
                
                await whatsappClient.sendMessage(message.from, mediaReply + signature);
                await chatService.addMessage(userId, userName, text || "[Media Attachment]", 'user', false, userName);
                await chatService.addMessage(userId, userName, mediaReply, 'bot', false, "Viraj Singh", false);
                return;
            }
        }
    }

    if (!text) return; // Ignore non-text messages if not media caption

    console.log(`Received from ${userName}${isGroup ? ` (Group: ${groupName})` : ''}: ${text}`);

    // 1b. Detect Importance
    const isImportant = await aiService.isMessageImportant(text);
    if (isImportant) console.log('Important message detected!');

    // 6. Support for 5-Minute Cooling Period (Manual ONLY)
    // Check last 5 messages to see if any were manual replies from phone in last 5m
    const historyCheck = await chatService.getHistory(userId, 5);
    const fiveMinutesAgo = new Date(Date.now() - 300000);
    
    const hasManualActivity = historyCheck.some(m => 
        m.sender === 'bot' && 
        m.timestamp > fiveMinutesAgo && 
        !m.text.includes('[This message is automated by NexAutomate]')
    );

    if (hasManualActivity) {
        console.log(`Manual activity in last 5m for ${userName}. Skipping AI reply to maintain your manual flow.`);
        await chatService.addMessage(userId, userName, text, 'user', isImportant, userName);
        return;
    }

    // 7. Store message in DB
    await chatService.addMessage(userId, userName, text, 'user', isImportant, userName);

    // 7. Get chat history (increased to 30 messages for better context)
    const history = await chatService.getHistory(userId, 30);

    // 8. Check if group is Admin-Only (Announce mode)
    if (isGroup && chat.groupMetadata && chat.groupMetadata.announce) {
        // If it's an announce group, check if the bot is an admin
        const me = chat.participants.find(p => p.id._serialized === whatsappClient.client.info.wid._serialized);
        if (!me || !me.isAdmin) {
            console.log(`Group "${groupName}" is Admin-Only. Storing info but skipping reply.`);
            return;
        }
    }

    // Pass today's schedules to the AI
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    
    const todaySchedules = await Schedule.find({
        scheduledTime: { $gte: startOfDay, $lte: endOfDay },
        status: { $ne: 'cancelled' }
    });
    
    aiService.currentSchedules = todaySchedules.map(s => `[${s.scheduledTime.toLocaleTimeString()}] ${s.userName}: ${s.reason || 'Call'}`).join(', ') || 'No calls scheduled today.';

    // 8. Gather Daily Logs for Long-Term Memory
    const pastLogs = await DailyLog.find({ userId: userId }).sort({ date: -1 }).limit(3);
    const logContext = pastLogs.map(l => `[${l.date.toLocaleDateString()}] ${l.summary}`).join(' | ');
    if (logContext) {
        aiService.currentUserLogContext = logContext;
    } else {
        aiService.currentUserLogContext = null;
    }
    
    // Pass Relationship flag to AI Service
    aiService.currentRelationship = contactRecord ? contactRecord.relationship : 'unknown';

    // 9. Decide if we should reply (Smart Filtering)
    const shouldReply = await aiService.shouldReply(text, history, groupName);
    if (!shouldReply) {
        console.log(`[SMART-SKIP] Skipping reply to ${userName} based on context/relevance.`);
        return;
    }

    // 10. Generate AI Reply
    let replyText = await aiService.generateReply(history, text, userName, groupName, mediaData);

    // 9b. Intercept Tags
    const scheduleMatch = replyText.match(/\[ACTION:\s*SCHEDULE,\s*TIME:\s*"([^"]+)"\]/);
    if (scheduleMatch) {
        try {
            const timeStr = scheduleMatch[1];
            const parsedDate = new Date(timeStr);
            if (!isNaN(parsedDate)) {
                await Schedule.create({
                    userId: userId,
                    userName: userName,
                    scheduledTime: parsedDate,
                    reason: "Automated AI Scheduling"
                });
                console.log(`[SCHEDULED] Call for ${userName} at ${timeStr}`);
            }
        } catch (e) {
            console.error("Error creating schedule:", e);
        }
        replyText = replyText.replace(scheduleMatch[0], '').trim();
    }

    const linkMatch = replyText.match(/\[ACTION:\s*SEND_PERSONAL_LINK\]/);
    if (linkMatch) {
        replyText = replyText.replace(linkMatch[0], '').trim();
        replyText += "\n\nHere is the link to schedule a direct, personal call with me: https://cal.com/virajsingh/connect";
    }

    // 10. Append Automated Signature
    const signature = "\n\n_*[This message is automated by NexAutomate]*_";
    const finalReply = replyText + signature;

    // 11. Buffer the full reply so we can identify it in 'message_create'
    recentBotMessages.set(userId, { body: finalReply, timestamp: Date.now() });

    // 12. AI Lead Extraction (Automatic)
    const leadInfo = await aiService.extractLeadInfo(history, text);
    if (leadInfo) {
        console.log(`[AI EXTRACTION] for ${userName}:`, leadInfo);
        await leadService.captureLead(
            userId, 
            leadInfo.name || userName, 
            leadInfo.phone || senderPhone, 
            leadInfo.interest,
            leadInfo.budget,
            leadInfo.requirements,
            leadInfo.isLead
        );
    }

    // 13. Human-like delay (Skip delay for sync messages to be faster)
    if (isSync) {
        await whatsappClient.sendMessage(message.from, finalReply);
        return;
    }

    const delay = Math.floor(Math.random() * (parseInt(process.env.RESPONSE_DELAY_MAX) - parseInt(process.env.RESPONSE_DELAY_MIN)) + parseInt(process.env.RESPONSE_DELAY_MIN));
    
    // Cancel any previous pending reply for this user to avoid overlapping
    if (pendingReplies.has(message.from)) {
        clearTimeout(pendingReplies.get(message.from));
    }

    const timeoutId = setTimeout(async () => {
        // Final check: did someone reply while we were waiting?
        if (!pendingReplies.has(message.from)) return;

        // Send Reply
        await whatsappClient.sendMessage(message.from, finalReply);
        
        console.log(`Replied to ${userName} after ${delay/1000}s`);
        pendingReplies.delete(message.from);
    }, delay);

    // Store the timeout so we can cancel it if needed
    pendingReplies.set(message.from, timeoutId);
}

// Cron Job: Daily Report (Every day at 10:05 PM IST)
cron.schedule('5 22 * * *', async () => {
    await generateAndSendReport();
}, {
    scheduled: true,
    timezone: "Asia/Kolkata"
});

async function generateAndSendReport() {
    console.log('Generating multi-pass chunked daily report...');
    
    const since = new Date(Date.now() - (24 * 60 * 60 * 1000));
    
    // FETCH ALL CONTACTS to map relationships
    const allContacts = await Contact.find({});
    const contactMap = new Map();
    allContacts.forEach(c => contactMap.set(c.phone, c));

    const allChats = await Chat.find({ lastInteraction: { $gte: since } });

    if (allChats.length === 0) {
        console.log('No activity in the last 24 hours.');
        return;
    }

    let stats = {
        uniqueSenders: allChats.length,
        totalReceived: 0,
        totalSent: 0
    };

    let allMessages = [];
    allChats.forEach(chat => {
        const phone = chat.chatId.split('@')[0];
        const contactInfo = contactMap.get(phone);
        const relationship = contactInfo ? contactInfo.relationship : 'unknown';
        const labelName = contactInfo && contactInfo.name !== 'Unknown' ? contactInfo.name : chat.userName;

        const recentMsgs = chat.messages.filter(m => m.timestamp >= since);
        recentMsgs.forEach(m => {
            if (m.sender === 'user') {
                stats.totalReceived++;
                allMessages.push(`[${labelName} (${relationship})]: ${m.text}`);
            } else {
                stats.totalSent++;
                allMessages.push(`[ME (AI)]: ${m.text}`);
            }
        });
    });

    // 0. Fetch recent leads for the report
    const recentLeads = await Lead.find({ capturedAt: { $gte: since } });

    // 1. Chunking - 50 messages per chunk to stay within token limits
    const CHUNK_SIZE = 50;
    const chunks = [];
    for (let i = 0; i < allMessages.length; i += CHUNK_SIZE) {
        chunks.push(allMessages.slice(i, i + CHUNK_SIZE).join('\n'));
    }

    console.log(`Processing ${chunks.length} report chunks...`);

    // 2. Summarize each chunk
    const summaries = [];
    for (const chunk of chunks) {
        const summary = await aiService.summarizeReportChunk(chunk);
        summaries.push(summary);
    }

    // 3. Combine summaries into final report
    console.log('Combining summaries into final report...');
    const finalReportHtml = await aiService.combineSummariesIntoReport(summaries, stats, recentLeads);

    // 4. Final Email Delivery
    await notificationService.sendEmail(
        process.env.REPORT_RECEIVER, 
        `Daily AI Bot Report: ${new Date().toLocaleDateString()}`, 
        finalReportHtml
    );
    
    console.log('Chunked daily report sent successfully.');
}

// Start Express Server FIRST so dashboard is reachable
const server = app.listen(PORT, () => {
    console.log(`Dashboard server is LIVE on http://localhost:${PORT}`);
    
    // Then Initialize WhatsApp in the background
    console.log('Initializing WhatsApp client...');
    whatsappClient.initialize();
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`[PID: ${process.pid}] Port ${PORT} is already in use.`);
        console.error('Stack Trace:', err.stack);
    } else {
        console.error(`[PID: ${process.pid}] Server Error:`, err);
    }
    process.exit(1);
});
