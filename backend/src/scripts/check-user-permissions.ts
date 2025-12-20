
import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DOLIBARR_URL = process.env.DOLIBARR_URL || 'https://sistema.coolgroove.com.br/api/index.php';
// We need a real user to test permissions, forcing manual input or args
const LOGIN = process.argv[2];
const PASSWORD = process.argv[3];

if (!LOGIN || !PASSWORD) {
    console.error("Usage: ts-node check-user-permissions.ts <login> <password>");
    process.exit(1);
}

async function checkPermissions() {
    console.log(`Checking permissions for user: ${LOGIN} at ${DOLIBARR_URL}`);

    try {
        // 1. Login to get Token/Key and User ID
        const loginUrl = `${DOLIBARR_URL}/login?login=${encodeURIComponent(LOGIN)}&password=${encodeURIComponent(PASSWORD)}`;
        console.log(`Logging in...`);

        // Add Cookie to bypass security challenge
        const headers = {
            'Cookie': process.env.DOLIBARR_BYPASS_COOKIE || 'humans_21909=1',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };

        const loginRes = await axios.get(loginUrl, { headers });

        if (loginRes.status !== 200 || !loginRes.data.success) {
            console.error("Login Failed:", loginRes.data);
            return;
        }

        const apiKey = loginRes.data.success.token;
        console.log("Login Successful. API Key acquired.");

        // 2. Fetch User Details to get Rights
        // We need to find the user ID first. simpler to search by login.
        console.log("Fetching User Details...");
        const usersUrl = `${DOLIBARR_URL}/users?sqlfilters=(t.login:=:'${LOGIN}')`;
        const usersRes = await axios.get(usersUrl, {
            headers: { 'DOLAPIKEY': apiKey }
        });

        if (!usersRes.data || usersRes.data.length === 0) {
            console.error("Could not find user details.");
            return;
        }

        const user = usersRes.data[0];
        console.log(`User Found: ID ${user.id} (${user.firstname} ${user.lastname})`);
        console.log("Admin Status:", user.admin);

        // 3. Inspect Rights (Note: /users/{id} usually returns 'rights' object if details are full)
        // If the list didn't return rights, fetch specific ID
        const fullUserUrl = `${DOLIBARR_URL}/users/${user.id}`;
        const fullUserRes = await axios.get(fullUserUrl, {
            headers: { 'DOLAPIKEY': apiKey }
        });

        const fullUser = fullUserRes.data;

        console.log("\n=== USER RIGHTS STRUCTURE ===");
        // Pretty print the rights object
        console.log(JSON.stringify(fullUser.rights, null, 2));

        console.log("\n=== ANALYSIS ===");
        if (!fullUser.rights) {
            console.warn("WARNING: No 'rights' object found in user response!");
        } else {
            console.log("Rights object present.");
            // Check common modules
            const check = (mod: string, perm: string) => {
                const has = fullUser.rights[mod] && fullUser.rights[mod][perm];
                console.log(`- ${mod}.${perm}: ${has ? 'YES (' + has + ')' : 'NO'}`);
            };

            check('societe', 'read');
            check('facture', 'read');
            check('projet', 'read');
            check('service', 'read');
        }

    } catch (error: any) {
        console.error("Error:", error.message);
        if (error.response) {
            console.error("Response Data:", error.response.data);
        }
    }
}

checkPermissions();
