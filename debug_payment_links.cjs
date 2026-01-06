
const axios = require('axios');
const fs = require('fs');

// Manually read .env.local because dotenv might be flaky
const envPath = fs.existsSync('.env.local') ? '.env.local' : (fs.existsSync('.env') ? '.env' : null);
let API_URL = "https://sistema.coolgroove.com.br/api/index.php";
let API_KEY = "26ecc09039bd0bfeb52b11003449a2deb4770482"; // Fallback, usually overwritten by env

if (envPath) {
    try {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const lines = envContent.split(/\r?\n/);
        lines.forEach(line => {
            line = line.trim();
            if (!line || line.startsWith('#')) return;
            const idx = line.indexOf('=');
            if (idx === -1) return;
            const key = line.substring(0, idx).trim();
            let val = line.substring(idx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                val = val.substring(1, val.length - 1);
            }
            if (key.includes('URL') && key.includes('DOLIBARR') && !API_URL) API_URL = val;
            if ((key.includes('KEY') || key.includes('TOKEN')) && key.includes('DOLIBARR') && !API_KEY) API_KEY = val;
        });
    } catch (e) {
        console.error("Erro ao ler .env:", e);
    }
}

// Derive Root URL for custom_sync.php
let ROOT_URL = API_URL;
if (ROOT_URL.includes('/api/index.php')) {
    ROOT_URL = ROOT_URL.replace(/\/api\/index\.php\/?$/, '');
}
if (ROOT_URL.endsWith('/')) ROOT_URL = ROOT_URL.slice(0, -1);
const CUSTOM_SYNC_URL = `${ROOT_URL}/custom_sync.php`;

async function checkType(type) {
    console.log(`\n🔎 Testing type: ${type}`);
    const url = `${CUSTOM_SYNC_URL}?type=${type}&limit=5&DOLAPIKEY=${API_KEY}`;
    try {
        const res = await axios.get(url);
        if (res.data && res.data.data) {
            console.log(`✅ Success! Count: ${res.data.data.length}`);
            if (res.data.data.length > 0) {
                console.log("Sample:", JSON.stringify(res.data.data[0], null, 2));
            } else {
                console.log("⚠️ No data returned (empty array). This might be normal if table is empty.");
            }
        } else {
            console.error("❌ Invalid response structure:", JSON.stringify(res.data));
        }
    } catch (err) {
        console.error(`❌ Request failed: ${err.message}`);
        if (err.response) {
            console.error(`Status: ${err.response.status}`);
            console.error(`Data:`, err.response.data);
        }
    }
}

async function run() {
    console.log("🚀 Verifying Custom Sync Payment Links...");
    console.log(`URL: ${CUSTOM_SYNC_URL}`);

    await checkType('payment_invoice_links');
    await checkType('supplier_payment_invoice_links');
}

run();
