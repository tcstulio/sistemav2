import { Request, Response, NextFunction } from 'express';
import { config } from '../config/env';
import { createLogger } from '../utils/logger';

const log = createLogger('Auth');

// Basic API Key check
// In production, use a more robust auth system (JWT, etc)
export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const apiKey = req.headers['x-admin-key'];

    // Check against config
    if (!apiKey || apiKey !== config.adminKey) {
        return res.status(403).json({
            status: 'error',
            message: 'Forbidden: Invalid or missing Admin Key.'
        });
    }

    next();
};

// Internal Cache for API Keys: Key -> Timestamp (expiry) OR Object
const validKeysCache = new Map<string, number | { expiry: number, user: any }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 Minutes

setInterval(() => {
    const now = Date.now();
    for (const [key, value] of validKeysCache.entries()) {
        const expiry = typeof value === 'number' ? value : value?.expiry;
        if (!expiry || now >= expiry) {
            validKeysCache.delete(key);
        }
    }
}, CACHE_TTL_MS);

// Check for Dolibarr User Login (Presence AND Validity of API Key)
export const requireDolibarrLogin = async (req: Request, res: Response, next: NextFunction) => {
    let userKey = (req.headers['dolapikey'] || req.headers['DOLAPIKEY'] || req.query.DOLAPIKEY || req.query.dolapikey || req.query.apiKey) as string;

    const authHeader = req.headers['authorization'];
    if (!userKey && authHeader && authHeader.startsWith('Bearer ')) {
        userKey = authHeader.substring(7);
    }

    if (!userKey && req.cookies?.dolapikey) {
        userKey = req.cookies.dolapikey;
    }

    if (!userKey) {
        return res.status(401).json({
            status: 'error',
            message: 'Authentication Required: You must be logged in to Dolibarr.'
        });
    }

    // 1. Check Cache
    const now = Date.now();
    if (validKeysCache.has(userKey)) {
        const cached = validKeysCache.get(userKey) as any;
        // Handle old cache format (number) vs new format (object)
        if (typeof cached === 'number') {
            if (now < cached) {
                // Old cache style: we don't have user object, so we must fetch it.
                // Fallthrough to fetch.
            }
        } else if (cached && cached.expiry && now < cached.expiry) {
            (req as any).user = cached.user;
            return next(); // Valid and cached with user
        }
    }

    // 2. Validate against Dolibarr (if not cached or expired)
    const { dolibarrService } = require('../services/dolibarrService');

    try {
        // We use getUserByKey to get the full user object (needed for signature), not just validate status
        const user = await dolibarrService.getUserByKey(userKey);

        if (user) {
            // Cache the user object
            validKeysCache.set(userKey, { expiry: now + CACHE_TTL_MS, user: user } as any);
            (req as any).user = user;
            return next();
        } else {
            // Fallback: Check if valid but no user returned (e.g. sqlfilters broken)
            // If we really need signature, this is a failure. But if we want to allow login without signature, we could check validateApiKey.
            // Given the requirement is "Signature is missing", failing here helps debug.
            // But to be safe for general auth, maybe we allow but user is null?
            // Let's rely on getUserByKey returning null = unauth or not found.
            return res.status(401).json({
                status: 'error',
                message: 'Authentication Failed: Invalid Dolibarr API Key or User not found.'
            });
        }
    } catch (e) {
        return res.status(401).json({
            status: 'error',
            message: 'Authentication Service Error'
        });
    }
};

export const requireDolibarrAdmin = async (req: Request, res: Response, next: NextFunction) => {
    // 1. Extract Key (Support Bearer, Header, Query)
    let userKey = (req.headers['dolapikey'] || req.headers['DOLAPIKEY'] || req.query.DOLAPIKEY || req.query.dolapikey || req.headers['x-admin-key']) as string;

    // Support Bearer Token
    const authHeader = req.headers['authorization'];
    if (!userKey && authHeader && authHeader.startsWith('Bearer ')) {
        userKey = authHeader.substring(7);
    }

    log.debug(`Admin auth check: ${req.method} ${req.path}`);

    // 2. Fallback to System Admin Key (if provided directly)
    if (userKey && userKey === config.adminKey) {
        log.debug('System admin key used');
        return next();
    }

    if (!userKey) {
        log.warn(`Admin access denied: no key provided for ${req.method} ${req.path}`);
        return res.status(401).json({
            status: 'error',
            message: 'Authentication Required: Admin Access Only.'
        });
    }

    // 3. Admin Validation via Dolibarr Service
    const { dolibarrService } = require('../services/dolibarrService');

    try {
        const isAdmin = await dolibarrService.verifyAdminStatus(userKey);

        if (isAdmin) {
            return next();
        } else {
            log.warn(`Admin access denied for ${req.method} ${req.path}`);
            return res.status(403).json({
                status: 'error',
                message: 'Access Denied: You must be an Administrator to perform this action.'
            });
        }

    } catch (e: any) {
        log.error(`Admin auth error for ${req.method} ${req.path}: ${e.message}`);
        return res.status(500).json({ status: 'error', message: 'Auth Verification Error' });
    }
};
