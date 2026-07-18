import { describe, it, expect, vi } from 'vitest';
import { asyncHandler, AsyncRequestHandler } from '../../utils/asyncHandler';

function mockReq() {
    return {} as Parameters<AsyncRequestHandler>[0];
}

function mockRes() {
    return {} as Parameters<AsyncRequestHandler>[1];
}

function mockNext() {
    return vi.fn();
}

describe('asyncHandler', () => {
    it('catches async errors and passes to next', async () => {
        const error = new Error('Async fail');
        const fn = vi.fn().mockRejectedValue(error);
        const wrapped = asyncHandler(fn);

        const req = mockReq();
        const res = mockRes();
        const next = mockNext();

        await wrapped(req, res, next);

        expect(fn).toHaveBeenCalledWith(req, res, next);
        expect(next).toHaveBeenCalledWith(error);
    });

    it('passes through on success', async () => {
        const fn = vi.fn().mockResolvedValue('ok');
        const wrapped = asyncHandler(fn);

        const req = mockReq();
        const res = mockRes();
        const next = mockNext();

        await wrapped(req, res, next);

        expect(fn).toHaveBeenCalledWith(req, res, next);
        expect(next).not.toHaveBeenCalled();
    });
});