import express from 'express';
import os from 'os';
import { logger } from '../utils/logger';
// import { wahaService } from '../services/wahaService'; // DEPRECATED
import { sessionService } from '../services/sessionService'; // ADDED

const log = logger.child('AdminRoutes');
// import { dbService } from '../../../services/dbService'; // REMOVED to prevent crash
// Correction: We cannot import client-side dbService here. Backend has no IndexedDB.
// If backend needs logs, it should read from a file or its own DB.
// Since the prompt asked for "server logs", we will return partial logs or mock for now,
// or if we implement file logging later.

import { requireDolibarrAdmin } from '../middleware/authMiddleware';
import { FEATURES, getAllFeatures, isUsingMoltbot, isTulipaActive, logFeatures } from '../config/features';
import { channelRouter } from '../services/channelRouter';
import { moltbotGateway } from '../services/moltbotGateway';
import { tulipaService } from '../services/tulipaService';

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
        const providerName = req.query.provider as string;

        let models: string[] = [];

        if (providerName && (providerName === 'local' || providerName === 'google')) {
            // Create a temporary provider instance to fetch models
            const { GoogleGenAI } = require('@google/genai');
            const axios = require('axios'); // Ensure axios is available

            if (providerName === 'google') {
                if (!config.googleApiKey) return res.json({ models: [] });
                // Reuse GoogleProvider logic or just minimal fetch
                const ai = new GoogleGenAI({ apiKey: config.googleApiKey });
                const response = await ai.models.list();
                for await (const model of response) {
                    if (model.name?.startsWith('models/gemini')) {
                        models.push(model.name.replace('models/', ''));
                    }
                }
            } else {
                // Local
                if (!config.localLlmUrl) return res.json({ models: [] });
                try {
                    const response = await axios.get(`${config.localLlmUrl}/models`);
                    if (response.data?.data) models = response.data.data.map((m: any) => m.id);
                    else if (response.data?.models) models = response.data.models.map((m: any) => m.name);
                } catch (e) { log.warn('Local model fetch failed', e); }
            }
        } else {
            // Default behavior: use active provider
            models = await aiService.getModels();
        }
        res.json({ models });
    } catch (e: any) {
        res.status(500).json({ error: "Failed to fetch models", details: e.message });
    }
});

router.post('/config/llm/test', async (req, res) => {
    try {
        const { provider, url, model, apiKey } = req.body;

        if (provider === 'google') {
            const testKey = apiKey || config.googleApiKey;
            if (!testKey) {
                return res.json({ success: false, error: "API Key ausente para o Google Gemini." });
            }

            const { GoogleGenAI } = require('@google/genai');
            const genAI = new GoogleGenAI({ apiKey: testKey });
            const testModel = genAI.getGenerativeModel({ model: model || 'gemini-1.5-flash' });

            const result = await testModel.generateContent("Respond with 'OK'");
            const responseString = result.response.text();

            // Fetch models
            const modelList: string[] = [];
            try {
                const responseList = await genAI.models.list();
                for await (const m of responseList) {
                    if (m.name?.startsWith('models/gemini')) {
                        modelList.push(m.name.replace('models/', ''));
                    }
                }
            } catch (e) { /* model listing failed, return empty list */ }

            return res.json({
                success: true,
                provider: 'google',
                testResponse: responseString,
                availableModels: modelList
            });
        } else if (provider === 'local') {
            const testUrl = url || config.localLlmUrl;
            const testModelName = model || config.localModelName;

            if (!testUrl) {
                return res.json({ success: false, error: "URL do servidor local ausente." });
            }

            const axios = require('axios');
            const startTime = Date.now();

            // Try to fetch models
            const modelsResponse = await axios.get(`${testUrl}/models`, { timeout: 10000 });
            let modelList: string[] = [];
            if (modelsResponse.data?.data) modelList = modelsResponse.data.data.map((m: any) => m.id);
            else if (modelsResponse.data?.models) modelList = modelsResponse.data.models.map((m: any) => m.name);

            // Quick completion test
            let testResponse = "Conectado ao servidor local.";
            try {
                const chatResponse = await axios.post(`${testUrl}/completions`, {
                    model: testModelName,
                    prompt: 'Respond with "OK"',
                    max_tokens: 5
                }, { timeout: 5000 }).catch(() =>
                    axios.post(`${testUrl}/chat/completions`, {
                        model: testModelName,
                        messages: [{ role: 'user', content: 'Respond with "OK"' }],
                        max_tokens: 5
                    }, { timeout: 5000 })
                );

                testResponse = chatResponse.data.choices[0].text || chatResponse.data.choices[0].message?.content || testResponse;
            } catch (e) { /* LLM test call failed, return default response */ }

            return res.json({
                success: true,
                provider: 'local',
                testResponse: testResponse.trim(),
                availableModels: modelList,
                latencyMs: Date.now() - startTime
            });
        }

        res.status(400).json({ success: false, error: "Provedor inválido." });
    } catch (e: any) {
        log.error('LLM Test Error', e);
        res.json({
            success: false,
            error: e.message,
            suggestion: e.code === 'ECONNREFUSED' ? "Servidor local offline ou URL incorreta." : undefined
        });
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
        config.llmProvider = provider;
        if (url) config.localLlmUrl = url;
        if (key) config.googleApiKey = key;
        if (modelName) config.localModelName = modelName;

        log.info('LLM config updated (runtime only - restart will reset)');

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

// --- Advanced LLM Configuration Endpoints ---
const { configService } = require('../services/configService');

// Simple usage stats tracking
let llmStats = {
    callsToday: 0,
    tokensToday: 0,
    errors: 0,
    lastError: null as string | null,
    lastCallTime: 0,
    startOfDay: new Date().setHours(0, 0, 0, 0)
};

// Reset stats daily
const resetStatsIfNewDay = () => {
    const today = new Date().setHours(0, 0, 0, 0);
    if (today > llmStats.startOfDay) {
        llmStats = { callsToday: 0, tokensToday: 0, errors: 0, lastError: null, lastCallTime: 0, startOfDay: today };
    }
};

// Get/Set module-specific LLM configurations
router.get('/config/llm/modules', (req, res) => {
    res.json(configService.getAllModuleConfigs());
});

router.post('/config/llm/modules', (req, res) => {
    const { modules } = req.body;
    if (modules && typeof modules === 'object') {
        configService.setModuleConfigs(modules);
        res.json({ success: true, modules: configService.getAllModuleConfigs() });
    } else {
        res.status(400).json({ error: 'Invalid modules format' });
    }
});

// Get/Set custom prompts
router.get('/config/llm/prompts', (req, res) => {
    res.json(configService.getAllPrompts());
});

router.post('/config/llm/prompts', (req, res) => {
    const { prompts } = req.body;
    if (prompts && typeof prompts === 'object') {
        configService.setPrompts(prompts);
        res.json({ success: true, prompts: configService.getAllPrompts() });
    } else {
        res.status(400).json({ error: 'Invalid prompts format' });
    }
});

// Get usage statistics
router.get('/config/llm/stats', (req, res) => {
    resetStatsIfNewDay();
    res.json({
        ...llmStats,
        currentProvider: config.llmProvider,
        currentModel: config.localModelName,
        estimatedCost: llmStats.tokensToday * 0.00001 // Rough estimate
    });
});

// Increment stats (called internally by aiService)
router.post('/config/llm/stats/track', (req, res) => {
    resetStatsIfNewDay();
    const { tokens, error } = req.body;
    llmStats.callsToday++;
    llmStats.lastCallTime = Date.now();
    if (tokens) llmStats.tokensToday += tokens;
    if (error) {
        llmStats.errors++;
        llmStats.lastError = error;
    }
    res.json({ success: true });
});

// Playground - test arbitrary prompt
router.post('/config/llm/playground', async (req, res) => {
    const { prompt, provider, model } = req.body;

    if (!prompt) {
        return res.status(400).json({ error: 'Prompt é obrigatório' });
    }

    try {
        const startTime = Date.now();

        // Temporarily switch provider if specified
        const originalProvider = config.llmProvider;
        if (provider && provider !== originalProvider) {
            aiService.setConfig(provider, config.localLlmUrl, config.googleApiKey, model);
        }

        const response = await aiService.analyzeSystem(prompt, '');

        // Restore original provider
        if (provider && provider !== originalProvider) {
            aiService.setConfig(originalProvider as 'local' | 'google', config.localLlmUrl, config.googleApiKey, config.localModelName);
        }

        const latency = Date.now() - startTime;

        // Track usage
        llmStats.callsToday++;
        llmStats.lastCallTime = Date.now();
        llmStats.tokensToday += Math.ceil(prompt.length / 4) + Math.ceil(response.length / 4);

        res.json({
            success: true,
            response,
            latencyMs: latency,
            provider: provider || originalProvider,
            model: model || config.localModelName,
            tokensEstimate: Math.ceil(prompt.length / 4) + Math.ceil(response.length / 4)
        });
    } catch (e: any) {
        llmStats.errors++;
        llmStats.lastError = e.message;
        res.status(500).json({ success: false, error: e.message });
    }
});

// ========================================
// FEATURE FLAGS & INTEGRATION STATUS
// ========================================

/**
 * GET /api/admin/config/features
 * Get all feature flags
 */
router.get('/config/features', (req, res) => {
    res.json({
        features: getAllFeatures(),
        computed: {
            usingMoltbot: isUsingMoltbot(),
            tulipaActive: isTulipaActive(),
            currentWhatsAppProvider: channelRouter.getWhatsAppProvider()
        }
    });
});

/**
 * POST /api/admin/config/features/provider
 * Switch WhatsApp provider at runtime
 */
router.post('/config/features/provider', (req, res) => {
    const { provider } = req.body;

    if (provider !== 'legacy' && provider !== 'moltbot') {
        return res.status(400).json({ error: "Invalid provider. Use 'legacy' or 'moltbot'." });
    }

    channelRouter.setWhatsAppProvider(provider);

    res.json({
        success: true,
        provider: channelRouter.getWhatsAppProvider(),
        note: 'Runtime change only. Set WHATSAPP_PROVIDER in .env to persist.'
    });
});

/**
 * GET /api/admin/integration/status
 * Get integration status summary (Moltbot + Tulipa)
 */
router.get('/integration/status', async (req, res) => {
    try {
        const [moltbotStatus, tulipaStatus, channelStatuses] = await Promise.all([
            moltbotGateway.getStatus(),
            tulipaService.getQuickStatus(),
            channelRouter.getAllChannelsStatus()
        ]);

        res.json({
            features: {
                moltbotEnabled: FEATURES.MOLTBOT_ENABLED,
                tulipaEnabled: FEATURES.TULIPA_ENABLED,
                whatsappProvider: FEATURES.WHATSAPP_PROVIDER,
                usingMoltbot: isUsingMoltbot()
            },
            services: {
                moltbot: moltbotStatus,
                tulipa: tulipaStatus
            },
            channels: channelStatuses,
            checkedAt: Date.now()
        });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /api/admin/integration/test
 * Test integration connections
 */
router.post('/integration/test', async (req, res) => {
    const results: any = {
        moltbot: { tested: false },
        tulipa: { tested: false }
    };

    // Test Moltbot
    if (FEATURES.MOLTBOT_ENABLED) {
        try {
            const status = await moltbotGateway.getStatus();
            results.moltbot = {
                tested: true,
                success: status.connected,
                status: status.status,
                latency: status.latency
            };
        } catch (e: any) {
            results.moltbot = { tested: true, success: false, error: e.message };
        }
    }

    // Test Tulipa
    if (FEATURES.TULIPA_ENABLED) {
        try {
            const status = await tulipaService.getSystemStatus();
            results.tulipa = {
                tested: true,
                success: status?.healthy || false,
                uptime: status?.uptime,
                stats: status?.stats
            };
        } catch (e: any) {
            results.tulipa = { tested: true, success: false, error: e.message };
        }
    }

    res.json(results);
});

/**
 * GET /api/admin/integration/brain/stats
 * Get Brain Hub statistics
 */
router.get('/integration/brain/stats', async (req, res) => {
    if (!FEATURES.TULIPA_ENABLED) {
        return res.status(400).json({ error: 'Tulipa integration not enabled' });
    }

    try {
        const [eventsStats, summary] = await Promise.all([
            tulipaService.getEventsStats(),
            tulipaService.getBrainSummary()
        ]);

        res.json({
            events: eventsStats,
            summary,
            checkedAt: Date.now()
        });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export default router;

