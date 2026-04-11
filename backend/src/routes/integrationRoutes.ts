/**
 * Integration Routes
 *
 * Endpoints para integração com Moltbot Gateway e Tulipa Server.
 * Permite consultar status, Brain Hub, e gerenciar a integração.
 *
 * @see docs/MOLTBOT_INTEGRATION_PLAN.md
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { moltbotGateway } from '../services/moltbotGateway';
import { tulipaService } from '../services/tulipaService';
import { channelRouter } from '../services/channelRouter';
import { syncService } from '../services/syncService';
import { FEATURES, getAllFeatures, isUsingMoltbot } from '../config/features';
import { createLogger } from '../utils/logger';

const log = createLogger('Integration');
const router = Router();

// All routes require authentication
router.use(requireDolibarrLogin);

// ========================================
// STATUS & HEALTH
// ========================================

/**
 * GET /api/integration/status
 * Get full integration status (Moltbot + Tulipa)
 */
router.get('/status', async (req, res) => {
    try {
        const [moltbotStatus, tulipaStatus, channelStatuses] = await Promise.all([
            moltbotGateway.getStatus(),
            tulipaService.getQuickStatus(),
            channelRouter.getAllChannelsStatus()
        ]);

        res.json({
            integration: {
                moltbotEnabled: FEATURES.MOLTBOT_ENABLED,
                tulipaEnabled: FEATURES.TULIPA_ENABLED,
                whatsappProvider: FEATURES.WHATSAPP_PROVIDER,
                usingMoltbot: isUsingMoltbot()
            },
            moltbot: moltbotStatus,
            tulipa: tulipaStatus,
            channels: channelStatuses,
            features: getAllFeatures(),
            checkedAt: Date.now()
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/integration/moltbot/status
 * Get Moltbot Gateway status only
 */
router.get('/moltbot/status', async (req, res) => {
    try {
        const status = await moltbotGateway.getStatus();
        res.json(status);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/integration/moltbot/whatsapp
 * Get WhatsApp status via Moltbot
 */
router.get('/moltbot/whatsapp', async (req, res) => {
    try {
        const status = await moltbotGateway.getWhatsAppStatus();
        res.json(status);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/integration/tulipa/status
 * Get Tulipa Server status
 */
router.get('/tulipa/status', async (req, res) => {
    try {
        const status = await tulipaService.getSystemStatus();
        res.json(status || { healthy: false, error: 'Failed to connect' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// BRAIN HUB - PEOPLE
// ========================================

/**
 * GET /api/integration/brain/people
 * Get all people from Brain Hub
 */
router.get('/brain/people', async (req, res) => {
    try {
        if (!FEATURES.TULIPA_ENABLED) {
            return res.status(400).json({ error: 'Tulipa integration not enabled' });
        }

        const people = await tulipaService.getPeople();
        res.json({ count: people.length, data: people });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/integration/brain/people/:id
 * Get a specific person from Brain Hub
 */
router.get('/brain/people/:id', async (req, res) => {
    try {
        if (!FEATURES.TULIPA_ENABLED) {
            return res.status(400).json({ error: 'Tulipa integration not enabled' });
        }

        const person = await tulipaService.getPerson(req.params.id);
        if (!person) {
            return res.status(404).json({ error: 'Person not found' });
        }
        res.json(person);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/integration/brain/people/:id/link
 * Link a Brain person to a Dolibarr customer
 */
router.post('/brain/people/:id/link', async (req, res) => {
    try {
        if (!FEATURES.TULIPA_ENABLED) {
            return res.status(400).json({ error: 'Tulipa integration not enabled' });
        }

        const { customerId } = z.object({
            customerId: z.string().min(1)
        }).parse(req.body);

        const success = await tulipaService.linkPersonToCustomer(req.params.id, customerId);
        res.json({ success });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: error.issues });
        }
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// BRAIN HUB - EVENTS
// ========================================

/**
 * GET /api/integration/brain/events
 * Get events from Brain Hub
 */
router.get('/brain/events', async (req, res) => {
    try {
        if (!FEATURES.TULIPA_ENABLED) {
            return res.status(400).json({ error: 'Tulipa integration not enabled' });
        }

        const date = req.query.date as string | undefined;
        const events = await tulipaService.getEvents(date);
        res.json({ count: events.length, data: events });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/integration/brain/events/stats
 * Get event statistics
 */
router.get('/brain/events/stats', async (req, res) => {
    try {
        if (!FEATURES.TULIPA_ENABLED) {
            return res.status(400).json({ error: 'Tulipa integration not enabled' });
        }

        const stats = await tulipaService.getEventsStats();
        res.json(stats || { error: 'Failed to get stats' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/integration/brain/summary
 * Get brain summary
 */
router.get('/brain/summary', async (req, res) => {
    try {
        if (!FEATURES.TULIPA_ENABLED) {
            return res.status(400).json({ error: 'Tulipa integration not enabled' });
        }

        const summary = await tulipaService.getBrainSummary();
        res.json(summary || { error: 'Failed to get summary' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// TASKS (TULIPA ORCHESTRATION)
// ========================================

/**
 * GET /api/integration/tasks
 * Get tasks from Tulipa
 */
router.get('/tasks', async (req, res) => {
    try {
        if (!FEATURES.TULIPA_ENABLED || !FEATURES.TULIPA_TASKS_ENABLED) {
            return res.status(400).json({ error: 'Tulipa tasks not enabled' });
        }

        const projectId = req.query.projectId as string | undefined;
        const tasks = await tulipaService.getTasks(projectId);
        res.json({ count: tasks.length, data: tasks });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/integration/tasks/available
 * Get available tasks to claim
 */
router.get('/tasks/available', async (req, res) => {
    try {
        if (!FEATURES.TULIPA_ENABLED || !FEATURES.TULIPA_TASKS_ENABLED) {
            return res.status(400).json({ error: 'Tulipa tasks not enabled' });
        }

        const tasks = await tulipaService.getAvailableTasks();
        res.json({ count: tasks.length, data: tasks });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/integration/tasks
 * Create a new task in Tulipa
 */
router.post('/tasks', async (req, res) => {
    try {
        if (!FEATURES.TULIPA_ENABLED || !FEATURES.TULIPA_TASKS_ENABLED) {
            return res.status(400).json({ error: 'Tulipa tasks not enabled' });
        }

        const taskData = z.object({
            name: z.string().min(1),
            description: z.string().optional(),
            projectId: z.string().optional(),
            priority: z.enum(['low', 'medium', 'high', 'critical']).optional()
        }).parse(req.body);

        const task = await tulipaService.createTask(taskData);
        res.json(task || { error: 'Failed to create task' });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: error.issues });
        }
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// PROJECTS (TULIPA)
// ========================================

/**
 * GET /api/integration/projects
 * Get projects from Tulipa
 */
router.get('/projects', async (req, res) => {
    try {
        if (!FEATURES.TULIPA_ENABLED) {
            return res.status(400).json({ error: 'Tulipa integration not enabled' });
        }

        const projects = await tulipaService.getProjects();
        res.json({ count: projects.length, data: projects });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// AGENTS (TULIPA)
// ========================================

/**
 * GET /api/integration/agents
 * Get active agents from Tulipa
 */
router.get('/agents', async (req, res) => {
    try {
        if (!FEATURES.TULIPA_ENABLED) {
            return res.status(400).json({ error: 'Tulipa integration not enabled' });
        }

        const agents = await tulipaService.getActiveAgents();
        res.json({ count: agents.length, data: agents });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// CHANNEL ROUTER
// ========================================

/**
 * GET /api/integration/channels
 * Get all channels status
 */
router.get('/channels', async (req, res) => {
    try {
        const statuses = await channelRouter.getAllChannelsStatus();
        res.json({
            provider: channelRouter.getWhatsAppProvider(),
            channels: statuses
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/integration/channels/send
 * Send message via unified channel router (for testing)
 */
router.post('/channels/send', async (req, res) => {
    try {
        const payload = z.object({
            channel: z.enum(['whatsapp', 'email']),
            recipient: z.string().min(1),
            content: z.string().min(1),
            subject: z.string().optional(),
            sessionId: z.string().optional()
        }).parse(req.body);

        const result = await channelRouter.send(payload);
        res.json(result);
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: error.issues });
        }
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// FEATURE FLAGS
// ========================================

/**
 * GET /api/integration/features
 * Get current feature flags
 */
router.get('/features', (req, res) => {
    res.json(getAllFeatures());
});

/**
 * POST /api/integration/features/provider
 * Switch WhatsApp provider (runtime only, not persisted)
 */
router.post('/features/provider', (req, res) => {
    try {
        const { provider } = z.object({
            provider: z.enum(['legacy', 'moltbot'])
        }).parse(req.body);

        channelRouter.setWhatsAppProvider(provider);

        res.json({
            success: true,
            provider: channelRouter.getWhatsAppProvider(),
            note: 'This change is runtime only and will reset on server restart'
        });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: error.issues });
        }
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// SYNC
// ========================================

/**
 * POST /api/integration/sync/brain
 * Trigger brain sync
 */
router.post('/sync/brain', async (req, res) => {
    try {
        if (!FEATURES.TULIPA_ENABLED) {
            return res.status(400).json({ error: 'Tulipa integration not enabled' });
        }

        const success = await tulipaService.triggerBrainSync();
        res.json({ success, message: success ? 'Sync triggered' : 'Sync failed' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/integration/sync/status
 * Get CRM sync status
 */
router.get('/sync/status', async (req, res) => {
    try {
        const status = await syncService.getSyncStatus();
        res.json(status);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/integration/sync/matches
 * Get all Brain people with their Dolibarr match status
 */
router.get('/sync/matches', async (req, res) => {
    try {
        if (!FEATURES.TULIPA_ENABLED) {
            return res.status(400).json({ error: 'Tulipa integration not enabled' });
        }

        const matches = await syncService.getPeopleWithMatches();
        res.json({
            count: matches.length,
            data: matches.map(m => ({
                brainPerson: {
                    id: m.brainPerson.id,
                    name: m.brainPerson.name,
                    phone: m.brainPerson.phone,
                    email: m.brainPerson.email,
                    messageCount: m.brainPerson.messageCount,
                    linkedCustomerId: m.brainPerson.linkedCustomerId
                },
                dolibarrCustomer: m.dolibarrCustomer ? {
                    id: m.dolibarrCustomer.id,
                    name: m.dolibarrCustomer.name || m.dolibarrCustomer.nom,
                    phone: m.dolibarrCustomer.phone || m.dolibarrCustomer.phone_mobile,
                    email: m.dolibarrCustomer.email
                } : null,
                matchType: m.matchType,
                confidence: m.confidence
            }))
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/integration/sync/link
 * Link a Brain person to a Dolibarr customer
 */
router.post('/sync/link', async (req, res) => {
    try {
        if (!FEATURES.TULIPA_ENABLED) {
            return res.status(400).json({ error: 'Tulipa integration not enabled' });
        }

        const { brainPersonId, dolibarrCustomerId } = z.object({
            brainPersonId: z.string().min(1),
            dolibarrCustomerId: z.string().min(1)
        }).parse(req.body);

        const success = await syncService.linkPersonToCustomer(brainPersonId, dolibarrCustomerId);
        res.json({ success });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: error.issues });
        }
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/integration/sync/create-customer
 * Create a Dolibarr customer from a Brain person
 */
router.post('/sync/create-customer', async (req, res) => {
    try {
        if (!FEATURES.TULIPA_ENABLED) {
            return res.status(400).json({ error: 'Tulipa integration not enabled' });
        }

        const { brainPersonId } = z.object({
            brainPersonId: z.string().min(1)
        }).parse(req.body);

        // Get the person from Brain
        const person = await tulipaService.getPerson(brainPersonId);
        if (!person) {
            return res.status(404).json({ error: 'Brain person not found' });
        }

        // Create customer
        const customerId = await syncService.createCustomerFromPerson(person);
        if (customerId) {
            res.json({ success: true, customerId });
        } else {
            res.status(500).json({ success: false, error: 'Failed to create customer' });
        }
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: error.issues });
        }
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/integration/sync/run
 * Run full sync (with options)
 */
router.post('/sync/run', async (req, res) => {
    try {
        if (!syncService.isEnabled()) {
            return res.status(400).json({ error: 'CRM sync not enabled. Set TULIPA_ENABLED=true and CRM_SYNC_ENABLED=true' });
        }

        const options = z.object({
            autoCreate: z.boolean().optional(),
            autoLink: z.boolean().optional()
        }).parse(req.body);

        const result = await syncService.syncAll(options);
        res.json(result);
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: error.issues });
        }
        res.status(500).json({ error: error.message });
    }
});

export default router;
