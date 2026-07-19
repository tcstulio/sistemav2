import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { schedulerService } from '../services/schedulerService';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { validateBody, validateParams, IdParamSchema } from '../middleware/validation';
import { rateLimiters } from '../middleware/rateLimit';
import { fail } from '../utils/apiResponse';
import { createLogger } from '../utils/logger';

const log = createLogger('Scheduler');
const router = Router();

// Protect all scheduler routes
router.use(requireDolibarrLogin);

// =============================================
// Schemas (Zod) — issue #1567
// =============================================
// Cada endpoint mutativo (POST/PUT/DELETE) agora possui schema Zod dedicado
// aplicado via `validateBody`/`validateParams`. Erros de validação são
// propagados via `next(error)` ao errorHandler global, que devolve o envelope
// `{ success:false, error:{ code, message, details } }` com a lista de issues
// do Zod em `details`.

/** Teto de destinatários por chamada de broadcast (anti-spam em massa). */
const MAX_BROADCAST_RECIPIENTS = 100;

/** Campo `scheduledAt`/`firstSendAt` aceita ISO string ou timestamp numérico. */
const TimeOrStringSchema = z.union([z.string(), z.number()]).optional();

const ScheduleSchema = z.object({
    chatId: z.string().min(1, 'chatId é obrigatório'),
    sessionId: z.string().min(1, 'sessionId é obrigatório'),
    message: z.string().min(1, 'message é obrigatório'),
    scheduledAt: TimeOrStringSchema,
    type: z.string().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
    channel: z.enum(['whatsapp', 'email']).optional(),
    subject: z.string().optional(),
});

const BroadcastSchema = z.object({
    sessionId: z.string().min(1, 'sessionId é obrigatório'),
    chatIds: z.array(z.string().min(1))
        .min(1, 'chatIds não pode ser vazio')
        .max(MAX_BROADCAST_RECIPIENTS, 'Máximo de 100 destinatários por chamada'),
    message: z.string().min(1).max(4096),
    templateId: z.string().min(1, 'templateId inválido').optional(),
    variables: z.record(z.string(), z.string()).optional(),
    scheduledAt: TimeOrStringSchema,
    delayBetween: z.number().int().min(0).optional(),
    channel: z.enum(['whatsapp', 'email']).optional(),
    subject: z.string().optional(),
});

const ConfirmationSchema = z.object({
    chatId: z.string().min(1, 'chatId é obrigatório'),
    sessionId: z.string().min(1, 'sessionId é obrigatório'),
    message: z.string().min(1, 'message é obrigatório'),
    timeoutMinutes: z.number().int().min(1).optional(),
    onConfirm: z.string().optional(),
    onReject: z.string().optional(),
});

const ReminderSchema = z.object({
    chatId: z.string().min(1, 'chatId é obrigatório'),
    sessionId: z.string().min(1, 'sessionId é obrigatório'),
    message: z.string().min(1, 'message é obrigatório'),
    firstSendAt: TimeOrStringSchema,
    interval: z.number().int().positive('interval deve ser um inteiro positivo'),
    unit: z.enum(['minutes', 'hours', 'days']),
});

const TemplateCategorySchema = z.enum(['reminder', 'news', 'confirmation', 'general']);

const TemplateCreateSchema = z.object({
    name: z.string().min(1).max(120),
    content: z.string().min(1).max(4096),
    category: TemplateCategorySchema.optional(),
    channel: z.enum(['whatsapp', 'email']).optional(),
    subject: z.string().optional(),
});

const TemplateUpdateSchema = z.object({
    name: z.string().min(1).max(120).optional(),
    content: z.string().min(1).max(4096).optional(),
    category: TemplateCategorySchema.optional(),
    channel: z.enum(['whatsapp', 'email']).optional(),
    subject: z.string().optional(),
});

const SendTemplateSchema = z.object({
    templateId: z.string().min(1, 'templateId é obrigatório'),
    chatId: z.string().min(1, 'chatId é obrigatório'),
    sessionId: z.string().min(1, 'sessionId é obrigatório'),
    variables: z.record(z.string(), z.string()).optional(),
    scheduledAt: TimeOrStringSchema,
});

const ImportCsvSchema = z.object({
    csvContent: z.string().min(1, 'csvContent é obrigatório'),
    sessionId: z.string().min(1, 'sessionId é obrigatório'),
    message: z.string().min(1, 'message é obrigatório'),
    scheduledAt: TimeOrStringSchema,
    delayBetween: z.number().int().min(0).optional(),
});

// =============================================
// Template rendering (anti-injection) — #1567
// =============================================

/** Escapa valores de variáveis antes da substituição no template. */
function escapeVarValue(value: string): string {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Renderiza `{{variavel}}` escapando os VALORES (não concatenação crua) —
 * previne injeção de HTML/markup em canais de e-mail e adulteração de
 * templates via variáveis fornecidas pelo usuário.
 */
function renderTemplateSafe(content: string, variables: Record<string, string> = {}): string {
    let rendered = content;
    for (const [key, value] of Object.entries(variables)) {
        rendered = rendered.replaceAll(`{{${key}}}`, escapeVarValue(value));
    }
    return rendered;
}

// --- Schedule a single message ---

router.post('/schedule', rateLimiters.scheduler, validateBody(ScheduleSchema), async (req: Request, res: Response) => {
    try {
        const { chatId, sessionId, message, scheduledAt, type, metadata, channel, subject } = req.body;

        // Parse scheduledAt (can be ISO string, timestamp, or relative like "+5m", "+1h")
        let scheduleTime: number;
        if (typeof scheduledAt === 'string' && scheduledAt.startsWith('+')) {
            // Relative time: +5m, +1h, +2d
            const match = scheduledAt.match(/^\+(\d+)([mhd])$/);
            if (!match) {
                return fail(res, 'BAD_REQUEST', 'Invalid relative time format. Use +5m, +1h, +2d', 400);
            }
            const [, num, unit] = match;
            let ms = parseInt(num);
            if (unit === 'h') ms *= 60;
            if (unit === 'd') ms *= 60 * 24;
            ms *= 60 * 1000;
            scheduleTime = Date.now() + ms;
        } else if (typeof scheduledAt === 'string') {
            scheduleTime = new Date(scheduledAt).getTime();
        } else if (typeof scheduledAt === 'number') {
            scheduleTime = scheduledAt;
        } else {
            scheduleTime = Date.now(); // Send immediately
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

        res.json({
            success: true,
            data: msg,
            scheduledFor: new Date(scheduleTime).toISOString()
        });

    } catch (error: any) {
        log.error('Schedule error', { error: error.message, stack: error.stack });
        fail(res, 'INTERNAL_ERROR', error.message, 500);
    }
});

// --- Schedule broadcast to multiple contacts ---

router.post('/broadcast', rateLimiters.scheduler, validateBody(BroadcastSchema), async (req: Request, res: Response) => {
    try {
        const { sessionId, chatIds, message, templateId, variables, scheduledAt, delayBetween, channel, subject } = req.body;

        // #1567: se templateId veio, valida existência e renderiza com escape
        // (anti-injection). Template inexistente → 400 (erro de cliente).
        let finalMessage = message;
        if (templateId) {
            const template = schedulerService.getTemplate(templateId);
            if (!template) {
                return fail(res, 'BAD_REQUEST', 'Template não encontrado', 400);
            }
            finalMessage = renderTemplateSafe(template.content, variables || {});
        }

        let scheduleTime: number | undefined;
        if (scheduledAt) {
            scheduleTime = typeof scheduledAt === 'string' ? new Date(scheduledAt).getTime() : scheduledAt;
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

        res.json({
            success: true,
            count: messages.length,
            broadcastId: messages[0]?.metadata?.broadcastId,
            data: messages
        });

    } catch (error: any) {
        log.error('Broadcast error', { error: error.message, stack: error.stack });
        fail(res, 'INTERNAL_ERROR', error.message, 500);
    }
});

// --- Schedule confirmation request ---

router.post('/confirmation', rateLimiters.scheduler, validateBody(ConfirmationSchema), async (req: Request, res: Response) => {
    try {
        const { chatId, sessionId, message, timeoutMinutes, onConfirm, onReject } = req.body;

        const msg = schedulerService.scheduleConfirmation({
            chatId,
            sessionId,
            message,
            timeoutMinutes: timeoutMinutes || 60,
            onConfirm,
            onReject
        });

        res.json({
            success: true,
            data: msg,
            expiresAt: new Date(Date.now() + (timeoutMinutes || 60) * 60 * 1000).toISOString()
        });

    } catch (error: any) {
        log.error('Confirmation error', { error: error.message, stack: error.stack });
        fail(res, 'INTERNAL_ERROR', error.message, 500);
    }
});

// --- Schedule recurring reminder ---

router.post('/reminder', rateLimiters.scheduler, validateBody(ReminderSchema), async (req: Request, res: Response) => {
    try {
        const { chatId, sessionId, message, firstSendAt, interval, unit } = req.body;

        let scheduleTime = Date.now();
        if (firstSendAt) {
            scheduleTime = typeof firstSendAt === 'string' ? new Date(firstSendAt).getTime() : firstSendAt;
        }

        const msg = schedulerService.scheduleReminder({
            chatId,
            sessionId,
            message,
            firstSendAt: scheduleTime,
            recurrence: { interval, unit }
        });

        res.json({
            success: true,
            data: msg,
            recurrence: { interval, unit }
        });

    } catch (error: any) {
        log.error('Reminder error', { error: error.message, stack: error.stack });
        fail(res, 'INTERNAL_ERROR', error.message, 500);
    }
});

// --- Get pending messages ---

router.get('/pending', (req: Request, res: Response) => {
    try {
        const sessionId = req.query.sessionId as string;
        const pending = schedulerService.getPending(sessionId);

        res.json({
            success: true,
            count: pending.length,
            data: pending
        });

    } catch (error: any) {
        fail(res, 'INTERNAL_ERROR', error.message, 500);
    }
});

// --- Get message history ---

router.get('/history', (req: Request, res: Response) => {
    try {
        const { sessionId, status, limit } = req.query;

        const history = schedulerService.getHistory({
            sessionId: sessionId as string,
            status: status as any,
            limit: limit ? parseInt(limit as string) : 50
        });

        res.json({
            success: true,
            count: history.length,
            data: history
        });

    } catch (error: any) {
        fail(res, 'INTERNAL_ERROR', error.message, 500);
    }
});

// --- Cancel a scheduled message ---

router.delete('/:id', rateLimiters.scheduler, validateParams(IdParamSchema), (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const success = schedulerService.cancelMessage(id);

        if (success) {
            res.json({ success: true, message: `Message ${id} cancelled` });
        } else {
            fail(res, 'NOT_FOUND', 'Message not found or already processed', 404);
        }

    } catch (error: any) {
        fail(res, 'INTERNAL_ERROR', error.message, 500);
    }
});

// --- Get stats ---

router.get('/stats', (_req: Request, res: Response) => {
    try {
        const stats = schedulerService.getStats();
        res.json({ success: true, data: stats });

    } catch (error: any) {
        fail(res, 'INTERNAL_ERROR', error.message, 500);
    }
});

// --- Templates ---

router.post('/templates', rateLimiters.scheduler, validateBody(TemplateCreateSchema), (req: Request, res: Response) => {
    try {
        const { name, content, category, channel, subject } = req.body;

        const template = schedulerService.createTemplate({ name, content, category, channel, subject });
        res.json({ success: true, data: template });

    } catch (error: any) {
        fail(res, 'INTERNAL_ERROR', error.message, 500);
    }
});

router.get('/templates', (_req: Request, res: Response) => {
    try {
        const templates = schedulerService.getTemplates();
        res.json({ success: true, count: templates.length, data: templates });

    } catch (error: any) {
        fail(res, 'INTERNAL_ERROR', error.message, 500);
    }
});

router.put('/templates/:id', rateLimiters.scheduler, validateParams(IdParamSchema), validateBody(TemplateUpdateSchema), (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { name, content, category, channel, subject } = req.body;
        const updated = schedulerService.updateTemplate(id, { name, content, category, channel, subject });
        if (updated) {
            res.json({ success: true, data: updated });
        } else {
            fail(res, 'NOT_FOUND', 'Template not found', 404);
        }
    } catch (error: any) {
        fail(res, 'INTERNAL_ERROR', error.message, 500);
    }
});

router.delete('/templates/:id', rateLimiters.scheduler, validateParams(IdParamSchema), (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const success = schedulerService.deleteTemplate(id);

        if (success) {
            res.json({ success: true });
        } else {
            fail(res, 'NOT_FOUND', 'Template not found', 404);
        }

    } catch (error: any) {
        fail(res, 'INTERNAL_ERROR', error.message, 500);
    }
});

// --- Send using template ---

router.post('/send-template', rateLimiters.scheduler, validateBody(SendTemplateSchema), async (req: Request, res: Response) => {
    try {
        const { templateId, chatId, sessionId, variables, scheduledAt } = req.body;

        // #1567: valida existência do template e renderiza com escape (anti-injection).
        const template = schedulerService.getTemplate(templateId);
        if (!template) {
            return fail(res, 'NOT_FOUND', 'Template not found', 404);
        }

        const message = renderTemplateSafe(template.content, variables || {});

        let scheduleTime = Date.now();
        if (scheduledAt) {
            scheduleTime = typeof scheduledAt === 'string' ? new Date(scheduledAt).getTime() : scheduledAt;
        }

        const msg = schedulerService.scheduleMessage({
            chatId,
            sessionId,
            message,
            scheduledAt: scheduleTime,
            metadata: { templateId, variables }
        });

        res.json({ success: true, data: msg });

    } catch (error: any) {
        log.error('Send-template error', { error: error.message, stack: error.stack });
        fail(res, 'INTERNAL_ERROR', error.message, 500);
    }
});

// --- Import CSV for Broadcast ---

router.post('/import-csv', rateLimiters.scheduler, validateBody(ImportCsvSchema), async (req: Request, res: Response) => {
    try {
        const { csvContent, sessionId, message, scheduledAt, delayBetween } = req.body;

        // Parse CSV to extract phone numbers
        const chatIds = schedulerService.parseCSVContacts(csvContent);

        if (chatIds.length === 0) {
            return fail(res, 'BAD_REQUEST', 'No valid phone numbers found in CSV', 400);
        }

        // Create broadcast
        let scheduleTime: number | undefined;
        if (scheduledAt) {
            scheduleTime = typeof scheduledAt === 'string' ? new Date(scheduledAt).getTime() : scheduledAt;
        }

        const messages = await schedulerService.scheduleBroadcast({
            sessionId,
            chatIds,
            message,
            scheduledAt: scheduleTime,
            delayBetween: delayBetween || 3000
        });

        res.json({
            success: true,
            contactsFound: chatIds.length,
            broadcastId: messages[0]?.metadata?.broadcastId,
            count: messages.length,
            data: messages
        });

    } catch (error: any) {
        log.error('CSV Import error', { error: error.message, stack: error.stack });
        fail(res, 'INTERNAL_ERROR', error.message, 500);
    }
});

// --- Broadcasts ---

router.get('/broadcasts', (_req: Request, res: Response) => {
    try {
        const broadcasts = schedulerService.getBroadcasts();
        res.json({ success: true, count: broadcasts.length, data: broadcasts });
    } catch (error: any) {
        fail(res, 'INTERNAL_ERROR', error.message, 500);
    }
});

router.get('/broadcasts/:id', (req: Request, res: Response) => {
    try {
        const details = schedulerService.getBroadcastDetails(req.params.id);
        if (details) {
            res.json({ success: true, data: details });
        } else {
            fail(res, 'NOT_FOUND', 'Broadcast not found', 404);
        }
    } catch (error: any) {
        fail(res, 'INTERNAL_ERROR', error.message, 500);
    }
});

export default router;
