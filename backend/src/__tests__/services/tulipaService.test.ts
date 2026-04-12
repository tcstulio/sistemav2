import { describe, it, expect, vi, beforeEach } from 'vitest';
import http from 'http';

vi.mock('http', () => ({
    default: {
        request: vi.fn(),
    },
}));

import { tulipaService, TulipaService } from '../../services/tulipaService';
import httpModule from 'http';

describe('TulipaService', () => {
    let service: TulipaService;

    function mockRequest(responseData: any) {
        const mockReq = {
            on: vi.fn(),
            write: vi.fn(),
            end: vi.fn(),
            destroy: vi.fn(),
        };
        const mockRes = {
            on: vi.fn().mockImplementation((event: string, handler: any) => {
                if (event === 'data') handler(JSON.stringify(responseData));
                if (event === 'end') handler();
            }),
            headers: { 'content-type': 'application/json' },
        };

        (httpModule.request as any).mockImplementation((opts: any, cb: any) => {
            cb(mockRes);
            return mockReq as any;
        });
        return mockReq;
    }

    function mockError(msg: string) {
        const mockReq = {
            on: vi.fn((event: string, handler: any) => {
                if (event === 'error') handler(new Error(msg));
            }),
            write: vi.fn(),
            end: vi.fn(),
            destroy: vi.fn(),
        };
        (httpModule.request as any).mockReturnValue(mockReq as any);
    }

    function mockTimeout() {
        const mockReq = {
            on: vi.fn((event: string, handler: any) => {
                if (event === 'timeout') handler();
            }),
            write: vi.fn(),
            end: vi.fn(),
            destroy: vi.fn(),
        };
        (httpModule.request as any).mockReturnValue(mockReq as any);
    }

    function mockJsonParseFail() {
        const mockReq = {
            on: vi.fn(),
            write: vi.fn(),
            end: vi.fn(),
        };
        const mockRes = {
            on: vi.fn(),
            headers: {},
        };
        let dataHandler: any;
        let endHandler: any;
        mockRes.on = vi.fn((event: string, handler: any) => {
            if (event === 'data') {
                dataHandler = handler;
            } else if (event === 'end') {
                endHandler = handler;
            }
        });
        (httpModule.request as any).mockImplementation((opts: any, cb: any) => {
            cb(mockRes);
            if (dataHandler) dataHandler('not-json');
            if (endHandler) endHandler();
            return mockReq as any;
        });
    }

    beforeEach(() => {
        vi.clearAllMocks();
        service = new TulipaService({ host: 'localhost', port: 8081, timeout: 5000 });
    });

    describe('isEnabled', () => {
        it('returns true when env is set', () => {
            process.env.TULIPA_ENABLED = 'true';
            expect(service.isEnabled()).toBe(true);
            delete process.env.TULIPA_ENABLED;
        });

        it('returns false by default', () => {
            delete process.env.TULIPA_ENABLED;
            expect(service.isEnabled()).toBe(false);
        });
    });

    describe('getSystemStatus', () => {
        it('returns system status', async () => {
            mockRequest({ healthy: true, uptime: 100 });
            const result = await service.getSystemStatus();
            expect(result?.healthy).toBe(true);
        });

        it('returns null on error', async () => {
            mockError('Connection failed');
            const result = await service.getSystemStatus();
            expect(result).toBeNull();
        });
    });

    describe('getQuickStatus', () => {
        it('returns healthy status', async () => {
            mockRequest({ healthy: true, message: 'OK' });
            const result = await service.getQuickStatus();
            expect(result.healthy).toBe(true);
        });

        it('handles ok field', async () => {
            mockRequest({ ok: true });
            const result = await service.getQuickStatus();
            expect(result.healthy).toBe(true);
        });

        it('returns error message', async () => {
            mockError('fail');
            const result = await service.getQuickStatus();
            expect(result.healthy).toBe(false);
        });
    });

    describe('getWhatsAppStatus', () => {
        it('returns status', async () => {
            mockRequest({ connected: true, status: 'ready', phone: '+5511' });
            const result = await service.getWhatsAppStatus();
            expect(result.connected).toBe(true);
        });

        it('returns error on failure', async () => {
            mockError('fail');
            const result = await service.getWhatsAppStatus();
            expect(result.connected).toBe(false);
            expect(result.error).toBeDefined();
        });
    });

    describe('Brain People', () => {
        it('getPeople returns people array', async () => {
            mockRequest({ data: [{ id: '1', name: 'Test' }] });
            const result = await service.getPeople();
            expect(result).toHaveLength(1);
        });

        it('getPeople handles people field', async () => {
            mockRequest({ people: [{ id: '2' }] });
            const result = await service.getPeople();
            expect(result).toHaveLength(1);
        });

        it('getPeople handles direct array', async () => {
            mockRequest([{ id: '3' }]);
            const result = await service.getPeople();
            expect(result).toHaveLength(1);
        });

        it('getPeople returns empty on error', async () => {
            mockError('fail');
            const result = await service.getPeople();
            expect(result).toEqual([]);
        });

        it('getPerson returns person', async () => {
            mockRequest({ data: { id: '1', name: 'Test' } });
            const result = await service.getPerson('1');
            expect(result?.id).toBe('1');
        });

        it('getPerson returns null on error', async () => {
            mockError('fail');
            const result = await service.getPerson('1');
            expect(result).toBeNull();
        });

        it('updatePerson returns true on success', async () => {
            mockRequest({ ok: true });
            const result = await service.updatePerson('1', { name: 'Updated' });
            expect(result).toBe(true);
        });

        it('updatePerson returns false on error', async () => {
            mockError('fail');
            const result = await service.updatePerson('1', { name: 'Updated' });
            expect(result).toBe(false);
        });

        it('linkPersonToCustomer returns true', async () => {
            mockRequest({ ok: true });
            const result = await service.linkPersonToCustomer('p1', 'c1');
            expect(result).toBe(true);
        });

        it('linkPersonToCustomer returns false on error', async () => {
            mockError('fail');
            const result = await service.linkPersonToCustomer('p1', 'c1');
            expect(result).toBe(false);
        });
    });

    describe('Brain Events', () => {
        it('getEvents returns events', async () => {
            mockRequest({ data: [{ id: 'e1' }] });
            const result = await service.getEvents();
            expect(result).toHaveLength(1);
        });

        it('getEvents with date parameter', async () => {
            mockRequest({ events: [] });
            const result = await service.getEvents('2024-01-15');
            expect(result).toEqual([]);
        });

        it('getEvents returns empty on error', async () => {
            mockError('fail');
            const result = await service.getEvents();
            expect(result).toEqual([]);
        });

        it('getEventsByPerson returns events', async () => {
            mockRequest({ data: [{ id: 'e1' }] });
            const result = await service.getEventsByPerson('p1', 10);
            expect(result).toHaveLength(1);
        });

        it('getEventsStats returns stats', async () => {
            mockRequest({ totalEvents: 100 });
            const result = await service.getEventsStats();
            expect(result?.totalEvents).toBe(100);
        });

        it('getEventsStats returns null on error', async () => {
            mockError('fail');
            const result = await service.getEventsStats();
            expect(result).toBeNull();
        });

        it('getBrainSummary returns data', async () => {
            mockRequest({ total: 50 });
            const result = await service.getBrainSummary();
            expect(result?.total).toBe(50);
        });

        it('getBrainSummary returns null on error', async () => {
            mockError('fail');
            const result = await service.getBrainSummary();
            expect(result).toBeNull();
        });
    });

    describe('Tasks', () => {
        it('getTasks returns tasks', async () => {
            mockRequest({ data: [{ id: 't1' }] });
            const result = await service.getTasks();
            expect(result).toHaveLength(1);
        });

        it('getTasks with projectId', async () => {
            mockRequest({ tasks: [] });
            const result = await service.getTasks('proj1');
            expect(result).toEqual([]);
        });

        it('getAvailableTasks returns tasks', async () => {
            mockRequest({ data: [{ id: 't1', status: 'ready' }] });
            const result = await service.getAvailableTasks();
            expect(result).toHaveLength(1);
        });

        it('getTask returns task', async () => {
            mockRequest({ data: { id: 't1' } });
            const result = await service.getTask('t1');
            expect(result?.id).toBe('t1');
        });

        it('getTask returns null on error', async () => {
            mockError('fail');
            const result = await service.getTask('t1');
            expect(result).toBeNull();
        });

        it('createTask returns task', async () => {
            mockRequest({ data: { id: 'new' } });
            const result = await service.createTask({ name: 'Test' });
            expect(result?.id).toBe('new');
        });

        it('createTask returns null on error', async () => {
            mockError('fail');
            const result = await service.createTask({ name: 'Test' });
            expect(result).toBeNull();
        });

        it('claimTask returns true', async () => {
            mockRequest({ ok: true });
            expect(await service.claimTask('t1', 'agent1')).toBe(true);
        });

        it('claimTask returns false on error', async () => {
            mockError('fail');
            expect(await service.claimTask('t1', 'agent1')).toBe(false);
        });

        it('completeTask returns true', async () => {
            mockRequest({ ok: true });
            expect(await service.completeTask('t1', { result: 'done' })).toBe(true);
        });

        it('failTask returns true', async () => {
            mockRequest({ ok: true });
            expect(await service.failTask('t1', 'error msg')).toBe(true);
        });

        it('failTask returns false on error', async () => {
            mockError('fail');
            expect(await service.failTask('t1', 'err')).toBe(false);
        });
    });

    describe('Projects', () => {
        it('getProjects returns projects', async () => {
            mockRequest({ projects: [{ id: 'p1' }] });
            const result = await service.getProjects();
            expect(result).toHaveLength(1);
        });

        it('createProject returns project', async () => {
            mockRequest({ data: { id: 'new' } });
            const result = await service.createProject({ name: 'Test' });
            expect(result?.id).toBe('new');
        });

        it('createProject returns null on error', async () => {
            mockError('fail');
            const result = await service.createProject({ name: 'Test' });
            expect(result).toBeNull();
        });
    });

    describe('Agents', () => {
        it('registerAgent returns true', async () => {
            mockRequest({ ok: true });
            expect(await service.registerAgent({ sessionId: 'a1' })).toBe(true);
        });

        it('registerAgent returns false on error', async () => {
            mockError('fail');
            expect(await service.registerAgent({ sessionId: 'a1' })).toBe(false);
        });

        it('agentHeartbeat returns true', async () => {
            mockRequest({ ok: true });
            expect(await service.agentHeartbeat('a1')).toBe(true);
        });

        it('agentHeartbeat returns false on error', async () => {
            mockError('fail');
            expect(await service.agentHeartbeat('a1')).toBe(false);
        });

        it('getActiveAgents returns agents', async () => {
            mockRequest({ agents: [{ id: 'a1' }] });
            const result = await service.getActiveAgents();
            expect(result).toHaveLength(1);
        });

        it('getActiveAgents returns empty on error', async () => {
            mockError('fail');
            const result = await service.getActiveAgents();
            expect(result).toEqual([]);
        });
    });

    describe('Sync', () => {
        it('triggerBrainSync returns true', async () => {
            mockRequest({ ok: true });
            expect(await service.triggerBrainSync()).toBe(true);
        });

        it('triggerBrainSync returns false on error', async () => {
            mockError('fail');
            expect(await service.triggerBrainSync()).toBe(false);
        });
    });

    describe('callAPI edge cases', () => {
        it('handles JSON parse failure', async () => {
            mockJsonParseFail();
            const result = await service.getSystemStatus();
            expect(result).toBeNull();
        });

        it('handles timeout', async () => {
            mockTimeout();
            const result = await service.getSystemStatus();
            expect(result).toBeNull();
        });

        it('sends body for POST requests', async () => {
            const mockReq = mockRequest({ ok: true });
            await service.createTask({ name: 'Test' });
            expect(mockReq.write).toHaveBeenCalledWith(expect.any(String));
            expect(mockReq.end).toHaveBeenCalled();
        });
    });
});
