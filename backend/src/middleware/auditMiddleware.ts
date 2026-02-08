/**
 * Audit Logging Middleware
 *
 * Logs all API requests and responses for security auditing.
 * Sensitive data is redacted from logs.
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

const auditLog = logger.child('Audit');

// Fields to redact from logs
const SENSITIVE_FIELDS = [
    'password',
    'senha',
    'apiKey',
    'api_key',
    'token',
    'secret',
    'authorization',
    'cookie',
    'cpf',
    'cnpj',
    'credit_card',
    'card_number'
];

// Paths to skip auditing (health checks, etc.)
const SKIP_PATHS = ['/health', '/favicon.ico', '/api/whatsapp/qr'];

interface AuditEntry {
    timestamp: string;
    method: string;
    path: string;
    ip: string;
    userAgent: string;
    userId?: string;
    statusCode?: number;
    duration?: number;
    requestBody?: Record<string, unknown>;
    error?: string;
}

/**
 * Recursively redact sensitive fields from an object
 */
function redactSensitive(obj: unknown, depth = 0): unknown {
    if (depth > 10) return '[MAX_DEPTH]';
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'string') return obj;
    if (typeof obj !== 'object') return obj;

    if (Array.isArray(obj)) {
        return obj.map(item => redactSensitive(item, depth + 1));
    }

    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
        const keyLower = key.toLowerCase();
        if (SENSITIVE_FIELDS.some(field => keyLower.includes(field))) {
            redacted[key] = '[REDACTED]';
        } else if (typeof value === 'object' && value !== null) {
            redacted[key] = redactSensitive(value, depth + 1);
        } else {
            redacted[key] = value;
        }
    }
    return redacted;
}

/**
 * Extract user ID from request (from JWT or API key header)
 */
function extractUserId(req: Request): string | undefined {
    // Try to get from auth header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        // For now, we don't decode JWT - just indicate it's present
        return 'jwt-user';
    }

    // Try to get from Dolibarr API key
    const dolapikey = req.headers.dolapikey as string;
    if (dolapikey) {
        return `apikey-${dolapikey.substring(0, 8)}...`;
    }

    return undefined;
}

/**
 * Audit middleware - logs all requests
 */
export function auditMiddleware(req: Request, res: Response, next: NextFunction): void {
    // Skip certain paths
    if (SKIP_PATHS.some(path => req.path.startsWith(path))) {
        return next();
    }

    const startTime = Date.now();

    const entry: AuditEntry = {
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.path,
        ip: req.ip || req.connection.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
        userId: extractUserId(req)
    };

    // Log request body for mutations (but redact sensitive data)
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.body) {
        entry.requestBody = redactSensitive(req.body) as Record<string, unknown>;
    }

    // Capture response
    const originalSend = res.send;
    res.send = function (body: unknown) {
        entry.statusCode = res.statusCode;
        entry.duration = Date.now() - startTime;

        // Log based on status code
        if (res.statusCode >= 500) {
            auditLog.error(`${entry.method} ${entry.path} [${entry.statusCode}] ${entry.duration}ms`, entry);
        } else if (res.statusCode >= 400) {
            auditLog.warn(`${entry.method} ${entry.path} [${entry.statusCode}] ${entry.duration}ms`, entry);
        } else {
            auditLog.info(`${entry.method} ${entry.path} [${entry.statusCode}] ${entry.duration}ms`);
        }

        return originalSend.call(this, body);
    };

    next();
}

/**
 * Audit specific actions (for manual logging of important events)
 */
export const audit = {
    login: (userId: string, ip: string, success: boolean) => {
        if (success) {
            auditLog.info(`LOGIN_SUCCESS user=${userId} ip=${ip}`);
        } else {
            auditLog.warn(`LOGIN_FAILED user=${userId} ip=${ip}`);
        }
    },

    logout: (userId: string) => {
        auditLog.info(`LOGOUT user=${userId}`);
    },

    configChange: (userId: string, setting: string, oldValue: string, newValue: string) => {
        auditLog.info(`CONFIG_CHANGE user=${userId} setting=${setting} old=[REDACTED] new=[REDACTED]`);
    },

    paymentAttempt: (userId: string, amount: number, type: string, success: boolean) => {
        if (success) {
            auditLog.info(`PAYMENT_SUCCESS user=${userId} amount=${amount} type=${type}`);
        } else {
            auditLog.warn(`PAYMENT_FAILED user=${userId} amount=${amount} type=${type}`);
        }
    },

    dataExport: (userId: string, dataType: string, recordCount: number) => {
        auditLog.info(`DATA_EXPORT user=${userId} type=${dataType} records=${recordCount}`);
    },

    permissionChange: (adminId: string, targetUserId: string, permission: string, granted: boolean) => {
        auditLog.info(`PERMISSION_CHANGE admin=${adminId} target=${targetUserId} permission=${permission} granted=${granted}`);
    },

    suspiciousActivity: (ip: string, reason: string) => {
        auditLog.warn(`SUSPICIOUS_ACTIVITY ip=${ip} reason=${reason}`);
    }
};

export default auditMiddleware;
