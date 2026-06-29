import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

    it('(#921) ao clicar abre detalhes e navega via botão "Abrir registro" (linkTo)', async () => {
        const user = userEvent.setup();
        const onNav = vi.fn();
        mockEvents.mockResolvedValue({ events: [ev({ linkTo: 'tasks/50', description: 'cobrança' })], total: 1, sources: [] });
        render(<SystemEventsView onNavigate={onNav} />);
        await user.click(await screen.findByText('cobrança'));
        const dialog = await screen.findByRole('dialog');
        expect(onNav).not.toHaveBeenCalled();
        await user.click(within(dialog).getByRole('button', { name: /Abrir registro/i }));
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

    it('(#544) actor.name "unknown" vira "Sistema" quando userMap não resolve o ID', async () => {
        mockUsers.mockReturnValue({ data: [] }); // sem userMap
        mockEvents.mockResolvedValue({ events: [ev({ actor: { id: 'x', name: 'unknown' }, description: 'ação sem autor' })], total: 1, sources: [] });
        const { container } = render(<SystemEventsView onNavigate={vi.fn()} />);
        await screen.findByText(/ação sem autor/);
        expect(container.textContent).not.toContain('unknown');
        expect(screen.getByText(/Sistema/)).toBeTruthy();
    });

    it('(#544) actor.name numérico cru sem entrada no userMap vira "Sistema"', async () => {
        mockUsers.mockReturnValue({ data: [] }); // userMap vazio
        mockEvents.mockResolvedValue({ events: [ev({ actor: { id: '42', name: '42' }, description: 'ação numérica' })], total: 1, sources: [] });
        const { container } = render(<SystemEventsView onNavigate={vi.fn()} />);
        await screen.findByText(/ação numérica/);
        // nome numérico cru nunca deve aparecer como nome de exibição
        expect(container.textContent).not.toMatch(/\b42\b.*\b42\b/); // não exibe '42 42'
        expect(screen.getByText(/Sistema/)).toBeTruthy();
    });
});

describe('SystemEventsView (#587) — cliques e navegação', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSources.mockResolvedValue(['audit', 'agent', 'delegation', 'notification', 'scheduler', 'approval', 'task']);
    });

    it('(#921) detalhes de evento agent com entityType=invoice e entityId=42 → "Abrir registro" navega ("invoices","42")', async () => {
        const user = userEvent.setup();
        const onNav = vi.fn();
        mockEvents.mockResolvedValue({
            events: [ev({ entityType: 'invoice', entityId: '42', description: 'criou fatura' })],
            total: 1, sources: [],
        });
        render(<SystemEventsView onNavigate={onNav} />);
        await user.click(await screen.findByText('criou fatura'));
        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByRole('button', { name: /Abrir registro/i }));
        expect(onNav).toHaveBeenCalledWith('invoices', '42');
    });

    it('(#921) evento scheduler sem linkTo/entidade abre detalhes, mas SEM botão "Abrir registro"', async () => {
        const user = userEvent.setup();
        const onNav = vi.fn();
        mockEvents.mockResolvedValue({
            events: [ev({ source: 'scheduler', description: 'job executado', entityType: undefined, entityId: undefined, linkTo: undefined })],
            total: 1, sources: [],
        });
        render(<SystemEventsView onNavigate={onNav} />);
        await user.click(await screen.findByText('job executado'));
        const dialog = await screen.findByRole('dialog');
        // não-navegável: o botão de abrir registro não existe, e nada é despachado
        expect(within(dialog).queryByRole('button', { name: /Abrir registro/i })).toBeNull();
        expect(onNav).not.toHaveBeenCalled();
    });

    it('(#921) evento com linkTo válido abre detalhes e navega via botão (regressão zero)', async () => {
        const user = userEvent.setup();
        const onNav = vi.fn();
        mockEvents.mockResolvedValue({
            events: [ev({ linkTo: 'tasks/99', description: 'delegação criada' })],
            total: 1, sources: [],
        });
        render(<SystemEventsView onNavigate={onNav} />);
        await user.click(await screen.findByText('delegação criada'));
        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByRole('button', { name: /Abrir registro/i }));
        expect(onNav).toHaveBeenCalledWith('tasks', '99');
    });
});

describe('SystemEventsView (#921) — ver mais detalhes ao clicar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUsers.mockReturnValue({ data: [] });
        mockSources.mockResolvedValue(['audit', 'agent', 'delegation', 'notification', 'scheduler', 'approval', 'task']);
    });

    it('ao clicar num evento abre o modal de detalhes com descrição, ator, tipo e badge de severidade', async () => {
        const user = userEvent.setup();
        mockEvents.mockResolvedValue({
            events: [ev({ description: 'faturou a venda', type: 'invoice_created', severity: 'warn', actor: { id: '7', name: 'Maria Lima' } })],
            total: 1, sources: [],
        });
        render(<SystemEventsView onNavigate={vi.fn()} />);
        await user.click(await screen.findByText('faturou a venda'));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('faturou a venda')).toBeTruthy();
        expect(within(dialog).getByText('Maria Lima')).toBeTruthy();
        expect(within(dialog).getByText('invoice_created')).toBeTruthy();
        expect(within(dialog).getByText('Atenção')).toBeTruthy(); // label da severidade 'warn'
        expect(within(dialog).getByText('Ator')).toBeTruthy();
    });

    it('mostra o campo "Objetivo" no detalhe quando metadata.objetivo existe', async () => {
        const user = userEvent.setup();
        mockEvents.mockResolvedValue({
            events: [ev({ description: 'cobrança registrada', metadata: { objetivo: 'Receber em até 30 dias' } })],
            total: 1, sources: [],
        });
        render(<SystemEventsView onNavigate={vi.fn()} />);
        await user.click(await screen.findByText('cobrança registrada'));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Objetivo')).toBeTruthy();
        expect(within(dialog).getByText('Receber em até 30 dias')).toBeTruthy();
    });

    it('mostra "Destinatário" resolvido pelo userMap quando metadata.to aponta para um usuário', async () => {
        const user = userEvent.setup();
        mockUsers.mockReturnValue({ data: [{ id: '9', firstname: 'Carlos', lastname: 'Souza', login: 'csouza' }] });
        mockEvents.mockResolvedValue({
            events: [ev({ description: 'delegou a cobrança', type: 'requested', metadata: { to: '9' } })],
            total: 1, sources: [],
        });
        render(<SystemEventsView onNavigate={vi.fn()} />);
        await user.click(await screen.findByText('delegou a cobrança'));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Destinatário')).toBeTruthy();
        expect(within(dialog).getByText(/Carlos Souza/)).toBeTruthy();
    });

    it('mostra "Detalhes" extras como JSON quando há metadados adicionais', async () => {
        const user = userEvent.setup();
        mockEvents.mockResolvedValue({
            events: [ev({ description: 'execução do job', metadata: { host: 'srv-1', duration: 42 } })],
            total: 1, sources: [],
        });
        render(<SystemEventsView onNavigate={vi.fn()} />);
        await user.click(await screen.findByText('execução do job'));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Detalhes')).toBeTruthy();
        expect(within(dialog).getByText(/"host"/)).toBeTruthy();
        expect(within(dialog).getByText(/"srv-1"/)).toBeTruthy();
    });

    it('o botão "Fechar" fecha o modal de detalhes', async () => {
        const user = userEvent.setup();
        mockEvents.mockResolvedValue({ events: [ev({ description: 'evento de auditoria' })], total: 1, sources: [] });
        render(<SystemEventsView onNavigate={vi.fn()} />);
        await user.click(await screen.findByText('evento de auditoria'));
        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByRole('button', { name: /^Fechar$/ }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });
});
