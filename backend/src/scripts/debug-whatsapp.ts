
import axios from 'axios';

const API_URL = 'http://localhost:3004/api/whatsapp';

async function run() {
    try {
        console.log('1. Fetching Sessions...');
        const sessionsRes = await axios.get(`${API_URL}/sessions`);
        console.log('Sessions:', sessionsRes.data);

        const connectedSession = sessionsRes.data.find((s: any) => s.status === 'WORKING' || s.status === 'connected');

        let sessionId = connectedSession?.id;

        if (!sessionId) {
            console.log('No connected session. Attempting to start "vendas"...');
            // Try to start 'vendas'
            await axios.post(`${API_URL}/start`, { sessionId: 'vendas' });

            // Poll for status
            console.log('Waiting for session to be ready...');
            for (let i = 0; i < 20; i++) {
                await new Promise(r => setTimeout(r, 2000));
                const statusRes = await axios.get(`${API_URL}/status?sessionId=vendas`);
                console.log(`Status poll ${i + 1}:`, statusRes.data);
                if (statusRes.data.status === 'WORKING' || statusRes.data.status === 'connected') {
                    sessionId = 'vendas';
                    break;
                }
            }
        }

        if (!sessionId) {
            console.error('Failed to start session.');
            return;
        }

        console.log(`\n2. Using Session: ${sessionId}`);

        console.log('3. Fetching Conversations...');
        const convsRes = await axios.get(`${API_URL}/conversations?sessionId=${sessionId}`);
        const convs = convsRes.data;
        console.log(`Found ${convs.length} conversations.`);

        if (convs.length === 0) {
            console.log('No conversations to test.');
            return;
        }

        const targetConv = convs[0];
        console.log(`\n4. Testing Conversation: ${targetConv.name} (ID: ${targetConv.id})`);

        console.log('5. Fetching Messages...');
        // Encode ID as frontend does
        const encodedId = encodeURIComponent(targetConv.id);
        const url = `${API_URL}/messages/${encodedId}?sessionId=${sessionId}`;
        console.log(`Request URL: ${url}`);

        const msgRes = await axios.get(url);
        console.log(`Response Status: ${msgRes.status}`);
        console.log(`Messages Found: ${msgRes.data.length}`);

        if (msgRes.data.length > 0) {
            console.log('Sample Message:', msgRes.data[0]);
        }

    } catch (e: any) {
        console.error('Error during debug:', e.message);
        if (e.response) {
            console.error('Response Data:', e.response.data);
            console.error('Response Status:', e.response.status);
        }
    }
}

run();
