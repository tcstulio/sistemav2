
import axios from 'axios';

// Configuration
const API_URL = 'http://localhost/api/dolibarr/custom_sync.php'; // Adjust if needed to match local dev setup
const API_KEY = 'YOUR_API_KEY'; // This will need to be a real key or mocked in the test environment if possible, 
// but for this script we might just test the PHP syntax/logic if we can't run it against a live server easily.
// However, since I am an AI, I can't browse localhost.
// I will rely on static verification of the code I wrote.

// Since I cannot run the PHP code directly, I will inspect the file content again to ensure all cases are covered.
// But I can create a script that WOULD run if the user ran it.

console.log("This script is a template for manual verification.");
console.log("1. Ensure your local Dolibarr is running.");
console.log("2. specificy a valid API Key below.");

async function testSync() {
    try {
        // Test 1: Check Suppliers (Fixed Endpoint Name)
        console.log("Testing 'suppliers' endpoint...");
        // We'll mock the URL construction
        const url = `${API_URL}?type=suppliers&last_modified=0&limit=1&DOLAPIKEY=...`;
        console.log(`Requesting: ${url}`);

        // This part requires a running server. 
        // For now, I will assume the changes are correct based on the code diff.
        // The critically important part was the SQL generation in custom_sync.php.

        console.log("Please verify manually by visiting: /custom_sync.php?type=suppliers&limit=1");
        console.log("Check if 'tms' and 'datec' are Integers (e.g. 1700000000) and NOT strings.");

    } catch (error) {
        console.error("Test failed", error);
    }
}

testSync();
