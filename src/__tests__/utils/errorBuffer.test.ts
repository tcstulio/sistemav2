import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    installErrorBuffer,
    readErrorBuffer,
    resetErrorBuffer,
    __resetInstalledForTests,
} from '../../utils/errorBuffer';

describe('errorBuffer', () => {
    let originalConsoleError: typeof console.error;
    let originalConsoleLog: typeof console.log;
    let originalConsoleWarn: typeof console.warn;
    let originalConsoleInfo: typeof console.info;

    beforeEach(() => {
        originalConsoleError = console.error;
        originalConsoleLog = console.log;
        originalConsoleWarn = console.warn;
        originalConsoleInfo = console.info;
        // Silencia o ruído durante os testes.
        console.error = vi.fn(() => {}) as any;
        console.log = vi.fn(() => {}) as any;
        console.warn = vi.fn(() => {}) as any;
        console.info = vi.fn(() => {}) as any;
        __resetInstalledForTests();
        resetErrorBuffer();
    });

    afterEach(() => {
        console.error = originalConsoleError;
        console.log = originalConsoleLog;
        console.warn = originalConsoleWarn;
        console.info = originalConsoleInfo;
        __resetInstalledForTests();
        resetErrorBuffer();
    });

    it('antes de instalar, buffer está vazio', () => {
        expect(readErrorBuffer()).toEqual({ logs: [], errors: [] });
    });

    it('installErrorBuffer é idempotente (instala uma única vez)', () => {
        installErrorBuffer();
        const afterFirst = console.error;
        installErrorBuffer(); // não deve re-wrap
        expect(console.error).toBe(afterFirst);
    });

    it('captura console.error no buffer de erros', () => {
        installErrorBuffer();
        console.error('boom', new Error('x'));
        const snap = readErrorBuffer();
        expect(snap.errors.length).toBe(1);
        expect(snap.errors[0]).toContain('boom');
        expect(snap.errors[0]).toContain('Error: x');
        expect(snap.logs.length).toBe(0);
    });

    it('captura console.log no buffer de logs', () => {
        installErrorBuffer();
        console.log('hello world');
        const snap = readErrorBuffer();
        expect(snap.logs.length).toBe(1);
        expect(snap.logs[0]).toContain('hello world');
        expect(snap.errors.length).toBe(0);
    });

    it('captura console.info e console.warn no buffer de logs (com prefixo)', () => {
        installErrorBuffer();
        console.info('informacao');
        console.warn('aviso');
        const snap = readErrorBuffer();
        expect(snap.logs.length).toBe(2);
        expect(snap.logs.some((l) => l.includes('informacao') && l.includes('[info]'))).toBe(true);
        expect(snap.logs.some((l) => l.includes('aviso') && l.includes('[warn]'))).toBe(true);
    });

    it('mantém o comportamento original do console (forward dos argumentos)', () => {
        installErrorBuffer();
        const spy = vi.fn();
        console.error = spy as any;
        console.error('encaminhado');
        expect(spy).toHaveBeenCalledWith('encaminhado');
    });

    it('limita o buffer a 30 linhas (FIFO)', () => {
        installErrorBuffer();
        for (let i = 0; i < 40; i++) console.error(`err ${i}`);
        const snap = readErrorBuffer();
        expect(snap.errors.length).toBe(30);
        expect(snap.errors[0]).toContain('err 10'); // os 10 primeiros saíram
        expect(snap.errors[snap.errors.length - 1]).toContain('err 39');
    });

    it('expõe window.__errorBuffer como snapshot fresco via getters', () => {
        installErrorBuffer();
        console.log('linha 1');
        expect(window.__errorBuffer).toBeDefined();
        expect(window.__errorBuffer!.logs).toEqual(readErrorBuffer().logs);
        console.log('linha 2');
        // getter retorna leitura fresca
        expect(window.__errorBuffer!.logs.length).toBe(2);
    });

    it('stringifica objetos e null sem lançar', () => {
        installErrorBuffer();
        const circular: any = { a: 1 };
        circular.self = circular;
        console.error('circular', circular, null, undefined);
        const snap = readErrorBuffer();
        expect(snap.errors.length).toBe(1);
        expect(snap.errors[0]).toContain('circular');
    });

    it('captura window.onerror via dispatchEvent', () => {
        installErrorBuffer();
        const ev = new ErrorEvent('error', {
            message: 'global boom',
            filename: 'app.js',
            lineno: 42,
        });
        window.dispatchEvent(ev);
        const snap = readErrorBuffer();
        expect(snap.errors.some((e) => e.includes('global boom') && e.includes('app.js:42'))).toBe(true);
    });

    it('captura unhandledrejection', async () => {
        installErrorBuffer();
        // .catch() suprime o warning de "unhandled rejection" do vitest sem
        // alterar o comportamento testado (o evento lê `reason` de forma síncrona).
        const p = Promise.reject();
        p.catch(() => {});
        const ev = new PromiseRejectionEvent('unhandledrejection', {
            promise: p,
            reason: 'rejeitado',
        });
        window.dispatchEvent(ev);
        const snap = readErrorBuffer();
        expect(snap.errors.some((e) => e.includes('unhandledrejection') && e.includes('rejeitado'))).toBe(true);
    });

    it('resetErrorBuffer limpa os buffers', () => {
        installErrorBuffer();
        console.log('x');
        console.error('y');
        expect(readErrorBuffer().logs.length).toBe(1);
        expect(readErrorBuffer().errors.length).toBe(1);
        resetErrorBuffer();
        expect(readErrorBuffer()).toEqual({ logs: [], errors: [] });
    });
});
