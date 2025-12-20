
import axios from 'axios';
import dotenv from 'dotenv';
import { exec } from 'child_process';
import util from 'util';
const execPromise = util.promisify(exec);


// Load environment variables from backend/.env
const envPath = 'c:\\Projetos\\Sistema\\backend\\.env';
console.log(`Loading .env from: ${envPath}`);
dotenv.config({ path: envPath });


const DOLIBARR_URL = process.env.DOLIBARR_URL;
const DOLIBARR_KEY = process.env.DOLIBARR_API_KEY;

if (!DOLIBARR_URL || !DOLIBARR_KEY) {
    console.error(`Error: DOLIBARR_URL or DOLIBARR_KEY not found in .env. Loaded keys: ${Object.keys(process.env).filter(k => k.startsWith('DOL'))}`);
    process.exit(1);
}

const targetUrl = DOLIBARR_URL.endsWith('/') ? `${DOLIBARR_URL}status` : `${DOLIBARR_URL}/status`;
// Or simpler endpoint if status doesn't exist, like 'setup/modules' or just the index if it returns JSON
// We'll try a known endpoint that was failing, like 'products'
const productsUrl = DOLIBARR_URL.endsWith('/') ? `${DOLIBARR_URL}products?limit=1` : `${DOLIBARR_URL}/products?limit=1`;


async function testConnection(useCookie: boolean) {

    // Revert to Axios for verification of the backend implementation library
    console.log(`\n--- Testing ${useCookie ? 'WITH' : 'WITHOUT'} Cookie (using Axios + HTTPS Agent) ---`);
    console.log(`URL: ${productsUrl}`);

    const https = require('https');
    const agent = new https.Agent({  
        rejectUnauthorized: false // Mimic curl -k
    });

    const headers: any = {
        'DOLAPIKEY': DOLIBARR_KEY,
        'Accept': 'application/json',
        // Critical: User-Agent to match backend fix and avoid socket hang up
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };

    if (useCookie) {
        headers['Cookie'] = 'humans_21909=1';
    }

    try {
        const response = await axios.get(productsUrl, { 
            headers,
            httpsAgent: agent
        });
        console.log(`✅ Success! Status: ${response.status}`);
        console.log('Data sample:', JSON.stringify(response.data).substring(0, 100) + '...');
        return true;
    } catch (error: any) {
        if (error.response) {
            console.log(`❌ Failed. Status: ${error.response.status}`);
            console.log('Data:', typeof error.response.data === 'string' ? error.response.data.substring(0, 200) : error.response.data);
            if (error.response.status === 409) {
                console.log('👉 Confirmed: 409 Conflict (likely security challenge)');
            }
        } else {
            console.error('❌ Error:', error.message);
            if (error.code) console.error('Code:', error.code);
        }
        return false;
    }
}

async function run() {
    console.log('Starting Dolibarr Axios Verification...');

    // 1. Test without cookie (Expect 409)
    await testConnection(false);

    // 2. Test with cookie (Expect 200)
    await testConnection(true);
}

run();
