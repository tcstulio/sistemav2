
const axios = require('axios');
const path = require('path');
const dotenv = require('dotenv');

// Load env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DOLIBARR_URL = process.env.DOLIBARR_URL || 'https://sistema.coolgroove.com.br/api/index.php';
const API_KEY = process.env.DOLIBARR_API_KEY;

if (!API_KEY) {
    console.error('Missing DOLIBARR_API_KEY in .env');
    process.exit(1);
}

const fetchTasks = async () => {
    console.log(`Fetching Tasks from ${DOLIBARR_URL}...`);

    const httpsAgent = new (require('https').Agent)({ rejectUnauthorized: false });
    const headers = {
        'User-Agent': 'DoliDebug/1.0',
        'DOLAPIKEY': API_KEY,
        'Accept': 'application/json'
    };

    try {
        // Fetch 5 tasks
        const url = `${DOLIBARR_URL}/tasks?limit=5&sortfield=t.rowid&sortorder=DESC`;
        const response = await axios.get(url, { headers, httpsAgent });

        if (Array.isArray(response.data) && response.data.length > 0) {
            console.log(`Fetched ${response.data.length} tasks.`);

            // DUMP DATA FOR USER
            console.log('\n--- DUMPING LATEST 3 TASKS FOR INSPECTION ---');
            const dumpCount = Math.min(3, response.data.length);
            for (let i = 0; i < dumpCount; i++) {
                console.log(`\n\n=== TASK #${i + 1} (ID: ${response.data[i].id}) ===`);
                console.log(JSON.stringify(response.data[i], null, 2));
            }

        } else {
            console.log('No tasks found.');
        }

    } catch (e) {
        console.error('General Error:', e.message);
    }
};

fetchTasks();
