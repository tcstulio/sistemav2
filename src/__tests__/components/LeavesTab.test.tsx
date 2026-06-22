import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LeavesTab } from '../../components/HR/tabs/LeavesTab';
import { LeaveRequest, DolibarrUser, DolibarrConfig } from '../../types';

const mockToast = vi.hoisted(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
}));
vi.mock('sonner', () => ({
    toast: mockToast,
}));

const mockConfig: DolibarrConfig = {
    apiUrl: 'https://api.example.com',
    apiKey: 'test-key',
    themeColor: 'indigo',
    darkMode: false,
    apiLimit: 0,
    currentUser: {} as any,
};

const { mockConfirm, confirmState } = vi.hoisted(() => {
    const confirmState = { result: true };
    return { mockConfirm: vi.fn(() => Promise.resolve(confirmState.result)), confirmState };
});
vi.mock('../../hooks/useConfirm', () => ({
    useConfirm: () => mockConfirm,
}));

const mockNotifyError = vi.hoisted(() => vi.fn());
vi.mock('../../utils/notifyError', () => ({
    notifyError: (...args: any[]) => mockNotifyError(...args),
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: () => ({ config: mockConfig }),
}));

const { validateLeaveRequest, approveLeaveRequest, refuseLeaveRequest } = vi.hoisted(() => ({
    validateLeaveRequest: vi.fn().mockResolvedValue({}),
    approveLeaveRequest: vi.fn().mockResolvedValue({}),
    refuseLeaveRequest: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: {
        validateLeaveRequest,
        approveLeaveRequest,
        refuseLeaveRequest,
    },
}));

const mockUsers: DolibarrUser[] = [
    { id: '1', login: 'jose.silva', lastname: 'Silva', firstname: 'José', email: 'jose@test.com', statut: '1' },
];

const draftLeave: LeaveRequest = {
    id: '10',
    fk_user: '1',
    date_debut: 1700000000,
    date_fin: 1700086400,
    statut: '1',
    type: 'paid',
    description: 'Férias de verão',
};

const pendingLeave: LeaveRequest = {
    id: '20',
    fk_user: '1',
    date_debut: 1700000000,
    date_fin: 1700086400,
    statut: '2',
    type: 'paid',
    description: 'Férias pendentes',
};

const defaultProps = {
    leaveRequests: [] as LeaveRequest[],
    users: mockUsers,
    searchTerm: '',
    sortConfig: { key: 'default', direction: 'asc' as const },
    onOpenLeaveModal: vi.fn(),
};

describe('LeavesTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        confirmState.result = true;
        validateLeaveRequest.mockResolvedValue({});
        approveLeaveRequest.mockResolvedValue({});
        refuseLeaveRequest.mockResolvedValue({});
    });

    it('renders title and empty state', () => {
        render(<LeavesTab {...defaultProps} />);
        expect(screen.getByText('Solicitações de Licença')).toBeInTheDocument();
        expect(screen.getByText('Nenhuma licença encontrada.')).toBeInTheDocument();
    });

    it('renders a draft leave request with validate button', () => {
        render(<LeavesTab {...defaultProps} leaveRequests={[draftLeave]} />);
        expect(screen.getByText('Férias de verão')).toBeInTheDocument();
        expect(screen.getByTitle('Enviar para Aprovação')).toBeInTheDocument();
    });

    it('renders a pending leave request with approve and refuse buttons', () => {
        render(<LeavesTab {...defaultProps} leaveRequests={[pendingLeave]} />);
        expect(screen.getByTitle('Aprovar')).toBeInTheDocument();
        expect(screen.getByTitle('Recusar')).toBeInTheDocument();
    });

    it('calls confirm then validateLeaveRequest and shows success toast on validate', async () => {
        render(<LeavesTab {...defaultProps} leaveRequests={[draftLeave]} />);
        fireEvent.click(screen.getByTitle('Enviar para Aprovação'));

        await waitFor(() => expect(mockConfirm).toHaveBeenCalledWith('Enviar solicitação para aprovação?'));
        await waitFor(() => expect(validateLeaveRequest).toHaveBeenCalledWith(mockConfig, '10'));
        await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Solicitação enviada!'));
        expect(mockNotifyError).not.toHaveBeenCalled();
    });

    it('calls confirm then approveLeaveRequest and shows success toast on approve', async () => {
        render(<LeavesTab {...defaultProps} leaveRequests={[pendingLeave]} />);
        fireEvent.click(screen.getByTitle('Aprovar'));

        await waitFor(() => expect(mockConfirm).toHaveBeenCalledWith('Aprovar esta solicitação?'));
        await waitFor(() => expect(approveLeaveRequest).toHaveBeenCalledWith(mockConfig, '20'));
        await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Solicitação aprovada!'));
    });

    it('calls confirm then refuseLeaveRequest and shows success toast on refuse', async () => {
        render(<LeavesTab {...defaultProps} leaveRequests={[pendingLeave]} />);
        fireEvent.click(screen.getByTitle('Recusar'));

        await waitFor(() => expect(mockConfirm).toHaveBeenCalledWith('Recusar esta solicitação?'));
        await waitFor(() => expect(refuseLeaveRequest).toHaveBeenCalledWith(mockConfig, '20'));
        await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Solicitação recusada!'));
    });

    it('does not call service when confirm is cancelled', async () => {
        confirmState.result = false;
        render(<LeavesTab {...defaultProps} leaveRequests={[draftLeave]} />);
        fireEvent.click(screen.getByTitle('Enviar para Aprovação'));

        await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
        expect(validateLeaveRequest).not.toHaveBeenCalled();
        expect(mockToast.success).not.toHaveBeenCalled();
    });

    it('calls notifyError when validate fails', async () => {
        validateLeaveRequest.mockRejectedValue(new Error('network'));
        render(<LeavesTab {...defaultProps} leaveRequests={[draftLeave]} />);
        fireEvent.click(screen.getByTitle('Enviar para Aprovação'));

        await waitFor(() => expect(mockNotifyError).toHaveBeenCalledWith('Enviar solicitação para aprovação', expect.any(Error)));
        expect(mockToast.success).not.toHaveBeenCalled();
    });

    it('calls notifyError when approve fails', async () => {
        approveLeaveRequest.mockRejectedValue(new Error('boom'));
        render(<LeavesTab {...defaultProps} leaveRequests={[pendingLeave]} />);
        fireEvent.click(screen.getByTitle('Aprovar'));

        await waitFor(() => expect(mockNotifyError).toHaveBeenCalledWith('Aprovar solicitação', expect.any(Error)));
    });

    it('calls notifyError when refuse fails', async () => {
        refuseLeaveRequest.mockRejectedValue(new Error('boom'));
        render(<LeavesTab {...defaultProps} leaveRequests={[pendingLeave]} />);
        fireEvent.click(screen.getByTitle('Recusar'));

        await waitFor(() => expect(mockNotifyError).toHaveBeenCalledWith('Recusar solicitação', expect.any(Error)));
    });

    it('chama onRefresh após aprovar licença (#622)', async () => {
        const onRefresh = vi.fn();
        render(<LeavesTab {...defaultProps} leaveRequests={[pendingLeave]} onRefresh={onRefresh} />);
        fireEvent.click(screen.getByTitle('Aprovar'));

        await waitFor(() => expect(approveLeaveRequest).toHaveBeenCalledWith(mockConfig, '20'));
        expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('chama onRefresh após recusar licença (#622)', async () => {
        const onRefresh = vi.fn();
        render(<LeavesTab {...defaultProps} leaveRequests={[pendingLeave]} onRefresh={onRefresh} />);
        fireEvent.click(screen.getByTitle('Recusar'));

        await waitFor(() => expect(refuseLeaveRequest).toHaveBeenCalledWith(mockConfig, '20'));
        expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('chama onRefresh após enviar para aprovação (#622)', async () => {
        const onRefresh = vi.fn();
        render(<LeavesTab {...defaultProps} leaveRequests={[draftLeave]} onRefresh={onRefresh} />);
        fireEvent.click(screen.getByTitle('Enviar para Aprovação'));

        await waitFor(() => expect(validateLeaveRequest).toHaveBeenCalledWith(mockConfig, '10'));
        expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('não chama onRefresh se confirmação for cancelada (#622)', async () => {
        confirmState.result = false;
        const onRefresh = vi.fn();
        render(<LeavesTab {...defaultProps} leaveRequests={[pendingLeave]} onRefresh={onRefresh} />);
        fireEvent.click(screen.getByTitle('Aprovar'));

        await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
        expect(approveLeaveRequest).not.toHaveBeenCalled();
        expect(onRefresh).not.toHaveBeenCalled();
    });
});
