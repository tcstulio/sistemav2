const axios = require('axios');

// Configuration
const API_URL = 'https://sistema.coolgroove.com.br/custom_sync.php';
const API_KEY = '26ecc09039bd0bfeb52b11003449a2deb4770482';

async function checkBankAccount() {
    // Check if 3438 is a transaction (line in llx_bank)
    const url = `${API_URL}?type=debug_bank_transaction_lookup&id=3438&DOLAPIKEY=${API_KEY}`;
    console.log(`Fetching from: ${url}`);

    try {
        const response = await axios.get(url);
        if (response.data.error) {
            console.error('API Error:', response.data.error);
        } else {
            const data = response.data.data || [];
            if (data.length > 0) {
                console.log('✅ FOUND TRANSACTION 3438:', data[0]);
                console.log(`-> It belongs to Bank Account: ${data[0].bank_label} (ID: ${data[0].fk_account})`);
            } else {
                console.log('❌ Transaction 3438 NOT FOUND.');
            }
        }
    } catch (err) {
        console.error('Request error:', err.message);
        if (err.response) {
            console.error('Status:', err.response.status);
            console.error('Data:', err.response.data);
        }
    }
}

checkBankAccount();
