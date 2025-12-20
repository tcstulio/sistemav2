
import axios from 'axios';
import { config } from '../config/env';

async function testClientStripping() {
    console.log("--- Testing Client-Side Header Stripping Resilience ---");
    const backendUrl = `http://localhost:${config.port}/api/dolibarr/thirdparties`;

    // Valid Key from env to verify success if resilience works
    // (We use the env key as a 'User Key' simulation)
    const validKey = config.dolibarrKey;

    // Simulation:
    // Header is stripped (empty).
    // Key is provided via Query Param 'DOLAPIKEY'.
    // If backend only checks header, this will fail (401).
    // If backend is resilient, it will check query param and succeed (200/201).

    const dummyData = {
        name: `Resilience-Test-${Date.now()}`,
        client: '0',
        fournisseur: '0'
    };

    console.log(`Target: ${backendUrl}?DOLAPIKEY=${validKey.substring(0, 3)}...`);

    try {
        const res = await axios.post(`${backendUrl}?DOLAPIKEY=${validKey}`, dummyData, {
            headers: {
                'Content-Type': 'application/json'
                // NO 'dolapikey' HEADER 
            },
            validateStatus: () => true
        });

        console.log(`Status: ${res.status}`);
        if (res.status === 200 || res.status === 201) {
            console.log("SUCCESS: Backend accepted Query Param Key!");
            console.log("ID:", res.data);
            // Cleanup would be needed
            if (res.data) {
                await axios.delete(`http://localhost:${config.port}/api/dolibarr/thirdparties/${res.data}`, {
                    headers: { 'dolapikey': validKey } // Cleanup using standard method
                }).catch(() => console.log("Cleanup failed"));
            }
        } else if (res.status === 401) {
            console.log("FAILURE: Backend rejected Query Param Key. Header stripping will break the app.");
        } else {
            console.log("Response:", res.status, res.data);
        }

    } catch (e: any) {
        console.error("Error:", e.message);
    }
}

testClientStripping();
