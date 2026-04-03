const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { EventEmitter } = require('events');

class WhatsAppClient extends EventEmitter {
    constructor() {
        super();
        this.client = new Client({
            authStrategy: new LocalAuth({
                clientId: process.env.SESSION_ID || 'nex-automate'
            }),
            webVersionCache: {
                type: 'remote',
                remotePath: 'https://raw.githubusercontent.com/wwebjs/web-whatsapp-client/main/Remote_v2.3000.1012588385.html'
            },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
            puppeteer: {
                args: [
                    '--no-sandbox', 
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
                    '--disable-canvas-aa',
                    '--disable-2d-canvas-clip-aa',
                    '--disable-gl-drawing-for-tests',
                    '--disable-dev-dbus-invocation',
                    '--disable-notifications',
                    '--disable-remote-fonts',
                    '--disable-extensions',
                    '--disable-background-networking',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-breakpad',
                    '--disable-component-update',
                    '--disable-default-apps',
                    '--disable-domain-reliability',
                    '--disable-sync'
                ],
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
                headless: 'new'
            }
        });

        // Auto-detect Chrome path on Linux VPS/Render
        if (process.platform === 'linux' && !process.env.PUPPETEER_EXECUTABLE_PATH) {
            const fs = require('fs');
            const glob = require('glob');
            const possiblePaths = [
                '/usr/bin/google-chrome-stable',
                '/usr/bin/google-chrome',
                '/usr/bin/chromium-browser',
                '/usr/bin/chromium',
                ...glob.sync('/home/cloud-user/.cache/puppeteer/chrome/**/chrome-linux64/chrome'),
                ...glob.sync('/opt/render/project/src/.cache/puppeteer/chrome/**/chrome-linux64/chrome'),
                ...glob.sync('./.cache/puppeteer/chrome/**/chrome-linux64/chrome')
            ];

            for (const path of possiblePaths) {
                if (fs.existsSync(path)) {
                    console.log(`[PUPPETEER] Auto-detected Chrome path: ${path}`);
                    this.client.options.puppeteer.executablePath = path;
                    break;
                }
            }
        }

        this.initializeEvents();
    }

    initializeEvents() {
        this.client.on('qr', (qr) => {
            console.log('QR RECEIVED', qr);
            qrcode.generate(qr, { small: true });
            this.emit('qr', qr);
        });

        this.client.on('ready', () => {
            console.log('Client is ready!');
            this.emit('ready');
        });

        this.client.on('authenticated', () => {
            console.log('AUTHENTICATED');
            this.emit('authenticated');
        });

        this.client.on('auth_failure', (msg) => {
            console.error('AUTHENTICATION FAILURE', msg);
            this.emit('auth_failure', msg);
        });

        this.client.on('disconnected', (reason) => {
            console.warn('Client was logged out', reason);
            this.emit('disconnected', reason);
        });

        this.client.on('message_create', async (message) => {
            this.emit('message', message);
        });
    }

    async setupConsoleLogging() {
        // No longer needed for headless mode
    }

    async initialize() {
        try {
            await this.client.initialize();
        } catch (error) {
            console.error('Failed to initialize WhatsApp client:', error);
        }
    }

    async getChats() {
        try {
            return await this.client.getChats();
        } catch (error) {
            console.error('Failed to get chats:', error);
            return [];
        }
    }

    async sendMessage(to, content, options = {}) {
        try {
            await this.client.sendMessage(to, content, options);
        } catch (error) {
            console.error(`Failed to send message to ${to}:`, error.message);
        }
    }
}

module.exports = new WhatsAppClient();
