import { describe, it, expect, vi } from 'vitest';
import { ok, created, fail } from '../../utils/response';
import type { ResponseEnvelope, ErrorBody } from '../../utils/response';
import type { Response } from 'express';

/**
 * Cria um mock mínimo de `express.Response` capturando as chamadas a
 * `status(...).json(...)` e `status(...).send()`. Encadeável igual ao
 * real (`status().json()` retorna `res`).
 */
function mockRes() {
    const json = vi.fn();
    const send = vi.fn();
    const res: any = {
        status: vi.fn(),
        json,
        send,
    };
    res.status.mockImplementation(() => res);
    json.mockImplementation(() => res);
    send.mockImplementation(() => res);
    return res as Response & {
        status: ReturnType<typeof vi.fn>;
        json: ReturnType<typeof vi.fn>;
        send: ReturnType<typeof vi.fn>;
    };
}

describe('ok (#976 — envelope de resposta padrão)', () => {
    it('returns 200 with { success: true, data } and no meta by default', () => {
        const res = mockRes();
        const data = { id: 1, name: 'Alice' };

        const ret = ok(res, data);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ success: true, data });
        expect(ret).toBeDefined();
    });

    it('includes meta when provided', () => {
        const res = mockRes();
        const data = [{ id: 1 }];
        const meta = { page: 1, perPage: 20, total: 42 };

        ok(res, data, meta);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ success: true, data, meta });
    });

    it('omits meta when undefined is explicitly passed', () => {
        const res = mockRes();

        ok(res, { foo: 'bar' }, undefined);

        const body = (res.json as any).mock.calls[0][0];
        expect(body).toEqual({ success: true, data: { foo: 'bar' } });
        expect(body).not.toHaveProperty('meta');
    });

    it('preserves the generic type of data (TS compile-time check)', () => {
        const res = mockRes();
        type User = { id: number; name: string };
        const user: User = { id: 1, name: 'Alice' };

        ok<User>(res, user);

        expect(res.json).toHaveBeenCalledWith({ success: true, data: user });
    });
});

describe('created (#976 — envelope de resposta padrão)', () => {
    it('returns 201 with { success: true, data }', () => {
        const res = mockRes();
        const data = { id: 99, created: true };

        created(res, data);

        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith({ success: true, data });
    });

    it('does NOT include meta even when caller passes it (spec: created does not take meta)', () => {
        const res = mockRes();
        const data = { id: 100 };

        created(res, data);

        const body = (res.json as any).mock.calls[0][0];
        expect(body).not.toHaveProperty('meta');
    });
});

describe('fail (#976 — envelope de resposta padrão)', () => {
    it('defaults to status 400 when status is omitted', () => {
        const res = mockRes();

        fail(res, 'Something is off');

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            error: { message: 'Something is off' }
        });
    });

    it('defaults to code "INTERNAL_ERROR" when code is omitted', () => {
        const res = mockRes();

        fail(res, 'Algo quebrou');

        const body = (res.json as any).mock.calls[0][0];
        // Spec: code é opcional; quando omitido, simplesmente não aparece.
        expect(body.error).not.toHaveProperty('code');
    });

    it('uses the provided code', () => {
        const res = mockRes();

        fail(res, 'Recurso não encontrado', 'NOT_FOUND', 404);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            error: { message: 'Recurso não encontrado', code: 'NOT_FOUND' }
        });
    });

    it('uses the provided status (independent of code)', () => {
        const res = mockRes();

        fail(res, 'Muitas requisições', 'RATE_LIMIT', 429);

        expect(res.status).toHaveBeenCalledWith(429);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            error: { message: 'Muitas requisições', code: 'RATE_LIMIT' }
        });
    });

    it('includes details when provided', () => {
        const res = mockRes();
        const details = [{ field: 'email', message: 'required' }];

        fail(res, 'Inválido', 'VALIDATION_ERROR', 422, details);

        expect(res.status).toHaveBeenCalledWith(422);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            error: {
                message: 'Inválido',
                code: 'VALIDATION_ERROR',
                details
            }
        });
    });

    it('omits the details field when not provided', () => {
        const res = mockRes();

        fail(res, 'boom', 'INTERNAL_ERROR', 500);

        const body = (res.json as any).mock.calls[0][0];
        expect(body.error).not.toHaveProperty('details');
    });

    it('treats explicit undefined details the same as omitted', () => {
        const res = mockRes();

        fail(res, 'msg', 'CUSTOM', 418, undefined);

        const body = (res.json as any).mock.calls[0][0];
        expect(body.error).not.toHaveProperty('details');
    });

    it('preserves the parameter order from spec: (res, message, code?, status?, details?)', () => {
        const res = mockRes();

        // Spec da issue: message é o 2º argumento (obrigatório), code 3º.
        fail(res, 'Sem código', undefined, 400);

        const body = (res.json as any).mock.calls[0][0];
        expect(body.error.message).toBe('Sem código');
        expect(body.error).not.toHaveProperty('code');
    });
});

describe('ResponseEnvelope / ErrorBody types (#976 — envelope de resposta padrão)', () => {
    it('ResponseEnvelope<T> é a união discriminada por `success`', () => {
        type User = { id: number };
        // Compila em runtime: ambas as formas devem ser atribuíveis.
        const success: ResponseEnvelope<User> = { success: true, data: { id: 1 } };
        const failure: ResponseEnvelope<User> = {
            success: false,
            error: { message: 'falhou' }
        };
        expect(success.success).toBe(true);
        expect(failure.success).toBe(false);
    });

    it('ErrorBody aceita message obrigatório, code/details opcionais', () => {
        const minimal: ErrorBody = { message: 'ok' };
        const full: ErrorBody = {
            message: 'ok',
            code: 'VALIDATION_ERROR',
            details: { field: 'email' }
        };
        expect(minimal.message).toBe('ok');
        expect(full.code).toBe('VALIDATION_ERROR');
    });
});
