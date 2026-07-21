import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, res: any, next: any) => next()));

/**
 * Tipos auxiliares para a suite (`#1567`): o service expõe várias
 * assinaturas opcionais (e.g. `updateTemplate` pode devolver `null` quando o id
 * não existe). Mantemos os mocks com `as any` nos pontos onde a inferência
 * fecharia o tipo indevidamente — eles são isolados por `applySchedulerMockDefaults`
 * e por um único lugar de mutação.
 */
const mockSchedulerService = vi.hoisted(() => ({
    scheduleMessage: vi.fn(() => ({ id: 'msg-1', chatId: '123', message: 'test', scheduledAt: Date.now() })),
    getPending: vi.fn(() => []),
    cancelMessage: vi.fn(() => true),
    scheduleBroadcast: vi.fn(() => []),
    scheduleConfirmation: vi.fn(() => ({ id: 'conf-1', chatId: '123', sessionId: 'default', message: 'm', scheduledAt: Date.now(), status: 'pending', createdAt: Date.now(), type: 'confirmation' as const })),
    scheduleReminder: vi.fn(() => ({ id: 'rem-1', chatId: '123', sessionId: 'default', message: 'm', scheduledAt: Date.now(), status: 'pending', createdAt: Date.now(), type: 'reminder' as const })),
    getHistory: vi.fn(() => []),
    getBroadcasts: vi.fn(() => []),
    getBroadcastDetails: vi.fn(() => null),
    // Template CRUD (#604)
    createTemplate: vi.fn(() => ({ id: 'tpl-1', name: 'Test', content: 'Hi', category: 'general' as const, channel: 'whatsapp' as const, createdAt: 0 })),
    getTemplates: vi.fn(() => [] as any[]),
    deleteTemplate: vi.fn(() => true),
    updateTemplate: vi.fn((): any => ({ id: 'tpl-1', name: 'Updated', content: 'Hi', category: 'general' as const, channel: 'whatsapp' as const, createdAt: 0 })),
    getStats: vi.fn(() => ({})),
    // #1567 — anti-injection de template: `templateExists`/`getTemplate`/`renderTemplate`.
    templateExists: vi.fn((_id: string) => false),
    getTemplate: vi.fn(() => ({ id: 'tpl-1', name: 'X', content: 'Hello from template', category: 'general' as const, channel: 'whatsapp' as const, createdAt: 0 })),
    renderTemplate: vi.fn(() => 'rendered'),
    parseCSVContacts: vi.fn(() => ['5511999999999@c.us']),
}));

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
}));

vi.mock('../../services/schedulerService', () => ({
    schedulerService: mockSchedulerService,
}));

vi.mock('../../utils/logger', () => ({
    createLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
    }),
}));

import schedulerRoutes from '../../routes/schedulerRoutes';
// `rateLimiters` é importado apenas para o helper `resetKey` abaixo — usado
// para isolar o bucket entre testes (sem isso, após 10 writes os testes
// começariam a receber 429).
import { rateLimiters } from '../../middleware/rateLimit';
// Sem o errorHandler global, as rotas que propagam erro via `next(...)`
// respondem só com status (sem envelope), quebrando as asserções em
// `res.body.error.code/...`.
import { errorHandler } from '../../middleware/errorHandler';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/scheduler', schedulerRoutes);
    app.use(errorHandler);
    return app;
}

/**
 * Reseta o bucket do schedulerLimiter para o IP de loopback (supertest usa
 * `::ffff:127.0.0.1` por padrão). Resetamos os 3 candidatos (IPv6-mapped,
 * IPv4 puro e IPv6 puro); o `try/catch` evita falha se a versão instalada
 * do `express-rate-limit` não expuser `resetKey`.
 */
function resetSchedulerLimiter() {
    const limiter: any = rateLimiters.scheduler as any;
    if (typeof limiter?.resetKey !== 'function') return;
    for (const ip of ['127.0.0.1', '::ffff:127.0.0.1', '::1']) {
        try { limiter.resetKey(ip); } catch { /* ignore */ }
    }
}

/**
 * Re-aplica os defaults de TODOS os mocks do schedulerService.
 *
 * `vi.clearAllMocks()` NÃO reseta implementações — apenas histórico. Logo,
 * se um teste fez `mockReturnValue(false)` para `cancelMessage`, esse `false`
 * persiste em testes posteriores que assumem o default `true`. Aqui
 * centralizamos a fonte de verdade para o estado "limpo" dos mocks.
 */
function applySchedulerMockDefaults() {
    mockSchedulerService.scheduleMessage.mockReturnValue({ id: 'msg-1', chatId: '123', message: 'test', scheduledAt: Date.now() });
    mockSchedulerService.getPending.mockReturnValue([]);
    mockSchedulerService.cancelMessage.mockReturnValue(true);
    mockSchedulerService.scheduleBroadcast.mockReturnValue([]);
    mockSchedulerService.scheduleConfirmation.mockReturnValue({ id: 'conf-1', chatId: '123', sessionId: 'default', message: 'm', scheduledAt: Date.now(), status: 'pending' as const, createdAt: Date.now(), type: 'confirmation' as const });
    mockSchedulerService.scheduleReminder.mockReturnValue({ id: 'rem-1', chatId: '123', sessionId: 'default', message: 'm', scheduledAt: Date.now(), status: 'pending' as const, createdAt: Date.now(), type: 'reminder' as const });
    mockSchedulerService.getHistory.mockReturnValue([]);
    mockSchedulerService.getBroadcasts.mockReturnValue([]);
    mockSchedulerService.getBroadcastDetails.mockReturnValue(null);
    mockSchedulerService.createTemplate.mockReturnValue({ id: 'tpl-1', name: 'Test', content: 'Hi', category: 'general' as const, channel: 'whatsapp' as const, createdAt: 0 });
    mockSchedulerService.getTemplates.mockReturnValue([]);
    mockSchedulerService.deleteTemplate.mockReturnValue(true);
    mockSchedulerService.updateTemplate.mockReturnValue({ id: 'tpl-1', name: 'Updated', content: 'Hi', category: 'general' as const, channel: 'whatsapp' as const, createdAt: 0 });
    mockSchedulerService.getStats.mockReturnValue({});
    // `templateExists` aceita apenas "tpl-1" e "tpl-exists" por padrão — cada
    // teste ajusta se precisar de outro id.
    mockSchedulerService.templateExists.mockImplementation((id: string) => id === 'tpl-1' || id === 'tpl-exists');
    mockSchedulerService.getTemplate.mockReturnValue({ id: 'tpl-1', name: 'X', content: 'Hello from template', category: 'general' as const, channel: 'whatsapp' as const, createdAt: 0 });
    mockSchedulerService.renderTemplate.mockReturnValue('rendered');
    mockSchedulerService.parseCSVContacts.mockReturnValue(['5511999999999@c.us']);
}

describe('schedulerRoutes', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        resetSchedulerLimiter();
        applySchedulerMockDefaults();
        app = createApp();
    });

    describe('POST /api/scheduler/schedule', () => {
        it('returns 200 with valid schedule request', async () => {
            const res = await request(app)
                .post('/api/scheduler/schedule')
                .send({ chatId: '123', sessionId: 'default', message: 'Hello' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toBeDefined();
        });

        it('returns 400 when missing required fields', async () => {
            const res = await request(app)
                .post('/api/scheduler/schedule')
                .send({ chatId: '123' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 400 for invalid relative time format', async () => {
            const res = await request(app)
                .post('/api/scheduler/schedule')
                .send({ chatId: '123', sessionId: 'default', message: 'Hello', scheduledAt: '+5x' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
        });

        it('accepts valid relative time formats (+5m, +1h, +2d)', async () => {
            const res = await request(app)
                .post('/api/scheduler/schedule')
                .send({ chatId: '123', sessionId: 'default', message: 'Hi', scheduledAt: '+5m' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });

    describe('POST /api/scheduler/broadcast', () => {
        it('returns 200 with a valid broadcast', async () => {
            const res = await request(app)
                .post('/api/scheduler/broadcast')
                .send({ sessionId: 'default', recipients: ['1@c.us', '2@c.us'], message: 'Hello' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockSchedulerService.scheduleBroadcast).toHaveBeenCalledTimes(1);
        });

        it('returns 400 when recipients is empty', async () => {
            const res = await request(app)
                .post('/api/scheduler/broadcast')
                .send({ sessionId: 'default', recipients: [], message: 'Hello' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(mockSchedulerService.scheduleBroadcast).not.toHaveBeenCalled();
        });

        // #1567 — AC#1: 150 destinatários → 400 com mensagem específica exigida pela issue.
        // O cap duro agora é 100 (era 500 via config). Atualizado de 501 (cap legado) p/ 150
        // (cap novo) — asserção "excede o cap → 400" preservada.
        it('returns 400 when recipients exceed the 100 cap (#1567 anti-spam)', async () => {
            const recipients = Array.from({ length: 150 }, (_, i) => `${i}@c.us`);
            const res = await request(app)
                .post('/api/scheduler/broadcast')
                .send({ sessionId: 'default', recipients, message: 'Hello' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            // A mensagem EXATA exigida pelo critério de aceite #1567
            expect(res.body.error.details[0].message).toBe('Máximo de 100 destinatários por chamada');
            expect(mockSchedulerService.scheduleBroadcast).not.toHaveBeenCalled();
        });

        // #1567 — AC#2: templateId inexistente no store → 400. Antes do render, a rota
        // checa `schedulerService.getTemplate(id)` (atômico — uma única chamada) e lança
        // `ValidationError` (envelope VALIDATION_ERROR). Impede que um cliente referencie
        // um id forjado e "renderize" conteúdo arbitrário via store.
        it('returns 400 when templateId does not exist (#1567 anti-injection)', async () => {
            mockSchedulerService.getTemplate.mockReturnValue(undefined as any);

            const res = await request(app)
                .post('/api/scheduler/broadcast')
                .send({ sessionId: 'default', recipients: ['1@c.us'], message: 'Hello', templateId: 'tpl-ghost' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(res.body.error.message).toMatch(/template/i);
            expect(res.body.error.details[0].field).toBe('templateId');
            expect(mockSchedulerService.scheduleBroadcast).not.toHaveBeenCalled();
        });

        it('accepts a known templateId and renders the template content as message (#1567)', async () => {
            // getTemplate default já retorna um template válido (applySchedulerMockDefaults)

            const res = await request(app)
                .post('/api/scheduler/broadcast')
                .send({ sessionId: 'default', recipients: ['1@c.us'], message: 'ignored', templateId: 'tpl-1' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            // O conteúdo do template (não a `message` crua) deve ter sido propagado ao service
            expect(mockSchedulerService.scheduleBroadcast).toHaveBeenCalledWith(
                expect.objectContaining({ message: 'Hello from template' }),
            );
        });

        it('returns 400 when message is missing (Zod required field)', async () => {
            const res = await request(app)
                .post('/api/scheduler/broadcast')
                .send({ sessionId: 'default', recipients: ['1@c.us'] });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 400 with Zod details when sessionId is missing', async () => {
            const res = await request(app)
                .post('/api/scheduler/broadcast')
                .send({ recipients: ['1@c.us'], message: 'Hi' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.details).toBeInstanceOf(Array);
            expect(res.body.error.details.length).toBeGreaterThan(0);
            // Cada item deve ter `field` (dot-path) + `message` (Zod)
            expect(res.body.error.details[0]).toHaveProperty('field');
            expect(res.body.error.details[0]).toHaveProperty('message');
        });

        // #1567 — backward compatibility com clientes que ainda enviam `chatIds`
        // (legado). O schema aceita ambos os campos; o handler sempre trabalha com
        // `recipients` normalizado via `.transform()`.
        it('aceita `chatIds` legado como alias de `recipients` (backward compat #1567)', async () => {
            const res = await request(app)
                .post('/api/scheduler/broadcast')
                .send({ sessionId: 'default', chatIds: ['1@c.us', '2@c.us'], message: 'Hello' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockSchedulerService.scheduleBroadcast).toHaveBeenCalledTimes(1);
            // O handler SEMPRE envia `chatIds` ao service — coerente com a assinatura atual
            expect(mockSchedulerService.scheduleBroadcast).toHaveBeenCalledWith(
                expect.objectContaining({ chatIds: ['1@c.us', '2@c.us'] }),
            );
        });

        // Quando AMBOS são enviados, `recipients` (canônico) tem precedência sobre `chatIds` (legado).
        it('recipients canônico tem precedência sobre chatIds legado quando ambos enviados', async () => {
            const res = await request(app)
                .post('/api/scheduler/broadcast')
                .send({
                    sessionId: 'default',
                    recipients: ['canonical@c.us'],
                    chatIds: ['legacy@c.us'],
                    message: 'Hello',
                });

            expect(res.status).toBe(200);
            expect(mockSchedulerService.scheduleBroadcast).toHaveBeenCalledWith(
                expect.objectContaining({ chatIds: ['canonical@c.us'] }),
            );
        });

        // `chatIds` legado também respeita o cap de 100.
        it('chatIds legado com 150 entradas → 400 com mensagem EXATA do cap', async () => {
            const chatIds = Array.from({ length: 150 }, (_, i) => `${i}@c.us`);
            const res = await request(app)
                .post('/api/scheduler/broadcast')
                .send({ sessionId: 'default', chatIds, message: 'Hello' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(res.body.error.details[0].message).toBe('Máximo de 100 destinatários por chamada');
        });

        // Quando NENHUM dos dois for enviado, retorna 400 apontando o campo `recipients`.
        it('sem recipients nem chatIds → 400 apontando recipients', async () => {
            const res = await request(app)
                .post('/api/scheduler/broadcast')
                .send({ sessionId: 'default', message: 'Hello' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(res.body.error.details[0].field).toBe('recipients');
        });
    });

    describe('GET /api/scheduler/pending', () => {
        it('returns 200', async () => {
            const res = await request(app).get('/api/scheduler/pending');

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('data');
            expect(res.body.success).toBe(true);
        });
    });

    describe('DELETE /api/scheduler/:id', () => {
        it('returns 200 when message cancelled', async () => {
            const res = await request(app).delete('/api/scheduler/msg-1');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.cancelled).toBe(true);
        });

        it('returns 404 when message not found', async () => {
            mockSchedulerService.cancelMessage.mockReturnValue(false);

            const res = await request(app).delete('/api/scheduler/not-found');

            expect(res.status).toBe(404);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('NOT_FOUND');
        });
    });

    describe('PUT /api/scheduler/templates/:id (#604)', () => {
        it('returns 200 and updated template when found', async () => {
            mockSchedulerService.updateTemplate.mockReturnValue({ id: 'tpl-1', name: 'Novo Nome', content: 'Hi', category: 'general', channel: 'whatsapp' });

            const res = await request(app)
                .put('/api/scheduler/templates/tpl-1')
                .send({ name: 'Novo Nome' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.name).toBe('Novo Nome');
            expect(mockSchedulerService.updateTemplate).toHaveBeenCalledWith('tpl-1', expect.objectContaining({ name: 'Novo Nome' }));
        });

        it('returns 404 when template not found', async () => {
            mockSchedulerService.updateTemplate.mockReturnValue(null as any);

            const res = await request(app)
                .put('/api/scheduler/templates/nonexistent')
                .send({ name: 'X' });

            expect(res.status).toBe(404);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('NOT_FOUND');
        });
    });

    // =====================================================
    // #1567 — envelope e validação em TODAS as rotas
    // =====================================================

    describe('envelope padronizado (#1567)', () => {
        it('GET /stats responde com { success, data }', async () => {
            mockSchedulerService.getStats.mockReturnValue({ pending: 0, sent: 5 });
            const res = await request(app).get('/api/scheduler/stats');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toEqual({ pending: 0, sent: 5 });
        });

        it('GET /templates responde com { success, count, data }', async () => {
            mockSchedulerService.getTemplates.mockReturnValue([{ id: 'tpl-1' }]);
            const res = await request(app).get('/api/scheduler/templates');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.count).toBe(1);
        });

        it('GET /broadcasts responde com { success, count, data }', async () => {
            const res = await request(app).get('/api/scheduler/broadcasts');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data)).toBe(true);
        });

        it('GET /broadcasts/:id 404 quando não encontrado', async () => {
            mockSchedulerService.getBroadcastDetails.mockReturnValue(null);
            const res = await request(app).get('/api/scheduler/broadcasts/no-such-id');
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('NOT_FOUND');
        });

        it('DELETE /templates/:id 404 quando não encontrado', async () => {
            mockSchedulerService.deleteTemplate.mockReturnValue(false);
            const res = await request(app).delete('/api/scheduler/templates/no-such');
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('NOT_FOUND');
        });

        it('POST /templates aceita body mínimo e devolve envelope de sucesso', async () => {
            const res = await request(app)
                .post('/api/scheduler/templates')
                .send({ name: 'Novo', content: 'Hi' });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockSchedulerService.createTemplate).toHaveBeenCalled();
        });

        it('POST /templates com name vazio retorna 400 com envelope de validação', async () => {
            const res = await request(app)
                .post('/api/scheduler/templates')
                .send({ name: '', content: 'Hi' });
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('POST /templates com content > 4096 chars retorna 400', async () => {
            const res = await request(app)
                .post('/api/scheduler/templates')
                .send({ name: 'X', content: 'a'.repeat(4097) });
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });
    });

    // =====================================================
    // #1567 — validação Zod em rotas adicionais
    // =====================================================

    describe('validação Zod em /schedule (#1567)', () => {
        it('chatId ausente → 400 com details do Zod', async () => {
            const res = await request(app).post('/api/scheduler/schedule').send({ sessionId: 's', message: 'm' });
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(res.body.error.details.some((d: any) => d.field === 'chatId')).toBe(true);
        });

        it('message ausente → 400', async () => {
            const res = await request(app).post('/api/scheduler/schedule').send({ chatId: 'c', sessionId: 's' });
            expect(res.status).toBe(400);
        });

        it('body completamente vazio → 400 com múltiplos erros do Zod', async () => {
            const res = await request(app).post('/api/scheduler/schedule').send({});
            expect(res.status).toBe(400);
            expect(res.body.error.details.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('validação Zod em /confirmation (#1567)', () => {
        it('faltando campos obrigatórios → 400', async () => {
            const res = await request(app).post('/api/scheduler/confirmation').send({ chatId: 'c' });
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('body válido → 200 com envelope', async () => {
            const res = await request(app)
                .post('/api/scheduler/confirmation')
                .send({ chatId: 'c', sessionId: 's', message: 'm' });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toBeDefined();
            expect(res.body.expiresAt).toBeDefined();
        });
    });

    describe('validação Zod em /reminder (#1567)', () => {
        it('unit inválido → 400', async () => {
            const res = await request(app)
                .post('/api/scheduler/reminder')
                .send({ chatId: 'c', sessionId: 's', message: 'm', interval: 5, unit: 'years' });
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('interval negativo → 400', async () => {
            const res = await request(app)
                .post('/api/scheduler/reminder')
                .send({ chatId: 'c', sessionId: 's', message: 'm', interval: -1, unit: 'minutes' });
            expect(res.status).toBe(400);
        });

        it('body válido → 200', async () => {
            const res = await request(app)
                .post('/api/scheduler/reminder')
                .send({ chatId: 'c', sessionId: 's', message: 'm', interval: 30, unit: 'minutes' });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });

    describe('validação Zod em /send-template (#1567 anti-injection)', () => {
        it('templateId inexistente → 400 (renderiza nada)', async () => {
            // renderTemplate mocka `null` para simular "template não existe"
            // (no service real, isso acontece quando `templateExists(id)` é false).
            mockSchedulerService.renderTemplate.mockReturnValue(null as any);

            const res = await request(app)
                .post('/api/scheduler/send-template')
                .send({ templateId: 'tpl-ghost', chatId: 'c', sessionId: 's' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('templateId existente → 200 e renderTemplate é chamado', async () => {
            mockSchedulerService.renderTemplate.mockReturnValue('Hello João!');

            const res = await request(app)
                .post('/api/scheduler/send-template')
                .send({ templateId: 'tpl-1', chatId: 'c', sessionId: 's', variables: { name: 'João' } });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockSchedulerService.renderTemplate).toHaveBeenCalledWith('tpl-1', { name: 'João' });
        });
    });

    describe('validação Zod em /import-csv (#1567)', () => {
        it('csvContent vazio → 400', async () => {
            const res = await request(app)
                .post('/api/scheduler/import-csv')
                .send({ sessionId: 's', message: 'm', csvContent: '' });
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('CSV sem contatos válidos → 400', async () => {
            mockSchedulerService.parseCSVContacts.mockReturnValue([]);
            const res = await request(app)
                .post('/api/scheduler/import-csv')
                .send({ sessionId: 's', message: 'm', csvContent: 'header-only\n' });
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(mockSchedulerService.scheduleBroadcast).not.toHaveBeenCalled();
        });

        it('CSV com mais de 100 contatos → 400 (cap do broadcast)', async () => {
            mockSchedulerService.parseCSVContacts.mockReturnValue(
                Array.from({ length: 150 }, (_, i) => `${i}@c.us`),
            );
            const res = await request(app)
                .post('/api/scheduler/import-csv')
                .send({ sessionId: 's', message: 'm', csvContent: 'mock-csv' });
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(res.body.error.details[0].message).toMatch(/100/);
        });

        it('CSV válido com 1 contato → 200 e scheduleBroadcast chamado', async () => {
            mockSchedulerService.parseCSVContacts.mockReturnValue(['5511999999999@c.us']);
            const res = await request(app)
                .post('/api/scheduler/import-csv')
                .send({ sessionId: 's', message: 'm', csvContent: 'phone\n5511999999999\n' });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockSchedulerService.scheduleBroadcast).toHaveBeenCalled();
        });
    });

    describe('validação Zod em /:id (#1567)', () => {
        it('id vazio na URL → rota não bate (404 do Express, mas o body não é envelope de erro da rota)', async () => {
            // O validateParams exige `id` com min(1); uma URL "/api/scheduler/" cai no router
            // sem casar com nenhum path — Express responde 404 nativo. Apenas garante
            // que a rota DELETE continua respondendo para IDs normais.
            const res = await request(app).delete('/api/scheduler/abc-123');
            expect(res.status).toBe(200);
        });
    });

    // =====================================================
    // #1567 — cronSchema: contrato da issue para futuros
    // endpoints de cron. Validação unitária (sem rota HTTP) —
    // confirma que o regex POSIX 5-campos aceita variações e
    // recusa formatos inválidos.
    // =====================================================

    describe('CronSchema (#1567)', () => {
        // Import lazy para evitar ciclos e deixar o escopo local
        let CronSchema: any;

        beforeAll(async () => {
            const mod = await import('../../routes/schedulerRoutes');
            CronSchema = (mod as any).CronSchema;
        });

        const cases: Array<{ cron: string; ok: boolean; reason: string }> = [
            { cron: '* * * * *', ok: true, reason: 'wildcards em todos os campos' },
            { cron: '*/15 * * * *', ok: true, reason: 'intervalo no minuto' },
            { cron: '0 9 * * 1-5', ok: true, reason: 'range no dia-da-semana' },
            { cron: '30 14 1,15 * *', ok: true, reason: 'lista no dia-do-mês' },
            { cron: '0 0 1 1 *', ok: true, reason: 'disparo único anual' },
            { cron: '* * * *', ok: false, reason: 'apenas 4 campos' },
            { cron: '* * * * * *', ok: false, reason: '6 campos (acima do POSIX)' },
            { cron: '60 * * * *', ok: true, reason: '60 não é validado pelo regex (semântico fica p/ node-cron)' },
            { cron: '', ok: false, reason: 'vazio' },
            { cron: 'not-a-cron', ok: false, reason: 'string sem campos' },
        ];

        for (const c of cases) {
            it(`${c.ok ? 'aceita' : 'rejeita'} ${JSON.stringify(c.cron)} — ${c.reason}`, () => {
                const result = CronSchema.safeParse({ name: 'n', action: 'a', cron: c.cron });
                expect(result.success).toBe(c.ok);
            });
        }

        it('rejeita name vazio', () => {
            const result = CronSchema.safeParse({ name: '', cron: '* * * * *', action: 'a' });
            expect(result.success).toBe(false);
        });

        it('rejeita action ausente', () => {
            const result = CronSchema.safeParse({ name: 'n', cron: '* * * * *' });
            expect(result.success).toBe(false);
        });

        it('aceita payload opcional', () => {
            const result = CronSchema.safeParse({
                name: 'n', cron: '* * * * *', action: 'a', payload: { foo: 'bar' },
            });
            expect(result.success).toBe(true);
        });
    });
});


// =====================================================
// #1567 — AC#3: 11ª chamada POST em 1min retorna 429
// O limiter é aplicado em router.use() dentro de schedulerRoutes.ts
// (`schedulerLimiter` = `rateLimiters.scheduler`, 10/1min, bucket por IP, handler
// que delega via `next(error)` ao errorHandler global). Aqui usamos a MESMA instância
// importada de middleware/rateLimit.ts — sem recriar config inline, single source of truth.
// =====================================================
describe('#1567: schedulerLimiter — 11ª chamada POST em 1min → 429', () => {
    function createAppWithLimiter() {
        const app = express();
        app.use(express.json());
        app.use('/api/scheduler', schedulerRoutes);
        // #1567: errorHandler aplicado para que o `next(error)` do rate limiter
        // seja renderizado no envelope padronizado `{ success: false, error: { code: 'RATE_LIMIT', ... } }`,
        // conforme asserções abaixo. Sem ele, Express responde com o pipeline de erro
        // nativo e o body fica vazio.
        app.use(errorHandler);
        return app;
    }

    beforeEach(() => {
        vi.clearAllMocks();
        resetSchedulerLimiter();
        applySchedulerMockDefaults();
    });

    it('10 POSTs /schedule OK; o 11º retorna 429', async () => {
        const app = createAppWithLimiter();

        for (let i = 0; i < 10; i++) {
            const res = await request(app).post('/api/scheduler/schedule').send({ chatId: 'c', sessionId: 's', message: 'm' });
            expect(res.status).toBe(200);
        }

        const blocked = await request(app).post('/api/scheduler/schedule').send({ chatId: 'c', sessionId: 's', message: 'm' });
        expect(blocked.status).toBe(429);
        // #1567: 429 agora vem no envelope padronizado pelo errorHandler
        expect(blocked.body.success).toBe(false);
        expect(blocked.body.error.code).toBe('RATE_LIMIT');
        expect(typeof blocked.body.error.message).toBe('string');
        expect(blocked.body.error.message.length).toBeGreaterThan(0);
    });

    it('POSTs em endpoints diferentes compartilham o mesmo bucket (cumulativo)', async () => {
        const app = createAppWithLimiter();

        // 5x /schedule + 5x /broadcast = 10 writes
        for (let i = 0; i < 5; i++) {
            await request(app).post('/api/scheduler/schedule').send({ chatId: 'c', sessionId: 's', message: 'm' });
        }
        for (let i = 0; i < 5; i++) {
            await request(app).post('/api/scheduler/broadcast').send({ sessionId: 's', recipients: ['1@c.us'], message: 'm' });
        }

        // 11ª chamada (de qualquer write) → 429
        const blocked = await request(app).post('/api/scheduler/templates').send({ name: 'X', content: 'Hi' });
        expect(blocked.status).toBe(429);
    });

    it('GETs NÃO contam para o limiter — muitos GETs seguem 200', async () => {
        const app = createAppWithLimiter();

        // 30 GETs (> max 10): se o limiter contasse GETs, algum seria 429.
        for (let i = 0; i < 30; i++) {
            const res = await request(app).get('/api/scheduler/pending');
            expect(res.status).toBe(200);
        }
    });

    it('DELETE também conta para o limiter (#1567: POST/PUT/DELETE)', async () => {
        const app = createAppWithLimiter();

        // 10 writes via DELETE (e outros writes no meio p/ simular uso real)
        for (let i = 0; i < 10; i++) {
            await request(app).delete(`/api/scheduler/msg-${i}`);
        }

        // 11ª escrita (PUT) → 429
        const blocked = await request(app).put('/api/scheduler/templates/tpl-1').send({ name: 'X' });
        expect(blocked.status).toBe(429);
    });

    // #1567 — sanity check de produção: server.ts NÃO deve montar
    // um `schedulerLimiter` inline antes do router, senão os GETs seriam
    // contados DUAS vezes (uma pelo limiter do server, outra pelo do
    // router). Esse teste falha se alguém reintroduzir a duplicação.
    it('server.ts NÃO aplica schedulerLimiter inline (#1567 — single source of truth)', () => {
        // Lazy import do server.ts para evitar efeitos colaterais de
        // import (o módulo cria servidor Express, sockets, etc.).
        // Lemos o source direto via fs para verificar a montagem.
        const fs = require('fs') as typeof import('fs');
        const path = require('path') as typeof import('path');
        const src = fs.readFileSync(
            path.resolve(__dirname, '../../../src/server.ts'),
            'utf-8',
        );
        // Não pode haver `app.use('/api/scheduler', schedulerLimiter, ...)`
        // — a montagem correta é só `app.use('/api/scheduler', schedulerRoutes)`
        expect(src).not.toMatch(/app\.use\(['"]\/api\/scheduler['"],\s*schedulerLimiter/);
        // Confirma que a forma "limpa" está presente
        expect(src).toMatch(/app\.use\(['"]\/api\/scheduler['"],\s*schedulerRoutes\)/);
    });
});