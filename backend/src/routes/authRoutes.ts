
import { Router } from 'express';
import { dolibarrService } from '../services/dolibarrService';

import { z } from 'zod';
import rateLimit from 'express-rate-limit';

const router = Router();

// Login Rate Limiter (100 attempts per 15 min for Dev)
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: "Too many login attempts, please try again later." }
});

const LoginSchema = z.object({
    login: z.string().min(1),
    password: z.string().min(1)
});

// Login Route
router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { login, password } = LoginSchema.parse(req.body);

        const result = await dolibarrService.login(login, password);

        // Return only what the frontend needs
        res.json({
            success: true,
            apiKey: result.token,
            message: result.message
        });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        console.error('[Auth] Login Error:', error.message);
        res.status(401).json({
            success: false,
            error: error.message || 'Authentication failed'
        });
    }
});

export default router;
