const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    name: { type: String, default: 'Unknown' },
    relationship: { type: String, default: 'unknown' }, // friend, family, client, unknown
    lastInteraction: { type: Date, default: Date.now },
});

const Contact = mongoose.model('Contact', contactSchema);
module.exports = Contact;
