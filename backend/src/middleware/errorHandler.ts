/**
 * Error Handler Middleware
 *
 * Sanitizes error responses to prevent leaking internal information.
 * In production, detailed errors are logged but not sent to clients.
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
    'CONFLICT'
];

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
    code?: string;
    details?: unknown;
    isOperational?: boolean;
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
 * Create a standardized error response
 */
export function createErrorResponse(
    error: ApiError,
    isProduction: boolean
): { status: number; body: Record<string, unknown> } {
    const status = error.status || 500;
    const code = error.code || 'INTERNAL_ERROR';
    const isOperational = error.isOperational || status < 500;

    // In production, only show safe error codes and messages
    const showDetails = !isProduction || (isOperational && SAFE_ERROR_CODES.includes(code));

    const body: Record<string, unknown> = {
        error: {
            code: showDetails ? code : 'INTERNAL_ERROR',
            message: showDetails
                ? sanitizeErrorMessage(error.message, isProduction)
                : getDefaultMessage(status)
        }
    };

    // Add validation details if safe
    if (showDetails && error.details && code === 'VALIDATION_ERROR') {
        body.error = {
            ...(body.error as object),
            details: error.details
        };
    }

    // Add request ID for tracking (if available)
    // body.requestId = req.id; // Would need request ID middleware

    return { status, body };
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

    if (err instanceof ZodError) {
        res.status(400).json({
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

    log.error(`${req.method} ${req.path} - ${err.message}`, {
        stack: err.stack,
        code: err.code,
        status: err.status,
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
