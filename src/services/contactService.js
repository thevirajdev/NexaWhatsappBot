const Contact = require('../models/Contact');
const fs = require('fs');
const path = require('path');

class ContactService {
    constructor() {
        this.businessData = JSON.parse(fs.readFileSync(path.join(__dirname, '../../knowledge/business.json'), 'utf8'));
    }

    async captureContact(phone, name) {
        try {
            // First check if already exists
            let contact = await Contact.findOne({ phone });
            
            if (!contact) {
                // Determine relationship from JSON
                let relationship = 'unknown';
                const lowerName = (name || '').toLowerCase();
                
                // Simplified matching
                const b = this.businessData.personalDetails;
                if (b.siblings.brother.toLowerCase().includes(lowerName) || b.siblings.sisters.some(s => lowerName.includes(s.toLowerCase()))) {
                    relationship = 'family';
                } else if (b.bestFriends.some(f => lowerName.includes(f.toLowerCase()))) {
                    relationship = 'best_friend';
                }

                contact = await Contact.create({
                    phone,
                    name: name || 'Unknown',
                    relationship
                });
            } else {
                // Update Name if it was unknown
                if (name && contact.name === 'Unknown') {
                    contact.name = name;
                    await contact.save();
                }
                
                // Update interaction time
                contact.lastInteraction = Date.now();
                await contact.save();
            }
            return contact;
        } catch (error) {
            console.error("Error capturing contact:", error);
            return { phone, name, relationship: 'unknown' };
        }
    }
}

module.exports = new ContactService();
