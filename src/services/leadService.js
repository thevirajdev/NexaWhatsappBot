const Lead = require('../models/Lead');

class LeadService {
    async captureLead(userId, userName, phone, interest, budget = null, requirements = null, isLead = false) {
        try {
            const lead = await Lead.findOneAndUpdate(
                { userId },
                { 
                    userName, 
                    phone, 
                    interest, 
                    budget,
                    requirements,
                    isLead,
                    status: isLead ? 'interested' : 'new',
                    capturedAt: new Date()
                },
                { upsert: true, returnDocument: 'after' }
            );
            return lead;
        } catch (error) {
            console.error('Error capturing lead:', error);
        }
    }

    async getLeadsCount(timeRange = 24) {
        try {
            const since = new Date(Date.now() - (timeRange * 60 * 60 * 1000));
            const count = await Lead.countDocuments({ capturedAt: { $gte: since } });
            return count;
        } catch (error) {
            console.error('Error getting leads count:', error);
            return 0;
        }
    }
}

module.exports = new LeadService();
