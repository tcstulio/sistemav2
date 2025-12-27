
import axios from 'axios';
import { config } from '../config/env';

async function countTasksStandard() {
    // Standard API endpoint: /api/index.php/tasks
    // Filter: we want everything, so we rely on pagination.

    // Config: https://sistema.coolgroove.com.br/api/index.php
    const baseUrl = config.dolibarrUrl;
    const endpoint = `${baseUrl}/tasks`;
    const apiKey = config.dolibarrKey;

    console.log(`Checking Standard API Task Count...`);
    console.log(`URL: ${endpoint}`);

    if (!apiKey) {
        console.error('Error: DOLIBARR_API_KEY is missing in .env');
        process.exit(1);
    }

    let totalTasks = 0;
    let page = 0;
    const limit = 100; // Standard API default limit often 100
    let hasMore = true;

    try {
        while (hasMore) {
            console.log(`Fetching page ${page} (Limit: ${limit})...`);

            const response = await axios.get(endpoint, {
                params: {
                    limit: limit,
                    page: page,
                    sortfield: 't.rowid',
                    sortorder: 'ASC'
                },
                headers: {
                    'DOLAPIKEY': apiKey
                },
                validateStatus: () => true
            });

            if (response.status !== 200) {
                if (response.status === 404 && page === 0) {
                    console.error(`Error: Endpoint not found (404). API might be disabled or URL incorrect.`);
                } else if (response.status === 404 && page > 0) {
                    // Sometimes 404 means "no more items" in strict REST implementations or valid page but empty?
                    // Dolibarr usually returns empty array [], but let's handle 404 as end just in case.
                    console.log('404 on subsequent page - treating as end of list.');
                    hasMore = false;
                    break;
                } else {
                    console.error(`Error: HTTP ${response.status}`);
                    console.error(response.data);
                }
                break;
            }

            const data = response.data;

            if (Array.isArray(data)) {
                const count = data.length;
                console.log(`+ ${count} tasks.`);
                totalTasks += count;

                if (count < limit) {
                    hasMore = false;
                } else {
                    page++;
                }
            } else {
                // Some error or unexpected object
                console.error('Unexpected response format:', data);
                break;
            }

            // Safety break
            if (page > 200) { // 20k tasks
                console.warn('Hit safety page limit (200). Stopping.');
                break;
            }
        }

        console.log(`\n--------------------------`);
        console.log(`TOTAL TASKS (Standard API): ${totalTasks}`);
        console.log(`--------------------------`);

    } catch (error: any) {
        console.error(`Execution Error: ${error.message}`);
    }
}

countTasksStandard();
