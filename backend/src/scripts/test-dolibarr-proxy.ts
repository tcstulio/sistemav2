
import axios from 'axios';
import { config } from '../config/env';

// We need to test the LOCAL BACKEND (3004) -> SYSTEM (coolgroove)
// We are mimicking the behavior of the frontend here
const PROXY_URL = 'http://localhost:3004/api/dolibarr/status';
// If your backend protects this route, you might need special headers, but ours is public currently (except for DOLAPIKEY check inside)
const API_KEY = config.dolibarrKey; // Should be loaded from env

async function testProxy() {
    try {
        console.log(`Testing Proxy at: ${PROXY_URL}`);
        console.log(`Using API Key (len): ${API_KEY ? API_KEY.length : 0}`);

        const response = await axios.get(PROXY_URL, {
            headers: {
                'DOLAPIKEY': API_KEY,
                'Content-Type': 'application/json'
            },
            validateStatus: () => true
        });

        console.log('--- Response ---');
        console.log('Status:', response.status);
        console.log('Data:', JSON.stringify(response.data, null, 2));

        if (response.status === 200) {
            console.log("SUCCESS: Proxy is working and Dolibarr is reachable.");
        } else {
            console.log("FAILURE: Proxy returned error status.");
        }

    } catch (error: any) {
        console.error('--- Execution Error ---');
        console.error(error.message);
        if (error.code === 'ECONNREFUSED') {
            console.error("Backend does not seem to be running on localhost:3004. Have you started it?");
        }
    }
}

testProxy();
