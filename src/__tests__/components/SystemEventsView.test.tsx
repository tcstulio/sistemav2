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
});

describe('SystemEventsView (#587) — cliques e navegação', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSources.mockResolvedValue(['audit', 'agent', 'delegation', 'notification', 'scheduler', 'approval', 'task']);
    });

    it('evento agent com entityType=invoice e entityId=42 → onNavigate("invoices","42")', async () => {
        const onNav = vi.fn();
        mockEvents.mockResolvedValue({
            events: [ev({ entityType: 'invoice', entityId: '42', description: 'criou fatura' })],
            total: 1, sources: [],
        });
        render(<SystemEventsView onNavigate={onNav} />);
        fireEvent.click(await screen.findByText('criou fatura'));
        expect(onNav).toHaveBeenCalledWith('invoices', '42');
    });

    it('evento scheduler sem linkTo/entidade → clique NÃO chama onNavigate e card sem cursor-pointer', async () => {
        const onNav = vi.fn();
        mockEvents.mockResolvedValue({
            events: [ev({ source: 'scheduler', description: 'job executado', entityType: undefined, entityId: undefined, linkTo: undefined })],
            total: 1, sources: [],
        });
        render(<SystemEventsView onNavigate={onNav} />);
        const text = await screen.findByText('job executado');
        // Sobe ao container do card (div com p-4)
        const card = text.closest('[class*="p-4"]');
        expect(card).toBeTruthy();
        fireEvent.click(card!);
        expect(onNav).not.toHaveBeenCalled();
        expect(card!.className).toContain('cursor-default');
        expect(card!.className).not.toContain('cursor-pointer');
    });

    it('evento com linkTo válido continua navegando (regressão zero)', async () => {
        const onNav = vi.fn();
        mockEvents.mockResolvedValue({
            events: [ev({ linkTo: 'tasks/99', description: 'delegação criada' })],
            total: 1, sources: [],
        });
        render(<SystemEventsView onNavigate={onNav} />);
        fireEvent.click(await screen.findByText('delegação criada'));
        expect(onNav).toHaveBeenCalledWith('tasks', '99');
    });
});
