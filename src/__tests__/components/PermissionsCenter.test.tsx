/**
 * Testes para PermissionsCenter — classes Tailwind estáticas por tema (#1100)
 *
 * Garante que nenhuma classe Tailwind é montada em runtime via template string
 * (o scanner JIT do Tailwind v4 não detecta `bg-${themeColor}-50`), e que as
 * abas/controles ativos exibem a cor correta de tema.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// --- Mocks hoisted ---
const mockSvc = vi.hoisted(() => ({
    fetchUsers: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../services/dolibarrService', () => ({ DolibarrService: mockSvc }));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({
        config: { themeColor: 'indigo' },
        currentUser: { id: 'u1', admin: 1 },
    })),
}));

// Stub de filhos pesados (não são foco deste teste)
vi.mock('../../components/admin/ScreenAccessMatrix', () => ({
    ScreenAccessMatrix: () => <div data-testid="screen-access-matrix" />,
}));
vi.mock('../../components/admin/UserPermissionsEditor', () => ({
    UserPermissionsEditor: ({ userId }: { userId: string }) => (
        <div data-testid="user-permissions-editor">{userId}</div>
    ),
}));
vi.mock('../../components/admin/AuditLog', () => ({
    AuditLog: () => <div data-testid="audit-log" />,
}));
vi.mock('../../components/admin/AppAccessTab', () => ({
    AppAccessTab: () => <div data-testid="app-access-tab" />,
}));
vi.mock('../../components/admin/GroupManager', () => ({
    __esModule: true,
    default: () => <div data-testid="group-manager" />,
}));
vi.mock('../../components/ui', () => ({
    Spinner: () => <div data-testid="spinner" />,
}));

import PermissionsCenter, {
    TAB_ACTIVE_CLASSES,
    PERSON_ACTIVE_CLASSES,
    ICON_TEXT600_CLASSES,
} from '../../components/admin/PermissionsCenter';
import { ThemeColor } from '../../utils/theme';
import { useDolibarr } from '../../context/DolibarrContext';

const ALL_COLORS: ThemeColor[] = [
    'slate', 'gray', 'zinc', 'neutral', 'stone',
    'red', 'orange', 'amber', 'yellow', 'lime',
    'green', 'emerald', 'teal', 'cyan', 'sky',
    'blue', 'indigo', 'violet', 'purple', 'fuchsia',
    'pink', 'rose',
];

// ---------------------------------------------------------------------------
// 1) Mapas estáticos: completude, literalidade e corretude por chave
// ---------------------------------------------------------------------------
describe('PermissionsCenter — mapas estáticos de tema (#1100)', () => {
    describe('TAB_ACTIVE_CLASSES (aba ativa)', () => {
        it('contém todas as 22 cores de ThemeColor', () => {
            ALL_COLORS.forEach((c) => expect(TAB_ACTIVE_CLASSES[c]).toBeDefined());
            expect(Object.keys(TAB_ACTIVE_CLASSES).sort()).toEqual([...ALL_COLORS].sort());
        });

        it('lista apenas classes literais (sem interpolação em runtime)', () => {
            Object.values(TAB_ACTIVE_CLASSES).forEach((v) => expect(v).not.toContain('${'));
        });

        it('referencia a própria cor em cada valor (border + text light/dark)', () => {
            ALL_COLORS.forEach((c) => {
                expect(TAB_ACTIVE_CLASSES[c]).toContain(`border-${c}-500`);
                expect(TAB_ACTIVE_CLASSES[c]).toContain(`text-${c}-600`);
                expect(TAB_ACTIVE_CLASSES[c]).toContain(`dark:text-${c}-400`);
            });
        });

        it('valores de amostra estão exatos', () => {
            expect(TAB_ACTIVE_CLASSES.indigo).toBe('border-indigo-500 text-indigo-600 dark:text-indigo-400');
            expect(TAB_ACTIVE_CLASSES.emerald).toBe('border-emerald-500 text-emerald-600 dark:text-emerald-400');
        });
    });

    describe('PERSON_ACTIVE_CLASSES (pessoa selecionada)', () => {
        it('contém todas as 22 cores de ThemeColor', () => {
            ALL_COLORS.forEach((c) => expect(PERSON_ACTIVE_CLASSES[c]).toBeDefined());
            expect(Object.keys(PERSON_ACTIVE_CLASSES).sort()).toEqual([...ALL_COLORS].sort());
        });

        it('lista apenas classes literais (sem interpolação em runtime)', () => {
            Object.values(PERSON_ACTIVE_CLASSES).forEach((v) => expect(v).not.toContain('${'));
        });

        it('referencia a própria cor em cada valor (bg + text light/dark)', () => {
            ALL_COLORS.forEach((c) => {
                expect(PERSON_ACTIVE_CLASSES[c]).toContain(`bg-${c}-50`);
                expect(PERSON_ACTIVE_CLASSES[c]).toContain(`dark:bg-${c}-900/30`);
                expect(PERSON_ACTIVE_CLASSES[c]).toContain(`text-${c}-700`);
                expect(PERSON_ACTIVE_CLASSES[c]).toContain(`dark:text-${c}-300`);
            });
        });

        it('valor de amostra está exato', () => {
            expect(PERSON_ACTIVE_CLASSES.indigo).toBe('bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300');
        });
    });

    describe('ICON_TEXT600_CLASSES (ícone)', () => {
        it('contém todas as 22 cores de ThemeColor', () => {
            ALL_COLORS.forEach((c) => expect(ICON_TEXT600_CLASSES[c]).toBeDefined());
            expect(Object.keys(ICON_TEXT600_CLASSES).sort()).toEqual([...ALL_COLORS].sort());
        });

        it('lista apenas classes literais (sem interpolação em runtime)', () => {
            Object.values(ICON_TEXT600_CLASSES).forEach((v) => expect(v).not.toContain('${'));
        });

        it('referencia a própria cor em cada valor (text-600)', () => {
            ALL_COLORS.forEach((c) => expect(ICON_TEXT600_CLASSES[c]).toBe(`text-${c}-600`));
        });
    });
});

// ---------------------------------------------------------------------------
// 2) Render: cores de tema aplicadas em runtime (aba, ícone, pessoa, fallback)
// ---------------------------------------------------------------------------
describe('PermissionsCenter (#1100) — cores de tema em runtime', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSvc.fetchUsers.mockResolvedValue([]);
        vi.mocked(useDolibarr).mockReturnValue({
            config: { themeColor: 'indigo' },
            currentUser: { id: 'u1', admin: 1 },
        } as any);
    });

    const tabBtnByText = (label: string): HTMLElement =>
        screen.getByText(label).closest('button') as HTMLElement;

    const renderView = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

    it('a aba ativa e o ícone usam a cor de tema configurada (emerald)', () => {
        vi.mocked(useDolibarr).mockReturnValue({
            config: { themeColor: 'emerald' },
            currentUser: { id: 'u1', admin: 1 },
        } as any);

        renderView(<PermissionsCenter />);

        // Aba "Telas (Ver)" é a ativa por padrão
        const activeTab = tabBtnByText('Telas (Ver)');
        expect(activeTab.className).toContain('border-emerald-500');
        expect(activeTab.className).toContain('text-emerald-600');
        expect(activeTab.className).toContain('dark:text-emerald-400');

        // Ícone ShieldCheck no cabeçalho
        const heading = screen.getByText('Central de Permissões');
        const icon = heading.parentElement!.querySelector('svg')!;
        expect(icon.getAttribute('class')).toContain('text-emerald-600');
    });

    it('trocar de aba move as classes ativas para a nova aba', () => {
        vi.mocked(useDolibarr).mockReturnValue({
            config: { themeColor: 'rose' },
            currentUser: { id: 'u1', admin: 1 },
        } as any);

        renderView(<PermissionsCenter />);

        const screensTab = tabBtnByText('Telas (Ver)');
        const auditTab = tabBtnByText('Auditoria');

        // Inicialmente "Telas" está ativa
        expect(screensTab.className).toContain('border-rose-500');
        expect(auditTab.className).not.toContain('border-rose-500');

        fireEvent.click(auditTab);

        // Após o clique, "Auditoria" passa a ter as classes ativas
        const auditTabAfter = tabBtnByText('Auditoria');
        const screensTabAfter = tabBtnByText('Telas (Ver)');
        expect(auditTabAfter.className).toContain('border-rose-500');
        expect(auditTabAfter.className).toContain('text-rose-600');
        expect(screensTabAfter.className).not.toContain('border-rose-500');
    });

    it('cor de tema desconhecida cai no fallback indigo (aba + ícone)', () => {
        vi.mocked(useDolibarr).mockReturnValue({
            config: { themeColor: 'cor-que-nao-existe' },
            currentUser: { id: 'u1', admin: 1 },
        } as any);

        renderView(<PermissionsCenter />);

        const activeTab = tabBtnByText('Telas (Ver)');
        expect(activeTab.className).toContain('border-indigo-500');
        expect(activeTab.className).toContain('text-indigo-600');

        const heading = screen.getByText('Central de Permissões');
        const icon = heading.parentElement!.querySelector('svg')!;
        expect(icon.getAttribute('class')).toContain('text-indigo-600');
    });

    it('a pessoa selecionada na aba Agente recebe as classes ativas do tema (blue)', async () => {
        vi.mocked(useDolibarr).mockReturnValue({
            config: { themeColor: 'blue' },
            currentUser: { id: 'u1', admin: 1 },
        } as any);
        mockSvc.fetchUsers.mockResolvedValue([
            { id: '1', login: 'alice', statut: '1' },
            { id: '2', login: 'bob', statut: '1' },
        ]);

        renderView(<PermissionsCenter />);

        // Abrir aba Agente
        fireEvent.click(tabBtnByText('Agente'));

        // Esperar a lista de pessoas carregar
        const alice = await screen.findByText('alice');
        await screen.findByText('bob');

        // Antes da seleção: nenhuma pessoa com classe ativa
        expect(alice.closest('button')!.className).not.toContain('bg-blue-50');

        // Selecionar alice
        fireEvent.click(alice);

        // alice passa a ter as classes ativas (bg + text + font-medium)
        const aliceBtn = screen.getByText('alice').closest('button')!;
        expect(aliceBtn.className).toContain('bg-blue-50');
        expect(aliceBtn.className).toContain('dark:bg-blue-900/30');
        expect(aliceBtn.className).toContain('text-blue-700');
        expect(aliceBtn.className).toContain('dark:text-blue-300');
        expect(aliceBtn.className).toContain('font-medium');

        // bob permanece inativo
        const bobBtn = screen.getByText('bob').closest('button')!;
        expect(bobBtn.className).not.toContain('bg-blue-50');
    });

    it('usuário não-admin não renderiza o painel de permissões', () => {
        vi.mocked(useDolibarr).mockReturnValue({
            config: { themeColor: 'indigo' },
            currentUser: { id: 'u2', admin: 0 },
        } as any);

        renderView(<PermissionsCenter />);
        expect(screen.queryByText('Central de Permissões')).not.toBeInTheDocument();
    });
});
