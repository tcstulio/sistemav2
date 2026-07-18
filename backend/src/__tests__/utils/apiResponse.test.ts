import { describe, it, expect, vi } from 'vitest';
import { ok, created, fail, paginated, noContent } from '../../utils/apiResponse';
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
    // Encadeamento: status(...).json(...) e status(...).send(...) retornam res
    res.status.mockImplementation(() => res);
    json.mockImplementation(() => res);
    send.mockImplementation(() => res);
    return res as Response & {
        status: ReturnType<typeof vi.fn>;
        json: ReturnType<typeof vi.fn>;
        send: ReturnType<typeof vi.fn>;
    };
}

describe('ok (#1540 apiResponse)', () => {
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
        const meta = { source: 'cache', ts: 42 };

        ok(res, data, meta);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ success: true, data, meta });
    });

    it('preserves the generic type of data (TS compile-time check)', () => {
        // Em runtime isto não valida o tipo, mas garante que a chamada
        // com generics compostos funciona (sem `any` indevido).
        const res = mockRes();
        type User = { id: number; name: string };
        const user: User = { id: 1, name: 'Alice' };

        ok<User>(res, user);

        expect(res.json).toHaveBeenCalledWith({ success: true, data: user });
    });
});

describe('created (#1540 apiResponse)', () => {
    it('returns 201 with { success: true, data }', () => {
        const res = mockRes();
        const data = { id: 99, created: true };

        created(res, data);

        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith({ success: true, data });
    });

    it('includes meta when provided', () => {
        const res = mockRes();
        const data = { id: 100 };

        created(res, data, { audit: 'auto' });

        expect(res.json).toHaveBeenCalledWith({ success: true, data, meta: { audit: 'auto' } });
    });
});

describe('fail (#1540 apiResponse)', () => {
    it('defaults to status 400 when status is omitted', () => {
        const res = mockRes();

        fail(res, 'BAD_REQUEST', 'Something is off');

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            error: { code: 'BAD_REQUEST', message: 'Something is off' }
        });
    });

    it('uses the provided status', () => {
        const res = mockRes();

        fail(res, 'NOT_FOUND', 'Missing', 404);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Missing' }
        });
    });

    it('includes details when provided', () => {
        const res = mockRes();
        const details = [{ field: 'email', message: 'required' }];

        fail(res, 'VALIDATION_ERROR', 'Invalid input', 422, details);

        expect(res.status).toHaveBeenCalledWith(422);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details }
        });
    });

    it('omits the details field when not provided', () => {
        const res = mockRes();

        fail(res, 'INTERNAL_ERROR', 'boom', 500);

        const body = (res.json as any).mock.calls[0][0];
        expect(body).not.toHaveProperty('error.details');
    });

    it('treats explicit undefined details the same as omitted', () => {
        const res = mockRes();

        fail(res, 'CUSTOM', 'msg', 418, undefined);

        const body = (res.json as any).mock.calls[0][0];
        expect(body.error).not.toHaveProperty('details');
    });
});

describe('paginated (#1540 apiResponse)', () => {
    it('returns 200 with { success: true, data, meta: { page, perPage, total } }', () => {
        const res = mockRes();
        const items = [{ id: 1 }, { id: 2 }, { id: 3 }];

        paginated(res, items, 2, 10, 42);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({
            success: true,
            data: items,
            meta: { page: 2, perPage: 10, total: 42 }
        });
    });

    it('merges extra meta fields alongside page/perPage/total', () => {
        const res = mockRes();
        const items: any[] = [];

        paginated(res, items, 1, 25, 0, { source: 'db', tookMs: 17 });

        expect(res.json).toHaveBeenCalledWith({
            success: true,
            data: [],
            meta: { page: 1, perPage: 25, total: 0, source: 'db', tookMs: 17 }
        });
    });

    it('preserves pagination semantics when items is empty', () => {
        const res = mockRes();

        paginated(res, [], 1, 50, 0);

        expect(res.json).toHaveBeenCalledWith({
            success: true,
            data: [],
            meta: { page: 1, perPage: 50, total: 0 }
        });
    });

    it('handles total=0 even with non-empty items (e.g. filtered out)', () => {
        const res = mockRes();
        const items: any[] = [];

        paginated(res, items, 1, 10, 0);

        expect(res.json.mock.calls[0][0].data).toEqual([]);
        expect(res.json.mock.calls[0][0].meta.total).toBe(0);
    });
});

describe('noContent (#1540 apiResponse)', () => {
    it('returns 204 with empty body via .send()', () => {
        const res = mockRes();

        noContent(res);

        expect(res.status).toHaveBeenCalledWith(204);
        expect(res.send).toHaveBeenCalledWith();
        expect(res.json).not.toHaveBeenCalled();
    });
});