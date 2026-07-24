
import { Router } from 'express';
import { dolibarrService } from '../services/dolibarrService';
import { createProtoSession } from '../services/protoSession';
import { createLogger } from '../utils/logger';
import { config } from '../config/env';

import { z } from 'zod';
import { rateLimiters } from '../middleware/rateLimit';

const log = createLogger('Auth');
const router = Router();

const LoginSchema = z.object({
    login: z.string().min(3),
    password: z.string().min(6)
});

router.post('/login', rateLimiters.login, async (req, res) => {
    try {
        const { login, password } = LoginSchema.parse(req.body);

        const result = await dolibarrService.login(login, password);

        let userData: any = null;
        try {
            userData = await dolibarrService.getUserByKey(result.token);
        } catch {
            log.warn(`Could not fetch user data for ${login}, proceeding without profile`);
        }

        const sessionToken = createProtoSession(login, result.token, userData);

        res.cookie('auth_token', sessionToken, {
            httpOnly: true,
            secure: true,
            sameSite: 'strict',
            maxAge: 86400000,
            path: '/api',
        });

        res.json({
            success: true,
            token: sessionToken,
            message: result.message
        });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        log.error('Login Error', { error: error.message });
        res.status(401).json({
            success: false,
            error: error.message || 'Authentication failed'
        });
    }
});

router.post('/logout', (req, res) => {
    res.clearCookie('auth_token', { path: '/api' });
    res.json({ success: true, message: 'Logged out' });
});

// ===========================================
// Admin Console auth (#33): a chave de admin vira cookie httpOnly em vez de
// ficar no sessionStorage (legível por XSS). O cookie é validado por
// requireDolibarrAdmin (break-glass key) nas rotas /api/admin/*.
// ===========================================

const AdminLoginSchema = z.object({ adminKey: z.string().min(1) });

router.post('/admin-login', rateLimiters.login, (req, res) => {
    try {
        const { adminKey } = AdminLoginSchema.parse(req.body);
        if (!config.adminKey || adminKey !== config.adminKey) {
            return res.status(401).json({ success: false, error: 'Chave de admin inválida' });
        }
        res.cookie('admin_key', adminKey, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 12 * 60 * 60 * 1000, // 12h
            path: '/api',
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
    res.clearCookie('admin_key', { path: '/api' });
    res.json({ success: true });
});

router.get('/admin-check', (req, res) => {
    const authenticated = !!config.adminKey && req.cookies?.admin_key === config.adminKey;
    res.json({ authenticated });
});

export default router;
