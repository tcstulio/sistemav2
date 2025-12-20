
import axios from 'axios';

const API_URL = 'http://127.0.0.1:3004/api/whatsapp';
const TARGET_NAME = 'Tulio';
// Use a different header for PTT 
// Using MP3 mimetype which we will convert
const SAMPLE_AUDIO_OGG = 'data:audio/mp3;base64,//uQZAAAAAAAAAAAAAABAAAAAAAAAAAAAAP/7kGQAAAAAAAAAAAAAAQgAAAAAoAAAA//uQZAAAAAAAAAAAAAABAAAAAAAAAAAAAAP/7kGQAAAAAAAAAAAAAAQgAAAAAoAAAA';

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
    try {
        console.log('1. Fetching Sessions...');
        const sessionsRes = await axios.get(`${API_URL}/sessions`);
        let session = sessionsRes.data.find((s: any) => true);

        if (!session) {
            console.error('No session found at all.');
            return;
        }

        console.log(`Found Session: ${session.id} (Status: ${session.status})`);

        if (session.status === 'STOPPED') {
            console.log('Session is STOPPED. Attempting to start it...');
            try {
                await axios.post(`${API_URL}/start`, { sessionId: session.id });
                console.log('Start command sent.');
                session.status = 'STARTING';
            } catch (e: any) {
                console.error('Failed to start session:', e.message);
                return;
            }
        }

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

        console.log('2. Finding Chat...');
        const convsRes = await axios.get(`${API_URL}/conversations?sessionId=${sessionId}`);
        const chats = convsRes.data;
        const targetChat = chats.find((c: any) => c.name.toLowerCase().includes(TARGET_NAME.toLowerCase()));

        if (!targetChat) {
            console.error('Chat not found');
            return;
        }

        console.log(`Target: ${targetChat.name} (${targetChat.id})`);

        console.log('3. Sending NATIVE PTT...');
        try {
            const res = await axios.post(`${API_URL}/send-voice-native`, {
                sessionId,
                chatId: targetChat.id,
                fileData: SAMPLE_AUDIO_OGG
            });
            console.log('SUCCESS Native PTT!');
            console.log(res.data);
        } catch (e: any) {
            console.error('FAILED Native PTT:', e.message);
            if (e.response) console.error(e.response.data);
        }

    } catch (e) {
        console.error(e);
    }
}
run();
