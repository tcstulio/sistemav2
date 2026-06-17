import axios from 'axios';

// Config
const API_URL = 'http://localhost:3004/api';
const API_KEY = process.env.DOLIBARR_API_KEY || '';

const main = async () => {
    try {
        console.log("Triggering /conversations to force Auth and logging...");
        const response = await axios.get(`${API_URL}/conversations`, {
            headers: {
                'DOLAPIKEY': API_KEY
            }
        });
        console.log("Response Status:", response.status);
    } catch (e: any) {
        console.error("Error:", e.message);
        if (e.response) console.error("Data:", e.response.data);
    }
};

main();
