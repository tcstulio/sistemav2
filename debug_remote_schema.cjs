const axios = require('axios');

const API_KEY = '26ecc09039bd0bfeb52b11003449a2deb4770482';
const BASE_URL = 'https://sistema.coolgroove.com.br/custom_sync.php';

async function checkSchema() {
    console.log("Checking schema for paiement...");
    try {
        const response = await axios.get(`${BASE_URL}?type=debug_schema&table=paiement&DOLAPIKEY=${API_KEY}`);

        if (response.data && response.data.data) {
            console.log("✅ Schema retrieved:");
            const columns = response.data.data.map(col => col.Field);
            console.log(columns.join(', '));

            // Check for potential user columns
            const userCols = columns.filter(c => c.includes('user'));
            console.log("\nPossible User Columns:", userCols);

        } else {
            console.log("❌ Invalid response:", response.data);
        }

    } catch (error) {
        console.error("❌ Request Failed:", error.message);
        if (error.response) {
            // console.error("Data:", error.response.data);
        }
    }
}

checkSchema();
