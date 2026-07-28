import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockUser = vi.hoisted(() => ({
    current: { id: 'user-1', login: 'tester', role: 'user', admin: '0' } as Record<string, unknown>,
}));

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, _res: any, next: any) => {
    req.user = { ...mockUser.current };
    next();
}));

const mockAdminAuditService = vi.hoisted(() => ({
    record: vi.fn(),
}));

const mockDocumentService = vi.hoisted(() => ({
    sendDocument: vi.fn(() => ({ success: true, messageId: 'msg-1' })),
    getBoletoPDF: vi.fn(() => Buffer.from('PDF')),
    getInvoicePDF: vi.fn(() => Buffer.from('PDF')),
    getCustomerPhone: vi.fn(() => '5511999999999'),
}));

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
}));

vi.mock('../../services/adminAuditService', () => ({
    adminAuditService: mockAdminAuditService,
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
        mockUser.current = { id: 'user-1', login: 'tester', role: 'user', admin: '0' };
        mockDocumentService.sendDocument.mockResolvedValue({ success: true, messageId: 'msg-1' });
        mockDocumentService.getCustomerPhone.mockResolvedValue('5511999999999');
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

    describe('POST /api/documents', () => {
        const validDocument = {
            documentType: 'invoice',
            entityType: 'invoice',
            entityId: 10,
        };

        it('returns 403 and audits a skipApproval attempt by a non-admin', async () => {
            const res = await request(app)
                .post('/api/documents')
                .send({ ...validDocument, skipApproval: true });

            expect(res.status).toBe(403);
            expect(res.body).toEqual({
                success: false,
                error: {
                    code: 'FORBIDDEN',
                    message: 'Apenas administradores podem pular aprovação',
                },
            });
            expect(mockAdminAuditService.record).toHaveBeenCalledWith(expect.objectContaining({
                action: 'document.skip-approval.denied',
                userId: 'user-1',
                userRole: 'user',
                documentType: 'invoice',
                entityType: 'invoice',
                entityId: 10,
                timestamp: expect.any(String),
                ip: expect.any(String),
            }));
        });

        it('returns 201 and audits skipApproval by an admin role', async () => {
            mockUser.current = { id: 'admin-1', login: 'boss', role: 'admin', admin: '0' };

            const res = await request(app)
                .post('/api/documents')
                .send({ ...validDocument, skipApproval: true });

            expect(res.status).toBe(201);
            expect(res.body).toEqual({
                success: true,
                data: { ...validDocument, skipApproval: true },
            });
            expect(mockAdminAuditService.record).toHaveBeenCalledWith(expect.objectContaining({
                action: 'document.skip-approval',
                adminId: 'admin-1',
                adminLogin: 'boss',
                userId: 'admin-1',
                userRole: 'admin',
                documentType: 'invoice',
                entityType: 'invoice',
                entityId: 10,
                timestamp: expect.any(String),
                ip: expect.any(String),
            }));
        });

        it('accepts the Dolibarr admin flag', async () => {
            mockUser.current = { id: 'admin-2', login: 'dolibarr-admin', admin: '1' };

            const res = await request(app)
                .post('/api/documents')
                .send({ ...validDocument, skipApproval: true });

            expect(res.status).toBe(201);
            expect(mockAdminAuditService.record).toHaveBeenCalledWith(expect.objectContaining({
                userRole: 'admin',
            }));
        });

        it('defaults skipApproval to false without creating an audit entry', async () => {
            const res = await request(app)
                .post('/api/documents')
                .send({ ...validDocument, template: 'crabe', data: { locale: 'pt_BR' } });

            expect(res.status).toBe(201);
            expect(res.body.data).toEqual({
                ...validDocument,
                template: 'crabe',
                data: { locale: 'pt_BR' },
                skipApproval: false,
            });
            expect(mockAdminAuditService.record).not.toHaveBeenCalled();
        });

        it.each([
            ['documentType', { ...validDocument, documentType: 'boleto' }],
            ['entityType', { ...validDocument, entityType: 'contract' }],
            ['zero entityId', { ...validDocument, entityId: 0 }],
            ['negative entityId', { ...validDocument, entityId: -1 }],
            ['non-integer entityId', { ...validDocument, entityId: 1.5 }],
        ])('returns 400 for invalid %s', async (_case, body) => {
            const res = await request(app).post('/api/documents').send(body);

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(res.body.error.details).toEqual(expect.any(Array));
            expect(mockAdminAuditService.record).not.toHaveBeenCalled();
        });
    });

    describe('PUT /api/documents/:id', () => {
        it('supports partial updates without skipApproval', async () => {
            const res = await request(app)
                .put('/api/documents/doc-1')
                .send({ template: 'custom-template', data: { color: 'blue' } });

            expect(res.status).toBe(200);
            expect(res.body).toEqual({
                success: true,
                data: {
                    id: 'doc-1',
                    template: 'custom-template',
                    data: { color: 'blue' },
                },
            });
            expect(mockAdminAuditService.record).not.toHaveBeenCalled();
        });

        it('enforces the admin policy for skipApproval updates', async () => {
            const res = await request(app)
                .put('/api/documents/doc-1')
                .send({
                    documentType: 'proposal',
                    entityType: 'project',
                    entityId: 20,
                    skipApproval: true,
                });

            expect(res.status).toBe(403);
            expect(mockAdminAuditService.record).toHaveBeenCalledWith(expect.objectContaining({
                documentType: 'proposal',
                entityType: 'project',
                entityId: 20,
            }));
        });

        it('audits an admin skipApproval update with complete context', async () => {
            mockUser.current = { id: 'admin-4', login: 'boss', admin: true };

            const res = await request(app)
                .put('/api/documents/doc-1')
                .send({
                    documentType: 'contract',
                    entityType: 'project',
                    entityId: 20,
                    skipApproval: true,
                });

            expect(res.status).toBe(200);
            expect(mockAdminAuditService.record).toHaveBeenCalledWith(expect.objectContaining({
                action: 'document.skip-approval',
                userRole: 'admin',
                documentType: 'contract',
                entityType: 'project',
                entityId: 20,
            }));
        });

        it('requires audit context when skipApproval is enabled', async () => {
            const res = await request(app)
                .put('/api/documents/doc-1')
                .send({ skipApproval: true });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(mockAdminAuditService.record).not.toHaveBeenCalled();
        });
    });

    describe('POST /api/documents/send skipApproval policy', () => {
        const validSend = {
            documentType: 'boleto',
            documentId: 'bank-123',
            phone: '5511999999999',
            sessionId: 'default',
        };

        it('does not process skipApproval for a non-admin and audits the denied attempt', async () => {
            const res = await request(app)
                .post('/api/documents/send')
                .send({ ...validSend, skipApproval: true });

            expect(res.status).toBe(403);
            expect(mockDocumentService.sendDocument).not.toHaveBeenCalled();
            expect(mockAdminAuditService.record).toHaveBeenCalledWith(expect.objectContaining({
                action: 'document.skip-approval.denied',
                documentType: 'boleto',
                entityType: 'bank-slip',
                entityId: 'bank-123',
            }));
        });

        it('processes and audits skipApproval for an admin without coercing documentId', async () => {
            mockUser.current = { id: 'admin-3', login: 'boss', role: 'admin' };

            const res = await request(app)
                .post('/api/documents/send')
                .send({ ...validSend, skipApproval: true });

            expect(res.status).toBe(200);
            expect(mockDocumentService.sendDocument).toHaveBeenCalledWith(expect.objectContaining({
                documentId: 'bank-123',
                skipApproval: true,
            }));
            expect(mockAdminAuditService.record).toHaveBeenCalledWith(expect.objectContaining({
                entityId: 'bank-123',
            }));
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
            expect(res.body.data.phone).toBeDefined();
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
