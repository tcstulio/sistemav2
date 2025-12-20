
import { dolibarrService } from '../services/dolibarrService';
import fs from 'fs';
import path from 'path';

// Use the key found in .env
const API_KEY = '26ecc09039bd0bfeb52b11003449a2deb4770482';

const main = async () => {
    try {
        console.log("Fetching user...");
        const user = await dolibarrService.getUserByKey(API_KEY);
        console.log("User fetched:", user ? user.login : 'NULL');

        const dumpPath = path.resolve(__dirname, '../../debug_user.json');
        fs.writeFileSync(dumpPath, JSON.stringify(user, null, 2));
        console.log(`User dumped to ${dumpPath}`);

    } catch (e: any) {
        console.error("Error:", e.message);
    }
};

main();
