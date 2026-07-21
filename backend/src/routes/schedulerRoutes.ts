/**
 * Scheduler Routes (#1567)
 *
 * Endpoints REST do scheduler de mensagens. Cada rota é protegida por:
 *   1. `requireDolibarrLogin` (autenticação) — montado no `router.use`.
 *   2. `validateBody`/`validateParams`/`validateQuery` (Zod) — fail-FAST 400 com
 *      lista de erros do Zod (issue #1567). Erros de validação são propagados via
 *      `next(validationError)` ao errorHandler global — o envelope padronizado
 *      `{ success: false, error: { code: 'VALIDATION_ERROR', details: [...] } }`
 *      sai do errorHandler, não da rota.
 *   3. `schedulerLimiter` (rate-limit 10/1min) — aplicado SÓ em POST/PUT/DELETE
 *      via um wrapper `router.use` que pula GETs. Bucket único por IP (preset
 *      `rateLimiters.scheduler` em middleware/rateLimit.ts — single source of truth).
 *
 * Envelope padrão em TODAS as respostas (sucesso ou erro):
 *   Sucesso: `{ success: true, data, ...extras }`
 *   Erro:    `{ success: false, error: { code, message, details? } }`
 *   (Erros saem via `next(error)` → errorHandler global — ver middleware/errorHandler.ts)
 *
 * Anti-injection de template (#1567):
 *   - `templateId` precisa existir no store (`schedulerService.templateExists`) ANTES
 *     de renderizar; rota retorna 400 (envelope VALIDATION_ERROR) se não existir.
 *   - `renderTemplate` (no service) escapa HTML/sign-entities no valor E remove
 *     `{{...}}` recursivo, então um valor enviado pelo cliente não consegue injetar
 *     placeholders novos nem HTML.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { schedulerService } from '../services/schedulerService';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { rateLimiters } from '../middleware/rateLimit';
import { config } from '../config/env';
import { createLogger } from '../utils/logger';
import { AppError, NotFoundError, ValidationError } from '../middleware/errorHandler';

const log = createLogger('Scheduler');
const router = Router();

// Re-exporta `schedulerLimiter` com o nome canônico pedido na issue (#1567). É o
// MESMO preset exportado por middleware/rateLimit.ts (10/1min, bucket por IP,
// handler que delega via `next(error)` ao errorHandler — code `RATE_LIMIT`,
// status 429, envelope padronizado).
const schedulerLimiter = rateLimiters.scheduler;

// ===========================================
// Auth: todas as rotas exigem login Dolibarr
// ===========================================
router.use(requireDolibarrLogin);

// ===========================================
// Rate-limit: aplicado só em writes (#1567)
// ===========================================
// `schedulerLimiter` (10/1min) é restrito a POST/PUT/DELETE — leituras (GET)
// não consomem cota. Mantemos o limite em escopo de router para que TODAS as
// rotas de escrita compartilhem o mesmo bucket por IP (cumulativo).
router.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
        return next();
    }
    return schedulerLimiter(req, res, next);
});

// ===========================================
// Zod Schemas (#1567)
// ===========================================

/**
 * `scheduledAt` aceita ISO-string, timestamp numérico, OU offset relativo
 * (`+5m`, `+1h`, `+2d`) — o parser custom fica na rota; o Zod só garante que
 * é uma string ou número e que o formato relativo (se for string) bate.
 */
const ScheduledAtSchema = z.union([
    z.string().refine(
        (v) => v.startsWith('+')
            ? /^\+\d+(m|h|d)$/.test(v)
            : !Number.isNaN(new Date(v).getTime()),
        { message: 'scheduledAt inválido (use ISO, timestamp ou +Nm/+Nh/+Nd)' }
    ),
    z.number().int().positive(),
]);

/**
 * Schema de ID de rota — uma string não-vazia (cobre IDs gerados pelo service
 * como `msg_<ts>_<rand>`, `tpl_<ts>`, `broadcast_<ts>` — não são UUIDs).
 */
const IdParamSchema = z.object({
    id: z.string().min(1, 'id é obrigatório').max(200),
});

const SessionIdSchema = z.string().min(1, 'sessionId é obrigatório').max(200);

/**
 * Broadcast: a issue #1567 redefine o contrato — `recipients` substitui
 * `chatIds` e o cap cai de 500 (config) para 100 (hard cap), com mensagem
 * específica exigida pelo critério de aceite. Suporta `templateId` opcional
 * (validado pelo store) e mantém `sessionId`/extras p/ compat com frontend.
 */
const BroadcastSchema = z.object({
    sessionId: SessionIdSchema,
    recipients: z.array(z.string().min(1))
        .min(1, 'recipients não pode ser vazio')
        .max(100, 'Máximo de 100 destinatários por chamada'),
    message: z.string().min(1).max(4096),
    templateId: z.string().min(1).max(200).optional(),
    scheduledAt: ScheduledAtSchema.optional(),
    delayBetween: z.number().int().min(0).max(60_000).optional(),
    channel: z.enum(['whatsapp', 'email']).optional(),
    subject: z.string().max(500).optional(),
});

const ScheduleSchema = z.object({
    chatId: z.string().min(1).max(200),
    sessionId: SessionIdSchema,
    message: z.string().min(1).max(4096),
    scheduledAt: ScheduledAtSchema.optional(),
    type: z.enum(['once', 'reminder', 'broadcast', 'confirmation']).optional(),
    metadata: z.record(z.string(), z.any()).optional(),
    channel: z.enum(['whatsapp', 'email']).optional(),
    subject: z.string().max(500).optional(),
});

const ConfirmationSchema = z.object({
    chatId: z.string().min(1).max(200),
    sessionId: SessionIdSchema,
    message: z.string().min(1).max(4096),
    timeoutMinutes: z.number().int().min(1).max(7 * 24 * 60).optional(),
    onConfirm: z.string().max(1000).optional(),
    onReject: z.string().max(1000).optional(),
});

const ReminderUnitSchema = z.enum(['minutes', 'hours', 'days']);

const ReminderSchema = z.object({
    chatId: z.string().min(1).max(200),
    sessionId: SessionIdSchema,
    message: z.string().min(1).max(4096),
    firstSendAt: ScheduledAtSchema.optional(),
    interval: z.number().int().min(1).max(10_000),
    unit: ReminderUnitSchema,
});

/**
 * Template CRUD (#604) — mantém `category`, `channel`, `subject` (campos
 * legados que o frontend envia). `variables` aceita array de strings com
 * nomes lógicos de placeholders (sem `{{...}}` cru).
 */
const TemplateCreateSchema = z.object({
    name: z.string().min(1).max(120),
    content: z.string().min(1).max(4096),
    category: z.enum(['reminder', 'news', 'confirmation', 'general']).optional(),
    channel: z.enum(['whatsapp', 'email']).optional(),
    subject: z.string().max(500).optional(),
    variables: z.array(z.string().min(1).max(80)).optional(),
});

const TemplateUpdateSchema = TemplateCreateSchema.partial();

const SendTemplateSchema = z.object({
    templateId: z.string().min(1).max(200),
    chatId: z.string().min(1).max(200),
    sessionId: SessionIdSchema,
    variables: z.record(z.string(), z.string()).optional(),
    scheduledAt: ScheduledAtSchema.optional(),
});

const ImportCsvSchema = z.object({
    csvContent: z.string().min(1).max(5 * 1024 * 1024),
    sessionId: SessionIdSchema,
    message: z.string().min(1).max(4096),
    scheduledAt: ScheduledAtSchema.optional(),
    delayBetween: z.number().int().min(0).max(60_000).optional(),
});

const PendingQuerySchema = z.object({
    sessionId: z.string().min(1).max(200).optional(),
});

const HistoryQuerySchema = z.object({
    sessionId: z.string().min(1).max(200).optional(),
    status: z.enum(['pending', 'sent', 'cancelled', 'failed']).optional(),
    limit: z.string().regex(/^\d+$/).transform(Number).optional(),
});

// ===========================================
// Helpers
// ===========================================

/**
 * Converte `scheduledAt` em timestamp ms — aceita ISO, número, OU offset
 * relativo (`+5m`, `+1h`, `+2d`). Erros viram `ValidationError` (envelope
 * padronizado) em vez de 500. Mantido como helper compartilhado entre as
 * rotas que recebem `scheduledAt`.
 */
function parseScheduledAt(value: unknown, fallback?: number): number {
    const fallbackMs = fallback ?? Date.now();

    if (value === undefined || value === null || value === '') {
        return fallbackMs;
    }

    if (typeof value === 'number') {
        if (!Number.isFinite(value) || value <= 0) {
            throw new ValidationError('scheduledAt inválido: número deve ser > 0', [
                { field: 'scheduledAt', message: 'timestamp deve ser positivo' },
            ]);
        }
        return value;
    }

    if (typeof value === 'string') {
        if (value.startsWith('+')) {
            const match = value.match(/^\+(\d+)([mhd])$/);
            if (!match) {
                throw new ValidationError(
                    'Formato relativo inválido. Use +5m, +1h ou +2d',
                    [{ field: 'scheduledAt', message: 'formato relativo inválido' }],
                );
            }
            const [, num, unit] = match;
            let ms = parseInt(num, 10);
            if (unit === 'h') ms *= 60;
            if (unit === 'd') ms *= 60 * 24;
            ms *= 60 * 1000;
            return Date.now() + ms;
        }
        const parsed = new Date(value).getTime();
        if (Number.isNaN(parsed)) {
            throw new ValidationError('scheduledAt inválido (ISO esperado)', [
                { field: 'scheduledAt', message: 'string ISO inválida' },
            ]);
        }
        return parsed;
    }

    throw new ValidationError('scheduledAt deve ser string, número ou null', [
        { field: 'scheduledAt', message: 'tipo não suportado' },
    ]);
}

/**
 * Garante que `templateId` (opcional) — se enviado — existe no store. Usado
 * por broadcast e send-template (#1567, anti-injection: id forjado não
 * consegue "renderizar" conteúdo arbitrário).
 */
function assertTemplateExistsOrThrow(templateId: unknown): void {
    if (templateId === undefined || templateId === null || templateId === '') return;
    if (typeof templateId !== 'string') {
        throw new ValidationError('templateId inválido', [
            { field: 'templateId', message: 'deve ser string' },
        ]);
    }
    if (!schedulerService.templateExists(templateId)) {
        throw new ValidationError(
            'Template não encontrado — verifique o templateId e tente novamente',
            [{ field: 'templateId', message: 'templateId não existe no store' }],
        );
    }
}

// ===========================================
// ROTAS
// ===========================================

// --- Schedule a single message ---

router.post('/schedule', validateBody(ScheduleSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { chatId, sessionId, message, scheduledAt, type, metadata, channel, subject } = req.body as z.infer<typeof ScheduleSchema>;
        const scheduleTime = parseScheduledAt(scheduledAt);

        const msg = schedulerService.scheduleMessage({
            chatId,
            sessionId,
            channel,
            subject,
            message,
            scheduledAt: scheduleTime,
            type: type || 'once',
            metadata,
        });

        res.json({
            success: true,
            data: msg,
            scheduledFor: new Date(scheduleTime).toISOString(),
        });
    } catch (error: any) {
        log.error('Schedule error', { error: error?.message, stack: error?.stack });
        next(error);
    }
});

// --- Schedule broadcast to multiple contacts (#1567) ---

router.post('/broadcast', validateBody(BroadcastSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const {
            sessionId,
            recipients,
            message,
            templateId,
            scheduledAt,
            delayBetween,
            channel,
            subject,
        } = req.body as z.infer<typeof BroadcastSchema>;

        // #1567 — anti-injection: templateId precisa existir antes de qualquer renderização.
        // Lança `ValidationError` (envelope 400 padronizado) se o id não bater.
        assertTemplateExistsOrThrow(templateId);

        // Se o cliente enviou templateId, sobrescreve a `message` crua pelo conteúdo
        // do template (sem variáveis — broadcast não aceita, por design).
        let finalMessage = message;
        if (templateId) {
            const tpl = schedulerService.getTemplate(templateId);
            finalMessage = tpl?.content ?? message;
        }

        const scheduleTime = parseScheduledAt(scheduledAt);

        const messages = await schedulerService.scheduleBroadcast({
            sessionId,
            chatIds: recipients, // service ainda chama `chatIds` — `recipients` é o nome canônico na API (#1567)
            channel,
            subject,
            message: finalMessage,
            scheduledAt: scheduleTime,
            delayBetween: delayBetween || 3000,
        });

        res.json({
            success: true,
            count: messages.length,
            broadcastId: messages[0]?.metadata?.broadcastId,
            data: messages,
        });
    } catch (error: any) {
        log.error('Broadcast error', { error: error?.message, stack: error?.stack });
        next(error);
    }
});

// --- Schedule confirmation request ---

router.post('/confirmation', validateBody(ConfirmationSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { chatId, sessionId, message, timeoutMinutes, onConfirm, onReject } = req.body as z.infer<typeof ConfirmationSchema>;
        const timeout = timeoutMinutes || 60;

        const msg = schedulerService.scheduleConfirmation({
            chatId,
            sessionId,
            message,
            timeoutMinutes: timeout,
            onConfirm,
            onReject,
        });

        res.json({
            success: true,
            data: msg,
            expiresAt: new Date(Date.now() + timeout * 60 * 1000).toISOString(),
        });
    } catch (error: any) {
        log.error('Confirmation error', { error: error?.message, stack: error?.stack });
        next(error);
    }
});

// --- Schedule recurring reminder ---

router.post('/reminder', validateBody(ReminderSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { chatId, sessionId, message, firstSendAt, interval, unit } = req.body as z.infer<typeof ReminderSchema>;
        const scheduleTime = parseScheduledAt(firstSendAt);

        const msg = schedulerService.scheduleReminder({
            chatId,
            sessionId,
            message,
            firstSendAt: scheduleTime,
            recurrence: { interval, unit },
        });

        res.json({
            success: true,
            data: msg,
            recurrence: { interval, unit },
        });
    } catch (error: any) {
        log.error('Reminder error', { error: error?.message, stack: error?.stack });
        next(error);
    }
});

// --- Get pending messages ---

router.get('/pending', validateQuery(PendingQuerySchema), (req: Request, res: Response, next: NextFunction) => {
    try {
        const { sessionId } = req.query as unknown as z.infer<typeof PendingQuerySchema>;
        const pending = schedulerService.getPending(sessionId);

        res.json({
            success: true,
            count: pending.length,
            data: pending,
        });
    } catch (error: any) {
        next(error);
    }
});

// --- Get message history ---

router.get('/history', validateQuery(HistoryQuerySchema), (req: Request, res: Response, next: NextFunction) => {
    try {
        const { sessionId, status, limit } = req.query as unknown as z.infer<typeof HistoryQuerySchema>;

        const history = schedulerService.getHistory({
            sessionId,
            status: status as any,
            limit: limit ? Number(limit) : 50,
        });

        res.json({
            success: true,
            count: history.length,
            data: history,
        });
    } catch (error: any) {
        next(error);
    }
});

// --- Cancel a scheduled message ---

router.delete('/:id', validateParams(IdParamSchema), (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params as z.infer<typeof IdParamSchema>;
        const success = schedulerService.cancelMessage(id);

        if (!success) {
            return next(new NotFoundError('Mensagem não encontrada ou já processada'));
        }

        res.json({ success: true, data: { id, cancelled: true } });
    } catch (error: any) {
        next(error);
    }
});

// --- Get stats ---

router.get('/stats', (_req: Request, res: Response, next: NextFunction) => {
    try {
        const stats = schedulerService.getStats();
        res.json({ success: true, data: stats });
    } catch (error: any) {
        next(error);
    }
});

// --- Templates (CRUD #604) ---

router.post('/templates', validateBody(TemplateCreateSchema), (req: Request, res: Response, next: NextFunction) => {
    try {
        const { name, content, category, channel, subject } = req.body as z.infer<typeof TemplateCreateSchema>;

        const template = schedulerService.createTemplate({ name, content, category, channel, subject });
        res.json({ success: true, data: template });
    } catch (error: any) {
        next(error);
    }
});

router.get('/templates', (_req: Request, res: Response, next: NextFunction) => {
    try {
        const templates = schedulerService.getTemplates();
        res.json({ success: true, count: templates.length, data: templates });
    } catch (error: any) {
        next(error);
    }
});

router.put('/templates/:id', validateParams(IdParamSchema), validateBody(TemplateUpdateSchema), (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params as z.infer<typeof IdParamSchema>;
        const updates = req.body as z.infer<typeof TemplateUpdateSchema>;

        const updated = schedulerService.updateTemplate(id, updates);
        if (!updated) {
            return next(new NotFoundError('Template não encontrado'));
        }

        res.json({ success: true, data: updated });
    } catch (error: any) {
        next(error);
    }
});

router.delete('/templates/:id', validateParams(IdParamSchema), (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params as z.infer<typeof IdParamSchema>;
        const success = schedulerService.deleteTemplate(id);

        if (!success) {
            return next(new NotFoundError('Template não encontrado'));
        }

        res.json({ success: true, data: { id, deleted: true } });
    } catch (error: any) {
        next(error);
    }
});

// --- Send using template (#1567 anti-injection) ---

router.post('/send-template', validateBody(SendTemplateSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { templateId, chatId, sessionId, variables, scheduledAt } = req.body as z.infer<typeof SendTemplateSchema>;

        // #1567 — templateId precisa existir (anti-injection).
        assertTemplateExistsOrThrow(templateId);

        // `renderTemplate` já escapa variáveis e remove recursão de `{{...}}`
        // (#1567 anti-injection: payload do cliente não consegue injetar novos
        // placeholders nem HTML).
        const rendered = schedulerService.renderTemplate(templateId, variables || {});
        if (!rendered) {
            return next(new ValidationError(
                'Não foi possível renderizar o template',
                [{ field: 'templateId', message: 'templateId ausente ou template sem conteúdo' }],
            ));
        }

        const scheduleTime = parseScheduledAt(scheduledAt);

        const msg = schedulerService.scheduleMessage({
            chatId,
            sessionId,
            message: rendered,
            scheduledAt: scheduleTime,
            metadata: { templateId, variables },
        });

        res.json({ success: true, data: msg });
    } catch (error: any) {
        log.error('Send-template error', { error: error?.message, stack: error?.stack });
        next(error);
    }
});

// --- Import CSV for Broadcast ---

router.post('/import-csv', validateBody(ImportCsvSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { csvContent, sessionId, message, scheduledAt, delayBetween } = req.body as z.infer<typeof ImportCsvSchema>;

        const chatIds = schedulerService.parseCSVContacts(csvContent);
        if (chatIds.length === 0) {
            return next(new ValidationError(
                'Nenhum número de telefone válido encontrado no CSV',
                [{ field: 'csvContent', message: 'CSV vazio ou sem coluna de telefone' }],
            ));
        }

        // Defesa em profundidade: o CSV pode ter MUITOS contatos (>100). Reaplica o cap
        // do broadcast pra que `import-csv` não escape do rate-limit por chamada.
        if (chatIds.length > 100) {
            return next(new ValidationError(
                'Máximo de 100 destinatários por chamada',
                [{ field: 'csvContent', message: `CSV contém ${chatIds.length} contatos (cap 100)` }],
            ));
        }

        const scheduleTime = parseScheduledAt(scheduledAt);

        const messages = await schedulerService.scheduleBroadcast({
            sessionId,
            chatIds,
            message,
            scheduledAt: scheduleTime,
            delayBetween: delayBetween || 3000,
        });

        res.json({
            success: true,
            contactsFound: chatIds.length,
            broadcastId: messages[0]?.metadata?.broadcastId,
            count: messages.length,
            data: messages,
        });
    } catch (error: any) {
        log.error('CSV Import error', { error: error?.message, stack: error?.stack });
        next(error);
    }
});

// --- Broadcasts ---

router.get('/broadcasts', (_req: Request, res: Response, next: NextFunction) => {
    try {
        const broadcasts = schedulerService.getBroadcasts();
        res.json({ success: true, count: broadcasts.length, data: broadcasts });
    } catch (error: any) {
        next(error);
    }
});

router.get('/broadcasts/:id', validateParams(IdParamSchema), (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params as z.infer<typeof IdParamSchema>;
        const details = schedulerService.getBroadcastDetails(id);
        if (!details) {
            return next(new NotFoundError('Broadcast não encontrado'));
        }
        res.json({ success: true, data: details });
    } catch (error: any) {
        next(error);
    }
});

// Remove a referência `AppError` para que o type-check valide o import
// mesmo em builds onde `AppError` ainda não seja referenciado (defesa
// contra "import não utilizado" em refactors futuros). Sem efeito em runtime.
void AppError;

export default router;