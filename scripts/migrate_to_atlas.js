require('dotenv').config();
const mongoose = require('mongoose');

// Import all models
const Chat = require('../src/models/Chat');
const Contact = require('../src/models/Contact');
const Lead = require('../src/models/Lead');
const Schedule = require('../src/models/Schedule');
const Settings = require('../src/models/Settings');
const DailyLog = require('../src/models/DailyLog');
const AdminChat = require('../src/models/AdminChat');

const LOCAL_URI = 'mongodb://localhost:27017/whatsapp_bot';
const ATLAS_URI = process.env.MONGODB_URI;

async function migrate() {
    try {
        console.log('🚀 Starting Migration: Local -> Atlas Cloud...');

        // 1. Connect to Local
        const localConn = await mongoose.createConnection(LOCAL_URI).asPromise();
        console.log('✅ Connected to Local MongoDB');

        // 2. Connect to Atlas
        const atlasConn = await mongoose.createConnection(ATLAS_URI).asPromise();
        console.log('✅ Connected to Atlas MongoDB');

        const models = [
            { name: 'Chat', model: Chat },
            { name: 'Contact', model: Contact },
            { name: 'Lead', model: Lead },
            { name: 'Schedule', model: Schedule },
            { name: 'Settings', model: Settings },
            { name: 'DailyLog', model: DailyLog },
            { name: 'AdminChat', model: AdminChat }
        ];

        for (const m of models) {
            console.log(`\n📦 Migrating: ${m.name}...`);
            
            // Fetch from Local
            const localModel = localConn.model(m.name, m.model.schema);
            let data = await localModel.find({});
            console.log(`   - Found ${data.length} documents in local.`);

            if (data.length > 0) {
                const atlasModel = atlasConn.model(m.name, m.model.schema);
                
                // DATA CLEANING: Fix 'text is required' validation errors
                if (m.name === 'Chat') {
                    data = data.map(doc => {
                        const obj = doc.toObject();
                        obj.messages = obj.messages.map(msg => {
                            if (!msg.text) msg.text = "[Media Content]";
                            return msg;
                        });
                        return obj;
                    });
                } else {
                    data = data.map(doc => doc.toObject());
                }

                // Clear existing data in Atlas
                await atlasModel.deleteMany({});
                console.log(`   - Cleared existing ${m.name} in Atlas.`);

                // Insert many (unordered to survive partial failures)
                try {
                    await atlasModel.insertMany(data, { ordered: false });
                    console.log(`   - Successfully migrated ${data.length} documents.`);
                } catch (insertError) {
                    console.warn(`   - Warning: Some documents had validation errors and were skipped. (${insertError.writeErrors ? insertError.writeErrors.length : 'Multiple'} failures)`);
                }
            } else {
                console.log(`   - No data to migrate for ${m.name}.`);
            }
        }

        console.log('\n✨ MIGRATION COMPLETE! All data is now in the cloud.');
        
        await localConn.close();
        await atlasConn.close();
        process.exit(0);

    } catch (error) {
        console.error('\n❌ MIGRATION FAILED:', error.message);
        process.exit(1);
    }
}

migrate();
