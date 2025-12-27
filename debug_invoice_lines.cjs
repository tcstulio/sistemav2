
const axios = require('axios');
const path = require('path');
const fs = require('fs');

console.log("🚀 Iniciando Script de Debug...");

// Manually read .env or .env.local because dotenv might be flaky or names might differ
const envPath = fs.existsSync('.env.local') ? '.env.local' : (fs.existsSync('.env') ? '.env' : null);

let API_URL = "https://sistema.coolgroove.com.br/api/index.php";
let API_KEY = "26ecc09039bd0bfeb52b11003449a2deb4770482";

if (envPath) {
    console.log(`📂 Lendo arquivo de ambiente: ${envPath}`);
    try {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const lines = envContent.split(/\r?\n/);

        lines.forEach(line => {
            line = line.trim();
            if (!line || line.startsWith('#')) return;

            const idx = line.indexOf('=');
            if (idx === -1) return;

            const key = line.substring(0, idx).trim();
            let val = line.substring(idx + 1).trim();

            // Remove quotes
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                val = val.substring(1, val.length - 1);
            }

            console.log(`   🔑 Chave encontrada: ${key}`);

            if (key.includes('URL') && key.includes('DOLIBARR') && !API_URL) API_URL = val;
            if ((key.includes('KEY') || key.includes('TOKEN')) && key.includes('DOLIBARR') && !API_KEY) API_KEY = val;
        });
    } catch (e) {
        console.error("Erro ao ler arquivo .env:", e.message);
    }
} else {
    console.warn("⚠️ Nenhum arquivo .env encontrado.");
}

if (!API_URL || !API_KEY) {
    console.error("\n❌ ERRO CRÍTICO: Credenciais não encontradas.");
    console.log("Variáveis detectadas:");
    console.log("   URL:", API_URL || "NÃO ENCONTRADA");
    console.log("   KEY:", API_KEY ? "ENCONTRADA (Oculta)" : "NÃO ENCONTRADA");
    process.exit(1);
}

// Derive Root URL for custom_sync.php
let ROOT_URL = API_URL;
if (ROOT_URL.includes('/api/index.php')) {
    ROOT_URL = ROOT_URL.replace(/\/api\/index\.php\/?$/, '');
}
if (ROOT_URL.endsWith('/')) ROOT_URL = ROOT_URL.slice(0, -1);

const CUSTOM_SYNC_URL = `${ROOT_URL}/custom_sync.php`;

console.log(`\n⚙️  Configuração Final:`);
console.log(`   API URL: ${API_URL}`);
console.log(`   Custom Sync URL: ${CUSTOM_SYNC_URL}`);
console.log(`   API Key: ${API_KEY ? API_KEY.substring(0, 4) + '...' : 'N/A'}`);

async function runDebug() {
    try {
        console.log(`\n1️⃣  Testando Custom Sync (supplier_invoice_lines)...`);
        const syncUrl = `${CUSTOM_SYNC_URL}?type=supplier_invoice_lines&limit=5&DOLAPIKEY=${API_KEY}`;
        console.log(`   GET ${syncUrl}`);

        const syncRes = await axios.get(syncUrl);
        const syncData = syncRes.data;

        if (syncData.data && syncData.data.length > 0) {
            console.log(`   ✅ Sucesso! Retornou ${syncData.data.length} linhas.`);
            console.log(`   Exemplo de linha (Custom Sync):`);
            console.log(JSON.stringify(syncData.data[0], null, 2));

            // Get a parent ID to compare
            const parentId = syncData.data[0].parent_id;
            // Note: in recent changes we aliased fk_facture_fourn as parent_id in custom_sync.

            if (parentId) {
                console.log(`   \n👉 Usando Parent ID (Invoice ID) ${parentId} para comparação com API padrão...`);
                await checkAskApi(parentId);
            } else {
                console.warn("   ⚠️ Linha não possui 'parent_id'. Verifique a query SQL no custom_sync.php");
            }
        } else {
            console.warn(`   ⚠️  Custom Sync retornou vazio ou sem dados.`);
            console.log(`   Resposta:`, JSON.stringify(syncData, null, 2));

            console.log(`   \n👉 Tentando buscar qualquer fatura na API para teste...`);
            await checkAskApi(null);
        }

    } catch (error) {
        console.error(`   ❌ Falha no Custom Sync:`, error.message);
        if (error.response) {
            console.log(`   Status:`, error.response.status);
            // console.log(`   Data:`, error.response.data);
        }
        console.log(`   \n👉 Prosseguindo para teste da API Standard para validar a chave...`);
        await checkAskApi(null);
    }
}

async function checkAskApi(invoiceId) {
    try {
        let targetId = invoiceId;

        // If no ID provided, fetch latest supplier invoice
        if (!targetId) {
            console.log(`\n2️⃣  Buscando última fatura de fornecedor na API Standard...`);
            const listUrl = `${API_URL}/supplierinvoices?sortfield=t.rowid&sortorder=DESC&limit=1`;
            const listRes = await axios.get(listUrl, { headers: { 'DOLAPIKEY': API_KEY } });

            if (listRes.data && listRes.data.length > 0) {
                targetId = listRes.data[0].id;
                console.log(`   Encontrada Fatura ID: ${targetId} (Ref: ${listRes.data[0].ref})`);
            } else {
                console.error(`   ❌ Nenhuma fatura encontrada na API Standard.`);
                return;
            }
        }

        console.log(`\n3️⃣  Buscando detalhes da Fatura ID ${targetId} na API Standard...`);
        const detailUrl = `${API_URL}/supplierinvoices/${targetId}`;
        const detailRes = await axios.get(detailUrl, { headers: { 'DOLAPIKEY': API_KEY } });

        const invoice = detailRes.data;
        console.log(`   ✅ Fatura recuperada: ${invoice.ref}`);

        if (invoice.lines && invoice.lines.length > 0) {
            console.log(`   ✅ API Standard retornou ${invoice.lines.length} linhas.`);
            console.log(`   Exemplo de linha (API Standard):`);
            // Show only relevant fields for comparison
            const line = invoice.lines[0];
            const simplified = {
                id: line.id,
                fk_facture_fourn: line.fk_facture_fourn || line.fk_facture,
                description: line.description || line.desc,
                qty: line.qty,
                total_ttc: line.total_ttc,
                product_id: line.fk_product
            };
            console.log(JSON.stringify(simplified, null, 2));
        } else {
            console.warn(`   ⚠️  API Standard retornou fatura SEM linhas (array vazio ou inexistente).`);
            console.log(`   Campo 'lines' raw:`, invoice.lines);
        }

    } catch (error) {
        console.error(`   ❌ Falha na API Standard:`, error.message);
        if (error.response) {
            console.log("   Status:", error.response.status);
        }
    }
}

runDebug();
