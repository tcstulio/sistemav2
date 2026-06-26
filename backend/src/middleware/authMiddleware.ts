import { Request, Response, NextFunction } from 'express';
import { config } from '../config/env';
import { getProtoSession, setProtoSessionUserData } from '../services/protoSession';
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

    if (!userKey || userKey === 'undefined' || userKey === 'null') {
        return res.status(401).json({
            status: 'error',
            message: 'Authentication Required: You must be logged in to Dolibarr.'
        });
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
                return res.status(401).json({
                    status: 'error',
                    message: 'Authentication Failed: Sua sessão está corrompida (chave ausente). Faça login novamente.'
                });
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
            try {
                if (protoSession.dolapikey && protoSession.dolapikey !== 'undefined' && protoSession.dolapikey !== 'null') {
                    const { dolibarrService } = require('../services/dolibarrService');
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
        }

        (req as any).user = {
            login: protoSession.login,
            ...(protoSession.userData || {}),
        };
        return next();
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

    // Cookie httpOnly do console admin (#33): a chave nunca fica em storage acessível por JS.
    if (!userKey && req.cookies?.admin_key) {
        userKey = req.cookies.admin_key;
    }

    log.debug(`Admin auth check: ${req.method} ${req.path}`);

    // 2. Fallback to System Admin Key (break-glass). Atribui identidade de sistema (para o
    // audit trail não registrar 'unknown') e loga em warn — uso da master key é evento sensível.
    if (userKey && userKey === config.adminKey) {
        log.warn(`System admin key used for ${req.method} ${req.path}`);
        (req as any).user = { id: 'system', login: 'system-admin-key', admin: '1' };
        return next();
    }

    if (!userKey) {
        log.warn(`Admin access denied: no key provided for ${req.method} ${req.path}`);
        return res.status(401).json({
            status: 'error',
            message: 'Authentication Required: Admin Access Only.'
        });
    }

    // PROTÓTIPO (Desenho B): se o userKey é um token de sessão do nosso /login,
    // resolve a DOLAPIKEY real do usuário (guardada server-side) e verifica se ELE
    // é admin no Dolibarr (acesso a /setup/company).
    const protoSession = getProtoSession(userKey);
    if (protoSession) {
        if (protoSession.userData?.admin) return next();
        const { dolibarrService } = require('../services/dolibarrService');
        const isAdmin = await dolibarrService.verifyAdminStatus(protoSession.dolapikey);
        if (isAdmin) return next();
        log.warn(`Admin access denied (session: ${protoSession.login}) for ${req.method} ${req.path}`);
        return res.status(403).json({
            status: 'error',
            message: 'Access Denied: You must be an Administrator to perform this action.'
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
