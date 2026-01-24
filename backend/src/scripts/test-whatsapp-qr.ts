
import { Manager } from "socket.io-client";
import fetch from 'node-fetch';

const SOCKET_URL = 'http://localhost:3004';
const API_URL = 'http://localhost:3004/api/whatsapp';

console.log(`[Test] Connecting to ${SOCKET_URL}...`);

const manager = new Manager(SOCKET_URL, {
    reconnectionDelayMax: 10000,
});

const socket = manager.socket("/");

const TEST_SESSION_ID = `test_session_${Math.floor(Math.random() * 1000)}`;

socket.on("connect", () => {
    console.log(`[Test] Connected to Backend Socket! ID: ${socket.id}`);

    // Trigger Start Session
    console.log(`[Test] Triggering start for ${TEST_SESSION_ID}...`);
    fetch(`${API_URL}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: TEST_SESSION_ID })
    })
        .then(res => res.json())
        .then(data => console.log('[Test] Start result:', data))
        .catch(err => console.error('[Test] Start error:', err));
});

socket.on("disconnect", () => {
    console.log("[Test] Disconnected.");
});

socket.on("session_status", (status) => {
    console.log("[Test] Session Status Update:", status);
});

socket.on("session_qr", (data) => {
    console.log("[Test] QR Code Received for session:", data.sessionId);
    console.log("[Test] QR Length:", data.qr.length);
    process.exit(0); // Success!
});

// Timeout
setTimeout(() => {
    console.log("[Test] Timeout waiting for QR code.");
    process.exit(1);
}, 30000);
