
import axios from 'axios';

// Config
const API_URL = 'http://localhost:3000/api/whatsapp'; // Assuming standard port
const API_KEY = '123456'; // Allow setting if needed, but usually dev env has lax auth or we need to check env
// Wait, middleware requireDolibarrLogin might block us if we don't mock it or use a valid token.
// Actually, let's try to invoke the service directly using ts-node to avoid auth headers complexity if possible,
// OR use a mock user in headers if the middleware allows it?
// Middleare: requireDolibarrLogin
// It checks 'x-dolibarr-api-key' or session.
// Let's assume we can use a simple script that imports the service directly.
// This is more robust for unit testing logic.

import { storeService } from '../services/storeService';
import { wahaService } from '../services/legacy/wahaService';

async function testSessionRename() {
    console.log("--- Testing Session Rename Logic ---");

    const sessionId = 'test-session-rename-' + Date.now();
    console.log(`Target Session: ${sessionId}`);

    // 1. Initial State
    const initialSettings = storeService.getSessionSettings(sessionId);
    console.log("Initial Settings:", initialSettings);

    // 2. Set Name
    console.log("Setting name to: 'My Custom Name'");
    storeService.updateSessionSettings(sessionId, { name: 'My Custom Name', autoReply: true });

    // 3. Verify Persistence in Memory
    const updatedSettings = storeService.getSessionSettings(sessionId);
    console.log("Updated Settings (Memory):", updatedSettings);

    if (updatedSettings.name !== 'My Custom Name') {
        console.error("FAILED to update name in memory!");
    } else {
        console.log("SUCCESS: Name updated in memory.");
    }

    // 4. Verify Persistence on Disk
    // We need to re-read the file raw
    const fs = require('fs');
    const path = require('path');
    const storePath = path.join(__dirname, '../../data/whatsapp_store.json');
    console.log(`Reading store from: ${storePath}`);

    try {
        const raw = fs.readFileSync(storePath, 'utf-8');
        const json = JSON.parse(raw);
        const savedSession = json.session_settings[sessionId];
        console.log("Saved on Disk:", savedSession);

        if (savedSession && savedSession.name === 'My Custom Name') {
            console.log("SUCCESS: Name persisted to disk.");
        } else {
            console.error("FAILED: Name NOT found on disk!");
        }

    } catch (e) {
        console.error("Error reading store file:", e);
    }

    // 5. Test Enrichment Logic (Mocking wahaService)
    // We can't easily mock wahaService behavior here without running the server, 
    // but we can test the logic used in the route:
    // name: settings.name || s.me?.pushName || (s.id === 'default' ? 'Sessão Principal' : `Sessão ${s.id}`)

    const mockWahaSession = { id: sessionId, status: 'STOPPED', me: { pushName: 'OriginalPushName' } };
    const enrichedName = updatedSettings.name || mockWahaSession.me?.pushName || `Sessão ${sessionId}`;

    console.log("Enriched Name Logic Result:", enrichedName);

    if (enrichedName === 'My Custom Name') {
        console.log("SUCCESS: Enrichment logic prioritizes custom name.");
    } else {
        console.error("FAILED: Enrichment logic wrong.");
    }

}

testSessionRename();
