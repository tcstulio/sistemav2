import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, res: any, next: any) => next()));

const mockDocumentService = vi.hoisted(() => ({
    sendDocument: vi.fn(() => ({ success: true, messageId: 'msg-1' })),
    getBoletoPDF: vi.fn(() => Buffer.from('PDF')),
    getInvoicePDF: vi.fn(() => Buffer.from('PDF')),
    getCustomerPhone: vi.fn(() => '5511999999999'),
}));

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
}));

vi.mock('../../services/documentService', () => ({
    documentService: mockDocumentService,
}));

const mockDolibarrService = vi.hoisted(() => ({
    getUserPhoto: vi.fn(),
    getDocumentPDF: vi.fn(),
}));

vi.mock('../../services/dolibarrService', () => ({
    dolibarrService: mockDolibarrService,
}));

vi.mock('../../services/interApiService', () => ({
    interApiService: {},
}));

vi.mock('../../services/itauApiService', () => ({
    itauApiService: {},
}));

vi.mock('../../services/legacy/messageService', () => ({
    messageService: {},
}));

vi.mock('../../services/approvalService', () => ({
    approvalService: {},
}));

vi.mock('../../utils/logger', () => ({
    createLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
    }),
}));

import documentRoutes from '../../routes/documentRoutes';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/documents', documentRoutes);
    return app;
}

describe('documentRoutes', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        app = createApp();
    });

    describe('POST /api/documents/send', () => {
        it('returns 200 with valid data', async () => {
            const res = await request(app)
                .post('/api/documents/send')
                .send({
                    documentType: 'boleto',
                    documentId: '1',
                    phone: '5511999999999',
                    sessionId: 'default'
                });

            expect(res.status).toBe(200);
        });

        it('returns 400 when missing required fields', async () => {
            const res = await request(app)
                .post('/api/documents/send')
                .send({ documentType: 'boleto' });

            expect(res.status).toBe(400);
        });

        it('returns 400 when invalid documentType', async () => {
            const res = await request(app)
                .post('/api/documents/send')
                .send({
                    documentType: 'invalid',
                    documentId: '1',
                    phone: '5511999999999',
                    sessionId: 'default'
                });

            expect(res.status).toBe(400);
        });

        it('returns 400 when phone too short', async () => {
            const res = await request(app)
                .post('/api/documents/send')
                .send({
                    documentType: 'boleto',
                    documentId: '1',
                    phone: '123',
                    sessionId: 'default'
                });

            expect(res.status).toBe(400);
        });

        it('returns 202 when approval required', async () => {
            mockDocumentService.sendDocument.mockResolvedValue({ approvalRequired: true, actionId: 'action-1' });

            const res = await request(app)
                .post('/api/documents/send')
                .send({
                    documentType: 'boleto',
                    documentId: '1',
                    phone: '5511999999999',
                    sessionId: 'default'
                });

            expect(res.status).toBe(202);
        });
    });

    describe('GET /api/documents/boleto/:banco/:nossoNumero/preview', () => {
        it('returns 200 with valid banco', async () => {
            const res = await request(app)
                .get('/api/documents/boleto/inter/123456/preview')
                .set('Accept', 'application/pdf');

            expect(res.status).toBe(200);
        });

        it('returns 400 with invalid banco', async () => {
            const res = await request(app)
                .get('/api/documents/boleto/invalid/123456/preview');

            expect(res.status).toBe(400);
        });
    });

    describe('GET /api/documents/invoice/:invoiceId/preview', () => {
        it('returns 200', async () => {
            const res = await request(app)
                .get('/api/documents/invoice/1/preview')
                .set('Accept', 'application/pdf');

            expect(res.status).toBe(200);
        });
    });

    describe('GET /api/documents/customer/:thirdPartyId/phone', () => {
        it('returns 200 when phone found', async () => {
            const res = await request(app).get('/api/documents/customer/1/phone');

            expect(res.status).toBe(200);
            expect(res.body.phone).toBeDefined();
        });

        it('returns 404 when phone not found', async () => {
            mockDocumentService.getCustomerPhone.mockResolvedValue(null);

            const res = await request(app).get('/api/documents/customer/not-found/phone');

            expect(res.status).toBe(404);
        });
    });

    describe('GET /api/documents/user-photo', () => {
        it('returns 200 with the image when the photo exists', async () => {
            mockDolibarrService.getUserPhoto.mockResolvedValue({
                buffer: Buffer.from('PNG-BYTES'),
                contentType: 'image/png',
            });

            const res = await request(app).get('/api/documents/user-photo?userId=35&file=olga.png');

            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toBe('image/png');
            expect(res.body).toEqual(Buffer.from('PNG-BYTES'));
            expect(mockDolibarrService.getUserPhoto).toHaveBeenCalledWith('35', 'olga.png');
        });

        it('returns 404 when the photo does not exist (expected condition)', async () => {
            mockDolibarrService.getUserPhoto.mockRejectedValue(new Error('Foto não encontrada para usuário #35'));

            const res = await request(app).get('/api/documents/user-photo?userId=35&file=olga.png');

            expect(res.status).toBe(404);
            expect(res.body.success).toBe(false);
        });

        it('returns 400 when userId is not numeric', async () => {
            const res = await request(app).get('/api/documents/user-photo?userId=abc&file=x.png');

            expect(res.status).toBe(400);
            expect(mockDolibarrService.getUserPhoto).not.toHaveBeenCalled();
        });

        it('returns 400 when file is missing', async () => {
            const res = await request(app).get('/api/documents/user-photo?userId=35');

            expect(res.status).toBe(400);
        });

        it('strips path traversal from the file name before querying Dolibarr', async () => {
            mockDolibarrService.getUserPhoto.mockResolvedValue({
                buffer: Buffer.from('IMG'),
                contentType: 'image/jpeg',
            });

            await request(app).get('/api/documents/user-photo?userId=35&file=..%2F..%2Fsecret.png');

            expect(mockDolibarrService.getUserPhoto).toHaveBeenCalledWith('35', 'secret.png');
        });
    });
});
