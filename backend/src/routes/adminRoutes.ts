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

// --- Advanced LLM Configuration Endpoints ---

// In-memory storage for module configs and prompts (persists until restart)
let llmModuleConfigs: Record<string, { provider: string; model: string }> = {
    chat: { provider: config.llmProvider, model: config.localModelName },
    banking: { provider: config.llmProvider, model: config.localModelName },
    system_analysis: { provider: config.llmProvider, model: config.localModelName },
    proposals: { provider: config.llmProvider, model: config.localModelName }
};

let llmCustomPrompts: Record<string, string> = {
    system_base: 'Você é um assistente virtual inteligente do sistema ERP.',
    banking_categorization: 'Categorize as transações bancárias fornecidas.',
    banking_anomalies: 'Identifique gastos suspeitos ou fora do padrão.',
    chat_signature: '~ Assistente Virtual'
};

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

// Test LLM connection
router.post('/config/llm/test', async (req, res) => {
    const { provider, url, model, apiKey } = req.body;

    try {
        if (provider === 'local') {
            // Test local LLM connection
            const axios = require('axios');
            const testUrl = url || config.localLlmUrl;

            // Try to list models first
            try {
                const modelsResponse = await axios.get(`${testUrl}/models`, { timeout: 5000 });
                const models = modelsResponse.data?.data?.map((m: any) => m.id) ||
                    modelsResponse.data?.models?.map((m: any) => m.name) || [];

                // Try a simple completion
                const testResponse = await axios.post(`${testUrl}/chat/completions`, {
                    model: model || config.localModelName,
                    messages: [{ role: 'user', content: 'Responda apenas: OK' }],
                    max_tokens: 10
                }, { timeout: 10000 });

                const reply = testResponse.data?.choices?.[0]?.message?.content || '';

                res.json({
                    success: true,
                    provider: 'local',
                    url: testUrl,
                    model: model || config.localModelName,
                    availableModels: models,
                    testResponse: reply.substring(0, 100),
                    latencyMs: Date.now() - (req as any).startTime || 0
                });
            } catch (connErr: any) {
                res.json({
                    success: false,
                    provider: 'local',
                    error: connErr.message,
                    suggestion: 'Verifique se o servidor LLM está rodando e a URL está correta'
                });
            }
        } else if (provider === 'google') {
            // Test Google Gemini
            const testKey = apiKey || config.googleApiKey;
            if (!testKey) {
                return res.json({ success: false, provider: 'google', error: 'API Key não configurada' });
            }

            try {
                const { GoogleGenAI } = require('@google/genai');
                const ai = new GoogleGenAI({ apiKey: testKey });
                const response = await ai.models.generateContent({
                    model: model || 'gemini-2.0-flash-exp',
                    contents: 'Responda apenas: OK'
                });

                res.json({
                    success: true,
                    provider: 'google',
                    model: model || 'gemini-2.0-flash-exp',
                    testResponse: response.text?.substring(0, 100) || 'OK',
                    availableModels: ['gemini-2.0-flash-exp', 'gemini-1.5-flash', 'gemini-1.5-pro']
                });
            } catch (geminiErr: any) {
                res.json({
                    success: false,
                    provider: 'google',
                    error: geminiErr.message,
                    suggestion: 'Verifique se a API Key está válida'
                });
            }
        } else {
            res.status(400).json({ error: 'Provider inválido' });
        }
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Get/Set module-specific LLM configurations
router.get('/config/llm/modules', (req, res) => {
    res.json(llmModuleConfigs);
});

router.post('/config/llm/modules', (req, res) => {
    const { modules } = req.body;
    if (modules && typeof modules === 'object') {
        llmModuleConfigs = { ...llmModuleConfigs, ...modules };
        res.json({ success: true, modules: llmModuleConfigs });
    } else {
        res.status(400).json({ error: 'Invalid modules format' });
    }
});

// Get/Set custom prompts
router.get('/config/llm/prompts', (req, res) => {
    res.json(llmCustomPrompts);
});

router.post('/config/llm/prompts', (req, res) => {
    const { prompts } = req.body;
    if (prompts && typeof prompts === 'object') {
        llmCustomPrompts = { ...llmCustomPrompts, ...prompts };
        res.json({ success: true, prompts: llmCustomPrompts });
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

export default router;

