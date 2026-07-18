import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZodError } from 'zod';

const { mockLogError } = vi.hoisted(() => ({
    mockLogError: vi.fn(),
}));

vi.mock('../../utils/logger', () => ({
    createLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: mockLogError,
    }),
}));

import {
    errorHandler,
    createErrorResponse,
    AppError,
    ValidationError,
    NotFoundError,
    UnauthorizedError,
    ForbiddenError,
    ConflictError,
    RateLimitError,
    asyncHandler,
} from '../../middleware/errorHandler';

function mockRes() {
    return {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
    } as any;
}

function mockReq() {
    return {
        method: 'GET',
        path: '/test',
        url: '/test',
        originalUrl: '/test',
        ip: '127.0.0.1',
        headers: { 'user-agent': 'test-agent' },
    } as any;
}

function mockNext() {
    return vi.fn();
}

describe('errorHandler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('handles ZodError and returns 400 with field details', () => {
        const zodError = new ZodError([
            {
                code: 'invalid_type',
                expected: 'string',
                received: 'number',
                path: ['body', 'name'],
                message: 'Expected string, received number',
            },
        ]);

        const req = mockReq();
        const res = mockRes();
        const next = mockNext();

        errorHandler(zodError, req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        const jsonArg = res.json.mock.calls[0][0];
        expect(jsonArg.error.code).toBe('VALIDATION_ERROR');
        expect(jsonArg.error.message).toBe('Validation failed');
        expect(jsonArg.error.details).toHaveLength(1);
        expect(jsonArg.error.details[0].field).toBe('body.name');
        expect(jsonArg.error.details[0].message).toBe('Expected string, received number');
    });

    it('handles generic error and logs it', () => {
        const error = new Error('Something went wrong');
        error.stack = 'Error: Something went wrong\n    at test.js:1:1';

        const req = mockReq();
        const res = mockRes();
        const next = mockNext();

        const origEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';

        errorHandler(error, req, res, next);

        expect(mockLogError).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalled();

        process.env.NODE_ENV = origEnv;
    });

    it('handles error with status and code properties', () => {
        const error: any = new Error('Custom error');
        error.status = 403;
        error.code = 'FORBIDDEN';

        const req = mockReq();
        const res = mockRes();
        const next = mockNext();

        const origEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';

        errorHandler(error, req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);

        process.env.NODE_ENV = origEnv;
    });
});

describe('createErrorResponse', () => {
    it('returns default status 500 when no status on error', () => {
        const error = new Error('test');
        const result = createErrorResponse(error, false);
        expect(result.status).toBe(500);
    });

    it('uses error status when provided', () => {
        const error: any = new Error('test');
        error.status = 404;
        const result = createErrorResponse(error, false);
        expect(result.status).toBe(404);
    });

    it('uses error code when provided', () => {
        const error: any = new Error('test');
        error.status = 400;
        error.code = 'VALIDATION_ERROR';
        const result = createErrorResponse(error, false);
        expect(result.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('defaults code to INTERNAL_ERROR', () => {
        const error = new Error('test');
        const result = createErrorResponse(error, false);
        expect(result.body.error).toHaveProperty('code', 'INTERNAL_ERROR');
    });

    it('in development, shows full error message', () => {
        const error = new Error('Detailed dev error message');
        const result = createErrorResponse(error, false);
        expect(result.body.error).toHaveProperty('message', 'Detailed dev error message');
    });

    it('in production with operational safe code, sanitizes sensitive error messages', () => {
        const error: any = new Error('Database password connection string error');
        error.status = 400;
        error.code = 'BAD_REQUEST';
        error.isOperational = true;
        const result = createErrorResponse(error, true);
        expect(result.body.error).toHaveProperty('message', 'An internal error occurred. Please try again later.');
    });

    it('in production with operational safe code, truncates long error messages', () => {
        const longMessage = 'a'.repeat(250);
        const error: any = new Error(longMessage);
        error.status = 400;
        error.code = 'BAD_REQUEST';
        error.isOperational = true;
        const result = createErrorResponse(error, true);
        expect((result.body.error as any).message).toBe('a'.repeat(200) + '...');
    });

    it('in production with operational safe code, keeps short safe messages', () => {
        const error: any = new Error('Short safe message');
        error.status = 400;
        error.code = 'BAD_REQUEST';
        error.isOperational = true;
        const result = createErrorResponse(error, true);
        expect(result.body.error).toHaveProperty('message', 'Short safe message');
    });

    it('in production with non-operational error, hides details', () => {
        const error: any = new Error('internal thing');
        error.status = 500;
        error.code = 'SOME_INTERNAL_CODE';
        error.isOperational = false;
        const result = createErrorResponse(error, true);
        expect(result.body.error).toHaveProperty('code', 'INTERNAL_ERROR');
        expect(result.body.error).toHaveProperty('message', 'Internal server error. Please try again later.');
    });

    it('in production with operational safe code, shows details', () => {
        const error: any = new Error('Not found error');
        error.status = 404;
        error.code = 'NOT_FOUND';
        error.isOperational = true;
        const result = createErrorResponse(error, true);
        expect(result.body.error).toHaveProperty('code', 'NOT_FOUND');
    });

    it('includes details when VALIDATION_ERROR with showDetails', () => {
        const error: any = new Error('Validation failed');
        error.status = 400;
        error.code = 'VALIDATION_ERROR';
        error.isOperational = true;
        error.details = [{ field: 'name', message: 'required' }];
        const result = createErrorResponse(error, false);
        expect((result.body.error as any).details).toEqual([{ field: 'name', message: 'required' }]);
    });

    it('does not include details when showDetails is false in production', () => {
        const error: any = new Error('Validation failed');
        error.status = 500;
        error.code = 'VALIDATION_ERROR';
        error.isOperational = false;
        error.details = [{ field: 'name', message: 'required' }];
        const result = createErrorResponse(error, true);
        expect((result.body.error as any).details).toBeUndefined();
    });

    it('does not include details for non-VALIDATION_ERROR code', () => {
        const error: any = new Error('Auth error');
        error.status = 401;
        error.code = 'UNAUTHORIZED';
        error.isOperational = true;
        error.details = [{ field: 'token', message: 'invalid' }];
        const result = createErrorResponse(error, false);
        expect((result.body.error as any).details).toBeUndefined();
    });

    it('treats status < 500 as operational when isOperational is not set', () => {
        const error: any = new Error('client error');
        error.status = 400;
        const result = createErrorResponse(error, true);
        expect(result.body.error).toHaveProperty('code', 'INTERNAL_ERROR');
    });
});

describe('Custom Error Classes', () => {
    it('ValidationError has correct properties', () => {
        const err = new ValidationError('Invalid input', [{ field: 'name', msg: 'required' }]);
        expect(err.name).toBe('ValidationError');
        expect(err.status).toBe(400);
        expect(err.code).toBe('VALIDATION_ERROR');
        expect(err.isOperational).toBe(true);
        expect(err.message).toBe('Invalid input');
        expect(err.details).toEqual([{ field: 'name', msg: 'required' }]);
    });

    it('ValidationError without details', () => {
        const err = new ValidationError('Invalid');
        expect(err.details).toBeUndefined();
    });

    it('NotFoundError has correct properties', () => {
        const err = new NotFoundError('User');
        expect(err.name).toBe('NotFoundError');
        expect(err.status).toBe(404);
        expect(err.code).toBe('NOT_FOUND');
        expect(err.isOperational).toBe(true);
        expect(err.message).toBe('User not found');
    });

    it('NotFoundError uses default message', () => {
        const err = new NotFoundError();
        expect(err.message).toBe('Resource not found');
    });

    it('UnauthorizedError has correct properties', () => {
        const err = new UnauthorizedError('Token expired');
        expect(err.name).toBe('UnauthorizedError');
        expect(err.status).toBe(401);
        expect(err.code).toBe('UNAUTHORIZED');
        expect(err.isOperational).toBe(true);
        expect(err.message).toBe('Token expired');
    });

    it('UnauthorizedError uses default message', () => {
        const err = new UnauthorizedError();
        expect(err.message).toBe('Authentication required');
    });

    it('ForbiddenError has correct properties', () => {
        const err = new ForbiddenError('No access');
        expect(err.name).toBe('ForbiddenError');
        expect(err.status).toBe(403);
        expect(err.code).toBe('FORBIDDEN');
        expect(err.isOperational).toBe(true);
        expect(err.message).toBe('No access');
    });

    it('ForbiddenError uses default message', () => {
        const err = new ForbiddenError();
        expect(err.message).toBe('Access denied');
    });

    it('ConflictError has correct properties', () => {
        const err = new ConflictError('Duplicate');
        expect(err.name).toBe('ConflictError');
        expect(err.status).toBe(409);
        expect(err.code).toBe('CONFLICT');
        expect(err.isOperational).toBe(true);
        expect(err.message).toBe('Duplicate');
    });

    it('ConflictError uses default message', () => {
        const err = new ConflictError();
        expect(err.message).toBe('Resource already exists');
    });

    it('RateLimitError has correct properties', () => {
        const err = new RateLimitError('Too many');
        expect(err.name).toBe('RateLimitError');
        expect(err.status).toBe(429);
        expect(err.code).toBe('RATE_LIMITED');
        expect(err.isOperational).toBe(true);
        expect(err.message).toBe('Too many');
    });

    it('RateLimitError uses default message', () => {
        const err = new RateLimitError();
        expect(err.message).toBe('Rate limit exceeded');
    });
});

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

describe('containsSensitiveInfo (via createErrorResponse)', () => {
    const sensitiveMessages = [
        'Error in password reset',
        'Invalid secret key',
        'Token is malformed',
        'api_key not found',
        'apikey expired',
        'authorization header missing',
        'certificate error',
        'private key not found',
        'connection string invalid',
        'database connection failed',
        'sql injection detected',
        'mysql error',
        'postgres error',
        'mongodb timeout',
        'redis connection failed',
        'credential error',
    ];

    sensitiveMessages.forEach((msg) => {
        it(`sanitizes message containing "${msg}"`, () => {
            const error: any = new Error(msg);
            error.status = 400;
            error.code = 'BAD_REQUEST';
            error.isOperational = true;
            const result = createErrorResponse(error, true);
            expect((result.body.error as any).message).toBe('An internal error occurred. Please try again later.');
        });
    });

    it('does not sanitize non-sensitive message', () => {
        const error: any = new Error('File not found');
        error.status = 400;
        error.code = 'BAD_REQUEST';
        error.isOperational = true;
        const result = createErrorResponse(error, true);
        expect((result.body.error as any).message).toBe('File not found');
    });
});

describe('getDefaultMessage (via createErrorResponse production)', () => {
    const statusMessages: [number, string][] = [
        [400, 'Invalid request. Please check your input.'],
        [401, 'Authentication required. Please log in.'],
        [403, 'Access denied. You do not have permission.'],
        [404, 'Resource not found.'],
        [409, 'Conflict with existing data.'],
        [422, 'Invalid data provided.'],
        [429, 'Too many requests. Please wait and try again.'],
        [500, 'Internal server error. Please try again later.'],
        [502, 'Service temporarily unavailable.'],
        [503, 'Service unavailable. Please try again later.'],
    ];

    statusMessages.forEach(([status, expectedMsg]) => {
        it(`returns correct message for status ${status}`, () => {
            const error: any = new Error('some error');
            error.status = status;
            error.code = 'DANGEROUS_CODE';
            error.isOperational = false;
            const result = createErrorResponse(error, true);
            expect((result.body.error as any).message).toBe(expectedMsg);
        });
    });

    it('returns default message for unknown status', () => {
        const error: any = new Error('some error');
        error.status = 418;
        error.code = 'TEAPOT';
        error.isOperational = false;
        const result = createErrorResponse(error, true);
        expect((result.body.error as any).message).toBe('An error occurred. Please try again.');
    });
});

describe('AppError', () => {
    it('uses the provided code as message when no message is given', () => {
        const err = new AppError(400, 'INVALID_INPUT');
        expect(err.statusCode).toBe(400);
        expect(err.code).toBe('INVALID_INPUT');
        expect(err.message).toBe('INVALID_INPUT');
        expect(err.isOperational).toBe(true);
        expect(err.name).toBe('AppError');
        expect(err.details).toBeUndefined();
    });

    it('accepts an explicit message string', () => {
        const err = new AppError(404, 'NOT_FOUND', 'User not found');
        expect(err.statusCode).toBe(404);
        expect(err.code).toBe('NOT_FOUND');
        expect(err.message).toBe('User not found');
    });

    it('accepts an options object with message and details', () => {
        const details = { field: 'email' };
        const err = new AppError(422, 'VALIDATION_ERROR', { message: 'Invalid email', details });
        expect(err.statusCode).toBe(422);
        expect(err.code).toBe('VALIDATION_ERROR');
        expect(err.message).toBe('Invalid email');
        expect(err.details).toBe(details);
    });

    it('falls back to the code as message when options object omits message', () => {
        const err = new AppError(409, 'CONFLICT', {});
        expect(err.message).toBe('CONFLICT');
        expect(err.details).toBeUndefined();
    });

    it('is an instance of Error', () => {
        const err = new AppError(500, 'INTERNAL_ERROR');
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(AppError);
    });

    it('errorHandler uses AppError statusCode and code', () => {
        const req = mockReq();
        const res = mockRes();
        const next = mockNext();

        const origEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';

        errorHandler(new AppError(400, 'INVALID_INPUT', 'Campo X é obrigatório'), req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        const body = res.json.mock.calls[0][0];
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('INVALID_INPUT');
        expect(body.error.message).toBe('Campo X é obrigatório');

        process.env.NODE_ENV = origEnv;
    });

    it('createErrorResponse honors AppError.statusCode and code', () => {
        const err = new AppError(403, 'FORBIDDEN', 'Nope');
        const result = createErrorResponse(err, false);
        expect(result.status).toBe(403);
        expect(result.body.success).toBe(false);
        expect((result.body.error as any).code).toBe('FORBIDDEN');
        expect((result.body.error as any).message).toBe('Nope');
    });

    it('AppError falls back to 500 / INTERNAL_ERROR when neither is provided (not applicable, but verifies fallback path)', () => {
        const err = new Error('generic');
        const result = createErrorResponse(err, false);
        expect(result.status).toBe(500);
        expect((result.body.error as any).code).toBe('INTERNAL_ERROR');
    });
});

describe('Standard error envelope', () => {
    it('wraps the body with success:false for generic errors', () => {
        const error: any = new Error('boom');
        error.status = 500;
        error.isOperational = false;
        const result = createErrorResponse(error, false);
        expect(result.body.success).toBe(false);
        expect(result.body).toHaveProperty('error');
    });

    it('wraps the body with success:false in production', () => {
        const error: any = new Error('boom');
        error.status = 400;
        error.code = 'BAD_REQUEST';
        error.isOperational = true;
        const result = createErrorResponse(error, true);
        expect(result.body.success).toBe(false);
        expect(result.body).toHaveProperty('error');
    });

    it('errorHandler emits success:false on the JSON response', () => {
        const req = mockReq();
        const res = mockRes();
        const next = mockNext();

        const origEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';

        errorHandler(new Error('plain'), req, res, next);

        expect(res.status).toHaveBeenCalledWith(500);
        const body = res.json.mock.calls[0][0];
        expect(body.success).toBe(false);
        expect(body.error).toBeDefined();

        process.env.NODE_ENV = origEnv;
    });

    it('errorHandler emits success:false for ZodError responses', () => {
        const zodError = new ZodError([
            {
                code: 'invalid_type',
                expected: 'string',
                received: 'number',
                path: ['name'],
                message: 'Expected string, received number',
            },
        ]);
        const req = mockReq();
        const res = mockRes();
        const next = mockNext();

        errorHandler(zodError, req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        const body = res.json.mock.calls[0][0];
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('VALIDATION_ERROR');
        expect(body.error.message).toBe('Validation failed');
        expect(body.error.details).toHaveLength(1);
    });

    it('uses statusCode over legacy status when both are present', () => {
        const error: any = new Error('dual');
        error.status = 404;
        error.statusCode = 418;
        const result = createErrorResponse(error, false);
        expect(result.status).toBe(418);
    });
});

describe('Stack trace handling in response', () => {
    it('includes stack in development responses', () => {
        const error: any = new Error('dev failure');
        error.status = 500;
        error.isOperational = false;
        error.stack = 'Error: dev failure\n    at test.js:1:1';

        const result = createErrorResponse(error, false);
        expect((result.body.error as any).stack).toBe('Error: dev failure\n    at test.js:1:1');
    });

    it('omits stack in production responses', () => {
        const error: any = new Error('prod failure');
        error.status = 500;
        error.isOperational = false;
        error.stack = 'Error: prod failure\n    at test.js:1:1';

        const result = createErrorResponse(error, true);
        expect((result.body.error as any).stack).toBeUndefined();
    });

    it('omits stack even for safe operational codes in production', () => {
        const error: any = new Error('safe but hidden');
        error.status = 400;
        error.code = 'BAD_REQUEST';
        error.isOperational = true;
        error.stack = 'Error: safe but hidden\n    at test.js:1:1';

        const result = createErrorResponse(error, true);
        expect((result.body.error as any).stack).toBeUndefined();
    });

    it('omits stack when error has no stack', () => {
        const error: any = new Error('no stack');
        error.status = 400;
        error.isOperational = true;
        error.stack = undefined;

        const result = createErrorResponse(error, false);
        expect((result.body.error as any).stack).toBeUndefined();
    });
});

describe('Structured logging', () => {
    it('logs with statusCode, method, url and stack for generic errors', () => {
        const req = mockReq();
        const res = mockRes();
        const next = mockNext();

        const origEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';

        const err = new Error('logged error');
        err.stack = 'Error: logged error\n    at handler.ts:1:1';

        mockLogError.mockClear();
        errorHandler(err, req, res, next);

        expect(mockLogError).toHaveBeenCalledTimes(1);
        const [, meta] = mockLogError.mock.calls[0];
        expect(meta).toMatchObject({
            statusCode: 500,
            method: 'GET',
            url: '/test',
            stack: err.stack,
        });

        process.env.NODE_ENV = origEnv;
    });

    it('logs with the AppError statusCode', () => {
        const req = mockReq();
        const res = mockRes();
        const next = mockNext();

        const origEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';

        mockLogError.mockClear();
        errorHandler(new AppError(409, 'CONFLICT', 'dup'), req, res, next);

        expect(mockLogError).toHaveBeenCalledTimes(1);
        const [, meta] = mockLogError.mock.calls[0];
        expect(meta.statusCode).toBe(409);
        expect(meta.method).toBe('GET');
        expect(meta.url).toBe('/test');

        process.env.NODE_ENV = origEnv;
    });

    it('logs ZodError with statusCode 400', () => {
        const zodError = new ZodError([
            {
                code: 'invalid_type',
                expected: 'string',
                received: 'number',
                path: ['x'],
                message: 'Expected string, received number',
            },
        ]);
        zodError.stack = 'ZodError: validation failed\n    at schema.ts:1:1';
        const req = mockReq();
        const res = mockRes();
        const next = mockNext();

        mockLogError.mockClear();
        errorHandler(zodError, req, res, next);

        expect(mockLogError).toHaveBeenCalled();
        const [, meta] = mockLogError.mock.calls[0];
        expect(meta.statusCode).toBe(400);
        expect(meta.method).toBe('GET');
        expect(meta.url).toBe('/test');
        expect(meta.stack).toBe('ZodError: validation failed\n    at schema.ts:1:1');
    });
});

describe('Backward compatibility (legacy status field)', () => {
    it('createErrorResponse accepts errors with legacy status field', () => {
        const error: any = new Error('legacy');
        error.status = 404;
        error.code = 'NOT_FOUND';
        const result = createErrorResponse(error, false);
        expect(result.status).toBe(404);
        expect((result.body.error as any).code).toBe('NOT_FOUND');
    });

    it('errorHandler handles errors with legacy status field', () => {
        const req = mockReq();
        const res = mockRes();
        const next = mockNext();

        const origEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';

        const error: any = new Error('legacy');
        error.status = 403;
        error.code = 'FORBIDDEN';

        errorHandler(error, req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        const body = res.json.mock.calls[0][0];
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('FORBIDDEN');

        process.env.NODE_ENV = origEnv;
    });
});
