import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { schedulerService } from '../services/schedulerService';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { validate, validateQuery, validateParams } from '../middleware/validation';
import { schedulerLimiter } from '../middleware/rateLimit';
import { ok, fail } from '../utils/apiResponse';
import { createLogger } from '../utils/logger';

const log = createLogger('Scheduler');
const router = Router();

// Protect all scheduler routes
router.use(requireDolibarrLogin);

// ============================================================
// #1567 — Schemas Zod para todos os endpoints do scheduler.
// Cap de destinatários fixado em 100 (anti-spam em massa) por
// chamada; o cap configurável via SCHEDULER_MAX_BROADCAST no env
// continua valendo como defesa em profundidade no serviço para
// callers não-HTTP (ex.: agente).
// ============================================================

const RELATIVE_TIME_REGEX = /^\+\d+[mhd]$/;

const ScheduledAtSchema = z.union([
    z.string().datetime({ offset: true }),
    z.string().regex(RELATIVE_TIME_REGEX, 'scheduledAt inválido'),
    z.number().int().nonnegative()
]);

const ChannelSchema = z.enum(['whatsapp', 'email']);
const TemplateIdSchema = z.union([
    z.string().uuid(),
    z.string().regex(/^tpl[-_][A-Za-z0-9-]+$/, 'templateId inválido')
]);
const TemplateCategorySchema = z.enum(['reminder', 'news', 'confirmation', 'general']);
const MessageStatusSchema = z.enum(['pending', 'sent', 'cancelled', 'failed']);

// --- Schedule a single message ---
const ScheduleBodySchema = z.object({
    chatId: z.string().min(1, 'chatId é obrigatório').max(128),
    sessionId: z.string().min(1, 'sessionId é obrigatório').max(128),
    message: z.string().min(1, 'message é obrigatório').max(4096),
    scheduledAt: ScheduledAtSchema.optional(),
    type: z.enum(['once', 'reminder', 'broadcast', 'confirmation']).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    channel: ChannelSchema.optional(),
    subject: z.string().max(255).optional(),
});

// --- Broadcast to multiple contacts ---
const RecipientsSchema = z.array(z.string().min(1).max(128))
    .min(1, 'É necessário informar pelo menos um destinatário')
    .max(100, 'Máximo de 100 destinatários por chamada');

const BroadcastBodySchema = z.object({
    sessionId: z.string().min(1, 'sessionId é obrigatório').max(128).optional().default('default'),
    chatIds: RecipientsSchema.optional(),
    recipients: RecipientsSchema.optional(),
    message: z.string().min(1, 'message é obrigatório').max(4096),
    scheduledAt: ScheduledAtSchema.optional(),
    delayBetween: z.number().int().min(0).max(60000).optional(),
    channel: ChannelSchema.optional(),
    subject: z.string().max(255).optional(),
    templateId: TemplateIdSchema.optional(),
    variables: z.record(z.string(), z.string()).optional(),
}).refine(data => data.chatIds || data.recipients, {
    path: ['recipients'],
    message: 'É necessário informar destinatários',
}).transform(data => ({
    ...data,
    chatIds: data.chatIds || data.recipients || [],
}));

// --- Confirmation request ---
const ConfirmationBodySchema = z.object({
    chatId: z.string().min(1, 'chatId é obrigatório').max(128),
    sessionId: z.string().min(1, 'sessionId é obrigatório').max(128),
    message: z.string().min(1, 'message é obrigatório').max(4096),
    timeoutMinutes: z.number().int().positive().max(24 * 60).optional(),
    onConfirm: z.string().max(2048).optional(),
    onReject: z.string().max(2048).optional(),
});

// --- Reminder (recurring) ---
const ReminderBodySchema = z.object({
    chatId: z.string().min(1, 'chatId é obrigatório').max(128),
    sessionId: z.string().min(1, 'sessionId é obrigatório').max(128),
    message: z.string().min(1, 'message é obrigatório').max(4096),
    firstSendAt: ScheduledAtSchema.optional(),
    interval: z.number().int().positive('interval deve ser > 0').max(1000),
    unit: z.enum(['minutes', 'hours', 'days']),
});

// --- Pending list query ---
const PendingQuerySchema = z.object({
    sessionId: z.string().min(1).max(128).optional(),
});

// --- History list query ---
const HistoryQuerySchema = z.object({
    sessionId: z.string().min(1).max(128).optional(),
    status: MessageStatusSchema.optional(),
    limit: z.string().regex(/^\d+$/, 'limit deve ser numérico').transform(Number).optional(),
});

// --- Message id path param ---
const MessageIdParamSchema = z.object({
    id: z.string().min(1, 'id é obrigatório').max(128),
});

// --- Template id path param ---
const TemplateIdParamSchema = z.object({
    id: z.string().min(1, 'id é obrigatório').max(128),
});

// --- Create template ---
const CreateTemplateBodySchema = z.object({
    name: z.string().min(1, 'name é obrigatório').max(120),
    content: z.string().min(1, 'content é obrigatório').max(4096),
    category: TemplateCategorySchema.optional(),
    channel: ChannelSchema.optional(),
    subject: z.string().max(255).optional(),
    variables: z.array(z.string().min(1).max(64)).max(50).optional(),
});

// --- Update template (partial) ---
const UpdateTemplateBodySchema = z.object({
    name: z.string().min(1).max(120).optional(),
    content: z.string().min(1).max(4096).optional(),
    category: TemplateCategorySchema.optional(),
    channel: ChannelSchema.optional(),
    subject: z.string().max(255).optional(),
}).refine(data => Object.keys(data).length > 0, {
    message: 'Pelo menos um campo deve ser fornecido para atualização',
});

// --- Send using template ---
const SendTemplateBodySchema = z.object({
    templateId: TemplateIdSchema,
    chatId: z.string().min(1, 'chatId é obrigatório').max(128),
    sessionId: z.string().min(1, 'sessionId é obrigatório').max(128),
    variables: z.record(z.string(), z.string()).optional(),
    scheduledAt: ScheduledAtSchema.optional(),
});

// --- Import CSV for broadcast ---
const ImportCsvBodySchema = z.object({
    csvContent: z.string().min(1, 'csvContent é obrigatório').max(5 * 1024 * 1024),
    sessionId: z.string().min(1, 'sessionId é obrigatório').max(128),
    message: z.string().min(1, 'message é obrigatório').max(4096),
    scheduledAt: ScheduledAtSchema.optional(),
    delayBetween: z.number().int().min(0).max(60000).optional(),
});

// --- Broadcasts list query ---
const EmptyQuerySchema = z.object({}).strict();

// --- Broadcast id path param ---
const BroadcastIdParamSchema = z.object({
    id: z.string().min(1, 'id é obrigatório').max(128),
});

// ============================================================
// #1567 — Render seguro de template (anti-injection).
// Escapa caracteres de controle / HTML nas variáveis antes da
// substituição para impedir XSS em e-mail e expansão aninhada
// maliciosa ({{var}} que contém {{outra_var}}).
// ============================================================

const DANGEROUS_VAR_RE = /\{\{[^}]*?\}\}/g;
const TEMPLATE_VARIABLE_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const TEMPLATE_HTML_ESCAPES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
};

type RenderedTemplate = { content: string } | { error: string };

function sanitizeTemplateVariable(value: string): string {
    return value
        .replace(DANGEROUS_VAR_RE, '')
        .replace(/[&<>"']/g, character => TEMPLATE_HTML_ESCAPES[character])
        .slice(0, 4096);
}

function renderTemplateSafely(
    templateId: string,
    variables: Record<string, string> = {}
): RenderedTemplate | null {
    const template = schedulerService.getTemplate(templateId);
    if (!template) return null;

    const placeholders = new Set<string>();
    template.content.replace(TEMPLATE_VARIABLE_RE, (_match, key: string) => {
        placeholders.add(key);
        return _match;
    });

    const providedKeys = Object.keys(variables);
    const unknownKeys = providedKeys.filter(key => !placeholders.has(key));
    if (unknownKeys.length > 0) {
        return { error: `Variáveis não permitidas: ${unknownKeys.join(', ')}` };
    }

    const missingKeys = [...placeholders].filter(key => variables[key] === undefined);
    if (missingKeys.length > 0) {
        return { error: `Variáveis obrigatórias ausentes: ${missingKeys.join(', ')}` };
    }

    const safeVariables = Object.fromEntries(
        providedKeys.map(key => [key, sanitizeTemplateVariable(String(variables[key] ?? ''))])
    );
    const content = template.content.replace(
        TEMPLATE_VARIABLE_RE,
        (_match, key: string) => safeVariables[key] ?? ''
    );

    return { content };
}

// ============================================================
// Helpers de parsing (mantidos para formatos não cobertos pelo Zod).
// ============================================================

function parseScheduledAt(input: unknown): number | null {
    if (input === undefined || input === null || input === '') return Date.now();
    if (typeof input === 'number') return input;
    if (typeof input === 'string') {
        if (RELATIVE_TIME_REGEX.test(input)) {
            const match = input.match(/^\+(\d+)([mhd])$/);
            if (!match) return null;
            const [, num, unit] = match;
            let ms = parseInt(num, 10);
            if (unit === 'h') ms *= 60;
            else if (unit === 'd') ms *= 60 * 24;
            ms *= 60 * 1000;
            return Date.now() + ms;
        }
        const ts = new Date(input).getTime();
        return Number.isFinite(ts) ? ts : null;
    }
    return null;
}

// ============================================================
// Routes
// ============================================================

// --- Schedule a single message ---

router.post('/schedule', schedulerLimiter, validate(ScheduleBodySchema), async (req: Request, res: Response) => {
    try {
        const { chatId, sessionId, message, scheduledAt, type, metadata, channel, subject } = req.body as z.infer<typeof ScheduleBodySchema>;

        const scheduleTime = parseScheduledAt(scheduledAt);
        if (scheduleTime === null) {
            return fail(res, 'BAD_REQUEST', 'scheduledAt inválido. Use ISO 8601, timestamp ms, ou formato relativo +5m/+1h/+2d', 400);
        }

        const msg = schedulerService.scheduleMessage({
            chatId,
            sessionId,
            channel,
            subject,
            message,
            scheduledAt: scheduleTime,
            type: type || 'once',
            metadata
        });

        return ok(res, msg);

    } catch (error: any) {
        log.error('Schedule error', { error: error.message, stack: error.stack });
        return fail(res, 'INTERNAL_ERROR', 'Falha ao agendar mensagem', 500);
    }
});

// --- Schedule broadcast to multiple contacts ---

router.post('/broadcast', schedulerLimiter, validate(BroadcastBodySchema), async (req: Request, res: Response) => {
    try {
        const { sessionId, chatIds, message, scheduledAt, delayBetween, channel, subject, templateId, variables } = req.body as z.infer<typeof BroadcastBodySchema>;

        // #1567 anti-injection: se templateId foi informado, garantir que existe
        // ANTES de tentar renderizar.
        if (templateId && !schedulerService.getTemplate(templateId)) {
            return fail(res, 'VALIDATION_ERROR', `Template '${templateId}' não encontrado`, 400);
        }

        const scheduleTime = scheduledAt === undefined ? undefined : parseScheduledAt(scheduledAt);
        if (scheduleTime === null) {
            return fail(res, 'BAD_REQUEST', 'scheduledAt inválido', 400);
        }

        let finalMessage = message;
        if (templateId) {
            const rendered = renderTemplateSafely(templateId, variables || {});
            if (!rendered) {
                return fail(res, 'VALIDATION_ERROR', `Template '${templateId}' não encontrado`, 400);
            }
            if ('error' in rendered) {
                return fail(res, 'VALIDATION_ERROR', rendered.error, 400);
            }
            finalMessage = rendered.content;
        }

        const messages = await schedulerService.scheduleBroadcast({
            sessionId,
            chatIds,
            channel,
            subject,
            message: finalMessage,
            scheduledAt: scheduleTime,
            delayBetween: delayBetween || 3000
        });

        return ok(res, {
            messages,
            count: messages.length,
            broadcastId: messages[0]?.metadata?.broadcastId
        });

    } catch (error: any) {
        log.error('Broadcast error', { error: error.message, stack: error.stack });
        return fail(res, 'INTERNAL_ERROR', 'Falha ao agendar broadcast', 500);
    }
});

// --- Schedule confirmation request ---

router.post('/confirmation', schedulerLimiter, validate(ConfirmationBodySchema), async (req: Request, res: Response) => {
    try {
        const { chatId, sessionId, message, timeoutMinutes, onConfirm, onReject } = req.body as z.infer<typeof ConfirmationBodySchema>;

        const msg = schedulerService.scheduleConfirmation({
            chatId,
            sessionId,
            message,
            timeoutMinutes: timeoutMinutes || 60,
            onConfirm,
            onReject
        });

        return ok(res, {
            message: msg,
            expiresAt: new Date(Date.now() + (timeoutMinutes || 60) * 60 * 1000).toISOString()
        });

    } catch (error: any) {
        log.error('Confirmation error', { error: error.message, stack: error.stack });
        return fail(res, 'INTERNAL_ERROR', 'Falha ao agendar confirmação', 500);
    }
});

// --- Schedule recurring reminder ---

router.post('/reminder', schedulerLimiter, validate(ReminderBodySchema), async (req: Request, res: Response) => {
    try {
        const { chatId, sessionId, message, firstSendAt, interval, unit } = req.body as z.infer<typeof ReminderBodySchema>;

        const scheduleTime = firstSendAt === undefined ? Date.now() : parseScheduledAt(firstSendAt);
        if (scheduleTime === null) {
            return fail(res, 'BAD_REQUEST', 'firstSendAt inválido', 400);
        }

        const msg = schedulerService.scheduleReminder({
            chatId,
            sessionId,
            message,
            firstSendAt: scheduleTime,
            recurrence: { interval, unit }
        });

        return ok(res, {
            message: msg,
            recurrence: { interval, unit }
        });

    } catch (error: any) {
        log.error('Reminder error', { error: error.message, stack: error.stack });
        return fail(res, 'INTERNAL_ERROR', 'Falha ao agendar lembrete', 500);
    }
});

// --- Get pending messages ---

router.get('/pending', validateQuery(PendingQuerySchema), (req: Request, res: Response) => {
    try {
        const { sessionId } = req.query as z.infer<typeof PendingQuerySchema>;
        const pending = schedulerService.getPending(sessionId);

        return ok(res, pending, { count: pending.length });

    } catch (error: any) {
        log.error('Pending error', { error: error.message, stack: error.stack });
        return fail(res, 'INTERNAL_ERROR', 'Falha ao listar pendentes', 500);
    }
});

// --- Get message history ---

router.get('/history', validateQuery(HistoryQuerySchema), (req: Request, res: Response) => {
    try {
        const { sessionId, status, limit } = req.query as unknown as z.infer<typeof HistoryQuerySchema>;

        const history = schedulerService.getHistory({
            sessionId,
            status,
            limit: limit || 50
        });

        return ok(res, history, { count: history.length });

    } catch (error: any) {
        log.error('History error', { error: error.message, stack: error.stack });
        return fail(res, 'INTERNAL_ERROR', 'Falha ao listar histórico', 500);
    }
});

// --- Cancel a scheduled message ---

router.delete('/:id', schedulerLimiter, validateParams(MessageIdParamSchema), (req: Request, res: Response) => {
    try {
        const { id } = req.params as z.infer<typeof MessageIdParamSchema>;
        const success = schedulerService.cancelMessage(id);

        if (!success) {
            return fail(res, 'NOT_FOUND', `Mensagem '${id}' não encontrada ou já processada`, 404);
        }

        return ok(res, { id, cancelled: true });

    } catch (error: any) {
        log.error('Cancel error', { error: error.message, stack: error.stack });
        return fail(res, 'INTERNAL_ERROR', 'Falha ao cancelar mensagem', 500);
    }
});

// --- Get stats ---

router.get('/stats', validateQuery(EmptyQuerySchema), (_req: Request, res: Response) => {
    try {
        const stats = schedulerService.getStats();
        return ok(res, stats);

    } catch (error: any) {
        log.error('Stats error', { error: error.message, stack: error.stack });
        return fail(res, 'INTERNAL_ERROR', 'Falha ao obter estatísticas', 500);
    }
});

// --- Templates ---

router.post('/templates', schedulerLimiter, validate(CreateTemplateBodySchema), (req: Request, res: Response) => {
    try {
        const { name, content, category, channel, subject } = req.body as z.infer<typeof CreateTemplateBodySchema>;

        const template = schedulerService.createTemplate({
            name,
            content,
            category,
            channel,
            subject
        });

        return ok(res, template);

    } catch (error: any) {
        log.error('Template create error', { error: error.message, stack: error.stack });
        return fail(res, 'INTERNAL_ERROR', 'Falha ao criar template', 500);
    }
});

router.get('/templates', validateQuery(EmptyQuerySchema), (_req: Request, res: Response) => {
    try {
        const templates = schedulerService.getTemplates();
        return ok(res, templates, { count: templates.length });

    } catch (error: any) {
        log.error('Templates list error', { error: error.message, stack: error.stack });
        return fail(res, 'INTERNAL_ERROR', 'Falha ao listar templates', 500);
    }
});

router.put('/templates/:id', schedulerLimiter, validateParams(TemplateIdParamSchema), validate(UpdateTemplateBodySchema), (req: Request, res: Response) => {
    try {
        const { id } = req.params as z.infer<typeof TemplateIdParamSchema>;
        const updates = req.body as z.infer<typeof UpdateTemplateBodySchema>;

        const updated = schedulerService.updateTemplate(id, updates);
        if (!updated) {
            return fail(res, 'NOT_FOUND', `Template '${id}' não encontrado`, 404);
        }

        return ok(res, updated);

    } catch (error: any) {
        log.error('Template update error', { error: error.message, stack: error.stack });
        return fail(res, 'INTERNAL_ERROR', 'Falha ao atualizar template', 500);
    }
});

router.delete('/templates/:id', schedulerLimiter, validateParams(TemplateIdParamSchema), (req: Request, res: Response) => {
    try {
        const { id } = req.params as z.infer<typeof TemplateIdParamSchema>;
        const success = schedulerService.deleteTemplate(id);

        if (!success) {
            return fail(res, 'NOT_FOUND', `Template '${id}' não encontrado`, 404);
        }

        return ok(res, { id, deleted: true });

    } catch (error: any) {
        log.error('Template delete error', { error: error.message, stack: error.stack });
        return fail(res, 'INTERNAL_ERROR', 'Falha ao excluir template', 500);
    }
});

// --- Send using template ---

router.post('/send-template', schedulerLimiter, validate(SendTemplateBodySchema), (req: Request, res: Response) => {
    try {
        const { templateId, chatId, sessionId, variables, scheduledAt } = req.body as z.infer<typeof SendTemplateBodySchema>;

        // #1567 anti-injection: renderTemplateSafely já valida existência,
        // mas checamos explicitamente para devolver erro claro em vez de null.
        if (!schedulerService.getTemplate(templateId)) {
            return fail(res, 'VALIDATION_ERROR', `Template '${templateId}' não encontrado`, 400);
        }

        const rendered = renderTemplateSafely(templateId, variables || {});
        if (!rendered) {
            return fail(res, 'NOT_FOUND', `Template '${templateId}' não encontrado`, 404);
        }
        if ('error' in rendered) {
            return fail(res, 'VALIDATION_ERROR', rendered.error, 400);
        }

        const scheduleTime = scheduledAt === undefined ? Date.now() : parseScheduledAt(scheduledAt);
        if (scheduleTime === null) {
            return fail(res, 'BAD_REQUEST', 'scheduledAt inválido', 400);
        }

        const msg = schedulerService.scheduleMessage({
            chatId,
            sessionId,
            message: rendered.content,
            scheduledAt: scheduleTime,
            metadata: { templateId, variables }
        });

        return ok(res, msg);

    } catch (error: any) {
        log.error('Send template error', { error: error.message, stack: error.stack });
        return fail(res, 'INTERNAL_ERROR', 'Falha ao enviar template', 500);
    }
});

// --- Import CSV for Broadcast ---

router.post('/import-csv', schedulerLimiter, validate(ImportCsvBodySchema), async (req: Request, res: Response) => {
    try {
        const { csvContent, sessionId, message, scheduledAt, delayBetween } = req.body as z.infer<typeof ImportCsvBodySchema>;

        const chatIds = schedulerService.parseCSVContacts(csvContent);

        if (chatIds.length === 0) {
            return fail(res, 'VALIDATION_ERROR', 'Nenhum número de telefone válido encontrado no CSV', 400);
        }

        if (chatIds.length > 100) {
            return fail(res, 'VALIDATION_ERROR', 'Máximo de 100 destinatários por chamada', 400);
        }

        const scheduleTime = scheduledAt === undefined ? undefined : parseScheduledAt(scheduledAt);
        if (scheduleTime === null) {
            return fail(res, 'BAD_REQUEST', 'scheduledAt inválido', 400);
        }

        const messages = await schedulerService.scheduleBroadcast({
            sessionId,
            chatIds,
            message,
            scheduledAt: scheduleTime,
            delayBetween: delayBetween || 3000
        });

        return ok(res, {
            messages,
            contactsFound: chatIds.length,
            count: messages.length,
            broadcastId: messages[0]?.metadata?.broadcastId
        });
    } catch (error: any) {
        log.error('CSV Import error', { error: error.message, stack: error.stack });
        return fail(res, 'INTERNAL_ERROR', 'Falha ao importar CSV', 500);
    }
});

// --- Broadcasts ---

router.get('/broadcasts', validateQuery(EmptyQuerySchema), (_req: Request, res: Response) => {
    try {
        const broadcasts = schedulerService.getBroadcasts();
        return ok(res, broadcasts, { count: broadcasts.length });

    } catch (error: any) {
        log.error('Broadcasts list error', { error: error.message, stack: error.stack });
        return fail(res, 'INTERNAL_ERROR', 'Falha ao listar broadcasts', 500);
    }
});

router.get('/broadcasts/:id', validateParams(BroadcastIdParamSchema), (req: Request, res: Response) => {
    try {
        const { id } = req.params as z.infer<typeof BroadcastIdParamSchema>;
        const details = schedulerService.getBroadcastDetails(id);

        if (!details) {
            return fail(res, 'NOT_FOUND', `Broadcast '${id}' não encontrado`, 404);
        }

        return ok(res, details);

    } catch (error: any) {
        log.error('Broadcast detail error', { error: error.message, stack: error.stack });
        return fail(res, 'INTERNAL_ERROR', 'Falha ao obter detalhes do broadcast', 500);
    }
});

export default router;
