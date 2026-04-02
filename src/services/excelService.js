const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const Lead = require('../models/Lead');
const Schedule = require('../models/Schedule');
const Chat = require('../models/Chat');

class ExcelService {
    async generateExcel() {
        try {
            const leads = await Lead.find().lean();
            const schedules = await Schedule.find().lean();
            const chats = await Chat.find().lean();

            // Transform Leads
            const leadData = leads.map(l => ({
                Name: l.userName || 'Unknown',
                Phone: l.phone || l.userId.replace('@c.us', ''),
                Interest: l.interest || '',
                Budget: l.budget || '',
                Requirements_Summary: l.requirements || '',
                isLead: l.isLead,
                Status: l.status,
                CapturedAt: l.capturedAt ? l.capturedAt.toLocaleString() : ''
            }));

            // Transform Schedules
            const scheduleData = schedules.map(s => ({
                Name: s.userName || 'Unknown',
                Phone: s.userId.replace('@c.us', ''),
                Time: s.scheduledTime ? s.scheduledTime.toLocaleString() : '',
                Reason: s.reason,
                Status: s.status
            }));

            // Transform General Contacts (Chats)
            const contactData = chats.map(c => {
                const totalMessages = c.messages ? c.messages.length : 0;
                return {
                    Name: c.userName || 'Unknown',
                    Phone: c.userId.replace('@c.us', ''),
                    LastInteraction: c.lastInteraction ? c.lastInteraction.toLocaleString() : '',
                    TotalMessages: totalMessages
                };
            });

            // Filter
            const qualifiedLeads = leadData.filter(l => l.isLead);
            const informationData = leadData.filter(l => !l.isLead);

            // Create workbook and add sheets
            const wb = xlsx.utils.book_new();
            
            const wsLeads = xlsx.utils.json_to_sheet(qualifiedLeads.length ? qualifiedLeads : [{ Message: 'No Leads Yet' }]);
            xlsx.utils.book_append_sheet(wb, wsLeads, 'Qualified Leads');

            const wsInfo = xlsx.utils.json_to_sheet(informationData.length ? informationData : [{ Message: 'No Information' }]);
            xlsx.utils.book_append_sheet(wb, wsInfo, 'Information Tracker');

            const wsContacts = xlsx.utils.json_to_sheet(contactData.length ? contactData : [{ Message: 'No Contacts' }]);
            xlsx.utils.book_append_sheet(wb, wsContacts, 'All Chat Activity');

            const wsSchedules = xlsx.utils.json_to_sheet(scheduleData.length ? scheduleData : [{ Message: 'No Schedules' }]);
            xlsx.utils.book_append_sheet(wb, wsSchedules, 'Schedules');

            // Save to public directory
            const publicDir = path.join(__dirname, '../../public');
            if (!fs.existsSync(publicDir)) {
                fs.mkdirSync(publicDir, { recursive: true });
            }

            const excelPath = path.join(publicDir, 'data.xlsx');
            xlsx.writeFile(wb, excelPath);
            
            console.log(`Excel data successfully written to ${excelPath}`);
            return '/data.xlsx';
        } catch (error) {
            console.error('Error generating Excel file:', error);
            return null;
        }
    }
}

module.exports = new ExcelService();
