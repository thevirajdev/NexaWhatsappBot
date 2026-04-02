const nodemailer = require('nodemailer');

class NotificationService {
    constructor() {
        this.transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });
    }

    async sendEmail(to, subject, html) {
        try {
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to,
                subject,
                html
            };

            await this.transporter.sendMail(mailOptions);
            console.log(`Email sent to ${to}: ${subject}`);
        } catch (error) {
            console.error('Error sending email:', error);
        }
    }

    async sendAlert(message) {
        const adminEmail = process.env.REPORT_RECEIVER;
        const subject = 'NexAutomate: Urgent Alert';
        const html = `<h3>NexAutomate Alert</h3><p>${message}</p>`;
        await this.sendEmail(adminEmail, subject, html);
    }
}

module.exports = new NotificationService();
