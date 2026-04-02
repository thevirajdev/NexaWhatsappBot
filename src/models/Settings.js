const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
    voiceProvider: { type: String, enum: ['bland', 'retell', 'vapi'], default: 'bland' },
    blandApiKey: { type: String, default: '' },
    retellApiKey: { type: String, default: '' },
    vapiApiKey: { type: String, default: '' }, // Private Key
    vapiPublicKey: { type: String, default: '' },
    vapiAssistantId: { type: String, default: '' },
    updatedAt: { type: Date, default: Date.now }
});

const Settings = mongoose.model('Settings', settingsSchema);
module.exports = Settings;
