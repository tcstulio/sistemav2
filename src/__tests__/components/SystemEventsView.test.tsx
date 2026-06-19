import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import SystemEventsView from '../../components/SystemEventsView';

vi.mock('../../context/DolibarrContext', () => ({ useDolibarr: () => ({ config: { apiUrl: 'x' } }) }));
vi.mock('../../hooks/dolibarr', () => ({
    useSystemLogs: () => ({ data: [] }),
    useUsers: () => ({ data: [] }),
}));

const mockSources = vi.fn();
const mockEvents = vi.fn();
vi.mock('../../services/systemEventsService', () => ({
    getSystemEventSources: () => mockSources(),
    getSystemEvents: (p: any) => mockEvents(p),
}));

const ev = (over: any = {}) => ({
    id: 'e1', timestamp: '2026-06-18T10:00:00Z', source: 'agent',
    actor: { id: '7', name: 'User 7' }, type: 'list_user_tasks',
    description: 'listou tarefas', severity: 'info', ...over,
});

describe('SystemEventsView (#519)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSources.mockResolvedValue(['audit', 'agent', 'delegation', 'notification', 'scheduler', 'approval', 'task']);
        mockEvents.mockResolvedValue({ events: [ev()], total: 1, sources: [] });
    });

    it('carrega fontes (chips) e lista os eventos', async () => {
        render(<SystemEventsView onNavigate={vi.fn()} />);
        expect(await screen.findByText('listou tarefas')).toBeTruthy();
        // chips das fontes (botões) + dolibarr (cliente)
        expect(screen.getByRole('button', { name: /Auditoria/i })).toBeTruthy();
        expect(screen.getByRole('button', { name: /Agente/i })).toBeTruthy();
        expect(screen.getByRole('button', { name: /Agenda \(Dolibarr\)/i })).toBeTruthy();
    });

    it('navega via linkTo ao clicar num evento', async () => {
        const onNav = vi.fn();
        mockEvents.mockResolvedValue({ events: [ev({ linkTo: 'tasks/50', description: 'cobrança' })], total: 1, sources: [] });
        render(<SystemEventsView onNavigate={onNav} />);
        fireEvent.click(await screen.findByText('cobrança'));
        expect(onNav).toHaveBeenCalledWith('tasks', '50');
    });

    it('desligar uma fonte re-busca no backend sem ela', async () => {
        render(<SystemEventsView onNavigate={vi.fn()} />);
        await screen.findByText('listou tarefas');
        mockEvents.mockClear();
        fireEvent.click(screen.getByRole('button', { name: /Agente/i })); // desliga 'agent'
        await waitFor(() => {
            const lastCall = mockEvents.mock.calls.at(-1)?.[0];
            expect(lastCall.sources).not.toContain('agent');
        });
    });
});
