import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, res: any, next: any) => next()));
const mockRequireDolibarrAdmin = vi.hoisted(() => vi.fn((req: any, res: any, next: any) => next()));

const mockApprovalService = vi.hoisted(() => ({
    getPendingActions: vi.fn(() => []),
    getActionHistory: vi.fn(() => []),
    getStats: vi.fn(() => ({ total: 0, pending: 0, approved: 0, rejected: 0 })),
    getActionById: vi.fn(),
    createPendingAction: vi.fn(),
    approveAction: vi.fn(),
    rejectAction: vi.fn(),
}));

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
    requireDolibarrAdmin: mockRequireDolibarrAdmin,
}));

vi.mock('../../services/approvalService', () => ({
    approvalService: mockApprovalService,
    ActionType: {},
    ActionStatus: {},
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

import approvalRoutes from '../../routes/approvalRoutes';
// Sem o errorHandler global, as rotas que propagam erro via `next(...)` (e o
// middleware `validateBody`/`validateQuery`) respondem só com status (sem
// envelope), quebrando as asserções em `res.body.error.code/...`.
import { errorHandler } from '../../middleware/errorHandler';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/approvals', approvalRoutes);
    app.use(errorHandler);
    return app;
}

/** Simula a decisão de `requireDolibarrAdmin` negando acesso a um usuário comum. */
function denyAdminOnce() {
    mockRequireDolibarrAdmin.mockImplementationOnce((_req: any, res: any) =>
        res.status(403).json({
            success: false,
            error: { code: 'ADMIN_ACCESS_DENIED', message: 'Access Denied: You must be an Administrator to perform this action.' },
        })
    );
}

describe('approvalRoutes', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        app = createApp();
    });

    describe('GET /api/approvals/pending', () => {
        it('returns 200 with pending actions', async () => {
            mockApprovalService.getPendingActions.mockResolvedValue([
                { id: '1', type: 'pagar_boleto', status: 'pending' }
            ]);

            const res = await request(app).get('/api/approvals/pending');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.meta.count).toBeDefined();
            expect(res.body.data).toBeDefined();
        });

        it('returns 400 when type query param is invalid', async () => {
            const res = await request(app).get('/api/approvals/pending?type=invalid_type');

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(mockApprovalService.getPendingActions).not.toHaveBeenCalled();
        });

        it('returns 400 when banco query param is invalid', async () => {
            const res = await request(app).get('/api/approvals/pending?banco=bradesco');

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 500 when service throws', async () => {
            mockApprovalService.getPendingActions.mockRejectedValue(new Error('Database error'));

            const res = await request(app).get('/api/approvals/pending');

            expect(res.status).toBe(500);
        });
    });

    describe('GET /api/approvals/history', () => {
        it('returns 200 with action history', async () => {
            mockApprovalService.getActionHistory.mockResolvedValue([
                { id: '1', type: 'pagar_boleto', status: 'approved' }
            ]);

            const res = await request(app).get('/api/approvals/history');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toBeDefined();
        });

        it('returns 400 when date query param is invalid', async () => {
            const res = await request(app).get('/api/approvals/history?startDate=01/01/2024');

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(mockApprovalService.getActionHistory).not.toHaveBeenCalled();
        });

        it('returns 400 when status query param is invalid', async () => {
            const res = await request(app).get('/api/approvals/history?status=unknown');

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 500 when service throws', async () => {
            mockApprovalService.getActionHistory.mockRejectedValue(new Error('Database error'));

            const res = await request(app).get('/api/approvals/history');

            expect(res.status).toBe(500);
        });
    });

    describe('GET /api/approvals/stats', () => {
        it('returns 200 with stats', async () => {
            const res = await request(app).get('/api/approvals/stats');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toBeDefined();
        });

        it('returns 500 when service throws', async () => {
            mockApprovalService.getStats.mockRejectedValue(new Error('Stats error'));

            const res = await request(app).get('/api/approvals/stats');

            expect(res.status).toBe(500);
        });
    });

    describe('GET /api/approvals/:id', () => {
        it('returns 200 when action is found', async () => {
            mockApprovalService.getActionById.mockResolvedValue({
                id: 'action-123',
                type: 'pagar_boleto',
                status: 'pending'
            });

            const res = await request(app).get('/api/approvals/action-123');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toBeDefined();
        });

        it('returns 404 when action is not found', async () => {
            mockApprovalService.getActionById.mockResolvedValue(null);

            const res = await request(app).get('/api/approvals/non-existent');

            expect(res.status).toBe(404);
            expect(res.body.success).toBe(false);
        });

        it('returns 500 when service throws', async () => {
            mockApprovalService.getActionById.mockRejectedValue(new Error('Database error'));

            const res = await request(app).get('/api/approvals/action-123');

            expect(res.status).toBe(500);
        });
    });

    describe('POST /api/approvals', () => {
        it('returns 201 when action is created', async () => {
            mockApprovalService.createPendingAction.mockResolvedValue({
                id: 'new-action-123',
                type: 'pagar_boleto',
                status: 'pending'
            });

            const res = await request(app)
                .post('/api/approvals')
                .send({
                    type: 'pagar_boleto',
                    payload: { barCode: '123' },
                    description: 'Pay water bill'
                });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toBeDefined();
        });

        it('returns 400 when type is missing', async () => {
            const res = await request(app)
                .post('/api/approvals')
                .send({
                    payload: {},
                    description: 'Test'
                });

            expect(res.status).toBe(400);
        });

        it('returns 400 when type is invalid', async () => {
            const res = await request(app)
                .post('/api/approvals')
                .send({
                    type: 'invalid_type',
                    payload: {},
                    description: 'Test'
                });

            expect(res.status).toBe(400);
        });

        it('returns 400 when description is missing', async () => {
            const res = await request(app)
                .post('/api/approvals')
                .send({
                    type: 'pagar_boleto',
                    payload: {}
                });

            expect(res.status).toBe(400);
        });

        it('returns 400 when payload is not an object (rejects arbitrary data)', async () => {
            const res = await request(app)
                .post('/api/approvals')
                .send({
                    type: 'pagar_boleto',
                    payload: 'not-an-object',
                    description: 'Test'
                });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(mockApprovalService.createPendingAction).not.toHaveBeenCalled();
        });

        it('returns 400 when payload is null', async () => {
            const res = await request(app)
                .post('/api/approvals')
                .send({
                    type: 'pagar_boleto',
                    payload: null,
                    description: 'Test'
                });

            expect(res.status).toBe(400);
        });

        it('returns 500 when service throws', async () => {
            mockApprovalService.createPendingAction.mockRejectedValue(new Error('Creation failed'));

            const res = await request(app)
                .post('/api/approvals')
                .send({
                    type: 'pagar_boleto',
                    payload: {},
                    description: 'Test'
                });

            expect(res.status).toBe(500);
        });
    });

    describe('POST /api/approvals/:id/approve', () => {
        it('returns 200 when an admin approves the action', async () => {
            mockApprovalService.approveAction.mockResolvedValue({
                success: true,
                result: { executed: true }
            });

            const res = await request(app)
                .post('/api/approvals/action-123/approve');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toBeDefined();
            expect(mockApprovalService.approveAction).toHaveBeenCalledWith('action-123', expect.any(String));
        });

        it('returns 400 when approval returns failure', async () => {
            mockApprovalService.approveAction.mockResolvedValue({
                success: false,
                error: 'Cannot approve: action already executed'
            });

            const res = await request(app)
                .post('/api/approvals/action-123/approve');

            expect(res.status).toBe(400);
        });

        it('returns 403 when a non-admin user tries to approve', async () => {
            denyAdminOnce();

            const res = await request(app)
                .post('/api/approvals/action-123/approve');

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('ADMIN_ACCESS_DENIED');
            expect(mockApprovalService.approveAction).not.toHaveBeenCalled();
        });

        it('returns 500 when service throws', async () => {
            mockApprovalService.approveAction.mockRejectedValue(new Error('Approval failed'));

            const res = await request(app)
                .post('/api/approvals/action-123/approve');

            expect(res.status).toBe(500);
        });
    });

    describe('POST /api/approvals/:id/reject', () => {
        it('returns 200 when action is rejected', async () => {
            mockApprovalService.rejectAction.mockResolvedValue({
                success: true
            });

            const res = await request(app)
                .post('/api/approvals/action-123/reject')
                .send({ reason: 'Invalid operation' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('returns 200 when reason is not provided', async () => {
            mockApprovalService.rejectAction.mockResolvedValue({
                success: true
            });

            const res = await request(app)
                .post('/api/approvals/action-123/reject')
                .send({});

            expect(res.status).toBe(200);
        });

        it('returns 400 when rejection returns failure', async () => {
            mockApprovalService.rejectAction.mockResolvedValue({
                success: false,
                error: 'Cannot reject: action already approved'
            });

            const res = await request(app)
                .post('/api/approvals/action-123/reject')
                .send({ reason: 'Test' });

            expect(res.status).toBe(400);
        });

        it('returns 403 when a non-admin user tries to reject', async () => {
            denyAdminOnce();

            const res = await request(app)
                .post('/api/approvals/action-123/reject')
                .send({ reason: 'Test' });

            expect(res.status).toBe(403);
            expect(mockApprovalService.rejectAction).not.toHaveBeenCalled();
        });

        it('returns 500 when service throws', async () => {
            mockApprovalService.rejectAction.mockRejectedValue(new Error('Rejection failed'));

            const res = await request(app)
                .post('/api/approvals/action-123/reject')
                .send({ reason: 'Test' });

            expect(res.status).toBe(500);
        });
    });

    describe('POST /api/approvals/bulk', () => {
        it('returns 200 and approves each id for an admin', async () => {
            mockApprovalService.approveAction
                .mockResolvedValueOnce({ success: true, result: { ok: true } })
                .mockResolvedValueOnce({ success: true, result: { ok: true } });

            const res = await request(app)
                .post('/api/approvals/bulk')
                .send({ ids: ['action-1', 'action-2'] });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.approved).toBe(2);
            expect(res.body.data.total).toBe(2);
            expect(res.body.data.results).toHaveLength(2);
            expect(mockApprovalService.approveAction).toHaveBeenCalledTimes(2);
        });

        it('reports partial failures without aborting the batch', async () => {
            mockApprovalService.approveAction
                .mockResolvedValueOnce({ success: false, error: 'already executed' })
                .mockResolvedValueOnce({ success: true, result: { ok: true } });

            const res = await request(app)
                .post('/api/approvals/bulk')
                .send({ ids: ['a', 'b'] });

            expect(res.status).toBe(200);
            expect(res.body.data.approved).toBe(1);
            expect(res.body.data.total).toBe(2);
        });

        it('returns 400 when ids is empty', async () => {
            const res = await request(app)
                .post('/api/approvals/bulk')
                .send({ ids: [] });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(mockApprovalService.approveAction).not.toHaveBeenCalled();
        });

        it('returns 400 when ids is missing', async () => {
            const res = await request(app)
                .post('/api/approvals/bulk')
                .send({});

            expect(res.status).toBe(400);
        });

        it('returns 403 when a non-admin user tries bulk approval', async () => {
            denyAdminOnce();

            const res = await request(app)
                .post('/api/approvals/bulk')
                .send({ ids: ['a'] });

            expect(res.status).toBe(403);
            expect(mockApprovalService.approveAction).not.toHaveBeenCalled();
        });
    });
});
