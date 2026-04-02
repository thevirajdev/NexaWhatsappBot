const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');

class AIService {
    constructor() {
        this.apiKey = process.env.GEMINI_API_KEY;
        this.genAI = new GoogleGenerativeAI(this.apiKey);
        this.model = this.genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' });
        this.knowledgeBase = this.loadKnowledgeBase();
    }

    loadKnowledgeBase() {
        try {
            const data = fs.readFileSync('knowledge/business.json', 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.warn('Knowledge base not found, using empty object.');
            return {};
        }
    }

    async _withRetry(fn, retries = 3, delay = 2000) {
        let lastError;
        for (let i = 0; i < retries; i++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error;
                const isNetworkError = error.message.includes('fetch failed') || error.message.includes('ERR_CONNECTION_RESET');
                if (isNetworkError && i < retries - 1) {
                    console.warn(`AI API call failed (Network Error). Retrying in ${delay / 1000}s... (Attempt ${i + 1}/${retries})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 2; // Exponential backoff
                } else {
                    throw error; // Rethrow if not a network error or out of retries
                }
            }
        }
        throw lastError;
    }

    async generateReply(chatHistory, userMessage, userName, groupName = null, mediaData = null) {
        try {
            const prompt = this.buildPrompt(chatHistory, userMessage, userName, groupName);
            
            let contents = [prompt];
            if (mediaData) {
                contents.push(mediaData);
            }

            const result = await this._withRetry(() => this.model.generateContent(contents));
            const response = await result.response;
            return response.text();
        } catch (error) {
            console.error('Error generating AI reply after retries:', error.message);
            return 'Sorry, I am having trouble processing your request right now. Please try again in a few seconds.';
        }
    }

    async generateSummaryOnly(conversationText) {
        try {
            const prompt = `Summarize the following daily conversation chronologically into a 1-2 sentence context log. Focus on the core needs, context, or mood of the user. Do not include minor greetings. \n\n${conversationText}`;
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            return response.text();
        } catch (error) {
            console.error("Error generating daily summary:", error);
            return "No summary generated due to error.";
        }
    }

    buildPrompt(chatHistory, userMessage, userName, groupName = null) {
        const historyText = chatHistory
            .map(m => {
                const label = m.sender === 'bot' 
                    ? (m.isManual ? '[ME (Sent via Phone)]' : '[ME (Sent via AI)]')
                    : `[${m.authorName || m.userName || 'User'}]`;
                return `${label}: ${m.text}`;
            })
            .join('\n');

        const k = this.knowledgeBase;
        const groupContext = groupName ? `[GROUP CONTEXT: Talking in group "${groupName}"]` : '[PRIVATE CHAT]';

        return `
You are ${k.identity.name}. This is your WhatsApp.
${groupContext}

CURRENT RELATIONSHIP: ${this.currentRelationship || 'unknown'}
${this.currentRelationship === 'family' || this.currentRelationship === 'best_friend' ? `
CRITICAL OVERRIDE: This person is your family or best friend. 
DO NOT try to sell them AI automation or web development. DO NOT ask for their budget or project requirements.
Speak completely casually, naturally, and warmly.
` : `You are a professional but conversational AI expert trying to understand their needs.`}

PAST HISTORY SUMMARIES:
${this.currentUserLogContext ? this.currentUserLogContext : 'No previous daily logs found.'}

RULES:
1. **Response Style**: ${k.personality.responseStyle.length}, Tone: ${k.personality.tone.modes.join('/')}.
2. **Language**: Use ${k.personality.language.default} (${k.personality.language.professional} for business).
3. **CRITICAL**: DO NOT include your name, any labels (like "[ME]"), or signatures in your response. 
4. **CRITICAL**: Just provide the message text itself. Never start with "Viraj Singh:" or "Viraj:".
5. **HUMAN-LIKE**: Talk like a real person on WhatsApp. Use short sentences. Avoid perfectly perfect grammar. If a person says "Done" or "Ok", just reply with "Ok" or "Thik hai" or nothing if the conversation is over.
6. **END CONVERSATION**: If the discussion is finished, don't keep asking questions. A simple "Ok" or "Done" is enough to end the loop.

7. **Topic Handling**: If the user talks about a random topic, do NOT repeatedly steer them back to AI or Automation. Go with the flow of the conversation.

8. **Agentic Actions (CRITICAL)**:
   - If the user explicitly asks to schedule a call or meeting, first check the provided "Today's Schedule". 
     - If the requested time clashes with an existing event, tell them the time is booked and ask for another time.
     - If the time is free, output EXACTLY this tag at the END of your message: [ACTION: SCHEDULE, TIME: "YYYY-MM-DD HH:MM"]
     - (Assume today's date if not specified, format example: [ACTION: SCHEDULE, TIME: "2026-04-02 18:00"])
   - If the user explicitly asks to talk to "Viraj" PERSONALLY (not the AI), output EXACTLY this tag at the END of your message: [ACTION: SEND_PERSONAL_LINK]

9. **Special Responses**:
   - If asked "kya kar rahe ho": ${k.specialReplies['kya kar rahe ho']}.
   - If asked "busy ho": Follow rules for important vs others.
   - If "I love you": No response or strictly platonic.
   - For sad/angry users: Be empathetic (kya hua? / batao).

Context:
- Business: ${k.business.company} (${k.business.website}).
- Services: ${k.business.services.join(', ')}.
- Portfolio: ${k.business.portfolio}.

Today's Currently Scheduled Calls:
${this.currentSchedules || 'None'}

Chat History (last 20 messages for context):
${historyText}

Current User: ${userName}
User Message: ${userMessage}

Goal: Feel like the real ${k.identity.name}, handle conversations humanely, and convert leads for NexAutomate. Keep replies VERY SHORT like a busy person.

Reply: `;
    }

    async shouldReply(text, chatHistory, groupName = null) {
        try {
            // Quick rule-based filter to save costs
            const lowerText = text.toLowerCase().trim();
            const stopWords = ['ok', 'thik hai', 'done', 'v', 'nice', '👍', 'dhanyawad', 'thanks', 'thank you', 'good night'];
            
            // If it's just a stop word and we were the last ones to speak, don't reply
            if (stopWords.includes(lowerText) && chatHistory.length > 0 && chatHistory[chatHistory.length - 1].sender === 'bot') {
                console.log(`[SHOULD-REPLY] Detected stop-word "${lowerText}" after bot response. Ending loop.`);
                return false;
            }

            // In groups, be even more selective
            if (groupName) {
                const prompt = `
                You are Viraj Singh (WhatsApp Owner). Decide if you should reply to this message in the group "${groupName}".
                Criteria to reply (YES):
                - Someone is asking you a direct question.
                - Someone is talking about AI, Web Dev, or NexAutomate.
                - Someone is asking for your help.
                
                Criteria to skip (NO):
                - Random group chatter that doesn't involve you.
                - Someone just said "ok", "nice", or "good" to something else.
                - It's a general announcement.
                
                Message: "${text}"
                
                Reply ONLY with "YES" or "NO".`;
                
                const result = await this._withRetry(() => this.model.generateContent(prompt));
                const response = await result.response;
                return response.text().trim().toUpperCase().includes('YES');
            }

            return true; // Default to true for private chats
        } catch (error) {
            console.error("Error in shouldReply logic:", error.message);
            return true; // Fallback to reply
        }
    }

    async isMessageImportant(text) {
        try {
            // Quick check for high-priority keywords to save API costs
            const keywords = ['urgent', 'important', 'buy', 'price', 'budget', 'meeting', 'call', 'consultation', 'issue', 'complaint'];
            if (keywords.some(k => text.toLowerCase().includes(k))) return true;

            const prompt = `
            Analyze this WhatsApp message and decide if it is "Important" for a business owner's daily report.
            Important messages include: 
            - Business inquiries or service requests
            - Serious complaints or issues
            - Requests for calls or meetings
            - Pricing or budget discussions

            Message: "${text}"

            Reply ONLY with "YES" or "NO".`;

            const result = await this._withRetry(() => this.model.generateContent(prompt));
            const response = await result.response;
            return response.text().trim().toUpperCase().includes('YES');
        } catch (error) {
            console.error('Error detecting importance after retries:', error.message);
            return false;
        }
    }

    async extractLeadInfo(chatHistory, userMessage) {
        try {
            const historyText = chatHistory
                .map(m => `${m.sender === 'bot' ? 'Viraj' : 'User'}: ${m.text}`)
                .join('\n');

            const prompt = `
            Analyze the following WhatsApp conversation between Viraj (AI) and a User.
            Your goal is to extract any structured "Lead Information" if present.
            
            Conversation History:
            ${historyText}
            
            Current Message:
            User: ${userMessage}
            
            Instructions:
            1. Look for: Name, Phone Number, Budget, Project Requirements, Specific Interest.
            2. Extract exactly what was mentioned.
            3. If info is NOT present, leave the field empty.
            4. Return ONLY a valid JSON object.
            5. **CRITICAL**: Set "isLead": true ONLY if the user is explicitly asking for or showing interest in "Websites", "AI Automations", or "Bots". For any other casual or non-relevant inquiries, set "isLead": false but still extract the data (name, phone, etc.).
            
            Format:
            {
                "name": "Extracted Name",
                "phone": "Extracted Phone",
                "budget": "Extracted Budget (e.g., 5000-10000 INR)",
                "requirements": "Extracted specific needs/details",
                "interest": "Extracted overall interest area",
                "isLead": true/false (See Rule 5)
            }`;

            const result = await this._withRetry(() => this.model.generateContent(prompt));
            const response = await result.response;
            const jsonText = response.text().replace(/```json|```/g, '').trim();
            return JSON.parse(jsonText);
        } catch (error) {
            console.error('Error extracting lead info:', error.message);
            return { isLead: false };
        }
    }

    async generateCategorizedReport(messageLogs, stats) {
        try {
            const prompt = `
            You are a lead analyst for NexAutomate. You have been provided with a bulk log of all WhatsApp messages handled by the AI bot in the last 24 hours.

            Stats for the last 24 hours:
            - Unique Senders: ${stats.uniqueSenders}
            - Total Received (User -> Bot): ${stats.totalReceived}
            - Total Sent (Bot -> User): ${stats.totalSent}

            Message Logs (Username: Message):
            ${messageLogs}

            Your Task:
            Generate a detailed, professional HTML-formatted daily report for the owner (Viraj Singh).
            
            REPORT STRUCTURE REQUIRED:
            1. **Summary Overview**: A 2-3 sentence summary of the day's activity.
            2. **Categorized Interactions**: Group conversations into the following categories:
               - **Family**: (Personal messages, siblings, etc.)
               - **Friends**: (Casual, funny, or sarcastic roasts)
               - **Clients / Leads**: (Inquiries about bots, websites, pricing)
               - **Suggestions**: (User feedback or feature requests)
               - **Promotion**: (Marketing spam or ads)
               - **Security**: (Alerts or system mentions)
               - **Business**: (Partnerships, finance, or trading talk)
            3. **Detailed Breakdown**: For each category, listed the messages and who sent them, and summarize what was discussed.
            4. **Key Details Discovered**: Extract ANY specific info provided (phone numbers, budget, names, requirements).

            Return ONLY valid HTML inside markdown code blocks. Use <h3> for categories and <li> for list items.`;

            const result = await this._withRetry(() => this.model.generateContent(prompt), 2); // 2 retries for bulk report
            const response = await result.response;
            return response.text();
        } catch (error) {
            console.error('Error generating bulk report after retries:', error.message);
            return '<p>Error generating daily report.</p>';
        }
    }

    async summarizeReportChunk(chunkLogs) {
        try {
            const prompt = `
            Summarize the following WhatsApp message logs for a daily business report.
            Group interactions into these categories: Family, Friends, Clients/Leads, Suggestions, Promotion, Security, Business.
            
            Logs:
            ${chunkLogs}

            Provide a concise summary for each category found in this chunk. 
            Format as a plain text summary per category.`;

            const result = await this._withRetry(() => this.model.generateContent(prompt), 2);
            const response = await result.response;
            return response.text();
        } catch (error) {
            console.error('Error summarizing report chunk after retries:', error.message);
            return 'Error summarizing this chunk.';
        }
    }

    async combineSummariesIntoReport(allSummaries, stats, recentLeads = []) {
        try {
            // Format Leads Row if available
            let leadsHtml = '';
            if (recentLeads.length > 0) {
                leadsHtml = `
                <div style="background-color: #f0f4ff; padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 5px solid #3b82f6;">
                    <h3 style="margin-top: 0; color: #1e3a8a;">🚀 New Leads Captured (Last 24h)</h3>
                    <ul style="padding-left: 20px;">
                        ${recentLeads.map(l => `
                            <li style="margin-bottom: 10px;">
                                <strong>${l.userName || 'Unknown'}</strong> (${l.phone || 'No Phone'})<br>
                                <span style="font-size: 13px; color: #475569;">
                                    <b>Interest:</b> ${l.interest || 'N/A'}<br>
                                    <b>Budget:</b> ${l.budget || 'N/A'}<br>
                                    <b>Requirements:</b> ${l.requirements || 'N/A'}
                                </span>
                            </li>
                        `).join('')}
                    </ul>
                </div>`;
            }

            const prompt = `
            You are a lead analyst for NexAutomate. You have been provided with several partial summaries of the day's WhatsApp activity. 
            Combine them into one final, professional HTML-formatted daily report for Viraj Singh.

            Stats for the last 24 hours:
            - Unique Senders: ${stats.uniqueSenders}
            - Total Received (User -> Bot): ${stats.totalReceived}
            - Total Sent (Bot -> User): ${stats.totalSent}

            Partial Summaries:
            ${allSummaries.join('\n\n---\n\n')}

            Your Task:
            1. Consolidate the info into categories: Family, Friends, Clients/Leads, Suggestions, Promotion, Security, Business.
            2. Extract any key details (phone numbers, requirements, budgets).
            3. Provide a high-level overview.

            Return ONLY valid HTML inside markdown code blocks. Use <h3> for categories and <li> for list items.`;

            const result = await this._withRetry(() => this.model.generateContent(prompt), 2);
            const response = await result.response;
            let reportHtml = response.text().replace(/```html|```/g, '').trim();
            
            // Append the extracted leads section at the top of the report
            if (leadsHtml) {
                reportHtml = leadsHtml + reportHtml;
            }
            
            return reportHtml;
        } catch (error) {
            console.error('Error combining summaries after retries:', error.message);
            return '<h2>Daily Report</h2><p>Error consolidating partial reports.</p>';
        }
    }

    async transcribeAudio(buffer, mimeType = 'audio/ogg; codecs=opus') {
        try {
            const model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const result = await model.generateContent([
                {
                    inlineData: {
                        data: buffer.toString('base64'),
                        mimeType: mimeType
                    }
                },
                "Please transcribe this audio exactly as it is said. If there is no speech, return an empty string. Only return the transcription."
            ]);
            const response = await result.response;
            return response.text().trim();
        } catch (error) {
            console.error("Transcription Error:", error.message);
            return "";
        }
    }
}

module.exports = new AIService();
