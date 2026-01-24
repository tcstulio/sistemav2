/**
 * Script to fetch and dump Partnerships data from Dolibarr API
 * Run with: npx ts-node scripts/test_partnerships.ts
 */

import axios from 'axios';
import https from 'https';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config();

const baseUrl = process.env.DOLIBARR_URL || 'https://sistema.coolgroove.com.br/api/index.php';
const apiKey = process.env.DOLIBARR_API_KEY || '';
const bypassCookie = process.env.DOLIBARR_BYPASS_COOKIE || 'humans_21909=1';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function fetchPartnerships() {
    const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const url = `${cleanBaseUrl}partnerships/partnerships`;

    const headers: Record<string, string> = {
        'DOLAPIKEY': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cookie': bypassCookie
    };

    console.log('🔍 Fetching partnerships from:', url);
    console.log('📝 Using API Key:', apiKey.substring(0, 8) + '...');

    try {
        const response = await axios.get(url, {
            headers,
            params: { limit: 100, DOLAPIKEY: apiKey },
            httpsAgent
        });

        console.log('✅ Success! Status:', response.status);
        console.log('📊 Total partnerships:', Array.isArray(response.data) ? response.data.length : 1);

        // Dump to file
        const dumpPath = '../dump/partnerships.json';
        fs.writeFileSync(dumpPath, JSON.stringify(response.data, null, 2));
        console.log('💾 Data saved to:', dumpPath);

        // Show structure of first item
        if (Array.isArray(response.data) && response.data.length > 0) {
            const first = response.data[0];
            console.log('\n📋 First partnership structure:');
            console.log('Keys:', Object.keys(first));

            console.log('\n📌 Basic fields:');
            ['id', 'ref', 'label', 'fk_soc', 'fk_member', 'status', 'date_partnership_start', 'date_partnership_end'].forEach(key => {
                if (first[key] !== undefined) console.log(`  ${key}:`, first[key]);
            });

            console.log('\n🔧 Extra fields (array_options):');
            if (first.array_options) {
                Object.entries(first.array_options).forEach(([key, value]) => {
                    console.log(`  ${key}:`, value);
                });
            } else {
                console.log('  (nenhum campo extra encontrado)');
            }
        }

        return response.data;
    } catch (error: any) {
        console.error('❌ Error fetching partnerships:');
        if (axios.isAxiosError(error)) {
            console.error('  Status:', error.response?.status);
            console.error('  Message:', error.response?.data || error.message);
        } else {
            console.error('  ', error.message);
        }
        return null;
    }
}

// Run
fetchPartnerships().then(() => {
    console.log('\n✨ Done!');
}).catch(err => {
    console.error('Fatal error:', err);
});
