
import axios from 'axios';
import { config } from '../config/env';

async function testVuln() {
    console.log("--- Testing for Unauthenticated Write Vulnerability ---");
    // We target the LOCAL BACKEND, not Dolibarr directly
    const backendUrl = `http://localhost:${config.port}/api/dolibarr/thirdparties`;

    console.log(`Target: ${backendUrl}`);

    const dummyData = {
        name: `Hacker-Test-${Date.now()}`,
        client: '0',
        fournisseur: '0'
    };

    try {
        // Request WITHOUT 'dolapikey' header
        const res = await axios.post(backendUrl, dummyData, {
            headers: { 'Content-Type': 'application/json' },
            validateStatus: () => true
        });

        console.log(`Status: ${res.status}`);
        if (res.status === 200 || res.status === 201) {
            console.error("VULNERABILITY CONFIRMED: Created entity without API Key!");
            console.log("ID:", res.data);

            // CLEANUP
            if (res.data) {
                // We need to delete it. But we can't use the vulnerability to delete (hopefully).
                // Use the service directly to clean up.
                console.log("Please manually delete ThirdParty ID:", res.data);
            }
        } else if (res.status === 401) {
            console.log("SECURE: Request rejected with 401.");
        } else {
            console.log("Response:", res.status, res.data);
        }

    } catch (e: any) {
        console.error("Error:", e.message);
    }
}

testVuln();
