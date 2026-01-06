const axios = require('axios');

const BASIC_AUTH_TOKEN = 'MjZlY2MwOTAzOWJkMGJmZWI1MmIxMTAwMzQ0OWEyZGViNDc3MDQ4MjphZG1pbg==';
const API_KEY = '26ecc09039bd0bfeb52b11003449a2deb4770482';
const BASE_URL = 'https://sistema.coolgroove.com.br/custom_sync.php';

async function checkSupplierLinks() {
    console.log("Checking supplier_payment_invoice_links...");
    try {
        const response = await axios.get(`${BASE_URL}?type=supplier_payment_invoice_links&limit=10&DOLAPIKEY=${API_KEY}`);

        if (response.data && response.data.data) {
            console.log(`✅ Success! Found ${response.data.data.length} links.`);
            if (response.data.data.length > 0) {
                console.log("Sample link:", response.data.data[0]);
            } else {
                console.log("⚠️ No links found in database.");
            }
        }

        console.log("\nChecking supplier_payments...");
        const paymentsResponse = await axios.get(`${BASE_URL}?type=supplier_payments&limit=10&DOLAPIKEY=${API_KEY}`);
        console.log("Response Status:", paymentsResponse.status);

        if (paymentsResponse.data && paymentsResponse.data.data) {
            console.log(`✅ Success! Found ${paymentsResponse.data.data.length} supplier payments.`);
            if (paymentsResponse.data.data.length > 0) {
                console.log("Sample payment:", paymentsResponse.data.data[0]);
                const p1 = paymentsResponse.data.data.find(p => p.id == 1);
                if (p1) console.log("✅ Payment ID 1 found:", p1);
                else console.log("⚠️ Payment ID 1 NOT found in first 10 records.");
            } else {
                console.log("⚠️ Data array is empty.");
            }
        } else {
            console.log("❌ Unexpected response structure:", JSON.stringify(paymentsResponse.data).substring(0, 500));
        }

    } catch (error) {
        console.error("❌ Request Failed:", error.message);
        if (error.response) {
            console.error("Status:", error.response.status);
            console.error("Data:", error.response.data);
        }
    }
}

checkSupplierLinks();
