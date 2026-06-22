import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import SystemEventsView from '../../components/SystemEventsView';

vi.mock('../../context/DolibarrContext', () => ({ useDolibarr: () => ({ config: { apiUrl: 'x' } }) }));
const mockUsers = vi.hoisted(() => vi.fn(() => ({ data: [] as any[] })));
vi.mock('../../hooks/dolibarr', () => ({
    useSystemLogs: () => ({ data: [] }),
    useUsers: () => mockUsers(),
}));

const mockSources = vi.fn();
const mockEvents = vi.fn();
vi.mock('../../services/systemEventsService', () => ({
    getSystemEventSources: () => mockSources(),
    getSystemEvents: (p: any) => mockEvents(p),
}));

// Socket-fake controlável: captura o handler do onAny p/ simular eventos em tempo real.
const sock = vi.hoisted(() => {
    const state: { onAny: ((e: string, ...a: any[]) => void) | null } = { onAny: null };
    const socket = {
        onAny: (fn: (e: string, ...a: any[]) => void) => { state.onAny = fn; },
        offAny: () => { state.onAny = null; },
    };
    return { state, socket };
});
vi.mock('../../contexts/WhatsAppContext', () => ({
    useWhatsAppContext: () => ({ socket: sock.socket, isConnected: true }),
}));

const ev = (over: any = {}) => ({
    id: 'e1', timestamp: '2026-06-18T10:00:00Z', source: 'agent',
    actor: { id: '7', name: 'User 7' }, type: 'list_user_tasks',
    description: 'listou tarefas', severity: 'info', ...over,
});

describe('SystemEventsView (#519)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUsers.mockReturnValue({ data: [] });
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

    it('indicador "Ao vivo" quando conectado', async () => {
        render(<SystemEventsView onNavigate={vi.fn()} />);
        expect(await screen.findByText('Ao vivo')).toBeTruthy();
    });

    it('evento de socket relevante dispara re-busca (debounced)', async () => {
        render(<SystemEventsView onNavigate={vi.fn()} />);
        await screen.findByText('listou tarefas');
        mockEvents.mockClear();
        sock.state.onAny?.('notification', { id: 'x' }); // sinal de tempo real
        await waitFor(() => expect(mockEvents).toHaveBeenCalled(), { timeout: 2500 });
    });

    it('evento de socket irrelevante NÃO dispara re-busca', async () => {
        render(<SystemEventsView onNavigate={vi.fn()} />);
        await screen.findByText('listou tarefas');
        mockEvents.mockClear();
        sock.state.onAny?.('whatsapp_message', {});
        await new Promise(r => setTimeout(r, 1800)); // além do debounce
        expect(mockEvents).not.toHaveBeenCalled();
    });

    it('(#544) resolve actor.name numérico/#id via userMap (mostra o nome real, não o cru)', async () => {
        mockUsers.mockReturnValue({ data: [{ id: '7', firstname: 'João', lastname: 'Silva', login: 'jsilva' }] });
        mockEvents.mockResolvedValue({ events: [ev({ actor: { id: '7', name: '#7' }, description: 'cobrança delegada' })], total: 1, sources: [] });
        const { container } = render(<SystemEventsView onNavigate={vi.fn()} />);
        expect(await screen.findByText(/João Silva/)).toBeTruthy();
        // o ID cru / referência rotulada não vaza: o nome resolvido aparece no lugar
        expect(container.textContent).not.toContain('#7');
    });
});
