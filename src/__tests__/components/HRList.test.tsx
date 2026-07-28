import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HRList from '../../components/HRList';
import { ConfirmProvider } from '../../hooks/useConfirm';
import * as HRAdmin from '../../services/api/hrAdmin';
import { useDolibarr } from '../../context/DolibarrContext';
import * as CoreApi from '../../services/api/core';

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({
        config: {
            apiUrl: 'http://test/api',
            apiKey: 'key',
            themeColor: 'indigo',
            darkMode: false,
        },
        currentUser: { id: 'u1', login: 'admin' },
        // #1416 — canDo default permissive (igual ao admin real) p/ os testes
        // existentes não quebrarem. Os testes de gating sobrescrevem esse mock.
        canDo: vi.fn(() => true),
    })),
}));

const mockUsers = [
    { id: 'u1', login: 'admin', firstname: 'Admin', lastname: 'User', statut: '1' },
];
const mockGroups = [
    { id: 'g1', name: 'Group One', note: 'Test' },
];

vi.mock('../../hooks/dolibarr', () => ({
    useUsers: vi.fn(() => ({ data: mockUsers })),
    useExpenseReports: vi.fn(() => ({ data: [] })),
    useLeaveRequests: vi.fn(() => ({ data: [] })),
    useJobPositions: vi.fn(() => ({ data: [] })),
    useCandidates: vi.fn(() => ({ data: [] })),
    useTasks: vi.fn(() => ({ data: [] })),
    useTickets: vi.fn(() => ({ data: [] })),
    useProjects: vi.fn(() => ({ data: [] })),
    useGroups: vi.fn(() => ({ data: mockGroups })),
    useExpenseReportLines: vi.fn(() => ({ data: [] })),
    useExpenseReportPayments: vi.fn(() => ({ data: [] })),
}));

vi.mock('../../hooks/usePrefill', () => ({
    usePrefill: vi.fn(() => null),
}));

vi.mock('../../services/api/hrAdmin', () => ({
    deleteGroup: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/api/core', () => ({
    deleteUser: vi.fn().mockResolvedValue(undefined),
}));

// Mock GroupsTab with a visible delete button
vi.mock('../../components/HR/tabs/GroupsTab', () => ({
    GroupsTab: ({ groups, onDeleteGroup }: any) => (
        <div data-testid="groups-tab">
            {groups.map((g: any) => (
                <button
                    key={g.id}
                    data-testid={`delete-group-${g.id}`}
                    onClick={() => onDeleteGroup(g.id)}
                >
                    Delete {g.name}
                </button>
            ))}
        </div>
    ),
}));

// Stub all other heavy child components
vi.mock('../../components/HR/tabs/TeamTab', () => ({
    TeamTab: ({ users, onSelectUser }: any) => (
        <div data-testid="team-tab">
            {users.map((u: any) => (
                <button key={u.id} data-testid={`select-user-${u.id}`} onClick={() => onSelectUser(u)}>
                    Select {u.firstname}
                </button>
            ))}
        </div>
    ),
}));
vi.mock('../../components/HR/tabs/HierarchyTab', () => ({ HierarchyTab: () => <div /> }));
vi.mock('../../components/HR/tabs/ExpensesTab', () => ({ ExpensesTab: () => <div /> }));
vi.mock('../../components/HR/tabs/LeavesTab', () => ({ LeavesTab: () => <div /> }));
vi.mock('../../components/HR/tabs/RecruitmentJobsList', () => ({ RecruitmentJobsList: () => <div /> }));
vi.mock('../../components/HR/tabs/RecruitmentCandidatesList', () => ({ RecruitmentCandidatesList: () => <div /> }));
vi.mock('../../components/HR/tabs/WorkloadTab', () => ({ WorkloadTab: () => <div /> }));
vi.mock('../../components/HR/UserDetail', () => ({
    UserDetail: ({ user, onDeleteUser }: any) => (
        <div data-testid="user-detail">
            {onDeleteUser && (
                <button data-testid={`delete-user-${user.id}`} onClick={() => onDeleteUser(user.id)}>
                    Delete {user.firstname}
                </button>
            )}
        </div>
    ),
}));
vi.mock('../../components/HR/GroupDetail', () => ({ GroupDetail: () => <div /> }));
vi.mock('../../components/HR/modals/UserModal', () => ({ UserModal: () => null }));
vi.mock('../../components/HR/modals/JobModal', () => ({ JobModal: () => null }));
vi.mock('../../components/HR/modals/LeaveModal', () => ({ LeaveModal: () => null }));
vi.mock('../../components/HR/modals/CandidateModal', () => ({ CandidateModal: () => null }));
vi.mock('../../components/HR/modals/ExpenseModal', () => ({ ExpenseModal: () => null }));
vi.mock('../../components/HR/modals/ExpenseScannerModal', () => ({ ExpenseScannerModal: () => null }));
vi.mock('../../components/HR/modals/ExpenseDetailModal', () => ({ ExpenseDetailModal: () => null }));
vi.mock('../../components/HR/modals/GroupModal', () => ({ GroupModal: () => null }));
vi.mock('../../components/ui', () => ({ ListToolbar: () => null }));

const renderWithProvider = () =>
    render(
        <ConfirmProvider>
            <HRList />
        </ConfirmProvider>
    );

describe('HRList — confirm/toast refactor (#335)', () => {
    let confirmSpy: ReturnType<typeof vi.spyOn>;
    let alertSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        confirmSpy = vi.spyOn(window, 'confirm');
        alertSpy = vi.spyOn(window, 'alert');
    });

    it('deletes a group via in-app confirm when user confirms', async () => {
        const user = userEvent.setup();
        renderWithProvider();

        // Navigate to Groups tab
        await user.click(screen.getByText(/Grupos/));

        // Click delete on the first group
        await user.click(await screen.findByTestId('delete-group-g1'));

        // In-app confirm dialog should appear (not native)
        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Confirmar'));

        await waitFor(() => {
            expect(HRAdmin.deleteGroup).toHaveBeenCalledWith(expect.anything(), 'g1');
        });
        expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('does NOT delete a group when user cancels the confirm dialog', async () => {
        const user = userEvent.setup();
        renderWithProvider();

        await user.click(screen.getByText(/Grupos/));
        await user.click(await screen.findByTestId('delete-group-g1'));

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Cancelar'));

        await waitFor(() => {
            expect(HRAdmin.deleteGroup).not.toHaveBeenCalled();
        });
        expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('never calls native window.confirm or window.alert', async () => {
        const user = userEvent.setup();
        renderWithProvider();

        // Navigate through a couple of tabs to exercise the component
        await user.click(screen.getByText(/Grupos/));
        await user.click(await screen.findByTestId('delete-group-g1'));

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Cancelar'));

        // Give async work a tick
        await waitFor(() => {
            expect(confirmSpy).not.toHaveBeenCalled();
        });
        expect(alertSpy).not.toHaveBeenCalled();
    });
});

describe('HRList — classes Tailwind literais por tema (#1094)', () => {
    const setThemeColor = (themeColor: string) => {
        vi.mocked(useDolibarr).mockReturnValue({
            config: {
                apiUrl: 'http://test/api',
                apiKey: 'key',
                themeColor,
                darkMode: false,
            },
            currentUser: { id: 'u1', login: 'admin' },
        } as any);
    };

    beforeEach(() => {
        vi.clearAllMocks();
        setThemeColor('indigo');
    });

    const tabButton = (label: RegExp) =>
        screen.getByText(label, { selector: 'button' }).closest('button') as HTMLElement;

    it('a aba ativa (Equipe) usa classes literais da cor de tema (indigo)', () => {
        renderWithProvider();

        const teamTab = tabButton(/Equipe/);
        expect(teamTab.className).toContain('border-indigo-600');
        expect(teamTab.className).toContain('text-indigo-600');
        expect(teamTab.className).toContain('dark:border-indigo-400');
        expect(teamTab.className).toContain('dark:text-indigo-400');
        expect(teamTab.className).not.toContain('${');
        expect(teamTab.className).not.toContain('undefined');
    });

    it('as abas inativas usam classes neutras (sem cor de tema)', () => {
        renderWithProvider();

        const groupsTab = tabButton(/Grupos/);
        expect(groupsTab.className).toContain('border-transparent');
        expect(groupsTab.className).not.toContain('border-indigo-600');
        expect(groupsTab.className).not.toContain('text-indigo-600');
    });

    it('trocar de aba move as classes ativas para a nova aba', () => {
        renderWithProvider();

        const groupsTab = tabButton(/Grupos/);
        expect(groupsTab.className).not.toContain('border-indigo-600');

        fireEvent.click(groupsTab);

        const groupsTabAfter = tabButton(/Grupos/);
        const teamTabAfter = tabButton(/Equipe/);
        expect(groupsTabAfter.className).toContain('border-indigo-600');
        expect(groupsTabAfter.className).toContain('text-indigo-600');
        expect(teamTabAfter.className).not.toContain('border-indigo-600');
    });

    it('o botão de ação "Novo Membro" usa classes literais do botão primário (indigo)', () => {
        renderWithProvider();

        const btn = screen.getByRole('button', { name: /novo membro/i });
        expect(btn.className).toContain('bg-indigo-600');
        expect(btn.className).toContain('hover:bg-indigo-700');
        expect(btn.className).toContain('text-white');
        expect(btn.className).not.toContain('${');
        expect(btn.className).not.toContain('undefined');
    });

    it('aplica a cor correta para tema diferente (emerald) na aba e no botão', () => {
        setThemeColor('emerald');
        renderWithProvider();

        const teamTab = tabButton(/Equipe/);
        expect(teamTab.className).toContain('border-emerald-600');
        expect(teamTab.className).toContain('text-emerald-600');
        expect(teamTab.className).not.toContain('border-indigo-600');

        const btn = screen.getByRole('button', { name: /novo membro/i });
        expect(btn.className).toContain('bg-emerald-600');
        expect(btn.className).toContain('hover:bg-emerald-700');
        expect(btn.className).not.toContain('bg-indigo-600');
    });

    it('cor de tema desconhecida cai no fallback indigo (aba + botão)', () => {
        setThemeColor('cor-que-nao-existe');
        renderWithProvider();

        const teamTab = tabButton(/Equipe/);
        expect(teamTab.className).toContain('border-indigo-600');
        expect(teamTab.className).not.toContain('undefined');

        const btn = screen.getByRole('button', { name: /novo membro/i });
        expect(btn.className).toContain('bg-indigo-600');
        expect(btn.className).not.toContain('undefined');
    });
});

describe('HRList — real user delete (#1088)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // #1416 — restaura o mock default com canDo permissivo. Blocos anteriores
        // (ex: #1094 Tailwind) sobrescrevem o return do useDolibarr SEM canDo.
        vi.mocked(useDolibarr).mockReturnValue({
            config: {
                apiUrl: 'http://test/api',
                apiKey: 'key',
                themeColor: 'indigo',
                darkMode: false,
            },
            currentUser: { id: 'u1', login: 'admin' },
            canDo: vi.fn(() => true),
        } as any);
    });

    it('deletes a user via the real API when confirmed', async () => {
        const user = userEvent.setup();
        renderWithProvider();

        // Select the first user in the Team tab
        await user.click(await screen.findByTestId('select-user-u1'));

        // Click delete in the detail panel
        await user.click(await screen.findByTestId('delete-user-u1'));

        // In-app confirm dialog
        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Confirmar'));

        await waitFor(() => {
            expect(CoreApi.deleteUser).toHaveBeenCalledWith(expect.anything(), 'u1');
        });
    });

    it('does NOT call the API when the user cancels', async () => {
        const user = userEvent.setup();
        renderWithProvider();

        await user.click(await screen.findByTestId('select-user-u1'));
        await user.click(await screen.findByTestId('delete-user-u1'));

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Cancelar'));

        await waitFor(() => {
            expect(CoreApi.deleteUser).not.toHaveBeenCalled();
        });
    });
});

describe('HRList — Rules of Hooks (#1104)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useDolibarr).mockReturnValue({
            config: {
                apiUrl: 'http://test/api',
                apiKey: 'key',
                themeColor: 'indigo',
                darkMode: false,
            },
            currentUser: { id: 'u1', login: 'admin' },
        } as any);
    });

    it('mostra "Carregando configuracao..." quando config é null (hooks ainda executam)', () => {
        vi.mocked(useDolibarr).mockReturnValue({
            config: null,
            currentUser: { id: 'u1', login: 'admin' },
        } as any);

        renderWithProvider();
        expect(screen.getByText('Carregando configuração...')).toBeInTheDocument();
    });

    it('sobrevive a transicao config null → set sem quebrar a ordem de hooks', async () => {
        vi.mocked(useDolibarr).mockReturnValue({
            config: null,
            currentUser: { id: 'u1', login: 'admin' },
        } as any);

        const { rerender } = renderWithProvider();
        expect(screen.getByText('Carregando configuração...')).toBeInTheDocument();

        vi.mocked(useDolibarr).mockReturnValue({
            config: {
                apiUrl: 'http://test/api',
                apiKey: 'key',
                themeColor: 'indigo',
                darkMode: false,
            },
            currentUser: { id: 'u1', login: 'admin' },
        } as any);

        rerender(
            <ConfirmProvider>
                <HRList />
            </ConfirmProvider>
        );

        await waitFor(() => {
            expect(screen.getByText('RH e Equipe')).toBeInTheDocument();
        });
    });
});

describe('HRList — delete-user gated by canDo (#1416)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // Helper: configura o mock de useDolibarr com canDo parametrizável.
    const setCanDo = (map: Record<string, boolean>) => {
        vi.mocked(useDolibarr).mockReturnValue({
            config: {
                apiUrl: 'http://test/api',
                apiKey: 'key',
                themeColor: 'indigo',
                darkMode: false,
            },
            currentUser: { id: 'u1', login: 'admin' },
            canDo: vi.fn((action: string, screen: string) => !!map[`${screen}.${action}`]),
        } as any);
    };

    it('NÃO chama a API quando canDo(delete, users) é false (gate defensivo)', async () => {
        setCanDo({}); // sem nenhuma permissão
        const user = userEvent.setup();
        renderWithProvider();

        // Seleciona o usuário e tenta excluir
        await user.click(await screen.findByTestId('select-user-u1'));
        await user.click(await screen.findByTestId('delete-user-u1'));

        // O confirm nem aparece (gate já bloqueia antes) — mas o mais importante:
        // a API NÃO é chamada.
        await waitFor(() => {
            expect(CoreApi.deleteUser).not.toHaveBeenCalled();
        });
    });

    it('chama a API normalmente quando canDo(delete, users) é true', async () => {
        setCanDo({ 'users.delete': true });
        const user = userEvent.setup();
        renderWithProvider();

        await user.click(await screen.findByTestId('select-user-u1'));
        await user.click(await screen.findByTestId('delete-user-u1'));

        // Confirm in-app aparece
        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Confirmar'));

        await waitFor(() => {
            expect(CoreApi.deleteUser).toHaveBeenCalledWith(expect.anything(), 'u1');
        });
    });

    it('admin (canDo permissivo) pode excluir como antes', async () => {
        // Admin sempre passa — espelha o default seguro do canDoAction
        setCanDo({
            'users.delete': true,
            'users.create': true,
            'users.edit': true,
        });
        const user = userEvent.setup();
        renderWithProvider();

        await user.click(await screen.findByTestId('select-user-u1'));
        await user.click(await screen.findByTestId('delete-user-u1'));
        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Confirmar'));

        await waitFor(() => {
            expect(CoreApi.deleteUser).toHaveBeenCalledWith(expect.anything(), 'u1');
        });
    });
});
