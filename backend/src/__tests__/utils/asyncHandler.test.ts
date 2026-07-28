import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { asyncHandler, AsyncRequestHandler } from '../../utils/asyncHandler';

function mockReq(): Request {
    return {
        method: 'GET',
        path: '/test',
        body: {},
        params: {},
        query: {},
        headers: {},
    } as unknown as Request;
}

function mockRes(): Response {
    return {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
        setHeader: vi.fn().mockReturnThis(),
        end: vi.fn().mockReturnThis(),
    } as unknown as Response;
}

function mockNext(): NextFunction {
    return vi.fn() as unknown as NextFunction;
}

describe('asyncHandler', () => {
    it('returns a function that can be used as an Express handler', () => {
        const wrapped = asyncHandler(async (_req, _res) => {
            // no-op
        });
        expect(typeof wrapped).toBe('function');
        // Express handlers take up to 3 args (req, res, next).
        expect(wrapped.length).toBeLessThanOrEqual(3);
    });

    it('forwards a rejected promise from the handler to next(error)', async () => {
        const error = new Error('async failure');
        const handler = vi.fn().mockRejectedValue(error);
        const wrapped = asyncHandler(handler);

        const req = mockReq();
        const res = mockRes();
        const next = mockNext();

        await wrapped(req, res, next);

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith(error);
    });

    it('does not call next when the handler resolves successfully', async () => {
        const handler = vi.fn().mockResolvedValue(undefined);
        const wrapped = asyncHandler(handler);

        const req = mockReq();
        const res = mockRes();
        const next = mockNext();

        await wrapped(req, res, next);

        expect(handler).toHaveBeenCalledWith(req, res, next);
        expect(next).not.toHaveBeenCalled();
    });

    it('passes req, res and next unchanged to the inner handler', async () => {
        let captured: { req: Request; res: Response; next: NextFunction } | null = null;
        const wrapped = asyncHandler(async (req, res, next) => {
            captured = { req, res, next };
        });

        const req = mockReq();
        const res = mockRes();
        const next = mockNext();

        await wrapped(req, res, next);

        expect(captured).not.toBeNull();
        expect(captured!.req).toBe(req);
        expect(captured!.res).toBe(res);
        expect(captured!.next).toBe(next);
    });

    it('forwards errors thrown inside an async handler body to next', async () => {
        const wrapped = asyncHandler(async () => {
            throw new Error('boom');
        });

        const req = mockReq();
        const res = mockRes();
        const next = mockNext();

        await wrapped(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        const forwarded = (next as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(forwarded).toBeInstanceOf(Error);
        expect((forwarded as Error).message).toBe('boom');
    });

    it('forwards non-Error rejection values to next unchanged', async () => {
        const handler = vi.fn().mockRejectedValue('plain string rejection');
        const wrapped = asyncHandler(handler);

        const req = mockReq();
        const res = mockRes();
        const next = mockNext();

        await wrapped(req, res, next);

        expect(next).toHaveBeenCalledWith('plain string rejection');
    });

    it('handles rejection with an object that has a custom message', async () => {
        const custom = { message: 'domain error', code: 'X' };
        const handler = vi.fn().mockRejectedValue(custom);
        const wrapped = asyncHandler(handler);

        const req = mockReq();
        const res = mockRes();
        const next = mockNext();

        await wrapped(req, res, next);

        expect(next).toHaveBeenCalledWith(custom);
    });

    it('allows the handler to call res.json without forwarding anything to next', async () => {
        const wrapped = asyncHandler(async (_req: Request, res: Response) => {
            res.status(200).json({ ok: true });
        });

        const req = mockReq();
        const res = mockRes();
        const next = mockNext();

        await wrapped(req, res, next);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ ok: true });
        expect(next).not.toHaveBeenCalled();
    });

    it('produces independent wrappers — errors do not leak between wrappers', async () => {
        const err1 = new Error('first');
        const err2 = new Error('second');
        const wrappedA = asyncHandler(async () => { throw err1; });
        const wrappedB = asyncHandler(async () => { throw err2; });

        const req = mockReq();
        const res = mockRes();
        const nextA = mockNext();
        const nextB = mockNext();

        await wrappedA(req, res, nextA);
        await wrappedB(req, res, nextB);

        expect(nextA).toHaveBeenCalledWith(err1);
        expect(nextB).toHaveBeenCalledWith(err2);
    });

    it('can wrap the documented aiRoutes example without invoking next on success', async () => {
        const wrapped = asyncHandler(async (req: Request, res: Response) => {
            const { data } = (req as Request<unknown, unknown, { data: { value: number } }>).body;
            const result = { doubled: data.value * 2 };
            (res.status(200) as Response).json({ result });
        });

        const req = {
            method: 'POST',
            path: '/generate',
            body: { data: { value: 21 } },
            params: {},
            query: {},
            headers: {},
        } as unknown as Request;
        const res = mockRes();
        const next = mockNext();

        await wrapped(req, res, next);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ result: { doubled: 42 } });
        expect(next).not.toHaveBeenCalled();
    });

    it('returns a RequestHandler-compatible function (structural compatibility)', () => {
        // Compile-time check: assigning the wrapper to a RequestHandler-typed
        // variable must succeed without an `any` cast, confirming the wrapper
        // is structurally compatible with Express's handler interface.
        const handler: RequestHandler = asyncHandler(async (_req, res) => {
            res.status(200).json({ ok: true });
        });
        expect(typeof handler).toBe('function');
    });

    it('AsyncRequestHandler is exported and can be used to type async handlers', () => {
        // Compile-time check that AsyncRequestHandler is a type (and not a value)
        // and that handlers typed with it can be wrapped by asyncHandler.
        const fn: AsyncRequestHandler = async (_req, _res) => {
            // no-op
        };
        const wrapped = asyncHandler(fn);
        expect(typeof wrapped).toBe('function');
    });
});