import https from 'https';

const API_URL = 'https://sistema.coolgroove.com.br/api/index.php';
const API_KEY = '26ecc09039bd0bfeb52b11003449a2deb4770482';
const TICKET_ID = 304;

// Test 1: Try /tickets/304/messages
const url1 = `${API_URL}/tickets/${TICKET_ID}/messages`;
console.log(`Testing ${url1}...`);

const options = {
    headers: {
        'DOLAPIKEY': API_KEY,
        'Accept': 'application/json'
    }
};

const testUrl = (url) => {
    return new Promise((resolve) => {
        https.get(url, options, (res) => {
            let data = '';
            console.log(`URL: ${url} -> Status: ${res.statusCode}`);
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    if (res.statusCode === 200) {
                        const json = JSON.parse(data);
                        console.log('Sample Data:', JSON.stringify(json).substring(0, 200) + '...');
                        resolve(true);
                    } else {
                        console.log('Error Body:', data);
                        resolve(false);
                    }
                } catch (e) {
                    console.log('Raw Data:', data);
                    resolve(false);
                }
            });
        }).on('error', err => {
            console.error(err.message);
            resolve(false);
        });
    });
};

const run = async () => {
    await testUrl(url1);

    // Test 2: Try /tickets/304 (maybe messages are embedded?)
    const url2 = `${API_URL}/tickets/${TICKET_ID}`;
    await testUrl(url2);

    // Test 3: Try /agendaevents with correct SQL filter
    // Syntax for Dolibarr API sqlfilters is usually (field:=:value)
    // t.elementtype = 'ticket' AND t.fk_element = TICKET_ID
    const filter = `(t.elementtype:=:'ticket') AND (t.fk_element:=:${TICKET_ID})`;
    const url3 = `${API_URL}/agendaevents?sortfield=t.datec&sortorder=DESC&limit=20&sqlfilters=${encodeURIComponent(filter)}`;

    console.log(`Testing ${url3}...`);

    https.get(url3, options, (res) => {
        let data = '';
        console.log(`Status: ${res.statusCode}`);
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            try {
                const json = JSON.parse(data);
                if (Array.isArray(json) && json.length > 0) {
                    console.log('First Item Full Structure:', JSON.stringify(json[0], null, 2));
                    console.log('Second Item Full Structure:', JSON.stringify(json[1], null, 2));
                } else {
                    console.log('JSON (not array or empty):', JSON.stringify(json, null, 2));
                }
            } catch (e) { console.error(e); }
        });
    });
};

run();
