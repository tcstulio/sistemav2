
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

const baseUrl = cleanUrl(API_URL); // Keep index.php

// HTTPS Agent to ignore SSL errors (like curl -k)
const agent = new https.Agent({
    rejectUnauthorized: false
});

const headers = {
    'DOLAPIKEY': API_KEY,
    'Cookie': BYPASS_COOKIE,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

async function verifyRights() {
    console.log(`Testing API: ${baseUrl}`);
    console.log(`Using Key: ${API_KEY!.substring(0, 5)}...`);
    console.log(`Using Cookie: ${BYPASS_COOKIE}`);

    try {
        // 1. Get User ID (List)
        console.log('\n--- Step 1: Get User ID ---');
        // Note: Some servers might block /users without ID if lists are restricted, but we'll see.
        const listResponse = await axios.get(`${baseUrl}/users`, {
            headers: headers,
            params: { limit: 1 },
            httpsAgent: agent
        });

        if (!listResponse.data || listResponse.data.length === 0) {
            console.error("No users found.");
            return;
        }

        const userId = listResponse.data[0].id;
        const login = listResponse.data[0].login;
        console.log(`Found User: ${login} (ID: ${userId})`);

        // 2. Fetch User WITHOUT includepermissions
        console.log('\n--- Step 2: Fetch /users/:id (Default) ---');
        const userDefault = await axios.get(`${baseUrl}/users/${userId}`, {
            headers: headers,
            httpsAgent: agent
        });

        const rightsDef = userDefault.data.rights;
        const hasRightsDefault = !!rightsDef; // Sometimes it's undefined, sometimes empty object/array

        console.log(`Rights present in default response? ${hasRightsDefault ? 'YES' : 'NO'}`);
        if (hasRightsDefault) {
            console.log("Type of rights:", typeof rightsDef);
            console.log("Rights keys:", Object.keys(rightsDef).slice(0, 3));
        }

        // 3. Fetch User WITH includepermissions=1
        console.log('\n--- Step 3: Fetch /users/:id?includepermissions=1 ---');
        const userWithPerms = await axios.get(`${baseUrl}/users/${userId}`, {
            headers: headers,
            params: { includepermissions: 1 },
            httpsAgent: agent
        });

        const rightsPerms = userWithPerms.data.rights;
        const hasRightsWithParam = !!rightsPerms;
        console.log(`Rights present with includepermissions=1? ${hasRightsWithParam ? 'YES' : 'NO'}`);
        if (hasRightsWithParam) {
            console.log("Type of rights:", typeof rightsPerms);
            console.log("Rights keys:", Object.keys(rightsPerms).slice(0, 5));
            // Deep inspect one
            const firstKey = Object.keys(rightsPerms)[0];
            if (firstKey) {
                console.log(`Ex of right (${firstKey}):`, JSON.stringify(rightsPerms[firstKey], null, 2));
            }
        }

    } catch (error: any) {
        console.error("Error:", error.message);
        if (error.response) {
            console.error("Status:", error.response.status);
            console.error("Data:", JSON.stringify(error.response.data).substring(0, 200));
        }
    }
}

verifyRights();
