import axios from 'axios';
import fs from 'fs';
import path from 'path';

const API_KEY = process.argv[2] || process.env.DOLAPIKEY;
// Default to the likely local URL, can be overridden by 2nd arg
const BASE_URL = process.argv[3] || 'http://localhost/dolibarr/custom_sync.php';

if (!API_KEY) {
    console.error("Usage: node analyze_data_links.js <API_KEY> [BASE_URL]");
    console.log("Example: node analyze_data_links.js your_api_key http://localhost/dolibarr/custom_sync.php");
    process.exit(1);
}

const TYPES = [
    'thirdparties', 'proposals', 'orders', 'invoices', 'contracts',
    'products', 'tickets', 'projects', 'tasks', 'contacts',
    'users', 'proposal_lines', 'order_lines', 'invoice_lines', 'links'
];

const DATA = {};

async function fetchData(type) {
    console.log(`Fetching ${type}...`);
    let allData = [];
    let offset = 0;
    const limit = 1000;
    let hasMore = true;

    while (hasMore) {
        try {
            const url = `${BASE_URL}?type=${type}&last_modified=0&limit=${limit}&offset=${offset}&DOLAPIKEY=${API_KEY}`;
            const response = await axios.get(url);

            if (response.data && response.data.data) {
                const batch = response.data.data;
                allData = allData.concat(batch);
                console.log(`  Fetched ${batch.length} records (Total: ${allData.length})`);

                if (batch.length < limit) {
                    hasMore = false;
                } else {
                    offset += limit;
                }
            } else {
                console.warn(`  No data returned for ${type} or invalid format.`);
                hasMore = false;
            }
        } catch (error) {
            console.error(`  Error fetching ${type}:`, error.response ? error.response.status : error.message);
            // Don't break completely, just stop this type
            hasMore = false;
        }
    }

    DATA[type] = allData;
    // Save backup
    fs.mkdirSync('dump', { recursive: true });
    fs.writeFileSync(`dump/${type}.json`, JSON.stringify(allData, null, 2));
}

function analyzeLinks() {
    console.log("\nAnalyzing Links...");
    const report = [];
    report.push("# Data Link Analysis Report");
    report.push(`Generated at: ${new Date().toISOString()}`);
    report.push("");

    // Helper to check ID existence
    const checkId = (id, type, context) => {
        if (!id) return; // Null is allowed for some fields
        const exists = DATA[type].find(item => item.id == id || item.rowid == id);
        if (!exists) {
            return `Missing ${type} ID: ${id} in ${context}`;
        }
    };

    // 1. Check Projects Linking
    report.push("## 1. Project Linking");
    const projectTypes = ['proposals', 'orders', 'invoices'];
    projectTypes.forEach(type => {
        let missingCount = 0;
        let totalCount = DATA[type] ? DATA[type].length : 0;
        DATA[type]?.forEach(item => {
            if (item.project_id && item.project_id !== '0') {
                // Check if project exists
                const err = checkId(item.project_id, 'projects', `${type} (Ref: ${item.ref})`);
                if (err) missingCount++;
            }
        });
        report.push(`- **${type}**: ${totalCount} records.`);
        if (missingCount > 0) {
            report.push(`  - ⚠️  ${missingCount} records point to non-existent Projects.`);
        } else {
            report.push(`  - ✅ All project links valid (where set).`);
        }
    });

    // 2. Check Line Items Orphaned
    report.push("\n## 2. Line Items Integrity");
    const lineTypes = [
        { lines: 'proposal_lines', parent: 'proposals', fk: 'parent_id' },
        { lines: 'order_lines', parent: 'orders', fk: 'parent_id' },
        { lines: 'invoice_lines', parent: 'invoices', fk: 'parent_id' }
    ];

    lineTypes.forEach(def => {
        let orphans = 0;
        let total = DATA[def.lines] ? DATA[def.lines].length : 0;
        DATA[def.lines]?.forEach(line => {
            const parentExists = DATA[def.parent].find(p => p.id == line[def.fk]);
            if (!parentExists) orphans++;
        });
        report.push(`- **${def.lines}**: ${total} lines.`);
        if (orphans > 0) {
            report.push(`  - ⚠️  ${orphans} orphaned lines (parent not found).`);
        } else {
            report.push(`  - ✅ All lines attached to valid parents.`);
        }
    });

    // 3. User Linking (Authors)
    report.push("\n## 3. User Linking (Authors)");
    const userFields = ['fk_user_author', 'fk_user_creat', 'fk_user_assign'];
    let userErrors = 0;
    // Iterate all types
    Object.keys(DATA).forEach(type => {
        if (type.includes('_lines') || type === 'links') return;

        DATA[type]?.forEach(item => {
            userFields.forEach(field => {
                if (item[field] && item[field] !== '0') {
                    const err = checkId(item[field], 'users', `${type}.${field}`);
                    if (err) userErrors++;
                }
            });
        });
    });
    if (userErrors > 0) report.push(`- ⚠️  ${userErrors} references to non-existent Users found across all types.`);
    else report.push("- ✅ All user references valid.");

    // 4. Element-Element Links Analysis
    report.push("\n## 4. Document Flow (Links)");
    const links = DATA['links'] || [];
    report.push(`Total Links found: ${links.length}`);

    // Sample flow check: Proposal -> Order
    let propToOrder = 0;
    let orderToInvoice = 0;

    links.forEach(link => {
        if (link.sourcetype === 'propal' && link.targettype === 'commande') propToOrder++;
        if (link.sourcetype === 'commande' && link.targettype === 'facture') orderToInvoice++;
    });

    report.push(`- Quote -> Order links: ${propToOrder}`);
    report.push(`- Order -> Invoice links: ${orderToInvoice}`);

    fs.writeFileSync('link_analysis_report.md', report.join('\n'));
    console.log("\nReport saved to link_analysis_report.md");
}

async function main() {
    for (const type of TYPES) {
        await fetchData(type);
    }
    analyzeLinks();
}

main().catch(console.error);
