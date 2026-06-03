
import { Router } from 'express';
import { dolibarrService } from '../services/dolibarrService';
import { createProtoSession } from '../services/protoSession';
import { createLogger } from '../utils/logger';

import { z } from 'zod';
import rateLimit from 'express-rate-limit';

const log = createLogger('Auth');
const router = Router();

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: "Too many login attempts, please try again later." }
});

const LoginSchema = z.object({
    login: z.string().min(1),
    password: z.string().min(1)
});

router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { login, password } = LoginSchema.parse(req.body);

        // Valida a senha do usuário no Dolibarr (lança se a senha estiver errada).
        const result = await dolibarrService.login(login, password);

        // PROTÓTIPO (Desenho B): a senha autentica; devolvemos um TOKEN DE SESSÃO
        // inofensivo (NÃO a chave admin). O middleware requireDolibarrLogin troca
        // esse token pela chave de serviço (Marciano) server-side ao falar com o
        // Dolibarr — a chave admin nunca chega ao navegador.
        const sessionToken = createProtoSession(login, result.token);

        res.cookie('dolapikey', sessionToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000,
            path: '/api',
        });

        res.json({
            success: true,
            apiKey: sessionToken,
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
    res.clearCookie('dolapikey', { path: '/api' });
    res.json({ success: true, message: 'Logged out' });
});

export default router;
