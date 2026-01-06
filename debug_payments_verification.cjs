const axios = require('axios');
require('dotenv').config({ path: '.env.local' });

const API_KEY = process.env.VITE_DOLIBARR_API_KEY || "26ecc09039bd0bfeb52b11003449a2deb4770482";
// Base URL often needs adjustment to point to custom_sync.php directly if not in standard API path
let BASE_URL = process.env.VITE_DOLIBARR_API_URL || "https://sistema.coolgroove.com.br/api/index.php";

// Strip /api/index.php to find custom_sync.php root
let ROOT_URL = BASE_URL.replace(/\/api\/index\.php\/?$/, '');
if (ROOT_URL.endsWith('/')) ROOT_URL = ROOT_URL.slice(0, -1);

const CUSTOM_SYNC_URL = `${ROOT_URL}/custom_sync.php`;

async function checkPayments() {
    console.log(`\n🔎 Testing type: payments`);
    console.log(`URL: ${CUSTOM_SYNC_URL}`);

    const url = `${CUSTOM_SYNC_URL}?type=payments&limit=5&DOLAPIKEY=${API_KEY}`;

    try {
        const res = await axios.get(url);
        if (res.data) {
            if (res.data.error) {
                console.error("❌ API Error:", res.data.error);
            } else if (Array.isArray(res.data.data)) {
                console.log(`✅ Success! Count: ${res.data.data.length}`);
                if (res.data.data.length > 0) {
                    console.log("Sample ID:", res.data.data[0].id);
                    console.log("Sample Ref:", res.data.data[0].ref);
                } else {
                    console.log("⚠️ Array empty, but endpoint works.");
                }
            } else {
                console.log("❓ Unexpected response format:", JSON.stringify(res.data).substring(0, 100));
            }
        } else {
            console.error("❌ No data in response");
        }
    } catch (err) {
        console.error(`❌ Request failed: ${err.message}`);
        if (err.response) {
            console.error(`Status: ${err.response.status}`);
            console.error(`Data:`, err.response.data);
        }
    }
}

checkPayments();
