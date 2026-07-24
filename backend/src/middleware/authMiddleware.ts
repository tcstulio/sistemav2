import { Request, Response, NextFunction } from 'express';
import { config } from '../config/env';
import { getProtoSession, setProtoSessionUserData } from '../services/protoSession';
import { fail } from '../utils/apiResponse';
import { createLogger } from '../utils/logger';

const log = createLogger('Auth');
const adminKey = process.env.ADMIN_KEY?.trim();

if (!adminKey) {
    throw new Error('ADMIN_KEY não configurada — defina a variável de ambiente antes de iniciar o servidor');
}

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const apiKey = req.headers['x-admin-key'];

    if (!apiKey || apiKey !== adminKey) {
        return fail(res, 'INVALID_ADMIN_KEY', 'Forbidden: Invalid or missing Admin Key.', 403);
    }

    next();
};

type CacheEntry = {
    expiresAt: number;
    user: unknown;
};

export interface AuthCacheMetrics {
    auth_cache_size: number;
    auth_cache_hits: number;
    auth_cache_misses: number;
}

const validKeysCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_SIZE = 500;
const CACHE_CLEANUP_INTERVAL_MS = 60 * 1000;

export let auth_cache_size = 0;
export let auth_cache_hits = 0;
export let auth_cache_misses = 0;

function syncCacheSize(): void {
    auth_cache_size = validKeysCache.size;
}

function pruneExpiredCacheEntries(now = Date.now()): void {
    for (const [key, entry] of validKeysCache.entries()) {
        if (!entry || typeof entry.expiresAt !== 'number' || now >= entry.expiresAt) {
            validKeysCache.delete(key);
        }
    }
    syncCacheSize();
}

function getCachedUser(key: string, now = Date.now()): unknown | undefined {
    const entry = validKeysCache.get(key);
    if (!entry || typeof entry.expiresAt !== 'number' || now >= entry.expiresAt) {
        if (entry) {
            validKeysCache.delete(key);
            syncCacheSize();
        }
        auth_cache_misses += 1;
        return undefined;
    }

    validKeysCache.delete(key);
    validKeysCache.set(key, entry);
    auth_cache_hits += 1;
    return entry.user;
}

function setCachedUser(key: string, user: unknown, now = Date.now()): void {
    pruneExpiredCacheEntries(now);
    validKeysCache.delete(key);

    while (validKeysCache.size >= CACHE_MAX_SIZE) {
        const leastRecentlyUsedKey = validKeysCache.keys().next().value as string | undefined;
        if (leastRecentlyUsedKey === undefined) break;
        validKeysCache.delete(leastRecentlyUsedKey);
    }

    validKeysCache.set(key, { expiresAt: now + CACHE_TTL_MS, user });
    syncCacheSize();
}

export function getAuthCacheMetrics(): AuthCacheMetrics {
    pruneExpiredCacheEntries();
    return {
        auth_cache_size,
        auth_cache_hits,
        auth_cache_misses,
    };
}

export const authCacheMetrics = {
    get auth_cache_size(): number {
        return getAuthCacheMetrics().auth_cache_size;
    },
    get auth_cache_hits(): number {
        return auth_cache_hits;
    },
    get auth_cache_misses(): number {
        return auth_cache_misses;
    },
};

const cacheCleanupTimer = setInterval(pruneExpiredCacheEntries, CACHE_CLEANUP_INTERVAL_MS);
cacheCleanupTimer.unref?.();

// Check for Dolibarr User Login (Presence AND Validity of API Key)
export const requireDolibarrLogin = async (req: Request, res: Response, next: NextFunction) => {
    let userKey = (req.headers['dolapikey'] || req.headers['DOLAPIKEY'] || req.query.DOLAPIKEY || req.query.dolapikey || req.query.apiKey) as string;

    const authHeader = req.headers['authorization'];
    if (!userKey && authHeader && authHeader.startsWith('Bearer ')) {
        userKey = authHeader.substring(7);
    }

    // httpOnly cookie do novo fluxo (#1329): o token de sessão fica em `auth_token` com
    // HttpOnly + Secure + SameSite=Strict. Mantemos `dolapikey` como fallback de
    // retrocompatibilidade para cookies antigos (pré-issue) — a remoção total quebraria
    // sessões já abertas em produção até o próximo login do usuário.
    if (!userKey && req.cookies?.auth_token) {
        userKey = req.cookies.auth_token;
    }

    if (!userKey && req.cookies?.dolapikey) {
        userKey = req.cookies.dolapikey;
    }

    if (!userKey || userKey === 'undefined' || userKey === 'null') {
        return fail(res, 'AUTHENTICATION_REQUIRED', 'Authentication Required: You must be logged in to Dolibarr.', 401);
    }

    // Se o userKey é um token de sessão do nosso /login, resolve a DOLAPIKEY real server-side
    // (nunca vai pro navegador). Enforcement nativo (decisão de produto): encaminha com a chave
    // do PRÓPRIO usuário (Dolibarr aplica os direitos dele em leitura E escrita) em vez da chave
    // de serviço (admin), que dava acesso total a qualquer logado. Admin tem chave admin -> nada
    // muda p/ admins. Flag PROXY_FORWARD_USER_KEY=false faz revert instantâneo p/ a chave de
    // serviço (sem deploy). Fallback p/ serviço se a sessão não tiver a chave do usuário.
    const protoSession = getProtoSession(userKey);
    if (protoSession) {
        const forwardUserKey = process.env.PROXY_FORWARD_USER_KEY !== 'false';
        
        let fwdKey: string;

        if (forwardUserKey) {
            const isValidUserKey = protoSession.dolapikey && protoSession.dolapikey !== 'undefined' && protoSession.dolapikey !== 'null';
            
            if (!isValidUserKey) {
                log.warn(`Sessão ${protoSession.login} com dolapikey inválida/ausente. Bloqueando requisição (Fail-Closed).`);
                return fail(
                    res,
                    'INVALID_SESSION',
                    'Authentication Failed: Sua sessão está corrompida (chave ausente). Faça login novamente.',
                    401
                );
            }
            fwdKey = protoSession.dolapikey;
        } else {
            fwdKey = config.dolibarrKey;
        }
        
        req.headers['dolapikey'] = fwdKey;
        if (req.query) { (req.query as any).DOLAPIKEY = fwdKey; }

        // Backfill do perfil quando a sessão é antiga/incompleta (criada antes de persistirmos
        // userData, ou getUserByKey falhou no login). Sem isso req.user fica sem 'admin' e quem
        // lê req.user.admin (ex.: o chat em aiRoutes) trata um admin real como não-admin.
        // Roda no MÁXIMO uma vez por sessão: depois do backfill, admin fica definido e cacheado.
        if (!protoSession.userData || protoSession.userData.admin === undefined || protoSession.userData.admin === null) {
            console.log(`[authMiddleware] Backfill needed for ${protoSession.login}`);
            try {
                if (protoSession.dolapikey && protoSession.dolapikey !== 'undefined' && protoSession.dolapikey !== 'null') {
                    const { dolibarrService } = await import('../services/dolibarrService');
                    const fresh = await dolibarrService.getUserByKey(protoSession.dolapikey);
                    if (fresh) {
                    // getUserByKey nem sempre traz 'admin' (users/info|myself). Resolve de forma
                    // autoritativa via verifyAdminStatus (testa acesso real a /setup/company).
                    if (fresh.admin === undefined || fresh.admin === null) {
                        const isAdmin = await dolibarrService.verifyAdminStatus(protoSession.dolapikey);
                        fresh.admin = isAdmin ? '1' : '0';
                    }
                    setProtoSessionUserData(userKey, fresh); // persiste -> cacheia
                    }
                }
            } catch (e: any) {
                log.warn(`Backfill de userData falhou (sessão ${protoSession.login}): ${e?.message || e}`);
            }
        } else {
            console.log(`[authMiddleware] Backfill SKIP for ${protoSession.login}, admin=${protoSession.userData.admin}`);
        }

        (req as any).user = {
            login: protoSession.login,
            ...(protoSession.userData || {}),
        };
        console.log(`[authMiddleware] Success for ${protoSession.login}, proceeding to next()`);
        return next();
    }

    const cachedUser = getCachedUser(userKey);
    if (cachedUser !== undefined) {
        (req as any).user = cachedUser;
        return next();
    }

    const { dolibarrService } = await import('../services/dolibarrService');

    try {
        const user = await dolibarrService.getUserByKey(userKey);

        if (user) {
            setCachedUser(userKey, user);
            (req as any).user = user;
            return next();
        }

        return fail(
            res,
            'INVALID_DOLIBARR_KEY',
            'Authentication Failed: Invalid Dolibarr API Key or User not found.',
            401
        );
    } catch {
        return fail(res, 'AUTHENTICATION_SERVICE_ERROR', 'Authentication Service Error', 401);
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

    // Cookie httpOnly do console admin (#33): a chave nunca fica em storage acessível por JS.
    if (!userKey && req.cookies?.admin_key) {
        userKey = req.cookies.admin_key;
    }

    log.debug(`Admin auth check: ${req.method} ${req.path}`);

    // 2. Fallback to System Admin Key (break-glass). Atribui identidade de sistema (para o
    // audit trail não registrar 'unknown') e loga em warn — uso da master key é evento sensível.
    if (userKey && userKey === adminKey) {
        log.warn(`System admin key used for ${req.method} ${req.path}`);
        (req as any).user = { id: 'system', login: 'system-admin-key', admin: '1' };
        return next();
    }

    if (!userKey) {
        log.warn(`Admin access denied: no key provided for ${req.method} ${req.path}`);
        return fail(res, 'ADMIN_AUTHENTICATION_REQUIRED', 'Authentication Required: Admin Access Only.', 401);
    }

    // PROTÓTIPO (Desenho B): se o userKey é um token de sessão do nosso /login,
    // resolve a DOLAPIKEY real do usuário (guardada server-side) e verifica se ELE
    // é admin no Dolibarr (acesso a /setup/company).
    const protoSession = getProtoSession(userKey);
    if (protoSession) {
        if (protoSession.userData?.admin) return next();
        const { dolibarrService } = await import('../services/dolibarrService');
        const isAdmin = await dolibarrService.verifyAdminStatus(protoSession.dolapikey);
        if (isAdmin) return next();
        log.warn(`Admin access denied (session: ${protoSession.login}) for ${req.method} ${req.path}`);
        return fail(
            res,
            'ADMIN_ACCESS_DENIED',
            'Access Denied: You must be an Administrator to perform this action.',
            403
        );
    }

    // 3. Admin Validation via Dolibarr Service
    const { dolibarrService } = await import('../services/dolibarrService');

    try {
        const isAdmin = await dolibarrService.verifyAdminStatus(userKey);

        if (isAdmin) {
            return next();
        } else {
            log.warn(`Admin access denied for ${req.method} ${req.path}`);
            return fail(
                res,
                'ADMIN_ACCESS_DENIED',
                'Access Denied: You must be an Administrator to perform this action.',
                403
            );
        }

    } catch (e: any) {
        log.error(`Admin auth error for ${req.method} ${req.path}: ${e.message}`);
        return fail(res, 'AUTH_VERIFICATION_ERROR', 'Auth Verification Error', 500);
    }
};

function getAuthenticatedRoles(req: Request): Set<string> {
    const user = (req as Request & {
        user?: { role?: unknown; roles?: unknown; admin?: unknown };
    }).user;
    if (!user || typeof user !== 'object') return new Set();

    const roles = new Set<string>();
    const addRole = (role: unknown): void => {
        if (typeof role === 'string' && role.trim()) roles.add(role.trim().toLowerCase());
    };

    addRole(user.role);
    if (Array.isArray(user.roles)) user.roles.forEach(addRole);
    if (user.admin === true || user.admin === 1 || user.admin === '1') roles.add('admin');

    return roles;
}

export function requireRole(role: string | string[]) {
    const allowedRoles = (Array.isArray(role) ? role : [role])
        .map((allowedRole) => allowedRole.trim().toLowerCase())
        .filter(Boolean);

    return (req: Request, res: Response, next: NextFunction) => {
        const authenticatedRoles = getAuthenticatedRoles(req);
        if (allowedRoles.some((allowedRole) => authenticatedRoles.has(allowedRole))) {
            return next();
        }

        return fail(res, 'INSUFFICIENT_ROLE', 'Access Denied: Insufficient role.', 403);
    };
}

export const requireAuth = requireDolibarrLogin;
