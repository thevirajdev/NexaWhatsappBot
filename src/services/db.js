const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        const uri = process.env.MONGODB_URI;
        
        if (!uri || uri.includes('localhost:27017')) {
            console.warn('⚠️ WARNING: Using LOCAL MongoDB (localhost:27017). Ensure MongoDB is installed and RUNNING.');
        }

        await mongoose.connect(uri, {
            serverSelectionTimeoutMS: 5000 // 5 second timeout
        });
        
        console.log('✅ MongoDB Connected successfully!');
    } catch (error) {
        console.error('❌ MongoDB Connection Error:', error.message);
        console.error('👉 TIP: If you don\'t have MongoDB installed, use MongoDB Atlas (Cloud). Update MONGODB_URI in .env');
        // Do not exit(1) immediately to allow the dashboard to show an offline status if needed
    }
};

module.exports = connectDB;
