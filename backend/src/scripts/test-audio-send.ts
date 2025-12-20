
import axios from 'axios';

const API_URL = 'http://127.0.0.1:3004/api/whatsapp';
const TARGET_NAME = 'Tulio'; // User specified target
const SAMPLE_AUDIO_B64 = 'data:audio/mp3;base64,//uQZAAAAAAAAAAAAAABAAAAAAAAAAAAAAP/7kGQAAAAAAAAAAAAAAQgAAAAAoAAAA//uQZAAAAAAAAAAAAAABAAAAAAAAAAAAAAP/7kGQAAAAAAAAAAAAAAQgAAAAAoAAAA';

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
    try {
        console.log('1. Fetching Sessions...');
        const sessionsRes = await axios.get(`${API_URL}/sessions`);
        console.log('Sessions Response Data:', JSON.stringify(sessionsRes.data, null, 2));

        if (!Array.isArray(sessionsRes.data)) {
            throw new Error('Sessions response is not an array');
        }

        let session = sessionsRes.data.find((s: any) => s.status === 'WORKING' || s.status === 'STARTING');

        if (!session) {
            console.error('No active session found.');
            return;
        }

        console.log(`Found Session: ${session.id} (Status: ${session.status})`);

        // Wait for WORKING
        if (session.status !== 'WORKING') {
            console.log('Session is not WORKING yet. Waiting...');
            for (let i = 0; i < 30; i++) { // Wait up to 60s
                await sleep(2000);
                const statusRes = await axios.get(`${API_URL}/status?sessionId=${session.id}`);
                const currentStatus = statusRes.data.status;
                process.stdout.write(`.${currentStatus}`);
                if (currentStatus === 'WORKING') {
                    console.log('\nSession is now WORKING!');
                    session.status = 'WORKING';
                    break;
                }
            }
        }

        if (session.status !== 'WORKING') {
            console.error('\nSession failed to become WORKING. Aborting.');
            return;
        }

        const sessionId = session.id;
        console.log(`\n2. Searching for chat with name containing "${TARGET_NAME}" in session ${sessionId}...`);

        const convsRes = await axios.get(`${API_URL}/conversations?sessionId=${sessionId}`);
        const chats = convsRes.data;

        if (!Array.isArray(chats)) {
            console.error('Conversations response is not an array:', chats);
            return;
        }

        console.log(`Fetched ${chats.length} chats.`);

        const targetChat = chats.find((c: any) => c.name.toLowerCase().includes(TARGET_NAME.toLowerCase()));

        if (!targetChat) {
            console.error(`Chat "${TARGET_NAME}" not found.`);
            console.log('Available chats (first 10):', chats.map((c: any) => c.name).slice(0, 10));
            return;
        }

        console.log(`Found Chat: ${targetChat.name} (ID: ${targetChat.id})`);

        console.log('3. Sending Audio Test (Nuclear Option)...');

        try {
            console.log('Sending payload...');
            const res = await axios.post(`${API_URL}/send-voice`, {
                sessionId,
                chatId: targetChat.id,
                fileData: SAMPLE_AUDIO_B64
            });
            console.log('SUCCESS! Audio sent.');
            console.log('Message ID:', res.data.id);
            console.log('Check WhatsApp for the message.');
        } catch (postErr: any) {
            console.error('FAILED to send audio.');
            if (postErr.response) {
                console.error('Status:', postErr.response.status);
                console.error('Data:', postErr.response.data);
            } else {
                console.error('Error:', postErr.message);
            }
        }

    } catch (e: any) {
        console.error('Script Fatal Error:', e);
        if (e.response) {
            console.error('Response data:', e.response.data);
        }
    }
}

run();
