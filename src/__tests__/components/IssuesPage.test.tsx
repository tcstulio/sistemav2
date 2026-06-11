import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { GitHubIssue, IssueStats } from '../../services/githubService';
import { Task } from '../../services/taskService';

vi.mock('../../services/githubService', () => ({
    GithubService: {
        getIssues: vi.fn(() => Promise.resolve([])),
        getStats: vi.fn(() => Promise.resolve(null)),
        addLabel: vi.fn(() => Promise.resolve({ ok: true })),
        setIssueState: vi.fn(() => Promise.resolve({ ok: true })),
    },
}));

vi.mock('../../services/taskService', () => ({
    TaskService: {
        list: vi.fn(() => Promise.resolve([])),
        getDiff: vi.fn(() => Promise.resolve('')),
        create: vi.fn(() => Promise.resolve()),
        start: vi.fn(() => Promise.resolve()),
        merge: vi.fn(() => Promise.resolve()),
        reject: vi.fn(() => Promise.resolve()),
        redo: vi.fn(() => Promise.resolve()),
        fix: vi.fn(() => Promise.resolve()),
        kill: vi.fn(() => Promise.resolve()),
        plan: vi.fn(() => Promise.resolve({ order: [] })),
        reorder: vi.fn(() => Promise.resolve()),
        update: vi.fn(() => Promise.resolve()),
        delete: vi.fn(() => Promise.resolve()),
    },
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({
        currentUser: { admin: 1 },
    })),
    DolibarrProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../hooks/useConfirm', () => ({
    useConfirm: vi.fn(() => async () => false),
}));

vi.mock('../TasksBoard/DiffViewer', () => ({
    default: () => <div data-testid="diff-viewer" />,
}));

vi.mock('../TasksBoard/TaskConsole', () => ({
    default: ({ onClose }: { onClose: () => void }) => (
        <div data-testid="task-console">
            <button onClick={onClose}>Close</button>
        </div>
    ),
}));

vi.mock('sonner', () => ({
    toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

vi.mock('@dnd-kit/core', () => ({
    DndContext: ({ children }: any) => <>{children}</>,
    closestCorners: vi.fn(),
    PointerSensor: vi.fn(),
    useSensor: vi.fn(() => ({})),
    useSensors: vi.fn(() => []),
}));

vi.mock('@dnd-kit/sortable', () => ({
    SortableContext: ({ children }: any) => <>{children}</>,
    verticalListSortingStrategy: {},
    useSortable: () => ({
        attributes: {},
        listeners: {},
        setNodeRef: () => {},
        transform: null,
        transition: null,
        isDragging: false,
    }),
    arrayMove: vi.fn((arr: any[]) => arr),
}));

vi.mock('@dnd-kit/utilities', () => ({
    CSS: { Transform: { toString: () => null } },
}));

const mockIssue: GitHubIssue = {
    number: 123,
    title: 'enhancement: melhorias basicas no TasksBoard (feedback, criacao, UX, filtros) - titulo longo para testar truncamento em mobile',
    state: 'OPEN',
    labels: [{ name: 'bug', color: 'ff0000' }],
    createdAt: '2024-01-15T10:30:00Z',
    url: 'https://github.com/test/test/issues/123',
    assignees: [],
};

const mockStats: IssueStats = {
    totalOpen: 5,
    totalClosed: 10,
    byLabel: {},
    recentClosed: [
        {
            number: 100,
            title: 'enhancement: melhorias basicas no TasksBoard (feedback, criacao, UX, filtros) - titulo longo recent closed',
            state: 'CLOSED',
            labels: [],
            createdAt: '2024-01-10T10:30:00Z',
            url: 'https://github.com/test/test/issues/100',
            assignees: [],
        },
    ],
};

const mockTask: Task = {
    issueNumber: 456,
    title: 'enhancement: melhorias basicas no TasksBoard (feedback, criacao, UX, filtros) - task titulo longo',
    body: 'body',
    labels: ['opencode-task'],
    status: 'pending',
    feedbackHistory: [],
    updatedAt: '2024-01-15T10:30:00Z',
};

import IssuesPage from '../../components/Issues/IssuesPage';
import React from 'react';

describe('IssuesPage - Issue title truncation (issue #343)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('issue titles should use line-clamp-3 instead of truncate in the issues list', async () => {
        const { GithubService } = await import('../../services/githubService');
        (GithubService.getIssues as ReturnType<typeof vi.fn>).mockResolvedValue([mockIssue]);
        (GithubService.getStats as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        render(<IssuesPage />);

        await waitFor(() => {
            expect(screen.getByText(/#123/)).toBeInTheDocument();
        });

        const titleElement = screen.getByText(/enhancement: melhorias basicas/).closest('p');
        expect(titleElement).not.toBeNull();
        expect(titleElement!.className).toContain('line-clamp-3');
        expect(titleElement!.className).not.toContain('truncate');
    });

    it('issue titles should NOT use truncate class', async () => {
        const { GithubService } = await import('../../services/githubService');
        (GithubService.getIssues as ReturnType<typeof vi.fn>).mockResolvedValue([mockIssue]);
        (GithubService.getStats as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        const { container } = render(<IssuesPage />);

        await waitFor(() => {
            expect(screen.getByText(/#123/)).toBeInTheDocument();
        });

        const allPTags = container.querySelectorAll('p');
        const issueTitlePs = Array.from(allPTags).filter(p =>
            p.textContent?.includes('#123') && p.textContent?.includes('melhorias basicas')
        );

        for (const p of issueTitlePs) {
            expect(p.className).not.toContain('truncate');
        }
    });

    it('recent closed titles in stats tab should use line-clamp-2 instead of truncate', async () => {
        const { GithubService } = await import('../../services/githubService');
        (GithubService.getIssues as ReturnType<typeof vi.fn>).mockResolvedValue([]);
        (GithubService.getStats as ReturnType<typeof vi.fn>).mockResolvedValue(mockStats);

        const { container } = render(<IssuesPage />);

        await waitFor(() => {
            expect(screen.getByText('Estatísticas')).toBeInTheDocument();
        });

        const statsTab = screen.getByText('Estatísticas');
        statsTab.click();

        await waitFor(() => {
            expect(screen.getByText('Fechadas Recentemente')).toBeInTheDocument();
        });

        const recentTitleSpans = container.querySelectorAll('span.line-clamp-2');
        expect(recentTitleSpans.length).toBeGreaterThanOrEqual(1);

        const allSpans = container.querySelectorAll('span.truncate');
        const recentClosedSection = screen.getByText('Fechadas Recentemente').closest('.space-y-1');
        if (recentClosedSection) {
            const spansInRecentClosed = recentClosedSection.querySelectorAll('span.truncate');
            expect(spansInRecentClosed.length).toBe(0);
        }
    });

    it('TaskListCard title element should have line-clamp-3 class', async () => {
        const { GithubService } = await import('../../services/githubService');
        const { TaskService } = await import('../../services/taskService');
        (GithubService.getIssues as ReturnType<typeof vi.fn>).mockResolvedValue([]);
        (GithubService.getStats as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        (TaskService.list as ReturnType<typeof vi.fn>).mockResolvedValue([mockTask]);

        const { container } = render(<IssuesPage />);

        const tasksTab = await screen.findByRole('button', { name: /Tasks/ });
        tasksTab.click();

        const listBtn = await screen.findByRole('button', { name: /Lista/i });
        listBtn.click();

        await waitFor(() => {
            const h3s = container.querySelectorAll('h3');
            const taskH3 = Array.from(h3s).find(h => h.textContent?.includes('melhorias basicas'));
            expect(taskH3).not.toBeUndefined();
            expect(taskH3!.className).toContain('line-clamp-3');
            expect(taskH3!.className).not.toContain('truncate');
        });
    });
});
