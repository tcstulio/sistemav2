
import { Router } from 'express';
import { dolibarrService } from '../services/dolibarrService';
import { logger } from '../utils/logger';

import { z } from 'zod';
import rateLimit from 'express-rate-limit';

const log = logger.child('AuthRoutes');
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

        const result = await dolibarrService.login(login, password);

        res.cookie('dolapikey', result.token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000,
            path: '/api',
        });

        res.json({
            success: true,
            apiKey: result.token,
            message: result.message
        });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        log.error('Login Error', error.message);
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
