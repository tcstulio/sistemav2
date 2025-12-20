
import axios from 'axios';
import { config } from '../config/env';
import https from 'https';

async function debug() {
    console.log("--- Debugging Auth ---");
    const baseUrl = config.dolibarrUrl.endsWith('/') ? config.dolibarrUrl : `${config.dolibarrUrl}/`;
    const url = `${baseUrl}users`; // Endpoint we are testing

    // Agent to ignore SSL
    const httpsAgent = new https.Agent({ rejectUnauthorized: false });

    // 1. Header Only (Baseline - known to likely fail)
    console.log(`\n1. Testing Header ONLY: ${url}`);
    try {
        const res = await axios.get(url, {
            headers: { 'DOLAPIKEY': config.dolibarrKey },
            params: { limit: 1 },
            httpsAgent,
            validateStatus: () => true
        });
        console.log(`Status: ${res.status}`);
        if (res.status !== 200) console.log("Body:", JSON.stringify(res.data).substring(0, 200));
    } catch (e: any) { console.error("Error:", e.message); }

    // 2. Param Only (Hypothesis - should work)
    console.log(`\n2. Testing Param ONLY: ${url}`);
    try {
        const res = await axios.get(url, {
            params: { limit: 1, DOLAPIKEY: config.dolibarrKey },
            httpsAgent,
            validateStatus: () => true
        });
        console.log(`Status: ${res.status}`);
        if (res.status !== 200) console.log("Body:", JSON.stringify(res.data).substring(0, 200));
    } catch (e: any) { console.error("Error:", e.message); }

    // 3. Both (The Fix)
    console.log(`\n3. Testing BOTH: ${url}`);
    try {
        const res = await axios.get(url, {
            headers: { 'DOLAPIKEY': config.dolibarrKey },
            params: { limit: 1, DOLAPIKEY: config.dolibarrKey },
            httpsAgent,
            validateStatus: () => true
        });
        console.log(`Status: ${res.status}`);
        if (res.status !== 200) console.log("Body:", JSON.stringify(res.data).substring(0, 200));
    } catch (e: any) { console.error("Error:", e.message); }

    // 4. Status Endpoint Check (Is server alive?)
    console.log(`\n4. Testing /status (No Auth): ${baseUrl}status`);
    try {
        const res = await axios.get(`${baseUrl}status`, {
            httpsAgent,
            validateStatus: () => true
        });
        console.log(`Status: ${res.status}`); // Should be 200 or 401 depending on config
    } catch (e: any) { console.error("Error:", e.message); }
}

debug();
