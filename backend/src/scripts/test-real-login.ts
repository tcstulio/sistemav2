
import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';

// Load env from backend root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DOLIBARR_URL = process.env.DOLIBARR_URL || 'https://sistema.coolgroove.com.br/api/index.php';
// We need a clear password to test. Since we can't hardcode it, we'll ask for it via args or use a dummy one to fail.
const LOGIN = process.argv[2];
const PASSWORD = process.argv[3];

if (!LOGIN || !PASSWORD) {
    console.error('Usage: npx ts-node src/scripts/test-real-login.ts <login> <password>');
    process.exit(1);
}

const testLogin = async () => {
    console.log(`Testing Login for user: ${LOGIN} at ${DOLIBARR_URL}`);

    const httpsAgent = new (require('https').Agent)({ rejectUnauthorized: false });
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Cookie': 'humans_21909=1', // Bypass challenge
        'Accept': 'application/json'
    };

    try {
        // Method 1: GET /login (Common in older Dolibarr versions or specific configs)
        // Note: Sending password in query param is insecure but seemingly how "loginLoginUnsecured" works in some versions? 
        // Let's check the Types definition we saw earlier: "loginLoginUnsecured" -> GET /login?login=...&password=...

        console.log('--- Attempt 1: GET /login (Unsecured) ---');
        try {
            const url = `${DOLIBARR_URL}/login?login=${encodeURIComponent(LOGIN)}&password=${encodeURIComponent(PASSWORD)}`;
            const response = await axios.get(url, {
                headers,
                httpsAgent,
                validateStatus: () => true // Don't throw
            });
            console.log(`Status: ${response.status}`);
            console.log('Data:', response.data);

            if (response.status === 200 && response.data.success) {
                console.log('SUCCESS! Token:', response.data.success.token);
                return;
            }
        } catch (e: any) {
            console.log('Error:', e.message);
        }

        // Method 2: POST /login (More standard REST)
        console.log('\n--- Attempt 2: POST /login ---');
        try {
            const url = `${DOLIBARR_URL}/login`;
            const response = await axios.post(url, {
                login: LOGIN,
                password: PASSWORD
            }, {
                headers: { ...headers, 'Content-Type': 'application/json' },
                httpsAgent,
                validateStatus: () => true
            });
            console.log(`Status: ${response.status}`);
            console.log('Data:', response.data);
            if (response.status === 200 && response.data.success) {
                 console.log('SUCCESS! Token:', response.data.success.token);
            }
        } catch (e: any) {
            console.log('Error:', e.message);
        }

    } catch (error: any) {
        console.error('Fatal Error:', error.message);
    }
};

testLogin();
