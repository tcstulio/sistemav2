
const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');

console.log('--- Starting Isolation Test ---');

// Helper to find local browser (Copied from wahaService.ts)
const getBrowserPath = () => {
    const paths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    for (const path of paths) {
        if (fs.existsSync(path)) return path;
    }
    return undefined;
};

const executablePath = getBrowserPath();
console.log(`Browser Path: ${executablePath || 'Bundled'}`);

const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'test-session' }),
    puppeteer: {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--disable-extensions',
            '--disable-accelerated-2d-canvas',
            '--no-first-run'
        ],
        headless: true, // Try false if you want to see the browser
        executablePath: executablePath
    }
});

client.on('qr', (qr) => {
    console.log('✅ QR RECEIVED!');
    console.log('Length:', qr.length);
    // qrcode.generate(qr, { small: true });
    console.log('Exiting success...');
    process.exit(0);
});

client.on('ready', () => {
    console.log('✅ Client is ready!');
    process.exit(0);
});

client.on('authenticated', () => {
    console.log('✅ Client is authenticated!');
});

client.on('auth_failure', msg => {
    console.error('❌ Auth failure:', msg);
    process.exit(1);
});

console.log('Initializing client...');
client.initialize().catch(err => {
    console.error('❌ Initialize failed:', err);
    process.exit(1);
});

// Timeout
setTimeout(() => {
    console.log('⚠️ Timeout reached (30s). No QR received.');
    process.exit(1);
}, 30000);
