import axios from 'axios';

// CONFIGURATION - EDIT THESE VALUES
const DOLIBARR_URL = 'https://sistema.coolgroove.com.br'; // Retrieved from .env (API_URL root)
const API_KEY = '26ecc09039bd0bfeb52b11003449a2deb4770482'; // Retrieved from .env
const CUSTOM_SYNC_PATH = '/custom_sync.php'; // Path to the script relative to DOLIBARR_URL root

async function testSync(type) {
    console.log(`\n--- Testing Sync for: ${type} ---`);
    const url = `${DOLIBARR_URL}${CUSTOM_SYNC_PATH}`;

    try {
        console.log(`Requesting: ${url}?type=${type}&last_modified=0`);
        const response = await axios.get(url, {
            params: {
                type: type,
                last_modified: 0,
                limit: 5,
                DOLAPIKEY: API_KEY
            },
            headers: {
                'DOLAPIKEY': API_KEY
            }
        });

        console.log(`Status: ${response.status} ${response.statusText}`);

        if (response.data && response.data.data) {
            console.log(`Success! Received ${response.data.data.length} items.`);
            if (response.data.data.length > 0) {
                console.log('Sample Item:', JSON.stringify(response.data.data[0], null, 2));
            } else {
                console.log('Response data is empty array.');
            }
        } else {
            console.log('Response format unexpected:', response.data);
        }

    } catch (error) {
        if (error.response) {
            console.error(`ERROR ${error.response.status}:`, error.response.statusText);
            console.error('Data:', error.response.data);
        } else if (error.request) {
            console.error('ERROR: No response received.');
            console.error(error.message);
        } else {
            console.error('ERROR:', error.message);
        }
    }
}

async function run() {
    if (API_KEY === 'YOUR_API_KEY') {
        console.error('⚠️  PLEASE EDIT THIS SCRIPT AND SET YOUR API_KEY AND DOLIBARR_URL ⚠️');
        process.exit(1);
    }

    await testSync('tasks');
    await testSync('events');
}

run();
