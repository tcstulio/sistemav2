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

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/approvals', approvalRoutes);
    return app;
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
            expect(res.body.count).toBeDefined();
            expect(res.body.actions).toBeDefined();
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
            expect(res.body.history).toBeDefined();
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
            expect(res.body.stats).toBeDefined();
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
            expect(res.body.action).toBeDefined();
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
            expect(res.body.action).toBeDefined();
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
        it('returns 200 when action is approved', async () => {
            mockApprovalService.approveAction.mockResolvedValue({
                success: true,
                result: { executed: true }
            });

            const res = await request(app)
                .post('/api/approvals/action-123/approve');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.result).toBeDefined();
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

        it('returns 500 when service throws', async () => {
            mockApprovalService.rejectAction.mockRejectedValue(new Error('Rejection failed'));

            const res = await request(app)
                .post('/api/approvals/action-123/reject')
                .send({ reason: 'Test' });

            expect(res.status).toBe(500);
        });
    });
});
