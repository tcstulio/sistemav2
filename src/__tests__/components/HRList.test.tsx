import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HRList from '../../components/HRList';
import { ConfirmProvider } from '../../hooks/useConfirm';
import * as HRAdmin from '../../services/api/hrAdmin';

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({
        config: {
            apiUrl: 'http://test/api',
            apiKey: 'key',
            themeColor: 'indigo',
            darkMode: false,
        },
        currentUser: { id: 'u1', login: 'admin' },
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
vi.mock('../../components/HR/tabs/TeamTab', () => ({ TeamTab: () => <div data-testid="team-tab" /> }));
vi.mock('../../components/HR/tabs/HierarchyTab', () => ({ HierarchyTab: () => <div /> }));
vi.mock('../../components/HR/tabs/ExpensesTab', () => ({ ExpensesTab: () => <div /> }));
vi.mock('../../components/HR/tabs/LeavesTab', () => ({ LeavesTab: () => <div /> }));
vi.mock('../../components/HR/tabs/RecruitmentJobsList', () => ({ RecruitmentJobsList: () => <div /> }));
vi.mock('../../components/HR/tabs/RecruitmentCandidatesList', () => ({ RecruitmentCandidatesList: () => <div /> }));
vi.mock('../../components/HR/tabs/WorkloadTab', () => ({ WorkloadTab: () => <div /> }));
vi.mock('../../components/HR/UserDetail', () => ({ UserDetail: () => <div /> }));
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
