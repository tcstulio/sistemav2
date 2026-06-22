import { Router } from 'express';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { dolibarrService } from '../services/dolibarrService';
import { delegationService } from '../services/delegationService';
import { delegationEventsService } from '../services/delegationEventsService';
import { dispatchTaskNotification } from '../services/taskNotificationService';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { createLogger } from '../utils/logger';

const log = createLogger('Dolibarr');
const router = Router();

// Basic Rate Limiter: 5000 requests per 15 minutes per IP
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later." }
});

router.use(limiter);
router.use(requireDolibarrLogin);


// --- Zod Schemas for Validation ---
// We define simplified schemas to validate incoming payloads before sending to Dolibarr
// This prevents malformed requests from even reaching the service

const ThirdPartySchema = z.object({
    name: z.string().min(1),
    code_client: z.string().optional(),
    email: z.string().email().optional().or(z.literal('')),
    client: z.enum(['1', '2', '3']).optional(), // 1=Customer, 2=Prospect, 3=Both
    fournisseur: z.enum(['0', '1']).optional(), // 0=No, 1=Yes
});

const TaskContactSchema = z.object({
    userId: z.union([z.string().min(1), z.number()]),
    // TASKEXECUTIVE = Responsável | TASKCONTRIBUTOR = Interveniente (element_contact, issue #72)
    typeCode: z.enum(['TASKEXECUTIVE', 'TASKCONTRIBUTOR']).optional(),
});

const InvoiceSchema = z.object({
    socid: z.string().min(1), // ThirdParty ID is required
    date: z.number().or(z.string()), // Timestamp or Date string
    type: z.number().default(0), // 0=Standard
    lines: z.array(z.object({
        desc: z.string().optional(),
        subprice: z.number(),
        qty: z.number().min(1),
        tva_tx: z.number().optional(),
        fk_product: z.number().optional()
    })).min(1)
});

// Middleware helper for validation
const validate = (schema: z.ZodSchema) => (req: any, res: any, next: any) => {
    try {
        schema.parse(req.body);
        next();
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        return res.status(400).json({ error: 'Invalid Request' });
    }
};

// --- Controller Methods for Strict Typed Actions ---

// Helper to extract key from Header OR Query
const getApiKey = (req: any): string | undefined => {
    const headerKey = req.headers['dolapikey'];
    if (headerKey) return headerKey as string;

    const queryKey = req.query.DOLAPIKEY;
    if (queryKey) return queryKey as string;

    return undefined;
};

// Create Third Party
router.post('/thirdparties', validate(ThirdPartySchema), async (req, res) => {
    try {
        const userKey = getApiKey(req);
        const result = await dolibarrService.createThirdParty(req.body, userKey);
        res.json(result);
    } catch (error: any) {
        // Error is now normalized by Service
        const status = error.status || 500;
        res.status(status).json({ error: error.message, details: error.details });
    }
});

// Create Invoice
router.post('/invoices', validate(InvoiceSchema), async (req, res) => {
    try {
        const userKey = getApiKey(req);
        const result = await dolibarrService.createInvoice(req.body, userKey);
        res.json(result);
    } catch (error: any) {
        const status = error.status || 500;
        res.status(status).json({ error: error.message, details: error.details });
    }
});

// Add Payment
router.post('/invoices/:id/payments', async (req, res) => {
    try {
        const userKey = getApiKey(req);
        const result = await dolibarrService.addPayment(req.params.id, req.body, userKey);
        res.json(result);
    } catch (error: any) {
        const status = error.status || 500;
        res.status(status).json({ error: error.message, details: error.details });
    }
});

// Validate Supplier Order
router.post('/supplierorders/:id/validate', async (req, res) => {
    try {
        const userKey = getApiKey(req);
        const result = await dolibarrService.validateSupplierOrder(req.params.id, req.body, userKey);
        res.json(result);
    } catch (error: any) {
        const status = error.status || 500;
        res.status(status).json({ error: error.message, details: error.details });
    }
});

// Close Proposal
router.post('/proposals/:id/close', async (req, res) => {
    try {
        const userKey = getApiKey(req);
        const result = await dolibarrService.closeProposal(req.params.id, req.body, userKey);
        res.json(result);
    } catch (error: any) {
        const status = error.status || 500;
        res.status(status).json({ error: error.message, details: error.details });
    }
});

// Add Time Spent
router.post('/tasks/:id/addtimespent', async (req, res) => {
    try {
        const userKey = getApiKey(req);
        const result = await dolibarrService.addTimeSpent(req.params.id, req.body, userKey);
        res.json(result);
    } catch (error: any) {
        const status = error.status || 500;
        res.status(status).json({ error: error.message, details: error.details });
    }
});


// --- Task Contacts (Responsável/Interveniente) via custom_sync (issue #72) ---
// O canal confiável de atribuição: a REST padrão NÃO grava responsável de tarefa
// (não existe /tasks/{id}/participants); o vínculo vive em element_contact.
// Estas rotas precisam vir ANTES do wildcard '/*' abaixo.

// Listar os contatos (papéis) de uma tarefa
router.get('/tasks/:id/contacts', async (req, res) => {
    try {
        const contacts = await dolibarrService.getTaskContacts(req.params.id);
        res.json(contacts);
    } catch (error: any) {
        const status = error.status || 500;
        res.status(status).json({ error: error.message });
    }
});

// Atribuir Responsável (TASKEXECUTIVE) ou Interveniente (TASKCONTRIBUTOR)
router.post('/tasks/:id/contacts', validate(TaskContactSchema), async (req, res) => {
    try {
        const typeCode = req.body.typeCode || 'TASKEXECUTIVE';
        const ok = await dolibarrService.setTaskContact(req.params.id, String(req.body.userId), typeCode);
        if (!ok) return res.status(502).json({ error: 'Falha ao gravar o contato da tarefa no Dolibarr' });
        res.json({ success: true });
    } catch (error: any) {
        const status = error.status || 500;
        res.status(status).json({ error: error.message });
    }
});

// Remover um vínculo de contato (rowid de element_contact)
router.delete('/tasks/:id/contacts/:rowid', async (req, res) => {
    try {
        const ok = await dolibarrService.removeTaskContact(req.params.id, req.params.rowid);
        if (!ok) return res.status(502).json({ error: 'Falha ao remover o contato da tarefa no Dolibarr' });
        res.json({ success: true });
    } catch (error: any) {
        const status = error.status || 500;
        res.status(status).json({ error: error.message });
    }
});

// --- Delegação: ciclo de vida (aceite) sobre a tarefa (Fase 1.5) ---
// Metadados do ciclo vivem no delegationService (store backend); estas rotas vêm ANTES do wildcard.
const TaskRef = z.object({
    id: z.union([z.string(), z.number()]),
    fk_user_creat: z.union([z.string(), z.number()]).optional(),
    label: z.string().optional(),
    ref: z.string().optional(),
    date_end: z.union([z.string(), z.number()]).optional().nullable(),
    progress: z.union([z.string(), z.number()]).optional().nullable(),
}).passthrough();

// Estado atual da delegação (aceite/critério). null se a tarefa ainda não é uma delegação.
router.get('/tasks/:id/delegation', async (req, res) => {
    try {
        res.json(delegationService.get(req.params.id) || null);
    } catch (error: any) {
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Linha do tempo (histórico) da delegação — quem/quando/o quê.
router.get('/tasks/:id/delegation/events', async (req, res) => {
    try {
        res.json(delegationEventsService.getEvents(req.params.id));
    } catch (error: any) {
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Documentação oficial (objetivo + critério de pronto) — visível a todos os envolvidos.
router.put('/tasks/:id/delegation/doc',
    validate(z.object({ objetivo: z.string().max(2000).optional(), criterio: z.string().max(2000).optional() })),
    async (req, res) => {
        try {
            const rec = delegationService.setDoc(req.params.id, { objetivo: req.body.objetivo, criterio: req.body.criterio });
            delegationEventsService.logEvent(req.params.id, 'doc_updated');
            res.json({ success: true, delegation: rec });
        } catch (error: any) {
            res.status(error.status || 500).json({ error: error.message });
        }
    });

// Define o template de execução estruturada (ex.: contagem de estoque) — verificação N2.
router.put('/tasks/:id/delegation/template',
    validate(z.object({ template: z.string().min(1).max(64), templateConfig: z.any().optional() })),
    async (req, res) => {
        try {
            const rec = delegationService.setTemplate(req.params.id, req.body.template, req.body.templateConfig);
            delegationEventsService.logEvent(req.params.id, 'template_set', { note: req.body.template });
            res.json({ success: true, delegation: rec });
        } catch (error: any) {
            res.status(error.status || 500).json({ error: error.message });
        }
    });

// Solicita o aceite: marca pending com prazo e avisa o responsável (acceptance_pending).
router.post('/tasks/:id/delegation/request-acceptance',
    validate(z.object({ task: TaskRef, prazoDeAceiteDays: z.number().int().positive().optional(), by: z.string().optional() })),
    async (req, res) => {
        try {
            const rec = delegationService.requestAcceptance(req.params.id, {
                prazoDeAceiteDays: req.body.prazoDeAceiteDays,
                by: req.body.by,
            });
            delegationEventsService.logEvent(req.params.id, 'requested', { by: req.body.by });
            await dispatchTaskNotification('acceptance_pending', req.body.task);
            res.json({ success: true, delegation: rec });
        } catch (error: any) {
            res.status(error.status || 500).json({ error: error.message });
        }
    });

// Responsável ACEITA a delegação.
router.post('/tasks/:id/delegation/accept',
    validate(z.object({ by: z.string().min(1) })),
    async (req, res) => {
        try {
            const rec = delegationService.accept(req.params.id, req.body.by);
            delegationEventsService.logEvent(req.params.id, 'accepted', { by: req.body.by });
            res.json({ success: true, delegation: rec });
        } catch (error: any) {
            res.status(error.status || 500).json({ error: error.message });
        }
    });

// Responsável RECUSA -> escala imediatamente ao solicitante (acceptance_overdue).
router.post('/tasks/:id/delegation/decline',
    validate(z.object({ by: z.string().min(1), reason: z.string().optional(), task: TaskRef })),
    async (req, res) => {
        try {
            const rec = delegationService.decline(req.params.id, req.body.by, req.body.reason);
            delegationEventsService.logEvent(req.params.id, 'declined', { by: req.body.by, note: req.body.reason });
            await dispatchTaskNotification('acceptance_overdue', req.body.task);
            res.json({ success: true, delegation: rec });
        } catch (error: any) {
            res.status(error.status || 500).json({ error: error.message });
        }
    });

// --- Interventions: update via custom_sync (issue #656) ---
// A REST padrão do Dolibarr NÃO expõe PUT /interventions/{id}; gravamos via
// custom_sync (action=update_intervention). Esta rota vem ANTES do wildcard '/*'
// para não cair no proxy genérico (que rotearia para o endpoint inexistente).
const InterventionUpdateSchema = z.object({
    socid: z.union([z.string(), z.number()]).optional(),
    date: z.union([z.string(), z.number()]).optional(),
    fk_project: z.union([z.string(), z.number()]).optional(),
    description: z.string().max(8000).optional(),
}).refine(
    (v) => v.socid != null || v.date != null || v.fk_project != null || v.description != null,
    { message: 'Ao menos um campo deve ser informado para atualização' }
);

// PUT /api/dolibarr/interventions/:id — edita uma intervenção (issue #656)
router.put('/interventions/:id', validate(InterventionUpdateSchema), async (req, res) => {
    try {
        const result = await dolibarrService.updateIntervention(req.params.id, req.body);
        res.json(result);
    } catch (error: any) {
        const status = error.status || 500;
        res.status(status).json({ error: error.message, details: error.details });
    }
});

// --- Delta Sync Custom Endpoint ---
// Routes to custom_sync.php at Dolibarr root (not /api/index.php)
router.get('/custom_sync.php', async (req, res) => {
    try {
        const response = await dolibarrService.proxyCustomSync(req.query, req.headers);
        res.status(response.status).json(response.data);
    } catch (error: any) {
        log.error('CustomSync Proxy Error', { error: error.message });
        const status = error.status || 500;
        res.status(status).json({ error: error.message || 'Custom Sync Error' });
    }
});

// --- Wildcard Proxy for Everything Else (Reads & Untyped Writes) ---
// Forwards all requests from /api/dolibarr/* to the actual Dolibarr URL
router.all('/*', async (req, res) => {
    try {
        // req.path will be something like "/thirdparties/123" or "/invoices"
        // Note: The specific routes above will be matched FIRST by Express if they match exactly.
        // However, "all /*" matches everything. We need to ensure specific routes are defined BEFORE this wildcard.
        // Express executes in order. So the above definitions capture the specific POSTs.
        // For existing GETs or other POSTs not defined above, this wildcard catches them.

        const response = await dolibarrService.proxyRequest(
            req.method,
            req.path,
            req.body,
            req.query,
            req.headers
        );

        res.status(response.status).json(response.data);

    } catch (error: any) {
        log.error('Proxy Error', { error: error.message });
        const status = error.status || 500;
        res.status(status).json({ error: error.message || 'Internal Proxy Error', details: error.details });
    }
});

export default router;
