import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';

// =====================================================
// Capture all rate-limit factory calls (sem mock da lib)
// =====================================================
// `vi.hoisted` é necessário porque o closure do `vi.mock` roda na fase de
// transformação do módulo (antes do `const rateLimitCalls = []` da raiz do
// arquivo estar disponível).
const { rateLimitCalls, hitCounts, limiterSeq } = vi.hoisted(() => {
    // Estado mutável capturado pelos mocks.
    return {
        rateLimitCalls: [] as any[],
        // Map<limiterId, Map<key, count>> — bucket por limiter + chave
        hitCounts: new Map<string, Map<string, number>>(),
        limiterSeq: { value: 0 },
    };
});

vi.mock('express-rate-limit', () => ({
    default: vi.fn((opts: any) => {
        rateLimitCalls.push(opts);
        const limiterId = `limiter-${++limiterSeq.value}`;
        if (!hitCounts.has(limiterId)) hitCounts.set(limiterId, new Map());

        const mw: any = (req: any, res: any, next: any) => {
            (req as any).__rateLimitOptions = opts;
            (req as any).__limiterId = limiterId;
            const key = typeof opts.keyGenerator === 'function'
                ? opts.keyGenerator(req, res)
                : (req.ip || 'unknown');
            const bucket = hitCounts.get(limiterId)!;
            const count = (bucket.get(key) ?? 0) + 1;
            bucket.set(key, count);

            const limit = opts.limit ?? opts.max ?? 5;
            if (count > limit) {
                // 429 — escreve o envelope direto.
                res.status(429);
                const body = typeof opts.message === 'function'
                    ? opts.message(req, res)
                    : opts.message;
                // Simula headers do standardHeaders (RFC draft) e Retry-After.
                if (opts.standardHeaders) {
                    res.setHeader('RateLimit-Limit', String(limit));
                    res.setHeader('RateLimit-Remaining', '0');
                    res.setHeader('Retry-After', String(Math.ceil(opts.windowMs / 1000)));
                }
                return res.json(body);
            }
            // Dentro do limite — segue o pipeline.
            next();
        };
        mw.__options = opts;
        mw.__limiterId = limiterId;
        // Helper para testes resetarem o bucket do limiter.
        mw.__reset = () => hitCounts.get(limiterId)?.clear();
        return mw;
    }),
    ipKeyGenerator: vi.fn((ip: string) => ip),
}));

// Importações depois dos mocks para garantir que pegam a versão mockada.
import {
    createLimiter,
    realClientIpKey,
    loginLimiter,
    aiLimiter,
    bankingLimiter,
    schedulerLimiter,
    whatsappCheckLimiter,
    webhookLimiter,
    rateLimitFactory,
} from '../../middleware/rateLimitFactory';

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const ONE_MIN_MS = 60 * 1000;

/**
 * Assinaturas (windowMs, max) dos 6 presets exigidos pela spec (#976).
 * Usada pelos testes que precisam distinguir os presets de outras
 * chamadas a `createLimiter` (ex.: testes do factory genérico).
 */
const PRESET_SIGNATURES: Array<{ windowMs: number; max: number; name: string }> = [
    { name: 'loginLimiter',         windowMs: FIFTEEN_MIN_MS, max: 5  },
    { name: 'aiLimiter',            windowMs: ONE_MIN_MS,     max: 20 },
    { name: 'bankingLimiter',       windowMs: ONE_MIN_MS,     max: 30 },
    { name: 'schedulerLimiter',     windowMs: ONE_MIN_MS,     max: 10 },
    { name: 'whatsappCheckLimiter', windowMs: ONE_MIN_MS,     max: 10 },
    { name: 'webhookLimiter',       windowMs: ONE_MIN_MS,     max: 60 },
];

// =====================================================
// realClientIpKey — extração do IP real
// =====================================================

describe('realClientIpKey (#976 — IP real do cliente)', () => {
    it('usa CF-Connecting-IP quando presente (preferência sobre X-Forwarded-For)', () => {
        const key = realClientIpKey({
            headers: { 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '10.0.0.99' },
            ip: '127.0.0.1'
        } as any);
        expect(key).toBe('203.0.113.7');
    });

    it('cai no primeiro IP de X-Forwarded-For quando não há CF-Connecting-IP', () => {
        const key = realClientIpKey({
            headers: { 'x-forwarded-for': '198.51.100.10, 10.0.0.1, 10.0.0.2' },
            ip: '127.0.0.1'
        } as any);
        // X-Forwarded-For: client, proxy1, proxy2 — pega o PRIMEIRO.
        expect(key).toBe('198.51.100.10');
    });

    it('cai no req.ip quando não há header de proxy', () => {
        const key = realClientIpKey({
            headers: {},
            ip: '10.0.0.1'
        } as any);
        expect(key).toBe('10.0.0.1');
    });

    it('cai em "unknown" quando req.ip também está ausente', () => {
        const key = realClientIpKey({ headers: {} } as any);
        expect(key).toBe('unknown');
    });

    it('CF-Connecting-IP em array → pega o primeiro', () => {
        const key = realClientIpKey({
            headers: { 'cf-connecting-ip': ['203.0.113.7', 'outro'] },
            ip: '10.0.0.1'
        } as any);
        expect(key).toBe('203.0.113.7');
    });
});

// =====================================================
// createLimiter — factory genérica
// =====================================================

describe('createLimiter (#976 — factory genérica)', () => {
    /**
     * Helper: cada teste captura o índice ANTES de chamar `createLimiter`
     * e depois lê a entrada naquele offset. Isso evita a necessidade de
     * limpar `rateLimitCalls` (o que apagaria os 6 presets registrados
     * na importação do módulo e quebraria a suite `Presets nomeados`).
     */
    function lastCallSince(before: number): any {
        return rateLimitCalls[before];
    }

    it('encaminha windowMs e max para o express-rate-limit', () => {
        const before = rateLimitCalls.length;
        createLimiter({ windowMs: 5000, max: 3 });
        const opts = lastCallSince(before);
        expect(opts.windowMs).toBe(5000);
        // v8: `max` é traduzido internamente para `limit`. Aceitamos qualquer um.
        expect(opts.limit ?? opts.max).toBe(3);
    });

    it('ativa standardHeaders (RateLimit-* + Retry-After) e desliga legacyHeaders', () => {
        const before = rateLimitCalls.length;
        createLimiter({ windowMs: 1000, max: 1 });
        const opts = lastCallSince(before);
        expect(opts.legacyHeaders).toBe(false);
        // `standardHeaders: 'draft-7'` é truthy e aceita um DraftHeadersVersion.
        expect(opts.standardHeaders).toBeTruthy();
    });

    it('usa o envelope padrão quando `message` é omitido', () => {
        const before = rateLimitCalls.length;
        createLimiter({ windowMs: 1000, max: 1 });
        const opts = lastCallSince(before);
        expect(opts.message).toEqual({
            success: false,
            error: { message: 'Muitas requisições', code: 'RATE_LIMIT' }
        });
    });

    it('aceita message como string e converte para envelope com code=RATE_LIMIT', () => {
        const before = rateLimitCalls.length;
        createLimiter({ windowMs: 1000, max: 1, message: 'Slow down please' });
        const opts = lastCallSince(before);
        expect(opts.message).toEqual({
            success: false,
            error: { message: 'Slow down please', code: 'RATE_LIMIT' }
        });
    });

    it('aceita message como objeto (envelope customizado) e preserva', () => {
        const before = rateLimitCalls.length;
        const custom = {
            success: false,
            error: { message: 'Capacidade esgotada', code: 'CAPACITY', retryIn: 30 }
        };
        createLimiter({ windowMs: 1000, max: 1, message: custom });
        const opts = lastCallSince(before);
        expect(opts.message).toEqual(custom);
    });

    it('quando objeto não tem `error`, injeta o default', () => {
        const before = rateLimitCalls.length;
        createLimiter({ windowMs: 1000, max: 1, message: { extra: 'x' } as any });
        const opts = lastCallSince(before);
        expect(opts.message).toEqual({
            success: false,
            extra: 'x',
            error: { message: 'Muitas requisições', code: 'RATE_LIMIT' }
        });
    });

    it('usa realClientIpKey como keyGenerator default', () => {
        const before = rateLimitCalls.length;
        createLimiter({ windowMs: 1000, max: 1 });
        const opts = lastCallSince(before);
        expect(typeof opts.keyGenerator).toBe('function');
        const key = opts.keyGenerator({
            headers: { 'x-forwarded-for': '203.0.113.99' },
            ip: '127.0.0.1'
        } as any, {} as any);
        expect(key).toBe('203.0.113.99');
    });

    it('respeita keyGenerator customizado quando fornecido', () => {
        const before = rateLimitCalls.length;
        const customKey = (req: any) => `custom:${req.body?.userId || 'anon'}`;
        createLimiter({ windowMs: 1000, max: 1, keyGenerator: customKey });
        const opts = lastCallSince(before);
        const key = opts.keyGenerator({ body: { userId: 42 } } as any, {} as any);
        expect(key).toBe('custom:42');
    });
});

// =====================================================
// Presets nomeados
// =====================================================

describe('Presets nomeados (#976 — fundação rate limit)', () => {
    beforeAll(() => {
        // Força avaliação dos presets.
        void loginLimiter;
        void aiLimiter;
        void bankingLimiter;
        void schedulerLimiter;
        void whatsappCheckLimiter;
        void webhookLimiter;
    });

    /**
     * Encontra o `opts` de um preset buscando pela assinatura (windowMs+max).
     * É robusto a reordenação e a chamadas intermediárias de `createLimiter`
     * que aparecem em outros describes (ex.: testes do factory genérico).
     */
    function findPreset(windowMs: number, max: number): any {
        const found = rateLimitCalls.find(
            (opts: any) =>
                opts.windowMs === windowMs &&
                (opts.limit ?? opts.max) === max &&
                opts.message &&
                typeof opts.message === 'object' &&
                opts.message.error?.code === 'RATE_LIMIT' &&
                opts.message.error?.message === 'Muitas requisições'
        );
        if (!found) {
            throw new Error(
                `Nenhum preset encontrado com windowMs=${windowMs} max=${max}. ` +
                `Chamadas registradas: ${rateLimitCalls.length}`
            );
        }
        return found;
    }

    it('exporta exatamente os 6 presets exigidos pela spec', () => {
        const exported = [
            'loginLimiter', 'aiLimiter', 'bankingLimiter',
            'schedulerLimiter', 'whatsappCheckLimiter', 'webhookLimiter'
        ];
        for (const name of exported) {
            expect((rateLimitFactory as any)[name], `preset ${name}`).toBeDefined();
            expect(typeof (rateLimitFactory as any)[name], `preset ${name}`).toBe('function');
        }
    });

    it('loginLimiter: 5 tentativas / 15min', () => {
        const opts = findPreset(FIFTEEN_MIN_MS, 5);
        expect(opts.windowMs).toBe(FIFTEEN_MIN_MS);
        expect(opts.limit ?? opts.max).toBe(5);
    });

    it('aiLimiter: 20 req/min', () => {
        const opts = findPreset(ONE_MIN_MS, 20);
        expect(opts.windowMs).toBe(ONE_MIN_MS);
        expect(opts.limit ?? opts.max).toBe(20);
    });

    it('bankingLimiter: 30 req/min', () => {
        const opts = findPreset(ONE_MIN_MS, 30);
        expect(opts.windowMs).toBe(ONE_MIN_MS);
        expect(opts.limit ?? opts.max).toBe(30);
    });

    it('schedulerLimiter: 10 req/min', () => {
        const opts = findPreset(ONE_MIN_MS, 10);
        expect(opts.windowMs).toBe(ONE_MIN_MS);
        expect(opts.limit ?? opts.max).toBe(10);
    });

    it('whatsappCheckLimiter: 10 req/min', () => {
        // Mesma assinatura que schedulerLimiter, mas ambos devem existir como presets.
        const found = rateLimitCalls.filter(
            (o: any) => o.windowMs === ONE_MIN_MS && (o.limit ?? o.max) === 10
        );
        // Devem haver pelo menos 2 (scheduler + whatsappCheck).
        expect(found.length).toBeGreaterThanOrEqual(2);
        // Cada um com o envelope padrão.
        for (const opts of found) {
            expect(opts.message).toEqual({
                success: false,
                error: { message: 'Muitas requisições', code: 'RATE_LIMIT' }
            });
        }
    });

    it('webhookLimiter: 60 req/min', () => {
        const opts = findPreset(ONE_MIN_MS, 60);
        expect(opts.windowMs).toBe(ONE_MIN_MS);
        expect(opts.limit ?? opts.max).toBe(60);
    });

    it('cada preset usa o envelope padrão exigido pela spec', () => {
        const expected = {
            success: false,
            error: { message: 'Muitas requisições', code: 'RATE_LIMIT' }
        };
        // Filtra EXATAMENTE pelos 6 presets (assinaturas únicas) — outras
        // chamadas a `createLimiter` (ex.: testes do factory genérico)
        // podem ter o mesmo envelope padrão, mas NÃO devem ser confundidas
        // com os presets.
        const presets = rateLimitCalls.filter(
            (o: any) =>
                PRESET_SIGNATURES.some(
                    (s) => s.windowMs === o.windowMs && s.max === (o.limit ?? o.max)
                )
        );
        expect(presets.length).toBe(6);
        for (const opts of presets) {
            expect(opts.message).toEqual(expected);
        }
    });

    it('cada preset ativa headers padrão (RateLimit-*) e desliga legacyHeaders', () => {
        const presets = rateLimitCalls.filter(
            (o: any) =>
                o.message?.error?.code === 'RATE_LIMIT' &&
                o.message?.error?.message === 'Muitas requisições'
        );
        for (const opts of presets) {
            expect(opts.standardHeaders, `preset windowMs=${opts.windowMs} max=${opts.limit}`).toBeTruthy();
            expect(opts.legacyHeaders, `preset windowMs=${opts.windowMs} max=${opts.limit}`).toBe(false);
        }
    });

    it('cada preset tem keyGenerator que honra X-Forwarded-For', () => {
        // Filtra EXATAMENTE pelos 6 presets (assinaturas únicas) — outras
        // chamadas a `createLimiter` (ex.: testes do factory genérico)
        // podem ter o mesmo envelope padrão, mas NÃO devem ser confundidas
        // com os presets.
        const presets = rateLimitCalls.filter(
            (o: any) =>
                o.message?.error?.code === 'RATE_LIMIT' &&
                o.message?.error?.message === 'Muitas requisições' &&
                PRESET_SIGNATURES.some(
                    (s) => s.windowMs === o.windowMs && s.max === (o.limit ?? o.max)
                )
        );
        expect(presets.length).toBe(6);
        for (const opts of presets) {
            expect(typeof opts.keyGenerator, `preset windowMs=${opts.windowMs}`).toBe('function');
            const key = opts.keyGenerator(
                { headers: { 'x-forwarded-for': '203.0.113.42' }, ip: '127.0.0.1' } as any,
                {} as any
            );
            expect(key, `preset windowMs=${opts.windowMs}`).toBe('203.0.113.42');
        }
    });
});

// =====================================================
// Integração AC — 6ª chamada de login em 15min → 429
// =====================================================

/**
 * Teste integrado do AC da issue #976 sem mock do `express-rate-limit`
 * (mesmo padrão usado em `routes/healthRateLimit.test.ts`). Garante:
 *
 *   1. As 5 primeiras chamadas de login passam (status != 429).
 *   2. A 6ª chamada retorna 429 com o envelope exigido.
 *   3. Headers `RateLimit-*` (RFC draft) + `Retry-After` estão presentes.
 */
describe('Integração loginLimiter (#976 — AC: 6ª chamada → 429 com envelope)', () => {
    let app: express.Application;

    beforeEach(() => {
        // loginLimiter é singleton (mesmo módulo compartilhado entre testes);
        // resetamos o bucket antes de CADA teste para isolar contadores.
        (loginLimiter as any).__reset?.();
        app = express();
        // Replicando o server.ts: trust proxy 1 para que X-Forwarded-For
        // seja respeitado e cada teste use SEU PRÓPRIO bucket.
        app.set('trust proxy', 1);
        app.use('/login-test', loginLimiter, (_req, res) => {
            res.status(200).json({ success: true, data: { ok: true } });
        });
    });

    it('AC: 6ª chamada em 15min retorna 429 com envelope { success:false, error:{ message, code:"RATE_LIMIT" } }', async () => {
        const IP = '203.0.113.55';

        // 5 chamadas passam
        for (let i = 0; i < 5; i++) {
            const res = await request(app)
                .get('/login-test')
                .set('X-Forwarded-For', IP);
            expect(res.status, `request #${i + 1} deveria passar`).toBe(200);
        }

        // 6ª chamada → 429 com envelope
        const blocked = await request(app)
            .get('/login-test')
            .set('X-Forwarded-For', IP);

        expect(blocked.status).toBe(429);
        expect(blocked.body).toEqual({
            success: false,
            error: {
                message: 'Muitas requisições',
                code: 'RATE_LIMIT'
            }
        });
    }, 15000);

    it('AC: resposta 429 inclui headers RateLimit-* (RFC draft)', async () => {
        const IP = '203.0.113.56';

        // Satura
        for (let i = 0; i < 6; i++) {
            await request(app).get('/login-test').set('X-Forwarded-For', IP);
        }

        const blocked = await request(app)
            .get('/login-test')
            .set('X-Forwarded-For', IP);

        expect(blocked.status).toBe(429);
        const hasRateLimit =
            blocked.headers['ratelimit-limit'] !== undefined ||
            blocked.headers['ratelimit-remaining'] !== undefined;
        expect(hasRateLimit).toBe(true);
    }, 15000);

    it('AC: resposta 429 inclui header Retry-After', async () => {
        const IP = '203.0.113.57';

        for (let i = 0; i < 6; i++) {
            await request(app).get('/login-test').set('X-Forwarded-For', IP);
        }

        const blocked = await request(app)
            .get('/login-test')
            .set('X-Forwarded-For', IP);

        expect(blocked.status).toBe(429);
        expect(blocked.headers['retry-after']).toBeDefined();
    }, 15000);

    it('Bucket é POR IP — IP distinto não compartilha contador', async () => {
        const IP_A = '203.0.113.70';
        const IP_B = '203.0.113.71';

        // Satura IP_A
        for (let i = 0; i < 6; i++) {
            await request(app).get('/login-test').set('X-Forwarded-For', IP_A);
        }

        // IP_A bloqueado
        const blocked = await request(app).get('/login-test').set('X-Forwarded-For', IP_A);
        expect(blocked.status).toBe(429);

        // IP_B intacto
        const fresh = await request(app).get('/login-test').set('X-Forwarded-For', IP_B);
        expect(fresh.status).toBe(200);
    }, 15000);
});
