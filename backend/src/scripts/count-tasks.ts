
import axios from 'axios';
import { config } from '../config/env';

async function countTasks() {
    // Derive Root URL from API URL details in config
    // Config default: https://sistema.coolgroove.com.br/api/index.php
    // Target: https://sistema.coolgroove.com.br/custom_sync.php (assuming it's in root as per test script)

    // Logic from test-custom-sync.ts
    const baseUrl = config.dolibarrUrl.replace(/\/api\/index\.php$/, '');
    const syncUrl = `${baseUrl}/custom_sync.php`;
    const apiKey = config.dolibarrKey;

    console.log(`Checking Task Count...`);
    console.log(`URL: ${syncUrl}`);

    if (!apiKey) {
        console.error('Error: DOLIBARR_API_KEY is missing in .env');
        process.exit(1);
    }

    let totalTasks = 0;
    let offset = 0;
    const limit = 5000;
    let hasMore = true;
    let page = 1;

    try {
        while (hasMore) {
            console.log(`Fetching page ${page} (Offset: ${offset})...`);

            const response = await axios.get(syncUrl, {
                params: {
                    type: 'tasks',
                    last_modified: 0,
                    limit: limit,
                    offset: offset,
                    DOLAPIKEY: apiKey
                },
                validateStatus: () => true
            });

            if (response.status !== 200) {
                console.error(`Error: HTTP ${response.status}`);
                console.error(response.data);
                break;
            }

            const data = response.data;
            let currentBatchCount = 0;

            if (Array.isArray(data)) {
                // Old format
                currentBatchCount = data.length;
                totalTasks += currentBatchCount;
                hasMore = false; // Array format usually implies no pagination or all in one, but relying on offset logic:
                // Actually custom_sync.php with old format didn't support offset well implicitly unless we trust it returns everything.
                // But the observed custom_sync.php HAS pagination logic returning an object.
            } else if (data && data.data && Array.isArray(data.data)) {
                // New format with pagination
                currentBatchCount = data.data.length;
                totalTasks += currentBatchCount;

                // Check pagination flags
                if (data.pagination) {
                    hasMore = data.pagination.has_more;
                } else {
                    hasMore = currentBatchCount >= limit;
                }
            } else {
                console.error('Unknown response format:', data);
                break;
            }

            console.log(`+ ${currentBatchCount} tasks.`);

            offset += limit;
            page++;

            // Safety break
            if (page > 50) {
                console.warn('Hit safety page limit (50). Stopping.');
                break;
            }
        }

        console.log(`\n--------------------------`);
        console.log(`TOTAL TASKS: ${totalTasks}`);
        console.log(`--------------------------`);

    } catch (error: any) {
        console.error(`Execution Error: ${error.message}`);
    }
}

countTasks();
