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

const mockRequireAdmin = vi.hoisted(() => vi.fn((req: any, res: any, next: any) => {
    const user = req.user || {};
    const isAdmin = user.role === 'admin' || user.admin === '1' || user.admin === 1 || user.admin === true;
    if (!isAdmin) {
        return res.status(403).json({
            success: false,
            error: { code: 'INSUFFICIENT_ROLE', message: 'Access Denied: Insufficient role.' },
        });
    }
    next();
}));

const mockApprovalService = vi.hoisted(() => ({
    getPendingActions: vi.fn(() => []),
    getActionHistory: vi.fn(() => []),
    getStats: vi.fn(() => ({ total: 0, pending: 0, approved: 0, rejected: 0 })),
    getActionById: vi.fn(),
    createPendingAction: vi.fn(),
    approveAction: vi.fn(),
    rejectAction: vi.fn(),
    bulkApproveActions: vi.fn(),
}));

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
    requireAdmin: mockRequireAdmin,
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
import { errorHandler } from '../../middleware/errorHandler';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/approvals', approvalRoutes);
    app.use(errorHandler);
    return app;
}

describe('approvalRoutes', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        mockUser.current = { id: 'user-1', login: 'tester', role: 'user', admin: '0' };
        mockRequireDolibarrLogin.mockImplementation((req: any, _res: any, next: any) => {
            req.user = { ...mockUser.current };
            next();
        });
        mockRequireAdmin.mockImplementation((req: any, res: any, next: any) => {
            const user = req.user || {};
            const isAdmin = user.role === 'admin' || user.admin === '1' || user.admin === 1 || user.admin === true;
            if (!isAdmin) {
                return res.status(403).json({
                    success: false,
                    error: { code: 'INSUFFICIENT_ROLE', message: 'Access Denied: Insufficient role.' },
                });
            }
            next();
        });
        app = createApp();
    });

    describe('GET /api/approvals/pending', () => {
        it('returns 200 with pending actions in the standard envelope', async () => {
            mockApprovalService.getPendingActions.mockResolvedValue([
                { id: '1', type: 'pagar_boleto', status: 'pending' },
            ]);

            const res = await request(app).get('/api/approvals/pending');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.meta.count).toBe(1);
            expect(res.body.data).toEqual([
                { id: '1', type: 'pagar_boleto', status: 'pending' },
            ]);
        });

        it('returns 400 with standard envelope for invalid type query param', async () => {
            const res = await request(app).get('/api/approvals/pending?type=invalid_type');

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(res.body.error.details).toEqual(expect.any(Array));
        });

        it('accepts valid banco query param', async () => {
            const res = await request(app).get('/api/approvals/pending?banco=inter');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('returns 400 when unknown query params are passed (strict)', async () => {
            const res = await request(app).get('/api/approvals/pending?foo=bar');

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
        it('returns 200 with action history in the standard envelope', async () => {
            mockApprovalService.getActionHistory.mockResolvedValue([
                { id: '1', type: 'pagar_boleto', status: 'approved' },
            ]);

            const res = await request(app).get('/api/approvals/history');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toEqual([
                { id: '1', type: 'pagar_boleto', status: 'approved' },
            ]);
        });

        it('returns 400 for invalid status query param', async () => {
            const res = await request(app).get('/api/approvals/history?status=unknown');

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 400 for malformed startDate', async () => {
            const res = await request(app).get('/api/approvals/history?startDate=not-a-date');

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 400 for malformed endDate', async () => {
            const res = await request(app).get('/api/approvals/history?endDate=2025/01/01');

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 400 for non-numeric limit', async () => {
            const res = await request(app).get('/api/approvals/history?limit=abc');

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

        it('returns 400 for unknown query params (strict)', async () => {
            const res = await request(app).get('/api/approvals/stats?foo=bar');

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
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
                status: 'pending',
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
            expect(res.body.error.code).toBe('NOT_FOUND');
        });

        it('returns 500 when service throws', async () => {
            mockApprovalService.getActionById.mockRejectedValue(new Error('Database error'));

            const res = await request(app).get('/api/approvals/action-123');

            expect(res.status).toBe(500);
        });
    });

    describe('POST /api/approvals', () => {
        it('returns 201 when action is created (typed payload)', async () => {
            mockApprovalService.createPendingAction.mockResolvedValue({
                id: 'new-action-123',
                type: 'pagar_boleto',
                status: 'pending',
            });

            const res = await request(app)
                .post('/api/approvals')
                .send({
                    type: 'pagar_boleto',
                    banco: 'inter',
                    payload: { barCode: '123', amount: 100 },
                    description: 'Pay water bill',
                });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toBeDefined();
            expect(res.body.data.id).toBe('new-action-123');
        });

        it('returns 400 when type is missing', async () => {
            const res = await request(app)
                .post('/api/approvals')
                .send({
                    payload: { barCode: '123', amount: 100 },
                    description: 'Test',
                });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 400 when type is invalid', async () => {
            const res = await request(app)
                .post('/api/approvals')
                .send({
                    type: 'invalid_type',
                    payload: { barCode: '123', amount: 100 },
                    description: 'Test',
                });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 400 when description is missing', async () => {
            const res = await request(app)
                .post('/api/approvals')
                .send({
                    type: 'pagar_boleto',
                    payload: { barCode: '123', amount: 100 },
                });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 400 when payload has arbitrary (non-object) shape', async () => {
            const res = await request(app)
                .post('/api/approvals')
                .send({
                    type: 'pagar_boleto',
                    payload: 'not-an-object',
                    description: 'Test',
                });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 400 when typed payload is missing required fields (#1544)', async () => {
            const res = await request(app)
                .post('/api/approvals')
                .send({
                    type: 'pagar_boleto',
                    payload: { barCode: '123' },
                    description: 'Test',
                });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 500 when service throws', async () => {
            mockApprovalService.createPendingAction.mockRejectedValue(new Error('Creation failed'));

            const res = await request(app)
                .post('/api/approvals')
                .send({
                    type: 'pagar_boleto',
                    payload: { barCode: '123', amount: 100 },
                    description: 'Test',
                });

            expect(res.status).toBe(500);
        });
    });

    describe('POST /api/approvals/:id/approve', () => {
        it('returns 200 when an admin approves the action', async () => {
            mockUser.current = { id: 'admin-1', login: 'boss', role: 'admin', admin: '0' };
            mockApprovalService.approveAction.mockResolvedValue({
                success: true,
                result: { executed: true },
            });

            const res = await request(app)
                .post('/api/approvals/action-123/approve')
                .send({});

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.result).toEqual({ executed: true });
        });

        it('returns 403 when a non-admin user tries to approve (#1544)', async () => {
            const res = await request(app)
                .post('/api/approvals/action-123/approve')
                .send({});

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
        });

        it('returns 400 when approval returns failure from the service', async () => {
            mockUser.current = { id: 'admin-1', login: 'boss', role: 'admin', admin: '0' };
            mockApprovalService.approveAction.mockResolvedValue({
                success: false,
                error: 'Cannot approve: action already executed',
            });

            const res = await request(app)
                .post('/api/approvals/action-123/approve')
                .send({});

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('BAD_REQUEST');
        });

        it('returns 500 when service throws', async () => {
            mockUser.current = { id: 'admin-1', login: 'boss', role: 'admin', admin: '0' };
            mockApprovalService.approveAction.mockRejectedValue(new Error('Approval failed'));

            const res = await request(app)
                .post('/api/approvals/action-123/approve')
                .send({});

            expect(res.status).toBe(500);
        });
    });

    describe('POST /api/approvals/:id/reject', () => {
        it('returns 200 when an admin rejects the action with a reason', async () => {
            mockUser.current = { id: 'admin-1', login: 'boss', role: 'admin', admin: '0' };
            mockApprovalService.rejectAction.mockResolvedValue({
                success: true,
            });

            const res = await request(app)
                .post('/api/approvals/action-123/reject')
                .send({ reason: 'Invalid operation' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('returns 200 when an admin rejects without a reason', async () => {
            mockUser.current = { id: 'admin-1', login: 'boss', role: 'admin', admin: '0' };
            mockApprovalService.rejectAction.mockResolvedValue({
                success: true,
            });

            const res = await request(app)
                .post('/api/approvals/action-123/reject')
                .send({});

            expect(res.status).toBe(200);
        });

        it('returns 403 when a non-admin user tries to reject (#1544)', async () => {
            const res = await request(app)
                .post('/api/approvals/action-123/reject')
                .send({ reason: 'No' });

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
        });

        it('returns 400 when rejection returns failure', async () => {
            mockUser.current = { id: 'admin-1', login: 'boss', role: 'admin', admin: '0' };
            mockApprovalService.rejectAction.mockResolvedValue({
                success: false,
                error: 'Cannot reject: action already approved',
            });

            const res = await request(app)
                .post('/api/approvals/action-123/reject')
                .send({ reason: 'Test' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('BAD_REQUEST');
        });

        it('returns 500 when service throws', async () => {
            mockUser.current = { id: 'admin-1', login: 'boss', role: 'admin', admin: '0' };
            mockApprovalService.rejectAction.mockRejectedValue(new Error('Rejection failed'));

            const res = await request(app)
                .post('/api/approvals/action-123/reject')
                .send({ reason: 'Test' });

            expect(res.status).toBe(500);
        });
    });

    describe('POST /api/approvals/bulk (#1544)', () => {
        it('returns 200 when an admin bulk-approves valid action ids', async () => {
            mockUser.current = { id: 'admin-1', login: 'boss', role: 'admin', admin: '0' };
            mockApprovalService.bulkApproveActions.mockResolvedValue({
                total: 2,
                succeeded: 2,
                failed: 0,
                results: [
                    { id: 'a-1', success: true, result: { executed: true } },
                    { id: 'a-2', success: true, result: { executed: true } },
                ],
            });

            const res = await request(app)
                .post('/api/approvals/bulk')
                .send({ actionIds: ['a-1', 'a-2'] });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.total).toBe(2);
            expect(res.body.data.succeeded).toBe(2);
        });

        it('returns 207 Multi-Status when some actions fail to approve', async () => {
            mockUser.current = { id: 'admin-1', login: 'boss', role: 'admin', admin: '0' };
            mockApprovalService.bulkApproveActions.mockResolvedValue({
                total: 2,
                succeeded: 1,
                failed: 1,
                results: [
                    { id: 'a-1', success: true, result: { executed: true } },
                    { id: 'a-2', success: false, error: 'Not pending' },
                ],
            });

            const res = await request(app)
                .post('/api/approvals/bulk')
                .send({ actionIds: ['a-1', 'a-2'] });

            expect(res.status).toBe(207);
            expect(res.body.data.failed).toBe(1);
        });

        it('returns 403 when a non-admin tries to bulk-approve (#1544)', async () => {
            const res = await request(app)
                .post('/api/approvals/bulk')
                .send({ actionIds: ['a-1'] });

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
        });

        it('returns 400 when actionIds is empty', async () => {
            mockUser.current = { id: 'admin-1', login: 'boss', role: 'admin', admin: '0' };

            const res = await request(app)
                .post('/api/approvals/bulk')
                .send({ actionIds: [] });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });
    });
});
