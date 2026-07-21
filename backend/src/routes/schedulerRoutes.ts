import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { schedulerService } from '../services/schedulerService';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { validateBody } from '../middleware/validation';
import { rateLimiters } from '../middleware/rateLimit';
import { config } from '../config/env';
import { createLogger } from '../utils/logger';
import { fail, ok } from '../utils/apiResponse';

const log = createLogger('Scheduler');
const router = Router();

const ScheduledAtSchema = z.union([
    z.number().finite(),
    z.string().min(1).refine(
        value => /^\+\d+[mhd]$/.test(value) || !Number.isNaN(Date.parse(value)),
        'Invalid scheduledAt. Use an ISO date, timestamp, or relative format such as +5m, +1h, +2d'
    ),
]).optional();

export const CreateJobSchema = z.object({
    chatId: z.string().min(1),
    sessionId: z.string().min(1),
    message: z.string().min(1),
    scheduledAt: ScheduledAtSchema,
    type: z.enum(['once', 'reminder', 'broadcast', 'confirmation']).optional(),
    metadata: z.any().optional(),
    channel: z.enum(['whatsapp', 'email']).optional(),
    subject: z.string().optional(),
});

export const BroadcastSchema = z.object({
    sessionId: z.string().min(1),
    chatIds: z.array(z.string().min(1))
        .min(1, 'chatIds não pode ser vazio')
        .max(
            config.schedulerMaxBroadcast,
            `Máximo de ${config.schedulerMaxBroadcast} destinatários por broadcast`
        ),
    message: z.string().min(1),
    scheduledAt: ScheduledAtSchema,
    delayBetween: z.number().int().min(0).optional(),
    channel: z.enum(['whatsapp', 'email']).optional(),
    subject: z.string().optional(),
});

export const TemplateSchema = z.object({
    name: z.string().min(1),
    content: z.string().min(1),
    category: z.enum(['reminder', 'news', 'confirmation', 'general']).optional(),
    channel: z.enum(['whatsapp', 'email']).optional(),
    subject: z.string().optional(),
});

const ConfirmationSchema = z.object({
    chatId: z.string().min(1),
    sessionId: z.string().min(1),
    message: z.string().min(1),
    timeoutMinutes: z.number().int().positive().optional(),
    onConfirm: z.string().optional(),
    onReject: z.string().optional(),
});

const ReminderSchema = z.object({
    chatId: z.string().min(1),
    sessionId: z.string().min(1),
    message: z.string().min(1),
    firstSendAt: ScheduledAtSchema,
    interval: z.number().int().positive(),
    unit: z.enum(['minutes', 'hours', 'days']),
});

const TemplateUpdateSchema = TemplateSchema.partial().refine(
    value => Object.keys(value).length > 0,
    'At least one template field must be provided'
);

const SendTemplateSchema = z.object({
    templateId: z.string().min(1),
    chatId: z.string().min(1),
    sessionId: z.string().min(1),
    variables: z.record(
        z.string(),
        z.union([z.string(), z.number(), z.boolean(), z.null()])
    ).optional(),
    scheduledAt: ScheduledAtSchema,
});

const ImportCsvSchema = z.object({
    csvContent: z.string().min(1),
    sessionId: z.string().min(1),
    message: z.string().min(1),
    scheduledAt: ScheduledAtSchema,
    delayBetween: z.number().int().min(0).optional(),
});

function parseScheduleTime(value: string | number | undefined, fallback = Date.now()): number {
    if (typeof value === 'number') return value;
    if (!value) return fallback;
    if (!value.startsWith('+')) return new Date(value).getTime();

    const match = value.match(/^\+(\d+)([mhd])$/);
    if (!match) return fallback;

    const amount = Number(match[1]);
    const multiplier = match[2] === 'd'
        ? 24 * 60 * 60 * 1000
        : match[2] === 'h'
            ? 60 * 60 * 1000
            : 60 * 1000;
    return Date.now() + amount * multiplier;
}

function internalError(res: Response, error: unknown, message: string) {
    const detail = error instanceof Error ? error.message : String(error);
    log.error(message, { error: detail, stack: error instanceof Error ? error.stack : undefined });
    return fail(res, 'INTERNAL_ERROR', message, 500);
}

function enforceBroadcastLimit(req: Request, res: Response, next: NextFunction) {
    const recipientCount = Array.isArray(req.body?.chatIds) ? req.body.chatIds.length : 0;
    if (recipientCount > config.schedulerMaxBroadcast) {
        return fail(
            res,
            'BAD_REQUEST',
            `Máximo de ${config.schedulerMaxBroadcast} destinatários por broadcast`,
            400
        );
    }
    return next();
}

router.use(requireDolibarrLogin);

const createJob = (req: Request, res: Response) => {
    try {
        const { chatId, sessionId, message, scheduledAt, type, metadata, channel, subject } = req.body;
        const scheduleTime = parseScheduleTime(scheduledAt);
        const job = schedulerService.scheduleMessage({
            chatId,
            sessionId,
            channel,
            subject,
            message,
            scheduledAt: scheduleTime,
            type: type || 'once',
            metadata,
        });

        return ok(res, job, { scheduledFor: new Date(scheduleTime).toISOString() });
    } catch (error) {
        return internalError(res, error, 'Failed to schedule message');
    }
};

router.post('/jobs', rateLimiters.scheduler, validateBody(CreateJobSchema), createJob);
router.post('/schedule', rateLimiters.scheduler, validateBody(CreateJobSchema), createJob);

router.post(
    '/broadcast',
    rateLimiters.scheduler,
    enforceBroadcastLimit,
    validateBody(BroadcastSchema),
    async (req: Request, res: Response) => {
        try {
            const { sessionId, chatIds, message, scheduledAt, delayBetween, channel, subject } = req.body;
            const messages = await schedulerService.scheduleBroadcast({
                sessionId,
                chatIds,
                channel,
                subject,
                message,
                scheduledAt: scheduledAt === undefined ? undefined : parseScheduleTime(scheduledAt),
                delayBetween: delayBetween ?? 3000,
            });

            return ok(res, messages, {
                count: messages.length,
                broadcastId: messages[0]?.metadata?.broadcastId,
            });
        } catch (error) {
            return internalError(res, error, 'Failed to schedule broadcast');
        }
    }
);

router.post('/confirmation', validateBody(ConfirmationSchema), (req: Request, res: Response) => {
    try {
        const { chatId, sessionId, message, timeoutMinutes, onConfirm, onReject } = req.body;
        const timeout = timeoutMinutes ?? 60;
        const job = schedulerService.scheduleConfirmation({
            chatId,
            sessionId,
            message,
            timeoutMinutes: timeout,
            onConfirm,
            onReject,
        });

        return ok(res, job, {
            expiresAt: new Date(Date.now() + timeout * 60 * 1000).toISOString(),
        });
    } catch (error) {
        return internalError(res, error, 'Failed to schedule confirmation');
    }
});

router.post('/reminder', validateBody(ReminderSchema), (req: Request, res: Response) => {
    try {
        const { chatId, sessionId, message, firstSendAt, interval, unit } = req.body;
        const scheduleTime = parseScheduleTime(firstSendAt);
        const job = schedulerService.scheduleReminder({
            chatId,
            sessionId,
            message,
            firstSendAt: scheduleTime,
            recurrence: { interval, unit },
        });

        return ok(res, job, { recurrence: { interval, unit } });
    } catch (error) {
        return internalError(res, error, 'Failed to schedule reminder');
    }
});

router.get('/pending', (req: Request, res: Response) => {
    try {
        const pending = schedulerService.getPending(req.query.sessionId as string | undefined);
        return ok(res, pending, { count: pending.length });
    } catch (error) {
        return internalError(res, error, 'Failed to list pending messages');
    }
});

router.get('/history', (req: Request, res: Response) => {
    try {
        const { sessionId, status, limit } = req.query;
        const history = schedulerService.getHistory({
            sessionId: sessionId as string,
            status: status as any,
            limit: limit ? parseInt(limit as string, 10) : 50,
        });
        return ok(res, history, { count: history.length });
    } catch (error) {
        return internalError(res, error, 'Failed to list message history');
    }
});

router.delete('/:id', (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        if (!schedulerService.cancelMessage(id)) {
            return fail(res, 'NOT_FOUND', 'Message not found or already processed', 404);
        }
        return ok(res, { message: `Message ${id} cancelled` });
    } catch (error) {
        return internalError(res, error, 'Failed to cancel message');
    }
});

router.get('/stats', (_req: Request, res: Response) => {
    try {
        return ok(res, schedulerService.getStats());
    } catch (error) {
        return internalError(res, error, 'Failed to load scheduler stats');
    }
});

router.post(
    '/templates',
    rateLimiters.scheduler,
    validateBody(TemplateSchema),
    (req: Request, res: Response) => {
        try {
            return ok(res, schedulerService.createTemplate(req.body));
        } catch (error) {
            return internalError(res, error, 'Failed to create template');
        }
    }
);

router.get('/templates', (_req: Request, res: Response) => {
    try {
        const templates = schedulerService.getTemplates();
        return ok(res, templates, { count: templates.length });
    } catch (error) {
        return internalError(res, error, 'Failed to list templates');
    }
});

router.put('/templates/:id', validateBody(TemplateUpdateSchema), (req: Request, res: Response) => {
    try {
        const updated = schedulerService.updateTemplate(req.params.id, req.body);
        if (!updated) return fail(res, 'NOT_FOUND', 'Template not found', 404);
        return ok(res, updated);
    } catch (error) {
        return internalError(res, error, 'Failed to update template');
    }
});

router.delete('/templates/:id', (req: Request, res: Response) => {
    try {
        if (!schedulerService.deleteTemplate(req.params.id)) {
            return fail(res, 'NOT_FOUND', 'Template not found', 404);
        }
        return ok(res, { id: req.params.id });
    } catch (error) {
        return internalError(res, error, 'Failed to delete template');
    }
});

router.post('/send-template', validateBody(SendTemplateSchema), (req: Request, res: Response) => {
    try {
        const { templateId, chatId, sessionId, scheduledAt } = req.body;
        const variables = Object.fromEntries(
            Object.entries(req.body.variables || {}).map(([key, value]) => [key, String(value ?? '')])
        );
        const message = schedulerService.renderTemplate(templateId, variables);
        if (!message) return fail(res, 'NOT_FOUND', 'Template not found', 404);

        const job = schedulerService.scheduleMessage({
            chatId,
            sessionId,
            message,
            scheduledAt: parseScheduleTime(scheduledAt),
            metadata: { templateId, variables },
        });
        return ok(res, job);
    } catch (error) {
        return internalError(res, error, 'Failed to send template');
    }
});

router.post('/import-csv', validateBody(ImportCsvSchema), async (req: Request, res: Response) => {
    try {
        const { csvContent, sessionId, message, scheduledAt, delayBetween } = req.body;
        const chatIds = schedulerService.parseCSVContacts(csvContent);
        if (chatIds.length === 0) {
            return fail(res, 'BAD_REQUEST', 'No valid phone numbers found in CSV', 400);
        }
        if (chatIds.length > config.schedulerMaxBroadcast) {
            return fail(
                res,
                'BAD_REQUEST',
                `Máximo de ${config.schedulerMaxBroadcast} destinatários por broadcast`,
                400
            );
        }

        const messages = await schedulerService.scheduleBroadcast({
            sessionId,
            chatIds,
            message,
            scheduledAt: scheduledAt === undefined ? undefined : parseScheduleTime(scheduledAt),
            delayBetween: delayBetween ?? 3000,
        });

        return ok(res, {
            contactsFound: chatIds.length,
            broadcastId: messages[0]?.metadata?.broadcastId,
            count: messages.length,
        });
    } catch (error) {
        return internalError(res, error, 'Failed to import CSV broadcast');
    }
});

router.get('/broadcasts', (_req: Request, res: Response) => {
    try {
        const broadcasts = schedulerService.getBroadcasts();
        return ok(res, broadcasts, { count: broadcasts.length });
    } catch (error) {
        return internalError(res, error, 'Failed to list broadcasts');
    }
});

router.get('/broadcasts/:id', (req: Request, res: Response) => {
    try {
        const details = schedulerService.getBroadcastDetails(req.params.id);
        if (!details) return fail(res, 'NOT_FOUND', 'Broadcast not found', 404);
        return ok(res, details);
    } catch (error) {
        return internalError(res, error, 'Failed to load broadcast');
    }
});

export default router;
