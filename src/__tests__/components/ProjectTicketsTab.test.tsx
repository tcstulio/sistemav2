import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectTicketsTab } from '../../components/Projects/tabs/ProjectTicketsTab';
import type { Ticket } from '../../types/crm';

// ConfirmDeleteButton (usado no fluxo de exclusão) dispara toasts via sonner.
vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// --- Cobertura base de render/props (restaurada do original; #854 a havia removido) ---
describe('ProjectTicketsTab — render & props base', () => {
    const mockOnCreateTicket = vi.fn();
    const mockOnEditTicket = vi.fn();
    const mockOnDeleteTicket = vi.fn().mockResolvedValue(undefined);

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const createMockTicket = (id: string, overrides: Partial<Ticket> = {}): Ticket => ({
        id,
        ref: `TKT-${id}`,
        track_id: `track-${id}`,
        subject: `Ticket ${id}`,
        message: 'This is a test message for the ticket',
        type_code: 'ISSUE',
        category_code: 'GENERAL',
        severity_code: 'HIGH',
        statut: '1',
        progress: '0',
        datec: Date.now(),
        tms: Date.now(),
        ...overrides
    });

    it('renders empty state when no tickets', () => {
        render(
            <ProjectTicketsTab
                tickets={[]}
                onCreateTicket={mockOnCreateTicket}
                onEditTicket={mockOnEditTicket}
                onDeleteTicket={mockOnDeleteTicket}
            />
        );
        expect(screen.getByText('Nenhum chamado encontrado.')).toBeInTheDocument();
    });

    it('renders ticket subject and ref', () => {
        const tickets = [createMockTicket('1', { subject: 'Bug no sistema' })];
        render(
            <ProjectTicketsTab
                tickets={tickets}
                onCreateTicket={mockOnCreateTicket}
                onEditTicket={mockOnEditTicket}
                onDeleteTicket={mockOnDeleteTicket}
            />
        );
        expect(screen.getByText('TKT-1 - Bug no sistema')).toBeInTheDocument();
    });

    it('renders multiple tickets', () => {
        const tickets = [
            createMockTicket('1', { subject: 'Ticket 1' }),
            createMockTicket('2', { subject: 'Ticket 2' })
        ];
        render(
            <ProjectTicketsTab
                tickets={tickets}
                onCreateTicket={mockOnCreateTicket}
                onEditTicket={mockOnEditTicket}
                onDeleteTicket={mockOnDeleteTicket}
            />
        );
        expect(screen.getByText('TKT-1 - Ticket 1')).toBeInTheDocument();
        expect(screen.getByText('TKT-2 - Ticket 2')).toBeInTheDocument();
    });

    it('calls onCreateTicket when clicking "Novo Chamado"', () => {
        render(
            <ProjectTicketsTab
                tickets={[]}
                onCreateTicket={mockOnCreateTicket}
                onEditTicket={mockOnEditTicket}
                onDeleteTicket={mockOnDeleteTicket}
            />
        );
        fireEvent.click(screen.getByText('Novo Chamado'));
        expect(mockOnCreateTicket).toHaveBeenCalled();
    });

    it('renders severity and status', () => {
        const tickets = [createMockTicket('1', { severity_code: 'HIGH', statut: 'Open' })];
        render(
            <ProjectTicketsTab
                tickets={tickets}
                onCreateTicket={mockOnCreateTicket}
                onEditTicket={mockOnEditTicket}
                onDeleteTicket={mockOnDeleteTicket}
            />
        );
        expect(screen.getByText('HIGH')).toBeInTheDocument();
        expect(screen.getByText('Open')).toBeInTheDocument();
    });

    it('calls onEditTicket when clicking edit button', () => {
        const tickets = [createMockTicket('1')];
        render(
            <ProjectTicketsTab
                tickets={tickets}
                onCreateTicket={mockOnCreateTicket}
                onEditTicket={mockOnEditTicket}
                onDeleteTicket={mockOnDeleteTicket}
            />
        );
        const buttons = screen.getAllByRole('button');
        fireEvent.click(buttons[1]);
        expect(mockOnEditTicket).toHaveBeenCalledWith(tickets[0]);
    });

    it('renders header "Chamados Vinculados"', () => {
        render(
            <ProjectTicketsTab
                tickets={[]}
                onCreateTicket={mockOnCreateTicket}
                onEditTicket={mockOnEditTicket}
                onDeleteTicket={mockOnDeleteTicket}
            />
        );
        expect(screen.getByText('Chamados Vinculados')).toBeInTheDocument();
    });

    it('shows ISSUE icon with red background', () => {
        const tickets = [createMockTicket('1', { type_code: 'ISSUE' })];
        render(
            <ProjectTicketsTab
                tickets={tickets}
                onCreateTicket={mockOnCreateTicket}
                onEditTicket={mockOnEditTicket}
                onDeleteTicket={mockOnDeleteTicket}
            />
        );
        expect(screen.getByText('TKT-1 - Ticket 1')).toBeInTheDocument();
    });
});

// --- Fluxo de confirmação de exclusão (#854) ---
// Substitui o antigo teste de clique-direto no delete: o botão agora abre um modal
// de confirmação (ConfirmDeleteButton) antes de chamar onDeleteTicket.
describe('ProjectTicketsTab — confirmação ao excluir chamado (#854)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const makeTicket = (overrides: Partial<Ticket> = {}): Ticket => ({
        id: 'ticket-1',
        ref: 'CH001',
        track_id: 'trk-1',
        subject: 'Assunto do Chamado',
        message: 'mensagem do chamado',
        type_code: 'ISSUE',
        category_code: '',
        severity_code: 'NORMAL',
        statut: '1',
        progress: '0',
        datec: 0,
        tms: 0,
        ...overrides,
    });

    it('abre modal de confirmação ao clicar em excluir (sem excluir imediatamente)', async () => {
        const onDeleteTicket = vi.fn().mockResolvedValue(undefined);
        const user = userEvent.setup();
        render(
            <ProjectTicketsTab
                tickets={[makeTicket()]}
                onCreateTicket={vi.fn()}
                onEditTicket={vi.fn()}
                onDeleteTicket={onDeleteTicket}
                refreshData={vi.fn()}
            />
        );

        await user.click(screen.getByLabelText('Excluir'));

        expect(await screen.findByRole('dialog')).toBeTruthy();
        expect(onDeleteTicket).not.toHaveBeenCalled();
    });

    it('cancela a exclusão sem efeito colateral', async () => {
        const onDeleteTicket = vi.fn().mockResolvedValue(undefined);
        const refreshData = vi.fn();
        const user = userEvent.setup();
        render(
            <ProjectTicketsTab
                tickets={[makeTicket()]}
                onCreateTicket={vi.fn()}
                onEditTicket={vi.fn()}
                onDeleteTicket={onDeleteTicket}
                refreshData={refreshData}
            />
        );

        await user.click(screen.getByLabelText('Excluir'));
        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(onDeleteTicket).not.toHaveBeenCalled();
        expect(refreshData).not.toHaveBeenCalled();
    });

    it('exclui o chamado e atualiza a lista ao confirmar', async () => {
        const onDeleteTicket = vi.fn().mockResolvedValue(undefined);
        const refreshData = vi.fn();
        const user = userEvent.setup();
        render(
            <ProjectTicketsTab
                tickets={[makeTicket({ id: 'ticket-7', ref: 'CH007' })]}
                onCreateTicket={vi.fn()}
                onEditTicket={vi.fn()}
                onDeleteTicket={onDeleteTicket}
                refreshData={refreshData}
            />
        );

        await user.click(screen.getByLabelText('Excluir'));
        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByRole('button', { name: 'Excluir' }));

        await vi.waitFor(() => expect(onDeleteTicket).toHaveBeenCalledTimes(1));
        expect(onDeleteTicket).toHaveBeenCalledWith('ticket-7');
        expect(refreshData).toHaveBeenCalledTimes(1);
    });
});
