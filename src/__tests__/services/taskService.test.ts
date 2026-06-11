import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');
vi.mock('../../utils/logger', () => ({
    logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));
vi.mock('../../utils/safeStorage', () => ({
    safeStorage: {
        getJSON: vi.fn().mockReturnValue({ apiKey: 'test-key' }),
    },
}));

const mockedAxios = vi.mocked(axios);

describe('TaskService', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        vi.resetModules();
    });

    describe('list', () => {
        it('calls GET /api/tasks and returns array', async () => {
            const mockTasks = [
                { issueNumber: 1, title: 'Test', status: 'pending' },
            ];
            mockedAxios.get.mockResolvedValue({ data: mockTasks });

            const { TaskService } = await import('../../services/taskService');
            const result = await TaskService.list();

            expect(mockedAxios.get).toHaveBeenCalledWith('/api/tasks', expect.objectContaining({
                headers: { Authorization: 'Bearer test-key' },
                timeout: 30000,
            }));
            expect(result).toEqual(mockTasks);
        });
    });

    describe('reorder', () => {
        it('calls PUT /api/tasks/reorder with order array', async () => {
            mockedAxios.put.mockResolvedValue({ data: { ok: true } });

            const { TaskService } = await import('../../services/taskService');
            await TaskService.reorder([10, 20, 30]);

            expect(mockedAxios.put).toHaveBeenCalledWith('/api/tasks/reorder', { order: [10, 20, 30] }, expect.objectContaining({
                headers: { Authorization: 'Bearer test-key' },
                timeout: 30000,
            }));
        });
    });

    describe('delete', () => {
        it('calls DELETE /api/tasks/:issueNumber', async () => {
            mockedAxios.delete.mockResolvedValue({ data: { ok: true } });

            const { TaskService } = await import('../../services/taskService');
            await TaskService.delete(42);

            expect(mockedAxios.delete).toHaveBeenCalledWith('/api/tasks/42', expect.objectContaining({
                headers: { Authorization: 'Bearer test-key' },
                timeout: 30000,
            }));
        });
    });

    describe('fix', () => {
        it('calls POST /api/tasks/:id/fix with feedback', async () => {
            mockedAxios.post.mockResolvedValue({ data: { issueNumber: 1 } });

            const { TaskService } = await import('../../services/taskService');
            await TaskService.fix(1, 'corrija isso');

            expect(mockedAxios.post).toHaveBeenCalledWith('/api/tasks/1/fix', { feedback: 'corrija isso' }, expect.objectContaining({
                headers: { Authorization: 'Bearer test-key' },
                timeout: 30000,
            }));
        });
    });
});
