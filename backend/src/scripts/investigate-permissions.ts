
import axios from 'axios';
import * as dotenv from 'dotenv';
import path from 'path';
import https from 'https';

// Load .env from backend root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const API_URL = process.env.DOLIBARR_URL;
const API_KEY = process.env.DOLIBARR_API_KEY;
const BYPASS_COOKIE = process.env.DOLIBARR_BYPASS_COOKIE || 'humans_21909=1';

if (!API_URL || !API_KEY) {
    console.error("Missing DOLIBARR_URL or DOLIBARR_API_KEY in .env");
    process.exit(1);
}

// Helper to clean URL
const cleanUrl = (url: string) => {
    return url.endsWith('/') ? url.slice(0, -1) : url;
}

const baseUrl = cleanUrl(API_URL);

// HTTPS Agent to ignore SSL errors
const agent = new https.Agent({
    rejectUnauthorized: false
});

const headers = {
    'DOLAPIKEY': API_KEY,
    'Cookie': BYPASS_COOKIE
};

async function investigate() {
    console.log(`Target: ${baseUrl}`);
    
    try {
        // 1. Fetch Setup Modules
        console.log('\n--- Fetching Setup Modules ---');
        try {
            const modulesResp = await axios.get(`${baseUrl}/setup/modules`, {
                headers,
                httpsAgent: agent
            });
            console.log("Status:", modulesResp.status);
            console.log("Is Array?", Array.isArray(modulesResp.data));
            if (Array.isArray(modulesResp.data)) {
                console.log("Count:", modulesResp.data.length);
                const sample = modulesResp.data.slice(0, 5).map(m => ({ name: m.name, active: m.active }));
                console.log("Sample (first 5):", sample);
                
                // Check for specific modules mentioned in Sidebar
                const relevant = ['propale', 'commande', 'facture', 'projet', 'banque', 'ficheinter', 'recruitment', 'holiday', 'contrat', 'mrp', 'expedition', 'ticket', 'agenda', 'societe', 'fournisseur', 'product', 'service'];
                
                console.log("\nChecking relevant modules in Sidebar:");
                relevant.forEach(r => {
                    const found = modulesResp.data.find((m: any) => m.name.toLowerCase() === r.toLowerCase());
                    if (found) {
                        console.log(`- ${r}: Found (Name: ${found.name}, Active: ${found.active})`);
                    } else {
                        console.warn(`- ${r}: NOT FOUND`);
                    }
                });
            }
        } catch (e: any) {
            console.error("Failed to fetch modules:", e.message);
            if (e.response) console.error("Response:", e.response.status, e.response.data);
        }

        // 2. Fetch User Permissions (Sanity Check)
        console.log('\n--- Fetching User Permissions (Admin/Env Key) ---');
        try {
            const listRef = await axios.get(`${baseUrl}/users?limit=1`, { headers, httpsAgent: agent });
            if (listRef.data && listRef.data.length > 0) {
                const uid = listRef.data[0].id;
                console.log(`Checking User ID: ${uid}`);
                const fullUser = await axios.get(`${baseUrl}/users/${uid}?includepermissions=1`, { headers, httpsAgent: agent });
                if (fullUser.data.rights) {
                     console.log("Rights object keys:", Object.keys(fullUser.data.rights));
                } else {
                    console.log("No rights object found!");
                }
            }
        } catch (e: any) {
             console.error("User fetch failed:", e.message);
        }

    } catch (e) {
        console.error("Fatal:", e);
    }
}

investigate();
