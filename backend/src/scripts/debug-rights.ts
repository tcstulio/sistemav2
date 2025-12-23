
import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DOLIBARR_URL = process.env.DOLIBARR_URL;
const API_KEY = process.env.DOLIBARR_API_KEY;

if (!DOLIBARR_URL || !API_KEY) {
    console.error("Missing DOLIBARR_URL or DOLIBARR_API_KEY in .env");
    process.exit(1);
}

async function debugRights() {
    console.log(`Checking rights using API Key: ${API_KEY!.substring(0, 5)}...`);

    try {
        // 1. Get My User (or List Users to find one)
        // Note: /users/myself doesn't always exist in older Dolibarr, but let's try listing users.
        console.log("Fetching Users...");
        const usersRes = await axios.get(`${DOLIBARR_URL}/users?limit=1`, {
            headers: {
                'DOLAPIKEY': API_KEY
            }
        });

        if (!usersRes.data || usersRes.data.length === 0) {
            console.error("No users found.");
            return;
        }

        const minimalUser = usersRes.data[0];
        console.log(`Found User: ${minimalUser.login} (ID: ${minimalUser.id})`);

        // 2. Get Full Details
        console.log(`Fetching full details for user ${minimalUser.id}...`);
        const fullUserRes = await axios.get(`${DOLIBARR_URL}/users/${minimalUser.id}`, {
            headers: {
                'DOLAPIKEY': API_KEY
            }
        });

        const fullUser = fullUserRes.data;

        console.log("\n=== RIGHTS STRUCTURE ===");
        if (fullUser.rights) {
            console.log(JSON.stringify(fullUser.rights, null, 2));

            // Check nesting depth
            const keys = Object.keys(fullUser.rights);
            if (keys.length > 0) {
                const firstKey = keys[0];
                const firstVal = fullUser.rights[firstKey];
                console.log(`\nSample Key: ${firstKey}`);
                console.log(`Sample Value Type: ${typeof firstVal}`);
                console.log(`Sample Value:`, firstVal);
            }
        } else {
            console.warn("No 'rights' property on user object.");
        }

        console.log("\n=== USER OBJECT KEYS ===");
        console.log(Object.keys(fullUser));

    } catch (e: any) {
        console.error("Error:", e.message);
        if (e.response) console.error("Data:", e.response.data);
    }
}

debugRights();
