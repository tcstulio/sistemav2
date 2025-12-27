const https = require('https');
const http = require('http');

const args = process.argv.slice(2);
if (args.length < 2) {
    console.error("Usage: node verify_proposal_data.js <BASE_URL> <API_KEY> [LIMIT]");
    console.error("Example: node verify_proposal_data.js https://mydolibarr.com/custom_sync.php myapikey 10");
    process.exit(1);
}

const baseUrl = args[0];
const apiKey = args[1];
const limit = args[2] || 50;

console.log(`Checking proposals from ${baseUrl}...`);

const url = new URL(baseUrl);
if (!url.searchParams.has('type')) url.searchParams.append('type', 'proposals');
if (!url.searchParams.has('limit')) url.searchParams.append('limit', limit);
if (!url.searchParams.has('DOLAPIKEY')) url.searchParams.append('DOLAPIKEY', apiKey);
// Add last_modified=0 to get all (or up to limit)
if (!url.searchParams.has('last_modified')) url.searchParams.append('last_modified', '0');

const client = url.protocol === 'https:' ? https : http;

client.get(url.toString(), (res) => {
    let data = '';

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        if (res.statusCode !== 200) {
            console.error(`Error: Status Code ${res.statusCode}`);
            console.error(data);
            return;
        }

        try {
            const json = JSON.parse(data);
            if (json.data && Array.isArray(json.data)) {
                console.log(`Found ${json.data.length} proposals.`);

                let withProject = 0;
                let withoutProject = 0;

                json.data.forEach(p => {
                    if (p.project_id) {
                        // console.log(`[WITH PROJECT] Ref: ${p.ref}, ID: ${p.id} -> Project ID: ${p.project_id}`);
                        withProject++;
                    } else {
                        withoutProject++;
                    }
                });

                console.log(`\nSummary:`);
                console.log(`- Proposals with project_id: ${withProject}`);
                console.log(`- Proposals without project_id: ${withoutProject}`);

                if (withProject > 0) {
                    console.log(`\nSample (With Project):`);
                    const sample = json.data.find(p => p.project_id);
                    console.log(JSON.stringify(sample, null, 2));
                } else {
                    console.warn(`\nWARNING: No proposals returned with project_id. Ensure your proposals are actually linked to projects in Dolibarr.`);
                }

            } else {
                console.error("Invalid data format received:", json);
            }
        } catch (e) {
            console.error("Error parsing JSON:", e.message);
        }
    });

}).on("error", (err) => {
    console.error("Error: " + err.message);
});
