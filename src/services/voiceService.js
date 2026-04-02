const googleTTS = require('google-tts-api');
const axios = require('axios');
const Settings = require('../models/Settings');
const fs = require('fs');
const path = require('path');
const Contact = require('../models/Contact');

class VoiceService {
    
    async generateVoiceNote(text, lang = 'hi') {
        try {
            const url = googleTTS.getAudioUrl(text, {
                lang: lang,
                slow: false,
                host: 'https://translate.google.com',
            });
            const res = await axios.get(url, { responseType: 'arraybuffer' });
            return Buffer.from(res.data);
        } catch (error) {
            console.error("TTS Generation Error:", error.message);
            throw error;
        }
    }
    
    // Voice Prompts Based On User Request
    getSystemPrompt(mode = 'sales') {
        const base = `You are Viraj Singh, the owner of NexAutomate, an AI automation and web development agency. 
You are currently on a voice call with a prospect or contact. 
IMPORTANT RULES: 
- DO NOT say you are an AI. You are Viraj Singh.
- Keep responses short, concise, and conversational. Do not ramble.
- End the call politely if the user says they are busy or want to drop.
`;

        if (mode === 'sales') {
            return base + `
SALES MODE INSTRUCTIONS:
- Start by casually asking how they are doing and mentioning you received their inquiry about AI/Websites.
- Goal 1: Find out what business they run or what their specific requirement is.
- Goal 2: Identify their budget (e.g. asking "What kind of investment were you looking at?").
- Goal 3: Emphasize that NexAutomate builds premium, custom AI automations and dynamic websites.
- End the call by telling them you will have your assistant send a follow-up summary on WhatsApp.
`;
        } else if (mode === 'friend') {
            return base + `
FRIEND MODE INSTRUCTIONS:
- You are talking to a personal friend or family member.
- Speak in a highly casual tone, mix Hindi and English (Hinglish).
- Be sarcastic or warm depending on the context. Do not try to sell anything.
`;
        }
        return base;
    }

    async initiateCall(phoneNumber, mode = 'sales', client) {
        const settings = await Settings.findOne();
        if (!settings) throw new Error("No settings found. Please configure Voice API keys.");

        const provider = settings.voiceProvider;
        
        // Persona Detection
        const contact = await Contact.findOne({ phone: phoneNumber.replace(/[^0-9]/g, '') });
        const relationship = contact ? contact.relationship : 'unknown';
        
        let firstMessage = "Hello! Viraj Singh here from NexAutomate. Kaise hain aap? How can I help you regarding AI automation today?";
        let systemPrompt = this.getSystemPrompt('sales');

        // PERSONA: FAMILY
        if (relationship === 'family') {
            firstMessage = "Hello! Viraj bol raha hu. Kaise ho?";
            if (contact && contact.name && (contact.name.includes('Praneet') || contact.name.includes('Prakash'))) {
                firstMessage = "Hello Praneet bhaiya! Kaise ho? Sab thik?";
            }
            systemPrompt = `You are Viraj Singh talking to your family. Be very respectful and warm. Use Hindi/Hinglish. Do NOT sell anything.`;
        } 
        // PERSONA: FRIEND
        else if (relationship === 'friend') {
            firstMessage = "Oi! Viraj here. Kya chal raha hai?";
            systemPrompt = `You are Viraj Singh talking to a close friend. Be casual, slightly sarcastic, and use lots of Hinglish. No professional talk unless they ask.`;
        }

        console.log(`[VOICE] Initiating ${provider} call to ${phoneNumber} (${relationship} persona).`);

        if (provider === 'bland') {
            return this.callBland(settings.blandApiKey, phoneNumber, systemPrompt);
        } else if (provider === 'retell') {
            return this.callRetell(settings.retellApiKey, phoneNumber, systemPrompt);
        } else if (provider === 'vapi') {
            return this.callVapi(settings.vapiApiKey, phoneNumber, mode, client, firstMessage, systemPrompt);
        } else {
            throw new Error('Unknown voice provider');
        }
    }

    async callBland(apiKey, phoneNumber, prompt) {
        if (!apiKey) throw new Error("Bland API key missing");
        
        try {
            const res = await fetch('https://api.bland.ai/v1/calls', {
                method: 'POST',
                headers: {
                    'authorization': apiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    phone_number: phoneNumber,
                    task: prompt,
                    voice: "maya", 
                    record: true,
                    wait_for_greeting: true
                })
            });
            const data = await res.json();
            return data;
        } catch (error) {
            console.error("Bland API Error:", error);
            throw error;
        }
    }

    async callRetell(apiKey, phoneNumber, prompt) {
        if (!apiKey) throw new Error("Retell API key missing");
        return { status: 'queued', provider: 'retell' };
    }

    async callVapi(apiKey, phoneNumber, mode = 'sales', client, firstMessage, systemPrompt) {
        // Vapi real-time bridge is now disabled per user request
        console.log("[VAPI] Real-time bridge is disabled. Using Voice Note AI instead.");
        return { status: 'ignored', reason: 'bridge-disabled' };
    }
}

module.exports = new VoiceService();
