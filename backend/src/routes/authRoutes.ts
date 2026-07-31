
import { Router } from 'express';
import { dolibarrService } from '../services/dolibarrService';
import { createProtoSession } from '../services/protoSession';
import { createLogger } from '../utils/logger';
import { config } from '../config/env';

import { z } from 'zod';
import { rateLimiters } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validation';

const log = createLogger('Auth');
const router = Router();

const SESSION_COOKIE_NAME = 'auth_token';
const LOGIN_COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const LoginSchema = z.object({
    login: z.string().trim().min(3).max(255),
    password: z.string().min(6).max(1024),
});

router.post('/login', rateLimiters.login, validateBody(LoginSchema), async (req, res) => {
    try {
        const { login, password } = req.body;
        const identifier = login;

        const result = await dolibarrService.login(identifier, password);

        let userData: any = null;
        try {
            userData = await dolibarrService.getUserByKey(result.token);
        } catch {
            log.warn(`Could not fetch user data for ${identifier}, proceeding without profile`);
        }

        const sessionToken = createProtoSession(identifier, result.token, userData);

        res.cookie(SESSION_COOKIE_NAME, sessionToken, {
            httpOnly: true,
            secure: true,
            sameSite: 'strict',
            maxAge: LOGIN_COOKIE_MAX_AGE_MS,
            path: '/',
        });

        res.json({
            success: true,
            data: { user: userData ? { id: userData.id, login: userData.login, admin: userData.admin } : null },
        });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        log.error('Login Error', { error: error.message });
        res.status(401).json({
            success: false,
            error: {
                code: 'AUTHENTICATION_FAILED',
                message: error.message || 'Authentication failed',
            },
        });
    }
});

router.post('/logout', (req, res) => {
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/', httpOnly: true, secure: true, sameSite: 'strict' });
    res.json({ success: true, message: 'Logged out' });
});

// ===========================================
// Admin Console auth (#33): a chave de admin vira cookie httpOnly em vez de
// ficar no sessionStorage (legível por XSS). O cookie é validado por
// requireDolibarrAdmin (break-glass key) nas rotas /api/admin/*.
// ===========================================

const AdminLoginSchema = z.object({ adminKey: z.string().min(1).max(1024) });

router.post('/admin-login', rateLimiters.login, validateBody(AdminLoginSchema), (req, res) => {
    try {
        const { adminKey } = req.body;
        if (!config.adminKey || adminKey !== config.adminKey) {
            return res.status(401).json({ success: false, error: 'Chave de admin inválida' });
        }
        res.cookie('admin_key', adminKey, {
            httpOnly: true,
            secure: true,
            sameSite: 'strict',
            maxAge: 12 * 60 * 60 * 1000, // 12h
            path: '/',
        });
        res.json({ success: true });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: error.issues });
        }
        log.error('Admin login error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

router.post('/admin-logout', (_req, res) => {
    res.clearCookie('admin_key', { path: '/', httpOnly: true, secure: true, sameSite: 'strict' });
    res.json({ success: true });
});

router.get('/admin-check', (req, res) => {
    const authenticated = !!config.adminKey && req.cookies?.admin_key === config.adminKey;
    res.json({ authenticated });
});

export default router;
