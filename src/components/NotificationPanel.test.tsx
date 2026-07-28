import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NotificationPanel from './NotificationPanel';
import { AppNotification, AppView } from '../types';
import { useDolibarr } from '../context/DolibarrContext';
import { classifyScope } from '../utils/notificationScope';

// #1429 — Mock do contexto Dolibarr. NotificationPanel usa useDolibarr() para obter
// o currentUser e particionar notificações em MINHAS × SISTEMA via classifyScope.
// Mantemos um userId padrão ('u1') para que os testes legados (que não se importam
// com escopo) continuem determinísticos — todos caem no ramo 'system' (sem recipient).
vi.mock('../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({
        currentUser: { id: 'u1', login: 'u1' },
    })),
}));

vi.mock('../utils/dateUtils', () => ({
    formatTime: vi.fn((date: number) => {
        const d = new Date(date);
        return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    })
}));

// #1431 — Mock do util compartilhado de classificação de escopo. Embrulha
// a implementação real com um `vi.fn` (spy) para que possamos:
//   (a) preservar o comportamento atual em todos os testes já existentes
//       (o spy delega para a implementação real via vi.importActual);
//   (b) asserir nos novos testes de fallback que o componente importa
//       `classifyScope` do util compartilhado '../utils/notificationScope'
//       e o chama com (notification, userId) esperada.
//
// Movido para o top-level do módulo (em vez de dentro de describe) para
// silenciar o warning do Vitest sobre hoisting e refletir a ordem real
// de execução. vi.importActual preserva os demais exports do módulo.
vi.mock('../utils/notificationScope', async () => {
    const actual = await vi.importActual<typeof import('../utils/notificationScope')>(
        '../utils/notificationScope'
    );
    return {
        ...actual,
        classifyScope: vi.fn(actual.classifyScope),
    };
});

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

describe('NotificationPanel — colapso da seção SISTEMA (#1430)', () => {
    const mockOnClose = vi.fn();
    const mockOnMarkRead = vi.fn();
    const mockOnNavigate = vi.fn();
    const mockOnClearAll = vi.fn();
    const mockOnMarkAllRead = vi.fn();
    const mockOnDismiss = vi.fn();

    const STORAGE_KEY = 'notif_system_collapsed';

    beforeEach(() => {
        vi.clearAllMocks();
        // Garante estado limpo entre testes (o mock em setup.ts mantém store entre specs).
        localStorage.removeItem(STORAGE_KEY);
    });

    const renderPanel = (notifications: AppNotification[], currentUser: { id: string; login?: string } | null = { id: 'u1', login: 'u1' }) => {
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

    const personalNote = (id: string): AppNotification => ({
        id,
        type: 'task',
        title: `Tarefa pessoal ${id}`,
        message: 'Mensagem pessoal',
        date: Date.now() - 1000,
        read: false,
        priority: 'medium',
        recipient: 'u1',
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

    it('renderiza o botão toggle [ocultar] quando a seção SISTEMA está expandida', () => {
        renderPanel([personalNote('p1'), systemNote('s1')]);

        const toggle = screen.getByRole('button', { name: '[ocultar]' });
        expect(toggle).toBeInTheDocument();
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(toggle).toHaveAttribute('aria-controls', 'notif-system-section');
    });

    it('renderiza o botão toggle [mostrar] quando a seção SISTEMA inicia colapsada (localStorage=true)', () => {
        localStorage.setItem(STORAGE_KEY, 'true');
        renderPanel([personalNote('p1'), systemNote('s1')]);

        const toggle = screen.getByRole('button', { name: '[mostrar]' });
        expect(toggle).toBeInTheDocument();
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });

    it('clicar em [ocultar] esconde os itens de SISTEMA mas mantém cabeçalho e contagem visíveis', () => {
        renderPanel([personalNote('p1'), systemNote('s1'), systemNote('s2')]);

        // Estado inicial: itens presentes
        expect(screen.getByText('Alerta sistema s1')).toBeInTheDocument();
        expect(screen.getByText('Alerta sistema s2')).toBeInTheDocument();
        // Cabeçalho com contagem
        expect(screen.getByRole('heading', { name: /SISTEMA \(2\)/ })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: '[ocultar]' }));

        // Itens somem
        expect(screen.queryByText('Alerta sistema s1')).not.toBeInTheDocument();
        expect(screen.queryByText('Alerta sistema s2')).not.toBeInTheDocument();
        // Cabeçalho permanece visível (com a mesma contagem) — usuário pode reabrir
        expect(screen.getByRole('heading', { name: /SISTEMA \(2\)/ })).toBeInTheDocument();
        // Botão agora mostra [mostrar]
        expect(screen.getByRole('button', { name: '[mostrar]' })).toBeInTheDocument();
        // MINHAS não é afetada
        expect(screen.getByText('Tarefa pessoal p1')).toBeInTheDocument();
    });

    it('clicar em [mostrar] traz os itens de SISTEMA de volta', () => {
        localStorage.setItem(STORAGE_KEY, 'true');
        renderPanel([personalNote('p1'), systemNote('s1'), systemNote('s2')]);

        // Pré-condição colapsada
        expect(screen.queryByText('Alerta sistema s1')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: '[mostrar]' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: '[mostrar]' }));

        // Itens voltam
        expect(screen.getByText('Alerta sistema s1')).toBeInTheDocument();
        expect(screen.getByText('Alerta sistema s2')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '[ocultar]' })).toBeInTheDocument();
        expect(localStorage.getItem(STORAGE_KEY)).toBe('false');
    });

    it('persiste o estado em localStorage a cada toggle (chave notif_system_collapsed)', () => {
        const { unmount } = renderPanel([personalNote('p1'), systemNote('s1')]);

        // Inicial: nada salvo
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: '[ocultar]' }));
        expect(localStorage.getItem(STORAGE_KEY)).toBe('true');

        fireEvent.click(screen.getByRole('button', { name: '[mostrar]' }));
        expect(localStorage.getItem(STORAGE_KEY)).toBe('false');

        unmount();
    });

    it('persiste entre remounts (simula fechar/reabrir dropdown via localStorage)', () => {
        // Primeira montagem: usuário colapsa
        const first = renderPanel([personalNote('p1'), systemNote('s1')]);
        fireEvent.click(first.getByRole('button', { name: '[ocultar]' }));
        expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
        first.unmount();

        // Segunda montagem: deve iniciar colapsado por causa do localStorage
        const second = renderPanel([personalNote('p1'), systemNote('s1')]);
        expect(second.queryByText('Alerta sistema s1')).toBeNull();
        expect(second.getByRole('button', { name: '[mostrar]' })).toBeInTheDocument();
        // Cabeçalho segue visível com contagem
        expect(second.getByRole('heading', { name: /SISTEMA \(1\)/ })).toBeInTheDocument();
        second.unmount();
    });

    it('atributos ARIA: seção SISTEMA com id="notif-system-section" e aria-labelledby apontando ao cabeçalho', () => {
        const { container } = renderPanel([personalNote('p1'), systemNote('s1')]);

        const section = container.querySelector('section[data-scope="system"]');
        expect(section).not.toBeNull();
        expect(section!.id).toBe('notif-system-section');
        expect(section!.getAttribute('aria-labelledby')).toBe('notification-panel-system-heading');

        // E o cabeçalho alvo deve existir dentro da seção
        const heading = section!.querySelector('#notification-panel-system-heading');
        expect(heading).not.toBeNull();
    });

    it('MINHAS não tem toggle de colapso (regra do escopo)', () => {
        const { container } = renderPanel([personalNote('p1'), systemNote('s1')]);

        const personalSection = container.querySelector('section[data-scope="personal"]');
        expect(personalSection).not.toBeNull();
        // Nenhum botão com aria-controls para 'notif-system-section' dentro de MINHAS
        const collapseButtonsInsidePersonal = personalSection!.querySelectorAll(
            'button[aria-controls="notif-system-section"]'
        );
        expect(collapseButtonsInsidePersonal).toHaveLength(0);
    });

    it('se SISTEMA está vazia, a seção some por inteiro (regra do #1429) — sem botão de toggle', () => {
        const { container } = renderPanel([personalNote('p1')]);

        expect(container.querySelector('section[data-scope="system"]')).toBeNull();
        expect(
            container.querySelector('button[aria-controls="notif-system-section"]')
        ).toBeNull();
    });
});

// =============================================================================
// #1431 — Cobertura dedicada dos 3 subcasos de "estados vazios" da issue.
// Describe isolado para reprodutibilidade de falha e aderência direta à spec.
// =============================================================================

describe('NotificationPanel — estados vazios (#1431)', () => {
    const mockOnClose = vi.fn();
    const mockOnMarkRead = vi.fn();
    const mockOnNavigate = vi.fn();
    const mockOnClearAll = vi.fn();
    const mockOnMarkAllRead = vi.fn();
    const mockOnDismiss = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useDolibarr).mockImplementation(
            () => ({ currentUser: { id: 'u1', login: 'u1' } } as unknown as ReturnType<typeof useDolibarr>)
        );
        localStorage.removeItem('notif_system_collapsed');
    });

    const renderPanel = (notifications: AppNotification[]) =>
        render(
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

    const personalNote = (id: string): AppNotification => ({
        id,
        type: 'task',
        title: `Tarefa pessoal ${id}`,
        message: 'm',
        date: Date.now() - 1000,
        read: false,
        priority: 'medium',
        recipient: 'u1',
    });

    const systemNote = (id: string): AppNotification => ({
        id,
        type: 'stock',
        title: `Alerta sistema ${id}`,
        message: 'm',
        date: Date.now() - 2000,
        read: false,
        priority: 'high',
    });

    it('5a — só pessoais: cabeçalho SISTEMA não aparece (nem cabeçalho, nem seção)', () => {
        renderPanel([personalNote('p1'), personalNote('p2')]);

        // MINHAS aparece com a contagem correta.
        expect(screen.getByRole('heading', { name: /MINHAS \(2\)/ })).toBeInTheDocument();
        // SISTEMA some por completo.
        expect(screen.queryByRole('heading', { name: /SISTEMA/ })).not.toBeInTheDocument();
    });

    it('5b — só sistema: cabeçalho MINHAS com placeholder "Tudo em dia!"', () => {
        renderPanel([systemNote('s1'), systemNote('s2')]);

        // MINHAS permanece visível com contagem 0 e placeholder inline.
        expect(screen.getByRole('heading', { name: /MINHAS \(0\)/ })).toBeInTheDocument();
        const personalSection = screen.getByRole('heading', { name: /MINHAS/ }).closest('section')!;
        expect(personalSection.textContent).toContain('Tudo em dia!');
        // SISTEMA aparece normalmente.
        expect(screen.getByRole('heading', { name: /SISTEMA \(2\)/ })).toBeInTheDocument();
    });

    it('5c — ambas vazias: empty state global renderiza (sem seções, com placeholder central)', () => {
        const { container } = renderPanel([]);

        // Nenhuma das duas seções chega a ser renderizada.
        expect(container.querySelector('section[data-scope="personal"]')).toBeNull();
        expect(container.querySelector('section[data-scope="system"]')).toBeNull();
        // E o empty state centralizado do painel aparece.
        expect(screen.getByText('Tudo em dia!')).toBeInTheDocument();
    });
});

// =============================================================================
// Cobertura da issue #1431 — adiciona cenários dos 6 grupos da especificação
// sem remover/alterar nenhuma das suítes anteriores (regra de preservação).
// =============================================================================

describe('NotificationPanel — cobertura #1431 (issue)', () => {
    const mockOnClose = vi.fn();
    const mockOnMarkRead = vi.fn();
    const mockOnNavigate = vi.fn();
    const mockOnClearAll = vi.fn();
    const mockOnMarkAllRead = vi.fn();
    const mockOnDismiss = vi.fn();
    const STORAGE_KEY = 'notif_system_collapsed';

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useDolibarr).mockImplementation(
            () => ({ currentUser: { id: 'u1', login: 'u1' } } as unknown as ReturnType<typeof useDolibarr>)
        );
        // Reset do localStorage mockado para que cada teste parta do estado limpo
        // (o mock em setup.ts mantém a store entre specs).
        localStorage.removeItem(STORAGE_KEY);
    });

    const renderPanel = (notifications: AppNotification[]) =>
        render(
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

    const personalNote = (id: string, type: AppNotification['type'] = 'task', recipient = 'u1'): AppNotification => ({
        id,
        type,
        title: `Pessoal ${id}`,
        message: 'm',
        date: Date.now() - 1000,
        read: false,
        priority: 'medium',
        recipient,
    });

    const systemNote = (id: string, type: AppNotification['type'] = 'stock'): AppNotification => ({
        id,
        type,
        title: `Sistema ${id}`,
        message: 'm',
        date: Date.now() - 2000,
        read: false,
        priority: 'high',
    });

    // Helper: conta quantos títulos de notificação (h4 com classe font-semibold)
    // estão dentro de uma seção. Como o componente renderiza os itens inline
    // (não há <NotificationItem> como subcomponente), contamos via DOM.
    const countTitlesInSection = (container: HTMLElement, scope: 'personal' | 'system'): number => {
        const section = container.querySelector(`section[data-scope="${scope}"]`);
        if (!section) return 0;
        return section.querySelectorAll('h4.text-sm.font-semibold').length;
    };

    // -----------------------------------------------------------------------------
    // Critério 1 — Ordem: primeiro item visível é pessoal; último é de sistema.
    // -----------------------------------------------------------------------------
    it('ordem global: primeiro item visível é pessoal, último item visível é de sistema', () => {
        // Datas garantem que P1 é o mais recente (1º) e S2 é o mais antigo dentro
        // de SISTEMA. P2 mais antigo que P1; S1 mais novo que S2.
        const notes: AppNotification[] = [
            { ...personalNote('P1', 'task'), date: 5_000 },
            { ...personalNote('P2', 'task'), date: 4_000 },
            { ...systemNote('S1', 'stock'), date: 3_000 },
            { ...systemNote('S2', 'stock'), date: 2_000 },
        ];
        const { container } = renderPanel(notes);

        const personalSection = container.querySelector('section[data-scope="personal"]')!;
        const systemSection = container.querySelector('section[data-scope="system"]')!;

        // Primeiro h4 (item) na seção pessoal vem antes do primeiro h4 em sistema.
        const firstPersonalTitle = personalSection.querySelector('h4.text-sm.font-semibold')!;
        const firstSystemTitle = systemSection.querySelector('h4.text-sm.font-semibold')!;
        // DOCUMENT_POSITION_FOLLOWING = 4 → firstSystemTitle vem depois de firstPersonalTitle.
        expect(
            firstPersonalTitle.compareDocumentPosition(firstSystemTitle) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();

        // E a ordem por data desc dentro de cada seção: P1 (5000) > P2 (4000); S1 (3000) > S2 (2000).
        const personalTitles = Array.from(personalSection.querySelectorAll('h4.text-sm.font-semibold'))
            .map(h => h.textContent);
        const systemTitles = Array.from(systemSection.querySelectorAll('h4.text-sm.font-semibold'))
            .map(h => h.textContent);
        expect(personalTitles).toEqual(['Pessoal P1', 'Pessoal P2']);
        expect(systemTitles).toEqual(['Sistema S1', 'Sistema S2']);

        // "Primeiro item visível" = primeiro título pessoal; "último item visível" = último título sistema.
        expect(firstPersonalTitle.textContent).toBe('Pessoal P1');
        const lastSystemTitle = systemSection.querySelectorAll('h4.text-sm.font-semibold');
        expect(lastSystemTitle[lastSystemTitle.length - 1].textContent).toBe('Sistema S2');
    });

    // -----------------------------------------------------------------------------
    // Critério 2 — Contagens: MINHAS (N) e SISTEMA (N) corretas.
    // (Cobertura legada já existente; este teste reforça com cenário misto real.)
    // -----------------------------------------------------------------------------
    it('contagens: cabeçalhos MINHAS (N) e SISTEMA (N) refletem o particionamento por escopo', () => {
        const notes = [
            personalNote('p1'),
            personalNote('p2'),
            personalNote('p3'),
            personalNote('p4'),
            systemNote('s1'),
            systemNote('s2'),
        ];
        renderPanel(notes);

        expect(screen.getByRole('heading', { name: /MINHAS \(4\)/ })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /SISTEMA \(2\)/ })).toBeInTheDocument();
    });

    // -----------------------------------------------------------------------------
    // Critério 3 — Colapso: pré-set localStorage='true' → seção SISTEMA renderiza
    // só o cabeçalho (sem itens); expandir mostra os itens; após toggle, localStorage
    // é atualizado.
    // -----------------------------------------------------------------------------
    it('colapso: localStorage pré-setado =true → seção SISTEMA sem itens, só cabeçalho', () => {
        localStorage.setItem(STORAGE_KEY, 'true');
        const { container } = renderPanel([
            personalNote('p1'),
            systemNote('s1'),
            systemNote('s2'),
        ]);

        const systemSection = container.querySelector('section[data-scope="system"]')!;
        expect(systemSection).not.toBeNull();

        // Sem itens: nenhum h4 de título de notificação dentro da seção.
        expect(countTitlesInSection(container, 'system')).toBe(0);

        // Cabeçalho segue visível com contagem e botão [mostrar] (aria-expanded=false).
        expect(screen.getByRole('heading', { name: /SISTEMA \(2\)/ })).toBeInTheDocument();
        const toggle = screen.getByRole('button', { name: '[mostrar]' });
        expect(toggle).toBeInTheDocument();
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });

    it('colapso: expandir via toggle revela os itens de SISTEMA', () => {
        localStorage.setItem(STORAGE_KEY, 'true');
        const { container } = renderPanel([
            personalNote('p1'),
            systemNote('s1'),
            systemNote('s2'),
        ]);

        // Pré-condição: sem itens
        expect(countTitlesInSection(container, 'system')).toBe(0);

        fireEvent.click(screen.getByRole('button', { name: '[mostrar]' }));

        // Após expandir: ambos os itens aparecem
        expect(screen.getByText('Sistema s1')).toBeInTheDocument();
        expect(screen.getByText('Sistema s2')).toBeInTheDocument();
        expect(countTitlesInSection(container, 'system')).toBe(2);
    });

    it('colapso: cada toggle atualiza localStorage (true → false → true)', () => {
        renderPanel([personalNote('p1'), systemNote('s1')]);
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: '[ocultar]' }));
        expect(localStorage.getItem(STORAGE_KEY)).toBe('true');

        fireEvent.click(screen.getByRole('button', { name: '[mostrar]' }));
        expect(localStorage.getItem(STORAGE_KEY)).toBe('false');

        fireEvent.click(screen.getByRole('button', { name: '[ocultar]' }));
        expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
    });

    // -----------------------------------------------------------------------------
    // Critério 4 — classifyScope fallback: sem `scope`, recipient === userId → personal;
    // sem `scope`, recipient !== userId → system.
    //
    // Estes testes exercitam o ramo de FALLBACK do util compartilhado (regression
    // guard: se alguém remover o fallback por recipient, estes testes quebram).
    // -----------------------------------------------------------------------------
    it('classifyScope fallback: AppNotification SEM scope, recipient === userId → vai para MINHAS', () => {
        // Montamos uma nota SEM campo `scope` (não setado) com recipient casando
        // com o userId do currentUser ('u1'). Deve cair em personal via fallback.
        const noteWithoutScope: AppNotification = {
            id: 'np1',
            type: 'invoice',
            title: 'Nota sem scope, recipient=u1',
            message: 'm',
            date: Date.now() - 1000,
            read: false,
            priority: 'medium',
            recipient: 'u1',
            // scope explicitamente ausente (undefined)
        };
        expect(noteWithoutScope.scope).toBeUndefined();

        renderPanel([noteWithoutScope]);

        // Aparece em MINHAS (e SISTEMA some, pois não há itens de sistema).
        expect(screen.getByRole('heading', { name: /MINHAS \(1\)/ })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: /SISTEMA/ })).not.toBeInTheDocument();
        expect(screen.getByText('Nota sem scope, recipient=u1')).toBeInTheDocument();
    });

    it('classifyScope fallback: AppNotification SEM scope, recipient !== userId → vai para SISTEMA', () => {
        // Mesma nota mas com recipient diferente do userId do currentUser ('u1').
        // Sem scope definido → fallback por recipient → 'system' (recipient não casa).
        const noteWithoutScope: AppNotification = {
            id: 'np2',
            type: 'invoice',
            title: 'Nota sem scope, recipient=outro',
            message: 'm',
            date: Date.now() - 1000,
            read: false,
            priority: 'medium',
            recipient: 'outro-user',
            // scope explicitamente ausente
        };
        expect(noteWithoutScope.scope).toBeUndefined();

        renderPanel([noteWithoutScope]);

        // Aparece em SISTEMA (e MINHAS mostra placeholder "Tudo em dia!").
        expect(screen.getByRole('heading', { name: /SISTEMA \(1\)/ })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /MINHAS \(0\)/ })).toBeInTheDocument();
        const personalSection = screen.getByRole('heading', { name: /MINHAS/ }).closest('section')!;
        expect(personalSection.textContent).toContain('Tudo em dia!');
        expect(screen.getByText('Nota sem scope, recipient=outro')).toBeInTheDocument();
    });

    // -----------------------------------------------------------------------------
    // Critério 6 — Filtro por tipo: alternar "Tickets" deve mostrar apenas itens
    // pessoal E de sistema do tipo 'ticket'.
    // -----------------------------------------------------------------------------
    it('filtro "Tickets": apenas itens pessoal e de sistema do tipo ticket aparecem', () => {
        const notes: AppNotification[] = [
            { ...personalNote('p-tk', 'ticket'), title: 'Ticket pessoal' },
            { ...personalNote('p-inv', 'invoice'), title: 'Fatura pessoal' },
            { ...personalNote('p-stk', 'stock'), title: 'Estoque pessoal' },
            { ...systemNote('s-tk', 'ticket'), title: 'Ticket sistema' },
            { ...systemNote('s-inv', 'invoice'), title: 'Fatura sistema' },
            { ...systemNote('s-stk', 'stock'), title: 'Estoque sistema' },
        ];
        renderPanel(notes);

        // Antes do filtro: 3 pessoal + 3 sistema
        expect(screen.getByRole('heading', { name: /MINHAS \(3\)/ })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /SISTEMA \(3\)/ })).toBeInTheDocument();

        // Abre o filtro e seleciona "Tickets"
        const filterToggle = screen.getAllByRole('button')
            .find(b => b.querySelector('svg.lucide-funnel'));
        expect(filterToggle).toBeDefined();
        fireEvent.click(filterToggle!);
        fireEvent.click(screen.getByRole('button', { name: 'Tickets' }));

        // Após filtro: 1 pessoal-ticket + 1 sistema-ticket
        expect(screen.getByRole('heading', { name: /MINHAS \(1\)/ })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /SISTEMA \(1\)/ })).toBeInTheDocument();

        // Itens ticket (pessoal E de sistema) aparecem
        expect(screen.getByText('Ticket pessoal')).toBeInTheDocument();
        expect(screen.getByText('Ticket sistema')).toBeInTheDocument();

        // Os outros somem (filtro aplicado ANTES do particionamento por escopo).
        expect(screen.queryByText('Fatura pessoal')).not.toBeInTheDocument();
        expect(screen.queryByText('Estoque pessoal')).not.toBeInTheDocument();
        expect(screen.queryByText('Fatura sistema')).not.toBeInTheDocument();
        expect(screen.queryByText('Estoque sistema')).not.toBeInTheDocument();
    });

    // -----------------------------------------------------------------------------
    // Critério extra — `classifyScope` é importado do util compartilhado.
    // Verificamos via spy do módulo (vi.mock no top-level do arquivo) que o
    // componente CONSOME o export de '../utils/notificationScope'. Se alguém
    // trocar por uma implementação inline (e remover a importação), este teste
    // quebra — porque o spy pararia de ser chamado.
    // -----------------------------------------------------------------------------
    describe('classifyScope é importado do util compartilhado (mock do módulo)', () => {
        // O vi.mock('../utils/notificationScope') é declarado no top-level
        // do arquivo (junto dos outros mocks). Aqui só inspecionamos o spy
        // através do binding de import ESM normal — sem require dinâmico,
        // que não funciona em modo ESM do Vitest.
        const classifyScopeMock = vi.mocked(classifyScope);

        beforeEach(() => {
            classifyScopeMock.mockClear();
        });

        it('classifyScope do util compartilhado é invocado durante o particionamento por escopo', () => {
            const notes = [
                personalNote('p1'),
                systemNote('s1'),
            ];
            renderPanel(notes);

            // O componente particionou usando o util spy: ambos os cabeçalhos visíveis com N corretos.
            expect(screen.getByRole('heading', { name: /MINHAS \(1\)/ })).toBeInTheDocument();
            expect(screen.getByRole('heading', { name: /SISTEMA \(1\)/ })).toBeInTheDocument();

            // O spy foi invocado pelo menos uma vez por nota.
            expect(classifyScopeMock).toHaveBeenCalled();
            expect(classifyScopeMock.mock.calls.length).toBeGreaterThanOrEqual(notes.length);

            // E a chamada foi com a (notification, userId) esperada — evidência de
            // que o componente importa do util compartilhado e delega o trabalho.
            const firstCallArgs = classifyScopeMock.mock.calls[0];
            expect(firstCallArgs[0]).toBeDefined();
            // userId passado como segundo argumento bate com o currentUser.id do mock do contexto.
            expect(firstCallArgs[1]).toBe('u1');
        });
    });
});
