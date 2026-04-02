require('dotenv').config();
const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const nodemailer = require('nodemailer');

async function verify() {
    console.log('--- NEXAUTOMATE ENVIRONMENT VERIFICATION ---\n');

    // 1. Check MongoDB
    try {
        console.log('1. Checking MongoDB Local...');
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/whatsapp_bot');
        console.log('   ✅ MongoDB Connected successfully!\n');
        await mongoose.connection.close();
    } catch (error) {
        console.log('   ❌ MongoDB Connection Failed!');
        console.log('      Error: ' + error.message);
        console.log('      Help: Ensure MongoDB is installed and the "MongoDB" service is started.\n');
    }

    // 2. Check Gemini AI
    try {
        console.log('2. Checking Gemini API Key...');
        if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
            throw new Error('API Key is missing or default.');
        }
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' });
        await model.generateContent('ping');
        console.log('   ✅ Gemini API Key is Valid!\n');
    } catch (error) {
        console.log('   ❌ Gemini API Check Failed!');
        console.log('      Error: ' + error.message);
        console.log('      Help: Check your API key at https://aistudio.google.com/\n');
    }

    // 3. Check Email/SMTP
    try {
        console.log('3. Checking Email/SMTP (Gmail App Password)...');
        if (!process.env.EMAIL_PASS || process.env.EMAIL_PASS === 'your_email_app_password') {
            throw new Error('Email App Password is missing or default.');
        }
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });
        await transporter.verify();
        console.log('   ✅ Email/SMTP Authenticated successfully!\n');
    } catch (error) {
        console.log('   ❌ Email/SMTP Check Failed!');
        console.log('      Error: ' + error.message);
        console.log('      Help: Ensure 2FA is enabled and you generated an "App Password".\n');
    }

    console.log('---------------------------------------------');
    console.log('If all ✅ are present, you are ready to start the bot!');
    process.exit(0);
}

verify();
