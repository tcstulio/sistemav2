import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

/**
 * Mock do `express-rate-limit` que captura cada chamada ao factory
 * `rateLimit(opts)` para que os testes possam inspecionar as opções
 * configuradas (windowMs, max, keyGenerator, handler, ...) e também
 * invocar o handler diretamente para validar o contrato `next(error)`.
 *
 * `vi.hoisted` é necessário porque o closure do `vi.mock` roda na fase
 * de transformação do módulo (antes do `const rateLimitCalls = []` da
 * raiz do arquivo estar disponível).
 */
const { rateLimitCalls } = vi.hoisted(() => ({ rateLimitCalls: [] as any[] }));

vi.mock('express-rate-limit', () => ({
    default: vi.fn((opts: any) => {
        rateLimitCalls.push(opts);
        const mw: any = (req: any, _res: any, next: any) => {
            // Repassa o opts no request pra testes integrados se quiserem
            (req as any).__rateLimitOptions = opts;
            next();
        };
        mw.__options = opts;
        return mw;
    }),
    ipKeyGenerator: vi.fn((ip: string) => ip),
}));

import { rateLimiters } from '../../middleware/rateLimit';

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const ONE_MIN_MS = 60 * 1000;

describe('rateLimiters (#1540 infrastructure)', () => {
    beforeAll(() => {
        // Força o módulo a ser avaliado (declarando cada preset) — sem isso,
        // `rateLimiters` é lazy e `rateLimitCalls` ficaria vazio.
        void rateLimiters.login;
        void rateLimiters.ai;
        void rateLimiters.banking;
        void rateLimiters.scheduler;
        void rateLimiters.strict;
        void rateLimiters.default;
        void rateLimiters.sync;
    });

    beforeEach(() => {
        // Não limpamos rateLimitCalls entre testes — a ordem dos presets
        // é determinística e validada uma vez no describe `exports`.
    });

    it('exports exactly 7 named presets (login, ai, banking, scheduler, strict, default, sync)', () => {
        const keys = Object.keys(rateLimiters).sort();
        expect(keys).toEqual(['ai', 'banking', 'default', 'login', 'scheduler', 'strict', 'sync']);
    });

    it('each preset is a function (Express middleware)', () => {
        for (const k of Object.keys(rateLimiters)) {
            expect(typeof (rateLimiters as any)[k], `preset ${k}`).toBe('function');
        }
    });

    describe('login preset (5/15min, IP+email)', () => {
        it('configures 15min window with max 5', () => {
            const opts = rateLimitCalls[0];
            expect(opts.windowMs).toBe(FIFTEEN_MIN_MS);
            expect(opts.max).toBe(5);
        });

        it('uses standardHeaders and disables legacy headers', () => {
            const opts = rateLimitCalls[0];
            expect(opts.standardHeaders).toBe(true);
            expect(opts.legacyHeaders).toBe(false);
        });

        it('handler builds an error with code=RATE_LIMIT, status=429, isOperational and calls next(error)', () => {
            const opts = rateLimitCalls[0];
            expect(typeof opts.handler).toBe('function');

            const req: any = {};
            const res: any = {};
            const next = vi.fn();

            opts.handler(req, res, next, opts);

            expect(next).toHaveBeenCalledTimes(1);
            const err = next.mock.calls[0][0];
            expect(err).toBeInstanceOf(Error);
            expect(err.status).toBe(429);
            expect(err.code).toBe('RATE_LIMIT');
            expect(err.isOperational).toBe(true);
            expect(err.message).toMatch(/login/i);
            expect(err.details).toMatchObject({ retryAfter: 15 * 60, limit: 5 });
        });

        it('keyGenerator combines IP and email/login (case-insensitive)', () => {
            const opts = rateLimitCalls[0];
            const req = { ip: '203.0.113.10', body: { email: 'User@Example.COM' } };
            const key = opts.keyGenerator(req, {} as any);
            expect(key).toContain('203.0.113.10');
            expect(key.toLowerCase()).toContain('user@example.com');
        });

        it('keyGenerator falls back to login field when email missing', () => {
            const opts = rateLimitCalls[0];
            const req = { ip: '203.0.113.11', body: { login: 'alice' } };
            const key = opts.keyGenerator(req, {} as any);
            expect(key).toContain('alice');
        });

        it('keyGenerator handles missing body gracefully (no crash)', () => {
            const opts = rateLimitCalls[0];
            const key = opts.keyGenerator({ ip: '203.0.113.12' }, {} as any);
            expect(key).toContain('203.0.113.12');
            // Quando não há identificador, ainda devolve uma chave válida.
            expect(typeof key).toBe('string');
            expect(key.length).toBeGreaterThan(0);
        });
    });

    describe('ai preset (20/1min, skip GET)', () => {
        it('configures 1min window with max 20', () => {
            // Ordem: [0]login, [1]ai
            const opts = rateLimitCalls[1];
            expect(opts.windowMs).toBe(ONE_MIN_MS);
            expect(opts.max).toBe(20);
        });

        it('skips GET requests (polling) so the limiter focuses on expensive writes (#320)', () => {
            const opts = rateLimitCalls[1];
            expect(opts.skip({ method: 'GET' } as any, {} as any)).toBe(true);
            expect(opts.skip({ method: 'POST' } as any, {} as any)).toBe(false);
            expect(opts.skip({ method: 'PUT' } as any, {} as any)).toBe(false);
        });

        it('handler builds RATE_LIMIT error mentioning AI', () => {
            const opts = rateLimitCalls[1];
            const next = vi.fn();
            opts.handler({}, {}, next, opts);
            const err = next.mock.calls[0][0];
            expect(err.status).toBe(429);
            expect(err.code).toBe('RATE_LIMIT');
            expect(err.message).toMatch(/ai/i);
            expect(err.details.limit).toBe(20);
        });
    });

    describe('banking preset (30/1min)', () => {
        it('configures 1min window with max 30', () => {
            const opts = rateLimitCalls[2];
            expect(opts.windowMs).toBe(ONE_MIN_MS);
            expect(opts.max).toBe(30);
        });

        it('handler builds RATE_LIMIT error mentioning banking', () => {
            const opts = rateLimitCalls[2];
            const next = vi.fn();
            opts.handler({}, {}, next, opts);
            const err = next.mock.calls[0][0];
            expect(err.status).toBe(429);
            expect(err.code).toBe('RATE_LIMIT');
            expect(err.message).toMatch(/banking/i);
            expect(err.details.limit).toBe(30);
        });
    });

    describe('scheduler preset (10/1min)', () => {
        it('configures 1min window with max 10', () => {
            const opts = rateLimitCalls[3];
            expect(opts.windowMs).toBe(ONE_MIN_MS);
            expect(opts.max).toBe(10);
        });

        it('handler builds RATE_LIMIT error mentioning scheduler', () => {
            const opts = rateLimitCalls[3];
            const next = vi.fn();
            opts.handler({}, {}, next, opts);
            const err = next.mock.calls[0][0];
            expect(err.status).toBe(429);
            expect(err.code).toBe('RATE_LIMIT');
            expect(err.message).toMatch(/scheduler/i);
            expect(err.details.limit).toBe(10);
        });
    });

    describe('strict preset (10/1min per IP, enumeration defense)', () => {
        it('configures 1min window with max 10', () => {
            const opts = rateLimitCalls[4];
            expect(opts.windowMs).toBe(ONE_MIN_MS);
            expect(opts.max).toBe(10);
        });

        it('does NOT skip any HTTP method (unlike ai preset)', () => {
            const opts = rateLimitCalls[4];
            // strict não tem skip → fica undefined
            expect(opts.skip).toBeUndefined();
        });

        it('handler builds RATE_LIMIT error', () => {
            const opts = rateLimitCalls[4];
            const next = vi.fn();
            opts.handler({}, {}, next, opts);
            const err = next.mock.calls[0][0];
            expect(err.status).toBe(429);
            expect(err.code).toBe('RATE_LIMIT');
            expect(err.details.limit).toBe(10);
        });
    });

    describe('default preset (100/15min fallback)', () => {
        it('configures 15min window with max 100', () => {
            const opts = rateLimitCalls[5];
            expect(opts.windowMs).toBe(FIFTEEN_MIN_MS);
            expect(opts.max).toBe(100);
        });

        it('handler builds RATE_LIMIT error', () => {
            const opts = rateLimitCalls[5];
            const next = vi.fn();
            opts.handler({}, {}, next, opts);
            const err = next.mock.calls[0][0];
            expect(err.status).toBe(429);
            expect(err.code).toBe('RATE_LIMIT');
            expect(err.details.limit).toBe(100);
            expect(err.details.retryAfter).toBe(15 * 60);
        });
    });

    describe('sync preset (#1569 — 30/1min, Dolibarr sync overload defense)', () => {
        it('configures 1min window with max 30', () => {
            // Ordem: [0]login, [1]ai, [2]banking, [3]scheduler, [4]strict, [5]default, [6]sync
            const opts = rateLimitCalls[6];
            expect(opts.windowMs).toBe(ONE_MIN_MS);
            expect(opts.max).toBe(30);
        });

        it('does NOT skip any HTTP method (sync writes e GETs de status contam — proteção total)', () => {
            const opts = rateLimitCalls[6];
            expect(opts.skip).toBeUndefined();
        });

        it('uses standardHeaders and disables legacy headers', () => {
            const opts = rateLimitCalls[6];
            expect(opts.standardHeaders).toBe(true);
            expect(opts.legacyHeaders).toBe(false);
        });

        it('handler builds RATE_LIMIT error mentioning sync', () => {
            const opts = rateLimitCalls[6];
            const next = vi.fn();
            opts.handler({}, {}, next, opts);
            const err = next.mock.calls[0][0];
            expect(err.status).toBe(429);
            expect(err.code).toBe('RATE_LIMIT');
            expect(err.isOperational).toBe(true);
            expect(err.message).toMatch(/sync/i);
            expect(err.details).toMatchObject({ retryAfter: 60, limit: 30 });
        });
    });

    describe('handler contract (all presets) — errorHandler integration', () => {
        it('every preset handler calls next exactly once with an Error instance', () => {
            // Reseta contadores pra testar fresh
            const freshNext = vi.fn();
            for (let i = 0; i < rateLimitCalls.length; i++) {
                freshNext.mockClear();
                const opts = rateLimitCalls[i];
                opts.handler({}, {}, freshNext, opts);
                expect(freshNext).toHaveBeenCalledTimes(1);
                const err = freshNext.mock.calls[0][0];
                expect(err).toBeInstanceOf(Error);
                expect(err.status).toBe(429);
                expect(err.code).toBe('RATE_LIMIT');
                expect(err.isOperational).toBe(true);
            }
        });

        it('does not write to res directly (#1540 — handler must defer to errorHandler)', () => {
            const res = mockRes();
            for (let i = 0; i < rateLimitCalls.length; i++) {
                const opts = rateLimitCalls[i];
                res.status.mockClear();
                res.json.mockClear();
                res.send.mockClear();
                const next = vi.fn();
                opts.handler({}, res as any, next, opts);
                // Handler NÃO toca o res — a renderização fica a cargo do errorHandler.
                expect(res.status).not.toHaveBeenCalled();
                expect(res.json).not.toHaveBeenCalled();
                expect(res.send).not.toHaveBeenCalled();
            }
        });
    });
});

function mockRes() {
    return {
        status: vi.fn(),
        json: vi.fn(),
        send: vi.fn(),
    };
}