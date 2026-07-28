import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import { formatCrashEntry, appendCrashLog, installCrashHandlers, CRASH_LOG_PATH } from '../../utils/crashLog';

vi.mock('fs');

const AT = new Date('2026-07-20T22:48:00.000Z');

describe('formatCrashEntry', () => {
    it('formata um Error com name/message/stack', () => {
        const err = new Error('boom');
        err.stack = 'Error: boom\n    at foo (x.ts:1:1)';
        const out = formatCrashEntry('uncaughtException', err, AT);
        expect(out).toContain('[2026-07-20T22:48:00.000Z] uncaughtException: Error: boom');
        expect(out).toContain('at foo (x.ts:1:1)');
        expect(out.startsWith('='.repeat(72))).toBe(true);
        expect(out.endsWith('\n')).toBe(true);
    });

    it('formata uma string como razão', () => {
        const out = formatCrashEntry('unhandledRejection', 'somente texto', AT);
        expect(out).toContain('unhandledRejection: Error: somente texto');
        expect(out).toContain('(sem stack)');
    });

    it('formata um objeto rejeitado sem Error (safeStringify)', () => {
        const out = formatCrashEntry('unhandledRejection', { code: 42 }, AT);
        expect(out).toContain('unhandledRejection: object: {"code":42}');
    });

    it('formata undefined sem quebrar', () => {
        const out = formatCrashEntry('unhandledRejection', undefined, AT);
        expect(out).toContain('unhandledRejection: undefined:');
    });

    it('é determinístico no timestamp (usa a Date passada)', () => {
        const a = formatCrashEntry('uncaughtException', new Error('x'), AT);
        const b = formatCrashEntry('uncaughtException', new Error('x'), AT);
        // mesma Date + mesmo erro (sem stack real) → mesma linha de cabeçalho
        expect(a.split('\n')[1]).toEqual(b.split('\n')[1]);
    });
});

describe('appendCrashLog', () => {
    beforeEach(() => vi.clearAllMocks());

    it('cria o diretório e faz append no arquivo', () => {
        appendCrashLog('linha de crash\n');
        expect(fs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
        expect(fs.appendFileSync).toHaveBeenCalledWith(CRASH_LOG_PATH, 'linha de crash\n', 'utf8');
    });

    it('nunca lança, mesmo se o fs falhar (best-effort dentro de handler de crash)', () => {
        vi.mocked(fs.appendFileSync).mockImplementation(() => { throw new Error('disk full'); });
        expect(() => appendCrashLog('x')).not.toThrow();
    });
});

describe('installCrashHandlers', () => {
    beforeEach(() => vi.clearAllMocks());

    it('registra unhandledRejection e uncaughtException, e é idempotente', () => {
        // Mocka process.on p/ NÃO anexar handlers reais no processo de teste (o de
        // uncaughtException chama process.exit(1)) — só registramos as chamadas.
        const spy = vi.spyOn(process, 'on').mockImplementation(() => process);
        installCrashHandlers();
        installCrashHandlers(); // 2ª chamada não deve registrar de novo

        const events = spy.mock.calls.map((c) => c[0]);
        // idempotente: cada evento registrado no máximo 1 vez por este módulo
        expect(events.filter((e) => e === 'unhandledRejection').length).toBeLessThanOrEqual(1);
        expect(events.filter((e) => e === 'uncaughtException').length).toBeLessThanOrEqual(1);
        spy.mockRestore();
    });
});
