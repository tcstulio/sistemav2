import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectTicketsTab } from '../../components/Projects/tabs/ProjectTicketsTab';
import type { Ticket } from '../../types/crm';

vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

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

describe('ProjectTicketsTab — confirmação ao excluir chamado (#854)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
