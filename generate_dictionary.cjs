const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const db = new sqlite3.Database('dolibarr_local.db');
const outFile = 'data_dictionary.md';

const report = [];
report.push('# Data Dictionary & Correlation Analysis');
report.push(`Generated: ${new Date().toISOString()}`);
report.push('');

db.serialize(() => {
    db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", [], async (err, tables) => {
        if (err) return console.error(err);

        for (const t of tables) {
            await new Promise((resolve) => {
                db.all(`PRAGMA table_info(${t.name})`, [], (err, cols) => {
                    db.get(`SELECT count(*) as count FROM ${t.name}`, (err, row) => {
                        const count = row ? row.count : 0;

                        report.push(`## ${t.name} (${count} rows)`);

                        // Detect potential IDs and FKs
                        const pks = cols.filter(c => c.pk > 0 || c.name === 'id' || c.name === 'rowid').map(c => c.name);
                        const fks = cols.filter(c => c.name.startsWith('fk_') || c.name.endsWith('_id') || c.name === 'socid').map(c => c.name);

                        if (pks.length) report.push(`- **Primary Key**: \`${pks.join(', ')}\``);
                        if (fks.length) report.push(`- **Potential Links**: \`${fks.join(', ')}\``);

                        report.push('| Column | Type | Sample Value |');
                        report.push('| :--- | :--- | :--- |');

                        // Get a sample
                        db.get(`SELECT * FROM ${t.name} LIMIT 1`, (err, sample) => {
                            cols.forEach(c => {
                                let val = sample ? sample[c.name] : 'N/A';
                                if (typeof val === 'string' && val.length > 50) val = val.substring(0, 47) + '...';
                                report.push(`| **${c.name}** | ${c.type} | ${val} |`);
                            });
                            report.push('');
                            resolve();
                        });
                    });
                });
            });
        }

        fs.writeFileSync(outFile, report.join('\n'));
        console.log(`Dictionary saved to ${outFile}`);
    });
});
