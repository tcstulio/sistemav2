
import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';

// Load env from backend root
dotenv.config({ path: path.join(__dirname, '../../.env') });

const DOLIBARR_URL = process.env.DOLIBARR_URL || '';
const DOLIBARR_API_KEY = process.env.DOLIBARR_API_KEY || '';

console.log('--- Debugging Dolibarr API ---');
console.log(`URL: ${DOLIBARR_URL}`);
console.log(`KEY: ${DOLIBARR_API_KEY ? 'Present' : 'Missing'}`);

if (!DOLIBARR_URL || !DOLIBARR_API_KEY) {
    console.error("Missing credentials in .env");
    process.exit(1);
}

const headers = {
    'DOLAPIKEY': DOLIBARR_API_KEY,
    'Accept': 'application/json'
};

const baseUrl = DOLIBARR_URL.endsWith('/') ? DOLIBARR_URL : DOLIBARR_URL + '/';

const testEndpoint = async (name: string, endpoint: string) => {
    console.log(`\nTesting ${name}...`);
    try {
        const url = `${baseUrl}${endpoint}?limit=5`;
        console.log(`Requesting: ${url}`);
        const start = Date.now();
        const res = await axios.get(url, { headers });
        const time = Date.now() - start;

        console.log(`Status: ${res.status} (${time}ms)`);
        if (Array.isArray(res.data)) {
            console.log(`Success! Found ${res.data.length} items.`);
            if (res.data.length > 0) {
                console.log('Sample Item ID:', res.data[0].id || res.data[0].rowid);
            }
        } else {
            console.log('Response is not an array:', typeof res.data);
            // console.log(res.data);
        }
    } catch (error: any) {
        console.error(`FAILED ${name}`);
        if (error.response) {
            console.error(`Status: ${error.response.status}`);
            console.error(`Data:`, error.response.data);
        } else {
            console.error(`Error:`, error.message);
        }
    }
};

const run = async () => {
    // 1. Status
    await testEndpoint('Status', 'status');

    // 2. Setup/Modules (The check we disabled)
    await testEndpoint('Setup Modules', 'setup/modules');

    // 3. Batch 1 (Working)
    await testEndpoint('Users', 'users');
    await testEndpoint('Products', 'products');

    // 4. Batch 2 (Failing?)
    await testEndpoint('ThirdParties (Customers)', 'thirdparties');

    // 5. Batch 3
    await testEndpoint('Invoices', 'invoices');
};

run();
