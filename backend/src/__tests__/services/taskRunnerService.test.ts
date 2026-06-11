import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

vi.mock('fs');
vi.mock('child_process', () => ({
    execFile: vi.fn(),
    exec: vi.fn(),
    spawn: vi.fn(),
}));
vi.mock('../../utils/atomicWrite', () => ({
    atomicWriteSync: vi.fn(),
}));
vi.mock('../../utils/processTree', () => ({
    killTree: vi.fn().mockResolvedValue({ ok: true, signal: 'SIGTERM', durationMs: 10, alreadyDead: false }),
    isAlive: vi.fn().mockReturnValue(false),
}));
vi.mock('../../services/aiService', () => ({
    aiService: { generateReply: vi.fn() },
}));
vi.mock('../../services/socketService', () => ({
    socketService: { emit: vi.fn() },
}));

const mockedFs = vi.mocked(fs);

describe('taskRunnerService', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        vi.resetModules();
        mockedFs.existsSync.mockReturnValue(false);
    });

    describe('one-shot migration: cleanup-dupes-316-318', () => {
        it('removes duplicate tasks #316, #317, #318 and keeps #315', async () => {
            const storeWithDupes = {
                tasks: {
                    315: { issueNumber: 315, title: 'Melhorar tela de Issues', body: '', labels: ['opencode-task'], status: 'pending', feedbackHistory: [], events: [], updatedAt: new Date().toISOString() },
                    316: { issueNumber: 316, title: 'Melhorar tela de Issues', body: '', labels: ['opencode-task'], status: 'pending', feedbackHistory: [], events: [], updatedAt: new Date().toISOString() },
                    317: { issueNumber: 317, title: 'Melhorar tela de Issues', body: '', labels: ['opencode-task'], status: 'pending', feedbackHistory: [], events: [], updatedAt: new Date().toISOString() },
                    318: { issueNumber: 318, title: 'Melhorar tela de Issues', body: '', labels: ['opencode-task'], status: 'pending', feedbackHistory: [], events: [], updatedAt: new Date().toISOString() },
                },
            };
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue(JSON.stringify(storeWithDupes));

            const { taskRunnerService } = await import('../../services/taskRunnerService');
            const tasks = taskRunnerService.getAllTasks();

            expect(tasks.find(t => t.issueNumber === 315)).toBeDefined();
            expect(tasks.find(t => t.issueNumber === 316)).toBeUndefined();
            expect(tasks.find(t => t.issueNumber === 317)).toBeUndefined();
            expect(tasks.find(t => t.issueNumber === 318)).toBeUndefined();
        });

        it('does not run migration again if already done', async () => {
            const migratedStore = {
                tasks: {
                    315: { issueNumber: 315, title: 'Melhorar tela de Issues', body: '', labels: ['opencode-task'], status: 'pending', feedbackHistory: [], events: [], updatedAt: new Date().toISOString() },
                },
                _migrations: ['cleanup-dupes-316-318'],
            };
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue(JSON.stringify(migratedStore));

            const { taskRunnerService } = await import('../../services/taskRunnerService');
            const tasks = taskRunnerService.getAllTasks();

            expect(tasks).toHaveLength(1);
            expect(tasks[0].issueNumber).toBe(315);
        });

        it('handles store without duplicates gracefully', async () => {
            const cleanStore = {
                tasks: {
                    315: { issueNumber: 315, title: 'Some task', body: '', labels: ['opencode-task'], status: 'pending', feedbackHistory: [], events: [], updatedAt: new Date().toISOString() },
                    320: { issueNumber: 320, title: 'Another task', body: '', labels: ['opencode-task'], status: 'pending', feedbackHistory: [], events: [], updatedAt: new Date().toISOString() },
                },
            };
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue(JSON.stringify(cleanStore));

            const { taskRunnerService } = await import('../../services/taskRunnerService');
            const tasks = taskRunnerService.getAllTasks();

            expect(tasks).toHaveLength(2);
        });
    });

    describe('reorderTasks', () => {
        it('sets queuePriority based on array order', async () => {
            const store = {
                tasks: {
                    10: { issueNumber: 10, title: 'A', body: '', labels: [], status: 'pending', feedbackHistory: [], events: [], updatedAt: new Date().toISOString() },
                    20: { issueNumber: 20, title: 'B', body: '', labels: [], status: 'pending', feedbackHistory: [], events: [], updatedAt: new Date().toISOString() },
                    30: { issueNumber: 30, title: 'C', body: '', labels: [], status: 'pending', feedbackHistory: [], events: [], updatedAt: new Date().toISOString() },
                },
                _migrations: ['cleanup-dupes-316-318'],
            };
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue(JSON.stringify(store));

            const { taskRunnerService } = await import('../../services/taskRunnerService');
            taskRunnerService.reorderTasks([30, 10, 20]);

            expect(taskRunnerService.getTask(30)!.queuePriority).toBe(1);
            expect(taskRunnerService.getTask(10)!.queuePriority).toBe(2);
            expect(taskRunnerService.getTask(20)!.queuePriority).toBe(3);
        });

        it('ignores non-existent issue numbers', async () => {
            const store = {
                tasks: {
                    10: { issueNumber: 10, title: 'A', body: '', labels: [], status: 'pending', feedbackHistory: [], events: [], updatedAt: new Date().toISOString() },
                },
                _migrations: ['cleanup-dupes-316-318'],
            };
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue(JSON.stringify(store));

            const { taskRunnerService } = await import('../../services/taskRunnerService');
            expect(() => taskRunnerService.reorderTasks([10, 999])).not.toThrow();
            expect(taskRunnerService.getTask(10)!.queuePriority).toBe(1);
        });
    });
});
