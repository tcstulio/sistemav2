import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NotificationPanel from '../../components/NotificationPanel';
import { AppNotification, AppView } from '../../types';
import { useDolibarr } from '../../context/DolibarrContext';

// #1429 — Mock do contexto Dolibarr. NotificationPanel usa useDolibarr() para obter
// o currentUser e particionar notificações em MINHAS × SISTEMA via classifyScope.
// Mantemos um userId padrão ('u1') para que os testes legados (que não se importam
// com escopo) continuem determinísticos — todos caem no ramo 'system' (sem recipient).
vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({
        currentUser: { id: 'u1', login: 'u1' },
    })),
}));

vi.mock('../../utils/dateUtils', () => ({
    formatTime: vi.fn((date: number) => {
        const d = new Date(date);
        return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    })
}));

const mockNotifications: AppNotification[] = [
    {
        id: '1',
        type: 'email',
        title: 'Novo email',
        message: 'Você recebeu uma nova mensagem de contato@empresa.com',
        date: Date.now() - 10000,
        read: false,
        priority: 'medium',
        linkTo: { view: 'email' as AppView, id: '100' }
    },
    {
        id: '2',
        type: 'stock',
        title: 'Alerta de Stock',
        message: 'O produto "Açúcar 5kg" está com stock crítico (3 unidades)',
        date: Date.now() - 50000,
        read: false,
        priority: 'high',
        linkTo: { view: 'inventory' as AppView, id: '50' }
    },
    {
        id: '3',
        type: 'invoice',
        title: 'Fatura Vencida',
        message: 'Fatura #1234 está vencida há 5 dias',
        date: Date.now() - 100000,
        read: true,
        priority: 'medium'
    }
];

describe('NotificationPanel', () => {
    const mockOnClose = vi.fn();
    const mockOnMarkRead = vi.fn();
    const mockOnNavigate = vi.fn();
    const mockOnClearAll = vi.fn();
    const mockOnMarkAllRead = vi.fn();
    const mockOnDismiss = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const renderPanel = (notifications: AppNotification[] = mockNotifications, isOpen = true) => {
        return render(
            <MemoryRouter>
                <NotificationPanel
                    isOpen={isOpen}
                    onClose={mockOnClose}
                    notifications={notifications}
                    onMarkRead={mockOnMarkRead}
                    onNavigate={mockOnNavigate}
                    onClearAll={mockOnClearAll}
                    onMarkAllRead={mockOnMarkAllRead}
                    onDismiss={mockOnDismiss}
                />
            </MemoryRouter>
        );
    };

    it('renders nothing when isOpen is false', () => {
        renderPanel(mockNotifications, false);
        expect(screen.queryByText('Notificações')).not.toBeInTheDocument();
    });

    it('renders notification panel when open', () => {
        renderPanel();
        expect(screen.getByText('Notificações')).toBeInTheDocument();
        expect(screen.getByText('Novo email')).toBeInTheDocument();
        expect(screen.getByText('Alerta de Stock')).toBeInTheDocument();
    });

    it('shows unread count badge', () => {
        renderPanel();
        expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('renders empty state when no notifications', () => {
        renderPanel([]);
        expect(screen.getByText('Tudo em dia!')).toBeInTheDocument();
    });

    it('calls onClose when close button is clicked', () => {
        renderPanel();
        const buttons = screen.getAllByRole('button');
        const closeButton = buttons.find(b => b.querySelector('svg.lucide-x'));
        expect(closeButton).toBeTruthy();
        fireEvent.click(closeButton!);
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('calls onMarkAllRead when "Lidas" button is clicked', () => {
        renderPanel();
        fireEvent.click(screen.getByText('Lidas'));
        expect(mockOnMarkAllRead).toHaveBeenCalled();
    });

    it('dismisses a single notification via the X button (without marking read/navigating)', () => {
        renderPanel();
        const dismissButtons = screen.getAllByLabelText('Remover notificação');
        fireEvent.click(dismissButtons[0]); // 1ª notificação (id '1')
        expect(mockOnDismiss).toHaveBeenCalledWith('1');
        expect(mockOnMarkRead).not.toHaveBeenCalled(); // stopPropagation
        expect(mockOnNavigate).not.toHaveBeenCalled();
    });

    it('calls onClearAll when "Limpar" button is clicked', () => {
        renderPanel();
        fireEvent.click(screen.getByText('Limpar'));
        expect(mockOnClearAll).toHaveBeenCalled();
    });

    it('calls onMarkRead and onNavigate when clicking a notification', () => {
        renderPanel();
        fireEvent.click(screen.getByText('Novo email'));
        expect(mockOnMarkRead).toHaveBeenCalledWith('1');
        expect(mockOnNavigate).toHaveBeenCalledWith('email', '100');
    });

    it('#1004 — oferece botão "Marcar como lida" por item não-lido (marca sem navegar)', () => {
        renderPanel();
        const markButtons = screen.getAllByRole('button', { name: /marcar .* como lida/i });
        // ids '1' e '2' estão não-lidos; a '3' está lida → 2 botões
        expect(markButtons).toHaveLength(2);
        fireEvent.click(markButtons[0]);
        expect(mockOnMarkRead).toHaveBeenCalledWith('1');
        expect(mockOnNavigate).not.toHaveBeenCalled();
    });

    it('#1004 — não renderiza botão "Marcar como lida" para item já lido', () => {
        // Apenas a notificação '3' (lida)
        renderPanel([mockNotifications[2]]);
        expect(screen.queryAllByRole('button', { name: /marcar .* como lida/i })).toHaveLength(0);
    });

    it('shows unread indicator for unread notifications', () => {
        renderPanel();
        const unreadNote = screen.getByText('Novo email').closest('.rounded-lg');
        expect(unreadNote).toHaveClass('border-l-indigo-500');
    });
});

describe('NotificationPanel — seções MINHAS x SISTEMA (#1429)', () => {
    const mockOnClose = vi.fn();
    const mockOnMarkRead = vi.fn();
    const mockOnNavigate = vi.fn();
    const mockOnClearAll = vi.fn();
    const mockOnMarkAllRead = vi.fn();
    const mockOnDismiss = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const renderPanel = (notifications: AppNotification[], currentUser: { id: string; login?: string } | null = { id: 'u1', login: 'u1' }) => {
        // O componente só consome `currentUser` do contexto; moldamos um objeto
        // parcial satisfazendo o tipo de DolibarrContextType apenas neste ponto.
        vi.mocked(useDolibarr).mockImplementation(() => ({ currentUser } as unknown as ReturnType<typeof useDolibarr>));
        return render(
            <MemoryRouter>
                <NotificationPanel
                    isOpen={true}
                    onClose={mockOnClose}
                    notifications={notifications}
                    onMarkRead={mockOnMarkRead}
                    onNavigate={mockOnNavigate}
                    onClearAll={mockOnClearAll}
                    onMarkAllRead={mockOnMarkAllRead}
                    onDismiss={mockOnDismiss}
                />
            </MemoryRouter>
        );
    };

    const personalNote = (id: string, recipient = 'u1'): AppNotification => ({
        id,
        type: 'task',
        title: `Tarefa pessoal ${id}`,
        message: 'Mensagem pessoal',
        date: Date.now() - 1000,
        read: false,
        priority: 'medium',
        recipient,
    });

    const systemNote = (id: string): AppNotification => ({
        id,
        type: 'stock',
        title: `Alerta sistema ${id}`,
        message: 'Mensagem de sistema',
        date: Date.now() - 2000,
        read: false,
        priority: 'high',
    });

    it('renderiza cabeçalhos MINHAS e SISTEMA com contagens corretas', () => {
        const notes = [
            personalNote('p1'),
            personalNote('p2'),
            personalNote('p3'),
            systemNote('s1'),
            systemNote('s2'),
        ];
        renderPanel(notes);

        expect(screen.getByRole('heading', { name: /MINHAS \(3\)/ })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /SISTEMA \(2\)/ })).toBeInTheDocument();
    });

    it('MINHAS sempre aparece ACIMA de SISTEMA no DOM', () => {
        const notes = [personalNote('p1'), systemNote('s1')];
        const { container } = renderPanel(notes);

        const personalSection = container.querySelector('section[data-scope="personal"]');
        const systemSection = container.querySelector('section[data-scope="system"]');
        expect(personalSection).not.toBeNull();
        expect(systemSection).not.toBeNull();
        // compareDocumentPosition: 4 = DOCUMENT_POSITION_FOLLOWING (system vem depois de personal)
        const pos = personalSection!.compareDocumentPosition(systemSection!);
        expect(pos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('omite totalmente a seção SISTEMA quando systemNotifs está vazio (nem cabeçalho)', () => {
        const notes = [personalNote('p1'), personalNote('p2')];
        const { container } = renderPanel(notes);

        expect(container.querySelector('section[data-scope="system"]')).toBeNull();
        expect(screen.queryByRole('heading', { name: /SISTEMA/ })).not.toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /MINHAS \(2\)/ })).toBeInTheDocument();
    });

    it('mostra placeholder "Tudo em dia!" sob MINHAS quando personalNotifs vazio mas há systemNotifs', () => {
        const notes = [systemNote('s1'), systemNote('s2')];
        renderPanel(notes);

        // O cabeçalho MINHAS continua visível (com contagem 0)
        expect(screen.getByRole('heading', { name: /MINHAS \(0\)/ })).toBeInTheDocument();
        // E o placeholder inline aparece dentro da seção MINHAS
        const personalSection = screen.getByRole('heading', { name: /MINHAS/ }).closest('section')!;
        expect(personalSection.textContent).toContain('Tudo em dia!');
    });

    it('quando ambas as seções estão vazias, mantém o estado vazio centralizado do painel', () => {
        const { container } = renderPanel([]);

        expect(container.querySelector('section[data-scope="personal"]')).toBeNull();
        expect(container.querySelector('section[data-scope="system"]')).toBeNull();
        // Empty state centralizado (preservado da implementação anterior)
        expect(screen.getByText('Tudo em dia!')).toBeInTheDocument();
    });

    it('filtro por tipo aplica ANTES da divisão por escopo', () => {
        // 1 notif pessoal tipo 'invoice' + 1 pessoal tipo 'task' + 1 sistema tipo 'invoice'
        const notes: AppNotification[] = [
            { ...personalNote('p-inv'), type: 'invoice' },
            { ...personalNote('p-task'), type: 'task' },
            { ...systemNote('s-inv'), type: 'invoice' },
        ];
        renderPanel(notes);

        // Antes do filtro: 2 pessoal + 1 sistema
        expect(screen.getByRole('heading', { name: /MINHAS \(2\)/ })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /SISTEMA \(1\)/ })).toBeInTheDocument();

        // Ativa o filtro 'Faturas' (invoice) — primeiro toggle do filtro, depois escolhe tipo
        // Nota: lucide-react v0.469+ renderiza o ícone Filter com classe "lucide-funnel"
        // (renomeação upstream). Usamos o seletor equivalente ao usado no teste de close (svg.lucide-x).
        const filterToggle = screen.getAllByRole('button').find(b => b.querySelector('svg.lucide-funnel'));
        expect(filterToggle).toBeDefined();
        fireEvent.click(filterToggle!);
        fireEvent.click(screen.getByRole('button', { name: 'Faturas' }));

        // Após filtro: 1 pessoal tipo invoice + 1 sistema tipo invoice
        expect(screen.getByRole('heading', { name: /MINHAS \(1\)/ })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /SISTEMA \(1\)/ })).toBeInTheDocument();
        expect(screen.getByText('Tarefa pessoal p-inv')).toBeInTheDocument();
        expect(screen.getByText('Alerta sistema s-inv')).toBeInTheDocument();
        // e a task pessoal some
        expect(screen.queryByText('Tarefa pessoal p-task')).not.toBeInTheDocument();
    });

    it('renderiza cada notificação dentro da seção correta com ordenação por data desc', () => {
        const oldP = { ...personalNote('old'), date: Date.now() - 5000 };
        const newP = { ...personalNote('new'), date: Date.now() - 1000 };
        const oldS = { ...systemNote('old-s'), date: Date.now() - 4000 };
        const newS = { ...systemNote('new-s'), date: Date.now() - 500 };
        renderPanel([oldP, newP, oldS, newS]);

        const personalSection = screen.getByRole('heading', { name: /MINHAS/ }).closest('section')!;
        const systemSection = screen.getByRole('heading', { name: /SISTEMA/ }).closest('section')!;

        // MINHAS: 'new' (date 1000) antes de 'old' (date 5000)
        const personalTitles = within(personalSection).getAllByRole('heading', { level: 4 })
            .filter(h => /Tarefa pessoal/.test(h.textContent || ''))
            .map(h => h.textContent);
        expect(personalTitles).toEqual(['Tarefa pessoal new', 'Tarefa pessoal old']);

        // SISTEMA: 'new-s' (date 500) antes de 'old-s' (date 4000)
        const systemTitles = within(systemSection).getAllByRole('heading', { level: 4 })
            .filter(h => /Alerta sistema/.test(h.textContent || ''))
            .map(h => h.textContent);
        expect(systemTitles).toEqual(['Alerta sistema new-s', 'Alerta sistema old-s']);
    });

    it('aciona onMarkRead ao clicar em item dentro da seção correta (mantém ações existentes)', () => {
        const p1 = { ...personalNote('p1'), title: 'Clique pessoal' };
        const s1 = { ...systemNote('s1'), title: 'Clique sistema' };
        renderPanel([p1, s1]);

        // Clica no item pessoal — espera que onMarkRead receba 'p1'
        fireEvent.click(screen.getByText('Clique pessoal'));
        expect(mockOnMarkRead).toHaveBeenCalledWith('p1');

        // Clica no item sistema — espera que onMarkRead receba 's1'
        fireEvent.click(screen.getByText('Clique sistema'));
        expect(mockOnMarkRead).toHaveBeenCalledWith('s1');
    });
});