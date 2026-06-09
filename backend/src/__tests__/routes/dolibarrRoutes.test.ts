import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, res: any, next: any) => next()));

const mockDolibarrService = vi.hoisted(() => ({
    createThirdParty: vi.fn(() => ({ id: '1', name: 'Test' })),
    createInvoice: vi.fn(() => ({ id: '1' })),
    addPayment: vi.fn(() => ({})),
    validateSupplierOrder: vi.fn(() => ({})),
    closeProposal: vi.fn(() => ({})),
    addTimeSpent: vi.fn(() => ({})),
    setTaskContact: vi.fn(() => true),
    getTaskContacts: vi.fn(() => [{ id: '7', task_id: '123', user_id: '45', type_id: '45' }]),
    removeTaskContact: vi.fn(() => true),
    proxyCustomSync: vi.fn(() => ({ status: 200, data: {} })),
    proxyRequest: vi.fn(() => ({ status: 200, data: {} })),
}));

const mockDelegation = vi.hoisted(() => ({
    get: vi.fn(() => ({ taskId: '50', aceite: { status: 'pending', deadlineDay: 100 } })),
    requestAcceptance: vi.fn(() => ({ taskId: '50', aceite: { status: 'pending' } })),
    accept: vi.fn(() => ({ taskId: '50', aceite: { status: 'accepted' } })),
    decline: vi.fn(() => ({ taskId: '50', aceite: { status: 'declined' } })),
}));
const mockDispatch = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
}));

vi.mock('../../services/dolibarrService', () => ({
    dolibarrService: mockDolibarrService,
}));

vi.mock('../../services/delegationService', () => ({ delegationService: mockDelegation }));
vi.mock('../../services/taskNotificationService', () => ({ dispatchTaskNotification: mockDispatch }));

vi.mock('../../utils/logger', () => ({
    createLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
    }),
}));

vi.mock('express-rate-limit', () => {
    const fn = vi.fn(() => (req: any, res: any, next: any) => next());
    return { default: fn };
});

import dolibarrRoutes from '../../routes/dolibarrRoutes';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/dolibarr', dolibarrRoutes);
    return app;
}

describe('dolibarrRoutes', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        app = createApp();
    });

    describe('POST /api/dolibarr/thirdparties', () => {
        it('returns 200 with valid data', async () => {
            const res = await request(app)
                .post('/api/dolibarr/thirdparties')
                .send({ name: 'Test Company', email: 'test@example.com' });

            expect(res.status).toBe(200);
        });

        it('returns 400 when name missing', async () => {
            const res = await request(app)
                .post('/api/dolibarr/thirdparties')
                .send({ email: 'test@example.com' });

            expect(res.status).toBe(400);
        });

        it('returns 400 when email invalid', async () => {
            const res = await request(app)
                .post('/api/dolibarr/thirdparties')
                .send({ name: 'Test', email: 'invalid-email' });

            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/dolibarr/invoices', () => {
        it('returns 200 with valid data', async () => {
            const res = await request(app)
                .post('/api/dolibarr/invoices')
                .send({
                    socid: '1',
                    date: Date.now(),
                    lines: [{ desc: 'Test', subprice: 100, qty: 1 }]
                });

            expect(res.status).toBe(200);
        });

        it('returns 400 when socid missing', async () => {
            const res = await request(app)
                .post('/api/dolibarr/invoices')
                .send({ date: Date.now(), lines: [{ desc: 'Test', subprice: 100, qty: 1 }] });

            expect(res.status).toBe(400);
        });

        it('returns 400 when lines empty', async () => {
            const res = await request(app)
                .post('/api/dolibarr/invoices')
                .send({ socid: '1', date: Date.now(), lines: [] });

            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/dolibarr/invoices/:id/payments', () => {
        it('returns 200', async () => {
            const res = await request(app)
                .post('/api/dolibarr/invoices/1/payments')
                .send({ amount: 100 });

            expect(res.status).toBe(200);
        });
    });

    describe('POST /api/dolibarr/supplierorders/:id/validate', () => {
        it('returns 200', async () => {
            const res = await request(app)
                .post('/api/dolibarr/supplierorders/1/validate')
                .send({});

            expect(res.status).toBe(200);
        });
    });

    describe('POST /api/dolibarr/proposals/:id/close', () => {
        it('returns 200', async () => {
            const res = await request(app)
                .post('/api/dolibarr/proposals/1/close')
                .send({});

            expect(res.status).toBe(200);
        });
    });

    describe('POST /api/dolibarr/tasks/:id/addtimespent', () => {
        it('returns 200', async () => {
            const res = await request(app)
                .post('/api/dolibarr/tasks/1/addtimespent')
                .send({ hours: 2 });

            expect(res.status).toBe(200);
        });
    });

    describe('Task contacts (Responsável/Interveniente) via custom_sync #72', () => {
        it('POST /tasks/:id/contacts grava via setTaskContact (não cai no wildcard)', async () => {
            const res = await request(app)
                .post('/api/dolibarr/tasks/123/contacts')
                .send({ userId: '45', typeCode: 'TASKEXECUTIVE' });

            expect(res.status).toBe(200);
            expect(mockDolibarrService.setTaskContact).toHaveBeenCalledWith('123', '45', 'TASKEXECUTIVE');
            // não deve ter caído no proxy genérico (REST /tasks/{id}/contacts não existe)
            expect(mockDolibarrService.proxyRequest).not.toHaveBeenCalled();
        });

        it('POST /tasks/:id/contacts usa TASKEXECUTIVE como padrão quando typeCode ausente', async () => {
            const res = await request(app)
                .post('/api/dolibarr/tasks/123/contacts')
                .send({ userId: '45' });

            expect(res.status).toBe(200);
            expect(mockDolibarrService.setTaskContact).toHaveBeenCalledWith('123', '45', 'TASKEXECUTIVE');
        });

        it('POST /tasks/:id/contacts aceita TASKCONTRIBUTOR (Interveniente)', async () => {
            const res = await request(app)
                .post('/api/dolibarr/tasks/123/contacts')
                .send({ userId: '46', typeCode: 'TASKCONTRIBUTOR' });

            expect(res.status).toBe(200);
            expect(mockDolibarrService.setTaskContact).toHaveBeenCalledWith('123', '46', 'TASKCONTRIBUTOR');
        });

        it('POST /tasks/:id/contacts retorna 400 quando userId ausente', async () => {
            const res = await request(app)
                .post('/api/dolibarr/tasks/123/contacts')
                .send({ typeCode: 'TASKEXECUTIVE' });

            expect(res.status).toBe(400);
            expect(mockDolibarrService.setTaskContact).not.toHaveBeenCalled();
        });

        it('POST /tasks/:id/contacts retorna 400 quando typeCode inválido', async () => {
            const res = await request(app)
                .post('/api/dolibarr/tasks/123/contacts')
                .send({ userId: '45', typeCode: 'BOSS' });

            expect(res.status).toBe(400);
            expect(mockDolibarrService.setTaskContact).not.toHaveBeenCalled();
        });

        it('POST /tasks/:id/contacts retorna 502 quando a gravação falha', async () => {
            mockDolibarrService.setTaskContact.mockResolvedValueOnce(false as any);
            const res = await request(app)
                .post('/api/dolibarr/tasks/123/contacts')
                .send({ userId: '45', typeCode: 'TASKEXECUTIVE' });

            expect(res.status).toBe(502);
        });

        it('GET /tasks/:id/contacts lista os contatos via getTaskContacts', async () => {
            const res = await request(app).get('/api/dolibarr/tasks/123/contacts');

            expect(res.status).toBe(200);
            expect(mockDolibarrService.getTaskContacts).toHaveBeenCalledWith('123');
            expect(res.body).toEqual([{ id: '7', task_id: '123', user_id: '45', type_id: '45' }]);
            expect(mockDolibarrService.proxyRequest).not.toHaveBeenCalled();
        });

        it('DELETE /tasks/:id/contacts/:rowid remove via removeTaskContact', async () => {
            const res = await request(app).delete('/api/dolibarr/tasks/123/contacts/7');

            expect(res.status).toBe(200);
            expect(mockDolibarrService.removeTaskContact).toHaveBeenCalledWith('123', '7');
            expect(mockDolibarrService.proxyRequest).not.toHaveBeenCalled();
        });
    });

    describe('Delegação — ciclo de vida (aceite)', () => {
        const task = { id: '50', fk_user_creat: '9', label: 'Relatório', ref: 'TK50' };

        it('GET /tasks/:id/delegation retorna o estado da delegação', async () => {
            const res = await request(app).get('/api/dolibarr/tasks/50/delegation');
            expect(res.status).toBe(200);
            expect(mockDelegation.get).toHaveBeenCalledWith('50');
            expect(mockDolibarrService.proxyRequest).not.toHaveBeenCalled();
        });

        it('POST request-acceptance solicita aceite e avisa o responsável', async () => {
            const res = await request(app)
                .post('/api/dolibarr/tasks/50/delegation/request-acceptance')
                .send({ task, by: '9' });
            expect(res.status).toBe(200);
            expect(mockDelegation.requestAcceptance).toHaveBeenCalledWith('50', expect.objectContaining({ by: '9' }));
            expect(mockDispatch).toHaveBeenCalledWith('acceptance_pending', expect.objectContaining({ id: '50' }));
        });

        it('POST accept registra o aceite', async () => {
            const res = await request(app).post('/api/dolibarr/tasks/50/delegation/accept').send({ by: '16' });
            expect(res.status).toBe(200);
            expect(mockDelegation.accept).toHaveBeenCalledWith('50', '16');
        });

        it('POST accept sem "by" retorna 400', async () => {
            const res = await request(app).post('/api/dolibarr/tasks/50/delegation/accept').send({});
            expect(res.status).toBe(400);
            expect(mockDelegation.accept).not.toHaveBeenCalled();
        });

        it('POST decline recusa e escala imediatamente ao solicitante', async () => {
            const res = await request(app)
                .post('/api/dolibarr/tasks/50/delegation/decline')
                .send({ by: '16', reason: 'já tratei', task });
            expect(res.status).toBe(200);
            expect(mockDelegation.decline).toHaveBeenCalledWith('50', '16', 'já tratei');
            expect(mockDispatch).toHaveBeenCalledWith('acceptance_overdue', expect.objectContaining({ id: '50' }));
        });
    });

    describe('GET /api/dolibarr/custom_sync.php', () => {
        it('returns 200', async () => {
            const res = await request(app)
                .get('/api/dolibarr/custom_sync.php')
                .query({ action: 'test' });

            expect(res.status).toBe(200);
        });
    });
});
