const axios = require('axios');
require('dotenv').config({ path: '.env.local' });

const API_KEY = process.env.VITE_DOLIBARR_API_KEY;
let BASE_URL = process.env.VITE_DOLIBARR_API_URL || '';
// Remove /api/index.php to get to the root where custom_sync.php resides
BASE_URL = BASE_URL.replace(/\/api\/index\.php\/?$/, '');
if (BASE_URL.endsWith('/')) BASE_URL = BASE_URL.slice(0, -1);

const CUSTOM_SYNC_URL = `${BASE_URL}/custom_sync.php`;

async function checkType(type) {
    console.log(`\n🔎 Testing type: ${type}`);
    const url = `${CUSTOM_SYNC_URL}?type=${type}&limit=5&DOLAPIKEY=${API_KEY}`;
    console.log(`Checking URL: ${url}`); // Added log
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
    console.log("🚀 Starting Verification for Additional Payment Types...");

    const types = [
        'expense_report_payments',
        'expense_report_payment_links',
        'vat_payments',
        'salary_payments',
        'social_contribution_payments',
        'loan_payments',
        'various_payments'
    ];

    for (const type of types) {
        await checkType(type);
    }
}

run();
