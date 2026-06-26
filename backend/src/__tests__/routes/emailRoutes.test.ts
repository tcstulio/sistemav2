import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockEmailService = vi.hoisted(() => ({
    sendEmail: vi.fn(),
}));

vi.mock('../../services/emailService', () => ({ emailService: mockEmailService }));
vi.mock('../../services/emailStoreService', () => ({ emailStoreService: {} }));
vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: (req: any, _res: any, next: any) => { req.user = { id: 'u1', login: 'u1' }; next(); },
}));
vi.mock('../../utils/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));

import emailRoutes from '../../routes/emailRoutes';

const app = express();
app.use(express.json());
app.use('/api/email', emailRoutes);

const validBody = (over: Record<string, unknown> = {}) => ({
    accountId: 'acc1',
    to: 'cliente@exemplo.com',
    subject: 'Assunto',
    htmlBody: '<p>oi</p>',
    ...over,
});

describe('emailRoutes /send — validação de destinatário com Zod (#832)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('rejeita envio sem destinatário (400) com mensagem clara e não chama sendEmail', async () => {
        const res = await request(app).post('/api/email/send').send(validBody({ to: '' }));
        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty('error');
        expect(typeof res.body.error).toBe('string');
        expect(res.body.error.length).toBeGreaterThan(0);
        expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
    });

    it('rejeita envio com email malformado (400) com mensagem clara e não chama sendEmail', async () => {
        const res = await request(app).post('/api/email/send').send(validBody({ to: 'nao-e-email' }));
        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty('error');
        expect(typeof res.body.error).toBe('string');
        expect(res.body.error.length).toBeGreaterThan(0);
        expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
    });

    it('rejeita envio sem o campo "to" (400) com mensagem clara', async () => {
        const { to: _to, ...withoutTo } = validBody();
        const res = await request(app).post('/api/email/send').send(withoutTo);
        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty('error');
        expect(typeof res.body.error).toBe('string');
        expect(res.body.error.length).toBeGreaterThan(0);
        expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
    });

    it('aceita envio com email válido (200) e repassa o destinatário', async () => {
        mockEmailService.sendEmail.mockResolvedValue({ messageId: '1' });
        const res = await request(app).post('/api/email/send').send(validBody());
        expect(res.status).toBe(200);
        expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
            'acc1',
            'cliente@exemplo.com',
            'Assunto',
            '<p>oi</p>',
            undefined,
            undefined,
            undefined
        );
    });
});
