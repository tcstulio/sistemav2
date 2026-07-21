/**
 * Error Handler Middleware
 *
 * Sanitizes error responses to prevent leaking internal information.
 * In production, detailed errors are logged but not sent to clients.
 *
 * All error responses follow the standard envelope:
 *   {
 *     "success": false,
 *     "error": {
 *       "message": "Mensagem legível",
 *       "code":    "CODIGO_DO_ERRO",
 *       "details": { ... }        // opcional
 *     }
 *   }
 */

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { createLogger } from '../utils/logger';

const log = createLogger('ErrorHandler');

// Error codes that are safe to show to users
const SAFE_ERROR_CODES = [
    'VALIDATION_ERROR',
    'NOT_FOUND',
    'UNAUTHORIZED',
    'FORBIDDEN',
    'BAD_REQUEST',
    'RATE_LIMITED',
    'RATE_LIMIT',
    'CONFLICT',
    'REPORT_NOT_FOUND',
    'SELECTOR_NO_MATCH',
    'INVALID_SELECTOR',
    'INVALID_REPORT_ID',
    'INVALID_EXT',
    'EXT_MISMATCH',
    'TOKEN_INVALID_OR_EXPIRED'];

// Patterns to detect in error messages that should be sanitized
const SENSITIVE_PATTERNS = [
    /password/i,
    /secret/i,
    /token/i,
    /key/i,
    /credential/i,
    /api_key/i,
    /apikey/i,
    /authorization/i,
    /certificate/i,
    /private/i,
    /connection string/i,
    /database/i,
    /sql/i,
    /mysql/i,
    /postgres/i,
    /mongodb/i,
    /redis/i,
    /at\s+\S+:\d+:\d+/i, // Stack trace patterns
    /Error:\s*\n/i,
    /node_modules/i,
    /internal\/modules/i
];

interface ApiError extends Error {
    status?: number;
    statusCode?: number;
    code?: string;
    details?: unknown;
    isOperational?: boolean;
}

/**
 * Generic operational application error.
 *
 * Constructor accepts either:
 *   - `new AppError(statusCode, code)`
 *   - `new AppError(statusCode, code, message)`
 *   - `new AppError(statusCode, code, { message, details })`
 *
 * Example: `throw new AppError(400, 'INVALID_INPUT', 'Campo X é obrigatório');`
 */
export class AppError extends Error {
    public readonly statusCode: number;
    public readonly code: string;
    public readonly details?: unknown;
    public readonly isOperational: boolean = true;

    constructor(
        statusCode: number,
        code: string,
        messageOrOptions?: string | { message?: string; details?: unknown }
    ) {
        let message: string;
        let details: unknown;

        if (typeof messageOrOptions === 'string') {
            message = messageOrOptions;
        } else if (messageOrOptions && typeof messageOrOptions === 'object') {
            message = messageOrOptions.message ?? code;
            details = messageOrOptions.details;
        } else {
            message = code;
        }

        super(message);
        this.name = 'AppError';
        this.statusCode = statusCode;
        this.code = code;
        if (details !== undefined) {
            this.details = details;
        }
    }
}

/**
 * Resolve the effective HTTP status for an error.
 * Accepts both the new `statusCode` (AppError) and the legacy `status` field.
 */
function resolveStatus(error: ApiError): number {
    return error.statusCode ?? error.status ?? 500;
}

/**
 * Check if an error message contains sensitive information
 */
function containsSensitiveInfo(message: string): boolean {
    return SENSITIVE_PATTERNS.some(pattern => pattern.test(message));
}

/**
 * Sanitize an error message for client response
 */
function sanitizeErrorMessage(message: string, isProduction: boolean): string {
    if (!isProduction) {
        // In development, show full errors
        return message;
    }

    if (containsSensitiveInfo(message)) {
        return 'An internal error occurred. Please try again later.';
    }

    // Truncate long error messages
    if (message.length > 200) {
        return message.substring(0, 200) + '...';
    }

    return message;
}

/**
 * Get a user-friendly error message based on status code
 */
function getDefaultMessage(status: number): string {
    switch (status) {
        case 400:
            return 'Invalid request. Please check your input.';
        case 401:
            return 'Authentication required. Please log in.';
        case 403:
            return 'Access denied. You do not have permission.';
        case 404:
            return 'Resource not found.';
        case 409:
            return 'Conflict with existing data.';
        case 422:
            return 'Invalid data provided.';
        case 429:
            return 'Too many requests. Please wait and try again.';
        case 500:
            return 'Internal server error. Please try again later.';
        case 502:
            return 'Service temporarily unavailable.';
        case 503:
            return 'Service unavailable. Please try again later.';
        default:
            return 'An error occurred. Please try again.';
    }
}

/**
 * Create a standardized error response.
 *
 * Returned body always follows the envelope:
 *   {
 *     "success": false,
 *     "error": { "code": string, "message": string, "details"?: unknown, "stack"?: string }
 *   }
 *
 * `stack` is only included when NOT in production.
 */
export function createErrorResponse(
    error: ApiError,
    isProduction: boolean
): { status: number; body: Record<string, unknown> } {
    const status = resolveStatus(error);
    const code = error.code || 'INTERNAL_ERROR';
    const isOperational = error.isOperational ?? status < 500;

    // In production, only show safe error codes and messages
    const showDetails = !isProduction || (isOperational && SAFE_ERROR_CODES.includes(code));

    const errorBody: Record<string, unknown> = {
        code: showDetails ? code : 'INTERNAL_ERROR',
        message: showDetails
            ? sanitizeErrorMessage(error.message, isProduction)
            : getDefaultMessage(status)
    };

    // Add validation details if safe
    if (showDetails && error.details !== undefined && code === 'VALIDATION_ERROR') {
        errorBody.details = error.details;
    }

    // Include stack trace only outside production to aid local debugging
    if (!isProduction && typeof error.stack === 'string') {
        errorBody.stack = error.stack;
    }

    const body: Record<string, unknown> = {
        success: false,
        error: errorBody
    };

    return { status, body };
}

/**
 * Emit a structured log entry for an error. Always includes
 * `statusCode`, `method`, `url` and `stack` so downstream
 * log pipelines can group/filter consistently.
 */
function logError(
    err: ApiError,
    req: Request,
    statusCode: number,
    extras?: Record<string, unknown>
): void {
    const url = req.originalUrl || req.url;
    log.error(`${req.method} ${url} - ${err.message}`, {
        statusCode,
        method: req.method,
        url,
        stack: err.stack,
        ...(extras || {})
    });
}

/**
 * Global error handler middleware
 */
export function errorHandler(
    err: ApiError,
    req: Request,
    res: Response,
    next: NextFunction
): void {
    const isProduction = process.env.NODE_ENV === 'production';
    const statusCode = resolveStatus(err);

    if (err instanceof ZodError) {
        logError(err, req, 400);
        res.status(400).json({
            success: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Validation failed',
                details: err.issues.map(issue => ({
                    field: issue.path.join('.'),
                    message: issue.message
                }))
            }
        });
        return;
    }

    logError(err, req, statusCode, {
        ip: req.ip,
        userAgent: req.headers['user-agent']
    });

    // Create sanitized response
    const { status, body } = createErrorResponse(err, isProduction);

    // Send response
    res.status(status).json(body);
}

/**
 * Custom error classes for operational errors
 */
export class ValidationError extends Error {
    status = 400;
    code = 'VALIDATION_ERROR';
    isOperational = true;
    details?: unknown;

    constructor(message: string, details?: unknown) {
        super(message);
        this.name = 'ValidationError';
        this.details = details;
    }
}

export class NotFoundError extends Error {
    status = 404;
    code = 'NOT_FOUND';
    isOperational = true;

    constructor(resource: string = 'Resource') {
        super(`${resource} not found`);
        this.name = 'NotFoundError';
    }
}

export class UnauthorizedError extends Error {
    status = 401;
    code = 'UNAUTHORIZED';
    isOperational = true;

    constructor(message: string = 'Authentication required') {
        super(message);
        this.name = 'UnauthorizedError';
    }
}

export class ForbiddenError extends Error {
    status = 403;
    code = 'FORBIDDEN';
    isOperational = true;

    constructor(message: string = 'Access denied') {
        super(message);
        this.name = 'ForbiddenError';
    }
}

export class ConflictError extends Error {
    status = 409;
    code = 'CONFLICT';
    isOperational = true;

    constructor(message: string = 'Resource already exists') {
        super(message);
        this.name = 'ConflictError';
    }
}

export class RateLimitError extends Error {
    status = 429;
    code = 'RATE_LIMITED';
    isOperational = true;

    constructor(message: string = 'Rate limit exceeded') {
        super(message);
        this.name = 'RateLimitError';
    }
}

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) {
    return (req: Request, res: Response, next: NextFunction) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

export default errorHandler;