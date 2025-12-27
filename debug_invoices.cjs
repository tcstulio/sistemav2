
const axios = require('axios');
const fs = require('fs');

console.log("🚀 Iniciando Script de Debug (Faturas)...");

// Hardcoded for speed as per previous success
let API_URL = "https://sistema.coolgroove.com.br/api/index.php";
let API_KEY = "26ecc09039bd0bfeb52b11003449a2deb4770482";
const CUSTOM_SYNC_URL = "https://sistema.coolgroove.com.br/custom_sync.php";

async function runDebug() {
    try {
        console.log(`\n1️⃣  Testando Custom Sync (supplier_invoices)...`);
        const syncUrl = `${CUSTOM_SYNC_URL}?type=supplier_invoices&limit=5&DOLAPIKEY=${API_KEY}`;
        console.log(`   GET ${syncUrl}`);

        const syncRes = await axios.get(syncUrl);
        const syncData = syncRes.data;

        if (syncData.data && syncData.data.length > 0) {
            console.log(`   ✅ Sucesso! Retornou ${syncData.data.length} faturas.`);
            console.log(`   Exemplo de fatura:`);
            console.log(JSON.stringify(syncData.data[0], null, 2));
        } else {
            console.warn(`   ⚠️  Custom Sync retornou vazio ou erro.`);
            console.log(`   Resposta:`, JSON.stringify(syncData, null, 2));
        }

    } catch (error) {
        console.error(`   ❌ Falha no Custom Sync:`, error.message);
        if (error.response) {
            console.log(`   Status:`, error.response.status);
            console.log(`   Data:`, JSON.stringify(error.response.data, null, 2));
        }
    }
}

runDebug();
