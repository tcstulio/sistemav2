
import axios from 'axios';
import { config } from '../config/env';

async function testCustomSync() {
    // Derive Root URL from API URL
    // Config: https://sistema.coolgroove.com.br/api/index.php -> https://sistema.coolgroove.com.br/custom_sync.php
    const baseUrl = config.dolibarrUrl.replace(/\/api\/index\.php$/, '');
    const syncUrl = `${baseUrl}/custom_sync.php`;

    const apiKey = config.dolibarrKey;

    console.log(`Target URL: ${syncUrl}`);
    console.log(`API Key present: ${!!apiKey}`);

    const modulesToTest = ['contacts', 'users', 'warehouses', 'events', 'proposals', 'orders'];

    for (const mod of modulesToTest) {
        console.log(`\n--- Testing Module: ${mod} ---`);
        try {
            const response = await axios.get(syncUrl, {
                params: {
                    type: mod,
                    last_modified: 0, // Fetch all for test
                    DOLAPIKEY: apiKey
                },
                validateStatus: () => true
            });

            if (response.status === 200) {
                if (Array.isArray(response.data)) {
                    console.log(`SUCCESS: Retrieved ${response.data.length} items.`);
                    if (response.data.length > 0) {
                        const first = response.data[0];
                        console.log('Sample Item Keys:', Object.keys(first).join(', '));
                        // Check if tms is present as we expect
                        if ('tms' in first) {
                            console.log('✓ "tms" field is present in response.');
                        } else {
                            console.error('✗ "tms" field is MISSING in response!');
                        }
                    } else {
                        console.log('Ensure this is expected (empty table?)');
                    }
                } else {
                    console.error('FAILURE: Response is not an array.', response.data);
                }
            } else {
                console.error(`FAILURE: Status ${response.status}`);
                console.error(response.data);
            }

        } catch (error: any) {
            console.error(`ERROR: ${error.message}`);
        }
    }
}

testCustomSync();
