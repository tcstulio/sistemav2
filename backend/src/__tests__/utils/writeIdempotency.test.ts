import { describe, it, expect, vi, beforeEach } from 'vitest';

// "Disco" em memória (o setup global mocka fs por completo). Necessário p/ o teste de persistência.
const fakeDisk = vi.hoisted(() => ({ files: new Map<string, string>() }));
vi.mock('fs', async (importActual) => {
    const actual = await importActual<typeof import('fs')>();
    return {
        ...actual,
        default: {
            ...actual,
            existsSync: (p: any) => fakeDisk.files.has(String(p)) || actual.existsSync(p),
            readFileSync: ((p: any, enc: any) => fakeDisk.files.has(String(p)) ? fakeDisk.files.get(String(p))! : actual.readFileSync(p, enc)) as any,
            unlinkSync: ((p: any) => { fakeDisk.files.delete(String(p)); }) as any,
        },
        existsSync: (p: any) => fakeDisk.files.has(String(p)),
        readFileSync: ((p: any) => fakeDisk.files.has(String(p)) ? fakeDisk.files.get(String(p))! : '{}') as any,
        unlinkSync: ((p: any) => { fakeDisk.files.delete(String(p)); }) as any,
    };
});
vi.mock('../../utils/atomicWrite', () => ({
    atomicWriteSync: vi.fn((p: string, data: any) => { fakeDisk.files.set(String(p), JSON.stringify(data)); }),
}));

import {
    writeIdempotencyKey, getIdempotentWrite, rememberWrite,
    __reloadWriteIdempotencyForTests, __clearWriteIdempotencyForTests,
} from '../../utils/writeIdempotency';

describe('writeIdempotency — store de idempotência de escrita', () => {
    beforeEach(() => { fakeDisk.files.clear(); __clearWriteIdempotencyForTests(); });

    it('chave é ESTÁVEL: mesmos inputs → mesma chave (independe da ORDEM das chaves dos args)', () => {
        const a = writeIdempotencyKey('turn1', 'u1', 'validate_invoice', { invoice_id: '50', note: 'x' });
        const b = writeIdempotencyKey('turn1', 'u1', 'validate_invoice', { note: 'x', invoice_id: '50' });
        expect(a).toBe(b);
    });

    it('chave MUDA com turno, ator, tool ou args diferentes', () => {
        const base = writeIdempotencyKey('turn1', 'u1', 'validate_invoice', { invoice_id: '50' });
        expect(writeIdempotencyKey('turn2', 'u1', 'validate_invoice', { invoice_id: '50' })).not.toBe(base);
        expect(writeIdempotencyKey('turn1', 'u2', 'validate_invoice', { invoice_id: '50' })).not.toBe(base);
        expect(writeIdempotencyKey('turn1', 'u1', 'validate_order', { invoice_id: '50' })).not.toBe(base);
        expect(writeIdempotencyKey('turn1', 'u1', 'validate_invoice', { invoice_id: '51' })).not.toBe(base);
    });

    it('get devolve undefined até remember; depois devolve o resultado', () => {
        const k = writeIdempotencyKey('t', 'u', 'validate_invoice', { invoice_id: '9' });
        expect(getIdempotentWrite(k)).toBeUndefined();
        rememberWrite(k, 'Fatura #9 validada.');
        expect(getIdempotentWrite(k)).toBe('Fatura #9 validada.');
    });

    it('persiste no "disco" e sobrevive a um reload (restart)', () => {
        const k = writeIdempotencyKey('t', 'u', 'validate_invoice', { invoice_id: '9' });
        rememberWrite(k, 'OK');
        __reloadWriteIdempotencyForTests();
        expect(getIdempotentWrite(k)).toBe('OK');
    });

    it('arquivo corrompido no disco → começa vazio (não quebra)', () => {
        // Simula um JSON inválido persistido.
        const anyKey = writeIdempotencyKey('t', 'u', 'x', {});
        rememberWrite(anyKey, 'OK');
        // corrompe o "disco" e recarrega
        for (const p of fakeDisk.files.keys()) fakeDisk.files.set(p, '{ isso não é json');
        expect(() => __reloadWriteIdempotencyForTests()).not.toThrow();
        expect(getIdempotentWrite(anyKey)).toBeUndefined();
    });
});
