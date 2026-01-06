const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const fs = require('fs');

const API_KEY = process.argv[2] || '26ecc09039bd0bfeb52b11003449a2deb4770482';
const BASE_URL = process.argv[3] || 'https://sistema.coolgroove.com.br/custom_sync.php';
const DB_FILE = 'dolibarr_local.db';

if (fs.existsSync(DB_FILE)) {
    console.log(`Removing existing DB: ${DB_FILE}`);
    fs.unlinkSync(DB_FILE);
}

const db = new sqlite3.Database(DB_FILE);

const TYPES = [
    'thirdparties', 'suppliers', 'categories', 'contacts',
    'invoices', 'supplier_invoices', 'products', 'proposals',
    'orders', 'shipments', 'projects', 'tasks',
    'bank_accounts', 'bank_lines', 'events', 'users',
    'supplier_orders', 'interventions', 'expense_reports',
    'job_positions', 'tickets', 'warehouses', 'stock_movements',
    'candidates', 'leave_requests', 'contracts',
    'payments', 'supplier_payments', 'boms',
    'manufacturing_orders', 'system_logs',
    'proposal_lines', 'order_lines', 'invoice_lines', 'links',
    'payment_invoice_links', 'supplier_payment_invoice_links',
    'expense_report_payments', 'expense_report_payment_links',
    'vat_payments', 'salary_payments', 'social_contribution_payments',
    'loan_payments', 'various_payments'
];

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
                process.stdout.write(`.`); // progress dot

                if (batch.length < limit) {
                    hasMore = false;
                } else {
                    offset += limit;
                }
            } else {
                hasMore = false;
            }
        } catch (error) {
            console.error(`\nError fetching ${type}:`, error.message);
            hasMore = false;
        }
    }
    console.log(`\n  Fetched ${allData.length} records.`);
    return allData;
}

function createTable(type, sampleRecord) {
    return new Promise((resolve, reject) => {
        if (!sampleRecord) {
            console.log(`  Skipping table for ${type} (no data)`);
            resolve();
            return;
        }

        const cols = [];
        Object.keys(sampleRecord).forEach(key => {
            let colType = 'TEXT';
            const val = sampleRecord[key];
            if (typeof val === 'number') {
                colType = Number.isInteger(val) ? 'INTEGER' : 'REAL';
            }
            cols.push(`"${key}" ${colType}`);
        });

        const sql = `CREATE TABLE ${type} (${cols.join(', ')});`;
        db.run(sql, (err) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function insertData(type, data) {
    return new Promise((resolve, reject) => {
        if (!data || data.length === 0) {
            resolve();
            return;
        }

        const keys = Object.keys(data[0]);
        const placeholders = keys.map(() => '?').join(',');
        const sql = `INSERT INTO ${type} ("${keys.join('","')}") VALUES (${placeholders})`;

        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            const stmt = db.prepare(sql);

            data.forEach(row => {
                const values = keys.map(k => row[k]);
                stmt.run(values);
            });

            stmt.finalize();
            db.run("COMMIT", (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    });
}

async function main() {
    console.log("Starting Local Sync...");

    for (const type of TYPES) {
        const data = await fetchData(type);
        if (data.length > 0) {
            await createTable(type, data[0]);
            await insertData(type, data);
            console.log(`  Saved ${type} to DB.`);
        }
    }

    db.close();
    console.log("\nDone! Database saved to: " + DB_FILE);
}

main().catch(console.error);
