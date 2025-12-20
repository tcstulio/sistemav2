
import { Manager } from "socket.io-client";
import * as readline from 'readline';

// Config
const SOCKET_URL = 'http://localhost:3004';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log(`[Test] Connecting to ${SOCKET_URL}...`);

const manager = new Manager(SOCKET_URL, {
    reconnectionDelayMax: 10000,
});

const socket = manager.socket("/");

socket.on("connect", () => {
    console.log(`[Test] Connected to Backend Socket! ID: ${socket.id}`);
    prompt();
});

socket.on("disconnect", () => {
    console.log("[Test] Disconnected.");
});

socket.on("whatsapp_message", (msg) => {
    console.log("\n[Test] Received Message:", JSON.stringify(msg, null, 2));
    prompt();
});

socket.on("session_status", (status) => {
    console.log("\n[Test] Session Status Update:", status);
    prompt();
});

function prompt() {
    rl.question('\nOptions:\n1. Send Fake Message (Simulate Incoming)\n2. Exit\n> ', (answer) => {
        if (answer === '1') {
            const fakeMsg = {
                sessionId: 'default',
                from: '5511999999999@c.us',
                to: 'agent@c.us',
                body: 'Hello from Test Script! ' + new Date().toISOString(),
                pushName: 'Tester',
                fromMe: false,
                timestamp: Math.floor(Date.now() / 1000),
                hasMedia: false,
                id: 'fake_' + Date.now()
            };

            // Note: We can't easily emit "incoming" messages TO the server because the server expects them from WAHA.
            // But we can listen. 
            // To simulate INCOMING, we would need to hit the webhook endpoint.

            console.log("[Test] Note: This script listens. To simulate incoming, we will hit the webhook via fetch.");

            fetch(`${SOCKET_URL}/api/whatsapp/webhook`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(fakeMsg)
            }).then(res => res.json()).then(d => {
                console.log("[Test] Webhook Triggered:", d);
            }).catch(e => console.error(e));

        } else if (answer === '2') {
            process.exit(0);
        } else {
            prompt();
        }
    });
}
