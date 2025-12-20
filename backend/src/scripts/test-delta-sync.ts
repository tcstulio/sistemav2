/**
 * Test Delta Sync Endpoints
 * Run: npx ts-node src/scripts/test-delta-sync.ts
 */
import axios from 'axios';
import https from 'https';
import dotenv from 'dotenv';

dotenv.config();

const DOLIBARR_URL = process.env.DOLIBARR_URL || 'https://sistema.coolgroove.com.br/api/index.php';
const DOLIBARR_KEY = process.env.DOLIBARR_API_KEY || '';
const BYPASS_COOKIE = process.env.DOLIBARR_BYPASS_COOKIE || 'humans_21909=1';

// Modules to test (the ones with 0 records)
const PROBLEM_MODULES = [
    'bank_accounts',
    'payments',
    'supplier_payments',
    'projects',
    'tasks',
    'categories',
    'contracts',
    'warehouses'
];

async function testDeltaSync() {
    // Get root URL (remove /api/index.php)
    let rootUrl = DOLIBARR_URL;
    if (rootUrl.includes('/api/index.php')) {
        rootUrl = rootUrl.replace('/api/index.php', '');
    }
    rootUrl = rootUrl.replace(/\/$/, '');

    const customSyncUrl = `${rootUrl}/custom_sync.php`;

    console.log('='.repeat(60));
    console.log('Delta Sync API Test');
    console.log('='.repeat(60));
    console.log(`Dolibarr Root: ${rootUrl}`);
    console.log(`Custom Sync URL: ${customSyncUrl}`);
    console.log(`API Key: ${DOLIBARR_KEY.substring(0, 10)}...`);
    console.log('='.repeat(60));

    const httpsAgent = new https.Agent({ rejectUnauthorized: false });
    const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cookie': BYPASS_COOKIE,
        'DOLAPIKEY': DOLIBARR_KEY
    };

    for (const module of PROBLEM_MODULES) {
        console.log(`\nTesting: ${module}`);
        console.log('-'.repeat(40));

        try {
            const response = await axios.get(customSyncUrl, {
                headers,
                params: {
                    type: module,
                    last_modified: 0, // Get all
                    limit: 10, // Small limit for testing
                    DOLAPIKEY: DOLIBARR_KEY
                },
                httpsAgent,
                validateStatus: () => true // Accept all status codes
            });

            console.log(`Status: ${response.status}`);

            if (response.status === 200) {
                const data = response.data;

                if (data.error) {
                    console.log(`❌ ERROR: ${JSON.stringify(data.error)}`);
                } else if (data.data && Array.isArray(data.data)) {
                    console.log(`✅ Records: ${data.data.length}`);
                    if (data.data.length > 0) {
                        console.log(`   Sample: ${JSON.stringify(data.data[0], null, 2).substring(0, 200)}...`);
                    }
                    console.log(`   Pagination: offset=${data.pagination?.offset}, count=${data.pagination?.count}, has_more=${data.pagination?.has_more}`);
                } else if (Array.isArray(data)) {
                    console.log(`✅ Records (old format): ${data.length}`);
                    if (data.length > 0) {
                        console.log(`   Sample: ${JSON.stringify(data[0], null, 2).substring(0, 200)}...`);
                    }
                } else {
                    console.log(`⚠️ Unknown response format: ${JSON.stringify(data).substring(0, 200)}`);
                }
            } else {
                console.log(`❌ HTTP Error: ${response.status}`);
                console.log(`   Response: ${JSON.stringify(response.data).substring(0, 300)}`);
            }
        } catch (error: any) {
            console.log(`❌ Request Failed: ${error.message}`);
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log('Test Complete');
    console.log('='.repeat(60));
}

testDeltaSync().catch(console.error);
