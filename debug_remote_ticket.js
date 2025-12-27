import https from 'https';

const API_URL = 'https://sistema.coolgroove.com.br/api/index.php';
const API_KEY = '26ecc09039bd0bfeb52b11003449a2deb4770482';
const TICKET_ID = 304;

const url = `${API_URL}/tickets/${TICKET_ID}`;

console.log(`Fetching ${url}...`);

const options = {
    headers: {
        'DOLAPIKEY': API_KEY,
        'Accept': 'application/json'
    }
};

https.get(url, options, (res) => {
    let data = '';

    console.log(`Status Code: ${res.statusCode}`);

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        try {
            const parsedData = JSON.parse(data);
            console.log(JSON.stringify(parsedData, null, 2));
        } catch (e) {
            console.error('Error parsing JSON:', e.message);
            console.log('Raw data:', data);
        }
    });

}).on('error', (err) => {
    console.error('Error fetching data:', err.message);
});
