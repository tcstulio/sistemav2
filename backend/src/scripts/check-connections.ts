import axios from 'axios';

const BACKEND_URL = 'http://localhost:3004/api/whatsapp';

async function testBackend() {
    console.log(`Testing Backend connectivity at ${BACKEND_URL}/status...`);
    try {
        const response = await axios.get(`${BACKEND_URL}/status`);
        console.log('✅ Backend is reachable. Status:', response.data);
    } catch (error: any) {
        console.error('❌ Backend is NOT reachable:', error.message);
        if (error.code === 'ECONNREFUSED') {
            console.error('   -> Check if Backend server is running on port 3004.');
        }
    }
}

async function run() {
    await testBackend();
}

run();
