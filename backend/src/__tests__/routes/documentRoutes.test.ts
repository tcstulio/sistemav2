import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// authState permite que cada teste defina req.user (admin/não-admin) sem acoplar
// ao requireDolibarrLogin real. Default = null (sem user), preservando os testes
// existentes do /send (que não enviam skipApproval e portanto não dependem de user).
const authState = vi.hoisted(() => ({ user: null as any }));
const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, _res: any, next: any) => {
    if (authState.user) req.user = authState.user;
    next();
}));

const mockDocumentService = vi.hoisted(() => ({
    sendDocument: vi.fn(() => ({ success: true, messageId: 'msg-1' })),
    getBoletoPDF: vi.fn(() => Buffer.from('PDF')),
    getInvoicePDF: vi.fn(() => Buffer.from('PDF')),
    getCustomerPhone: vi.fn(() => '5511999999999'),
}));

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
    isAdmin: (u: any) => {
        if (!u) return false;
        if (u.role === 'admin') return true;
        const a = u.admin;
        return a === '1' || a === 1 || a === true || a === 'admin';
    },
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

// Audit service mockado — evita escrita em disco e permite assertar chamadas.
const mockAdminAudit = vi.hoisted(() => ({
    record: vi.fn(() => ({ id: 'audit-1', ts: Date.now() })),
}));

vi.mock('../../services/adminAuditService', () => ({
    adminAuditService: mockAdminAudit,
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
        authState.user = null;
        app = createApp();
    });

    describe('POST /api/documents (#1570 — create/generate document)', () => {
        const validBody = {
            documentType: 'invoice',
            entityType: 'thirdparty',
            entityId: 42,
        };

        it('returns 201 with valid data (no skipApproval)', async () => {
            const res = await request(app).post('/api/documents').send(validBody);

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toMatchObject({
                documentType: 'invoice',
                entityType: 'thirdparty',
                entityId: 42,
                approved: false,
            });
            expect(mockAdminAudit.record).not.toHaveBeenCalled();
        });

        it('defaults skipApproval to false when omitted', async () => {
            const res = await request(app).post('/api/documents').send(validBody);

            expect(res.status).toBe(201);
            expect(res.body.data.approved).toBe(false);
        });

        it('returns 403 when non-admin sends skipApproval:true', async () => {
            authState.user = { id: '7', login: 'operador', admin: '0' };

            const res = await request(app)
                .post('/api/documents')
                .send({ ...validBody, skipApproval: true });

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
            expect(res.body.error.message).toBe('Apenas administradores podem pular aprovação');
            // Nada deve seguir para o service nem para o audit.
            expect(mockAdminAudit.record).not.toHaveBeenCalled();
        });

        it('returns 201 and writes audit entry when admin sends skipApproval:true', async () => {
            authState.user = { id: '1', login: 'boss', admin: '1' };

            const res = await request(app)
                .post('/api/documents')
                .send({ ...validBody, skipApproval: true });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.approved).toBe(true);
            expect(mockAdminAudit.record).toHaveBeenCalledTimes(1);
            const entry = mockAdminAudit.record.mock.calls[0][0];
            expect(entry.action).toBe('document.create.skipApproval');
            expect(entry.adminLogin).toBe('boss');
            expect(entry.target).toBe('thirdparty/42');
            // Campos exigidos pelo issue (#1570): userId, userRole, documentType, entityType, entityId, ip.
            expect(entry.changes.userId.after).toBe('1');
            expect(entry.changes.userRole.after).toBe('admin');
            expect(entry.changes.documentType.after).toBe('invoice');
            expect(entry.changes.entityType.after).toBe('thirdparty');
            expect(entry.changes.entityId.after).toBe(42);
            expect(entry.changes.ip).toBeDefined();
        });

        it('returns 400 when documentType is outside the enum', async () => {
            const res = await request(app)
                .post('/api/documents')
                .send({ ...validBody, documentType: 'unknown' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 400 when entityType is outside the enum', async () => {
            const res = await request(app)
                .post('/api/documents')
                .send({ ...validBody, entityType: 'customer' });

            expect(res.status).toBe(400);
        });

        it('returns 400 when entityId is zero', async () => {
            const res = await request(app)
                .post('/api/documents')
                .send({ ...validBody, entityId: 0 });

            expect(res.status).toBe(400);
        });

        it('returns 400 when entityId is negative', async () => {
            const res = await request(app)
                .post('/api/documents')
                .send({ ...validBody, entityId: -5 });

            expect(res.status).toBe(400);
        });

        it('returns 400 when entityId is a float', async () => {
            const res = await request(app)
                .post('/api/documents')
                .send({ ...validBody, entityId: 3.14 });

            expect(res.status).toBe(400);
        });

        it('returns 400 when missing required fields', async () => {
            const res = await request(app).post('/api/documents').send({ documentType: 'invoice' });

            expect(res.status).toBe(400);
        });

        it('accepts template and data optional fields', async () => {
            const res = await request(app)
                .post('/api/documents')
                .send({
                    ...validBody,
                    template: 'tpl-001',
                    data: { foo: 'bar', nested: { a: 1 } },
                });

            expect(res.status).toBe(201);
            expect(res.body.data.template).toBe('tpl-001');
        });
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

        it('#1570: returns 403 when non-admin sends skipApproval:true', async () => {
            authState.user = { id: '7', login: 'operador', admin: '0' };

            const res = await request(app)
                .post('/api/documents/send')
                .send({
                    documentType: 'boleto',
                    documentId: '1',
                    phone: '5511999999999',
                    sessionId: 'default',
                    skipApproval: true,
                });

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
            expect(res.body.error.message).toBe('Apenas administradores podem pular aprovação');
            expect(mockDocumentService.sendDocument).not.toHaveBeenCalled();
            expect(mockAdminAudit.record).not.toHaveBeenCalled();
        });

        it('#1570: admin with skipApproval:true writes audit entry and proceeds', async () => {
            authState.user = { id: '1', login: 'boss', admin: '1' };
            mockDocumentService.sendDocument.mockResolvedValue({ success: true, messageId: 'msg-1' });

            const res = await request(app)
                .post('/api/documents/send')
                .send({
                    documentType: 'boleto',
                    documentId: '1',
                    phone: '5511999999999',
                    sessionId: 'default',
                    skipApproval: true,
                });

            expect(res.status).toBe(200);
            expect(mockAdminAudit.record).toHaveBeenCalledTimes(1);
            const entry = mockAdminAudit.record.mock.calls[0][0];
            expect(entry.action).toBe('document.send.skipApproval');
            expect(entry.adminLogin).toBe('boss');
        });

        it('#1570: non-admin WITHOUT skipApproval still succeeds (admin gate only applies to skipApproval)', async () => {
            authState.user = { id: '7', login: 'operador', admin: '0' };
            mockDocumentService.sendDocument.mockResolvedValue({ success: true, messageId: 'msg-1' });

            const res = await request(app)
                .post('/api/documents/send')
                .send({
                    documentType: 'boleto',
                    documentId: '1',
                    phone: '5511999999999',
                    sessionId: 'default',
                });

            expect(res.status).toBe(200);
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
