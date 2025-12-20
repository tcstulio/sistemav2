
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

const fetchTask = async (id) => {
    console.log(`Fetching Task ${id} from ${DOLIBARR_URL}...`);

    const httpsAgent = new (require('https').Agent)({ rejectUnauthorized: false });
    const headers = {
        'User-Agent': 'DoliDebug/1.0',
        'DOLAPIKEY': API_KEY,
        'Accept': 'application/json'
    };

    try {
        const url = `${DOLIBARR_URL}/tasks/${id}`;
        const response = await axios.get(url, { headers, httpsAgent });

        console.log(`\n=== TASK ${id} ===`);
        console.log(JSON.stringify(response.data, null, 2));

        // Check contacts/assignments specifically
        if (response.data.fk_user_creat) console.log(`\nCreator ID: ${response.data.fk_user_creat}`);
        if (response.data.fk_user_assign) console.log(`Assignee ID: ${response.data.fk_user_assign}`);

        console.log('\n--- Checking Contacts ---');
        try {
            const contactsUrl = `${DOLIBARR_URL}/tasks/${id}/contacts`;
            const contactsRes = await axios.get(contactsUrl, { headers, httpsAgent });
            console.log(JSON.stringify(contactsRes.data, null, 2));
        } catch (e) {
            console.log('Contacts fetch failed (likely 404):', e.message);
        }

    } catch (e) {
        console.error('Error fetching task:', e.message);
        if (e.response) {
            console.error('Status:', e.response.status);
            console.error('Data:', e.response.data);
        }
    }
};

fetchTask(627);
