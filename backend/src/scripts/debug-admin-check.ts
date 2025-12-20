
import { config } from '../config/env';
import { dolibarrService } from '../services/dolibarrService';
import axios from 'axios';
import https from 'https';

async function run() {
    const TEST_KEY = process.argv[2];

    if (!TEST_KEY) {
        console.error("Usage: ts-node debug-admin-check.ts <YOUR_DOLIBARR_API_KEY>");
        process.exit(1);
    }

    console.log(`Checking key: ${TEST_KEY}`);
    const adminKey = config.dolibarrKey;
    console.log(`System Admin Key: ${adminKey}`);

    const httpsAgent = new https.Agent({ rejectUnauthorized: false });
    const headers = {
        'DOLAPIKEY': adminKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };

    // 1. Try to list users (check permissions of System Key)
    console.log("TEST 1: List first 5 users with System Key...");
    try {
        // Access private property logic or just reconstruct URL
        // Service might have trailing slash
        let baseUrl = config.dolibarrUrl;
        if (!baseUrl.endsWith('/')) baseUrl += '/';
        const url = `${baseUrl}users`;

        const response = await axios.get(url, {
            headers,
            params: { limit: 5 },
            httpsAgent,
            validateStatus: () => true
        });

        console.log(`Status: ${response.status}`);
        if (response.status === 200 && Array.isArray(response.data)) {
            console.log(`Success! Found ${response.data.length} users.`);
            const firstUser = response.data[0];
            console.log("Sample User:", JSON.stringify(firstUser, null, 2));

            // Check if api_key is present in the response
            if (firstUser.api_key !== undefined) {
                console.log("Can see api_key field? YES");
            } else {
                console.log("Can see api_key field? NO (This is the problem!)");
            }

        } else {
            console.log("Failed to list users. Response:", response.data);
            console.log("System Key likely does not have 'User Read' permissions.");
        }
    } catch (e: any) {
        console.error("Test 1 Failed:", e.message);
    }

    // 2. Try the Filter Search again
    console.log("\nTEST 2: Filter Search...");
    try {
        // const user = await dolibarrService.getUserByKey(TEST_KEY);
        // const user = await dolibarrService.getUserByKey(TEST_KEY);
        // console.log("getUserByKey Result:", user);
    } catch (e) {
        console.error(e);
    }
}

run();
