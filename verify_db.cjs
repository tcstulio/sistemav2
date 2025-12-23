const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('dolibarr_local.db');

db.serialize(() => {
    db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, tables) => {
        if (err) {
            console.error(err);
            return;
        }
        console.log("Tables found:", tables.length);
        tables.forEach(t => {
            db.get(`SELECT count(*) as count FROM ${t.name}`, (err, row) => {
                console.log(`- ${t.name}: ${row.count} rows`);
            });
        });
    });
});
