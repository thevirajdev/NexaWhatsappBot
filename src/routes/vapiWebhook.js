const express = require('express');
const router = express.Router();
const Lead = require('../models/Lead');
const Schedule = require('../models/Schedule');
const Contact = require('../models/Contact');
const DailyLog = require('../models/DailyLog');
const whatsappClient = require('../client/whatsapp');

router.post('/', async (req, res) => {
    const { message } = req.body;
    if (!message) return res.send("OK");

    const { type, call, artifact } = message;

    // 1. Handle Tool Calls (The 6 AI Actions)
    if (type === 'tool-call') {
        const { toolCalls } = message;
        const results = [];

        for (const toolCall of toolCalls) {
            const { function: fn, id: toolCallId } = toolCall;
            const args = JSON.parse(fn.arguments || '{}');
            const phone = call.customer.number.replace('+', '');

            console.log(`[VAPI-TOOL] Executed: ${fn.name} for ${phone}`);

            try {
                if (fn.name === 'capture_lead_details') {
                    await Lead.findOneAndUpdate(
                        { userId: phone + '@c.us' },
                        { 
                            userName: args.name || "Lead", 
                            phone: phone, 
                            interest: args.interest, 
                            budget: args.budget, 
                            requirements: args.requirements,
                            capturedAt: new Date(),
                            isLead: true 
                        },
                        { upsert: true }
                    );
                    results.push({ toolCallId, result: "Lead captured successfully" });
                } else if (fn.name === 'schedule_followup_call') {
                    await Schedule.create({
                        userId: phone + '@c.us',
                        userName: args.name || "Valued Contact",
                        scheduledTime: new Date(args.time),
                        reason: args.reason || "Vapi Followup"
                    });
                    results.push({ toolCallId, result: "Call scheduled successfully" });
                } else if (fn.name === 'update_relationship') {
                    await Contact.findOneAndUpdate(
                        { phone: phone },
                        { relationship: args.relationship },
                        { upsert: true }
                    );
                    results.push({ toolCallId, result: "Relationship updated" });
                } else if (fn.name === 'send_whatsapp_summary') {
                    const summaryMsg = "Hey! Thanks for the call. Here's what we discussed: " + args.summary;
                    await whatsappClient.sendMessage(phone + '@c.us', summaryMsg);
                    results.push({ toolCallId, result: "WhatsApp summary sent" });
                } else if (fn.name === 'escalate_to_human') {
                    // Logic to mark as priority
                    await Lead.findOneAndUpdate({ userId: phone + '@c.us' }, { isLead: true });
                    results.push({ toolCallId, result: "Escalated to Viraj" });
                } else if (fn.name === 'hang_up') {
                    results.push({ toolCallId, result: "Hanging up now" });
                }
            } catch (err) {
                console.error(`[VAPI-TOOL-ERROR] ${fn.name}:`, err.message);
                results.push({ toolCallId, result: "Failed to execute" });
            }
        }
        return res.json({ results });
    }

    // 2. Handle End of Call Report (For Summaries)
    if (type === 'end-of-call-report') {
        const transcript = artifact?.transcript || "No transcript available.";
        const summary = artifact?.summary || "Short interaction.";
        const phone = call.customer.number.replace('+', '');

        console.log(`[VAPI-REPORT] Call ended for ${phone}`);

        await DailyLog.create({
            userId: phone + '@c.us',
            date: new Date(),
            summary: `VOICE CALL LOG: ${summary}\n\nTRANSCRIPT excerpt:\n${transcript.slice(0, 500)}...`
        });
    }

    res.send("OK");
});

module.exports = router;
