import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockSvc = vi.hoisted(() => ({
    getForUser: vi.fn(() => []),
    getUnreadCount: vi.fn(() => 0),
    getStats: vi.fn(() => ({ total: 0, unread: 0, byEvent: {} })),
    markAsRead: vi.fn(() => true),
    markAllAsRead: vi.fn(() => 2),
    delete: vi.fn(() => true),
    deleteAllForUser: vi.fn(() => 3),
    create: vi.fn(() => ({ id: 'n1' })),
}));

vi.mock('../../services/notificationService', () => ({ notificationService: mockSvc }));
vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: (req: any, _res: any, next: any) => { req.user = { id: 'u1', login: 'u1' }; next(); },
}));
vi.mock('../../utils/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));

import notificationRoutes from '../../routes/notificationRoutes';

const app = express();
app.use(express.json());
app.use('/api/notifications', notificationRoutes);

describe('notificationRoutes (#519)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('GET / usa o unreadCount filtrado por usuário', async () => {
        const res = await request(app).get('/api/notifications');
        expect(res.status).toBe(200);
        expect(mockSvc.getUnreadCount).toHaveBeenCalledWith('u1');
    });

    it('DELETE / limpa as notificações do usuário (corrige o clearAll)', async () => {
        const res = await request(app).delete('/api/notifications');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, count: 3 });
        expect(mockSvc.deleteAllForUser).toHaveBeenCalledWith('u1');
    });

    it('DELETE /:id passa o userId (isolamento) e some 1', async () => {
        const res = await request(app).delete('/api/notifications/abc');
        expect(res.status).toBe(200);
        expect(mockSvc.delete).toHaveBeenCalledWith('abc', 'u1');
    });

    it('DELETE /:id retorna 404 quando não é do usuário / não existe', async () => {
        mockSvc.delete.mockReturnValueOnce(false);
        const res = await request(app).delete('/api/notifications/zzz');
        expect(res.status).toBe(404);
    });

    it('PUT /:id/read e /read-all passam o userId', async () => {
        await request(app).put('/api/notifications/abc/read');
        expect(mockSvc.markAsRead).toHaveBeenCalledWith('abc', 'u1');
        await request(app).put('/api/notifications/read-all');
        expect(mockSvc.markAllAsRead).toHaveBeenCalledWith('u1');
    });
});

describe('notificationRoutes — scope derivado (#531)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('recipient === userId → scope personal', async () => {
        mockSvc.getForUser.mockReturnValueOnce([
            { id: 'n1', event: 'task.assigned', title: 'T', message: 'M', priority: 'medium', read: false, createdAt: 1000, recipient: 'u1', channels: ['in-app'], deliveredTo: ['in-app'], failedChannels: [] },
        ]);
        const res = await request(app).get('/api/notifications');
        expect(res.status).toBe(200);
        expect(res.body.notifications[0].scope).toBe('personal');
    });

    it('recipient diferente do userId → scope system', async () => {
        mockSvc.getForUser.mockReturnValueOnce([
            { id: 'n2', event: 'stock.low', title: 'T', message: 'M', priority: 'high', read: false, createdAt: 1000, recipient: 'outro', channels: ['in-app'], deliveredTo: ['in-app'], failedChannels: [] },
        ]);
        const res = await request(app).get('/api/notifications');
        expect(res.status).toBe(200);
        expect(res.body.notifications[0].scope).toBe('system');
    });

    it('sem recipient → scope system', async () => {
        mockSvc.getForUser.mockReturnValueOnce([
            { id: 'n3', event: 'custom', title: 'T', message: 'M', priority: 'medium', read: false, createdAt: 1000, recipient: undefined, channels: ['in-app'], deliveredTo: ['in-app'], failedChannels: [] },
        ]);
        const res = await request(app).get('/api/notifications');
        expect(res.status).toBe(200);
        expect(res.body.notifications[0].scope).toBe('system');
    });
});
