
import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';

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
        'Cookie': process.env.DOLIBARR_BYPASS_COOKIE || 'humans_21909=1',
        'Accept': 'application/json'
    };

    try {
        const url = `${DOLIBARR_URL}/tasks?limit=5&sortfield=t.rowid&sortorder=DESC`;
        const response = await axios.get(url, { headers, httpsAgent });

        console.log(`Status: ${response.status}`);
        if (Array.isArray(response.data) && response.data.length > 0) {
            console.log('Successfully fetched tasks. Inspecting first item for assignment fields:');
            const sample = response.data[0];

            // Log specific interesting fields
            console.log('ID:', sample.id);
            console.log('Ref:', sample.ref);
            console.log('Label:', sample.label);
            console.log('fk_user_assign:', sample.fk_user_assign);
            console.log('user_assigned:', sample.user_assigned);
            console.log('fk_user_check:', sample.fk_user_check);

            // Log contacts if present (sometimes in linked objects)
            console.log('contacts keys:', sample.contacts ? Object.keys(sample.contacts) : 'None');

            console.log('\n--- FULL RAW OBJECT ---');
            console.log(JSON.stringify(sample, null, 2));
        } else {
            console.log('No tasks found or empty array.');
            console.log('Data:', response.data);
        }

    } catch (e: any) {
        console.error('Error fetching tasks:', e.message);
        if (e.response) {
            console.error('Response Status:', e.response.status);
            console.error('Response Data:', e.response.data);
        }
    }
};

fetchTasks();
