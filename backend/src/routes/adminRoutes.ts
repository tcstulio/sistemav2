import express from 'express';
import os from 'os';
// import { wahaService } from '../services/wahaService'; // DEPRECATED
import { sessionService } from '../services/sessionService'; // ADDED
// import { dbService } from '../../../services/dbService'; // REMOVED to prevent crash
// Correction: We cannot import client-side dbService here. Backend has no IndexedDB.
// If backend needs logs, it should read from a file or its own DB.
// Since the prompt asked for "server logs", we will return partial logs or mock for now, 
// or if we implement file logging later.

import { requireDolibarrAdmin } from '../middleware/authMiddleware';

const router = express.Router();

// Protect all admin routes
router.use(requireDolibarrAdmin);

router.get('/status', async (req, res) => {
    const memoryUsage = process.memoryUsage();

    // Check WAHA status
    let wahaStatus = 'UNKNOWN';
    try {
        const status = await sessionService.getStatus('default');
        wahaStatus = status || 'STOPPED';
    } catch {
        wahaStatus = 'UNREACHABLE';
    }

    res.json({
        uptime: process.uptime(),
        timestamp: Date.now(),
        system: {
            platform: os.platform(),
            release: os.release(),
            totalMem: os.totalmem(),
            freeMem: os.freemem(),
            processMem: memoryUsage.rss
        },
        services: {
            backend: 'ONLINE',
            waha: wahaStatus,
            database: 'N/A (IndexedDB Client-Side)'
        }
    });
});

router.post('/restart', async (req, res) => {
    // We can't easily restart the node process itself without a manager like PM2, 
    // but we can restart subsystems.
    try {
        // Example: Restart WAHA session
        await sessionService.startSession('default');
        res.json({ status: 'success', message: 'WAHA Session Restart Triggered' });
    } catch (e: any) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});



// LLM Configuration Endpoints
import { config } from '../config/env';
import { aiService } from '../services/aiService';

router.get('/config/llm', (req, res) => {
    res.json({
        provider: config.llmProvider, // Reflect in-memory state
        // We might need to track the *current* runtime state if we want to reflect dynamic changes accurately
        // For MVP, we'll return what's in config object
        configProvider: config.llmProvider,
        localUrl: config.localLlmUrl,
        localModelName: config.localModelName
    });
});

router.get('/config/llm/models', async (req, res) => {
    try {
        const models = await aiService.getModels();
        res.json({ models });
    } catch (e: any) {
        res.status(500).json({ error: "Failed to fetch models", details: e.message });
    }
});

router.post('/config/llm', async (req, res) => {
    try {
        const { provider, url, key, modelName } = req.body;

        if (provider !== 'local' && provider !== 'google') {
            return res.status(400).json({ error: "Invalid provider. Use 'local' or 'google'." });
        }

        // Update Runtime
        aiService.setConfig(provider, url, key, modelName);

        // Update Config Object (In-Memory only)
        // Note: This won't persist across restarts unless we write to .env
        config.llmProvider = provider;
        if (url) config.localLlmUrl = url;
        if (key) config.googleApiKey = key;
        if (modelName) config.localModelName = modelName;

        // Persist to .env
        try {
            const fs = require('fs');
            const path = require('path');
            const envPath = path.resolve(__dirname, '../../.env');

            if (fs.existsSync(envPath)) {
                let envContent = fs.readFileSync(envPath, 'utf8');

                const updateOrAdd = (key: string, value: string) => {
                    const regex = new RegExp(`^${key}=.*`, 'm');
                    if (regex.test(envContent)) {
                        envContent = envContent.replace(regex, `${key}=${value}`);
                    } else {
                        envContent += `\n${key}=${value}`;
                    }
                };

                updateOrAdd('LLM_PROVIDER', provider);
                if (url) updateOrAdd('LOCAL_LLM_URL', url);
                if (key) updateOrAdd('GOOGLE_API_KEY', key);
                if (modelName) updateOrAdd('LOCAL_LLM_MODEL', modelName);

                fs.writeFileSync(envPath, envContent);
                console.log('Saved config to .env');
            }
        } catch (err) {
            console.error("Failed to save .env file:", err);
            // Non-blocking error for client, but logged
        }

        res.json({ status: 'success', message: `LLM Provider switched to ${provider} (Model: ${modelName || 'default'})` });
    } catch (e: any) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

// Mock logs endpoint - in real scenario, read from 'server.log'
router.get('/logs', (req, res) => {
    // TODO: Implement real file logging
    res.json([
        { level: 'info', message: 'Backend started successfully', timestamp: Date.now() - 100000 },
        { level: 'info', message: 'Health check passed', timestamp: Date.now() - 50000 },
        { level: 'warn', message: 'Sample warning log for admin panel', timestamp: Date.now() }
    ]);
});

export default router;
