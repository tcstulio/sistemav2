import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EmailTemplateManager } from '../../components/Email/EmailTemplateManager';
import { ConfirmProvider } from '../../hooks/useConfirm';

vi.mock('../../services/emailService', () => ({
    EmailService: {
        getTemplates: vi.fn(),
        addTemplate: vi.fn(),
        updateTemplate: vi.fn(),
        deleteTemplate: vi.fn(),
    },
}));

import { EmailService } from '../../services/emailService';

const mockTemplates = [
    {
        id: 't1',
        name: 'Welcome',
        subject: 'Bem-vindo',
        body: 'Olá!',
        createdBy: 'u1',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
    },
    {
        id: 't2',
        name: 'Follow-up',
        subject: 'Acompanhamento',
        body: 'Como vai?',
        createdBy: 'u1',
        createdAt: '2024-01-02T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
    },
];

const renderWithProvider = (ui: React.ReactElement) =>
    render(<ConfirmProvider>{ui}</ConfirmProvider>);

describe('EmailTemplateManager', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(EmailService.getTemplates).mockResolvedValue(mockTemplates);
    });

    it('renders templates after loading', async () => {
        renderWithProvider(<EmailTemplateManager onClose={vi.fn()} />);

        await waitFor(() => {
            expect(screen.getByText('Welcome')).toBeTruthy();
            expect(screen.getByText('Follow-up')).toBeTruthy();
        });
    });

    it('deletes template when confirm is accepted', async () => {
        vi.mocked(EmailService.deleteTemplate).mockResolvedValue(undefined);
        renderWithProvider(<EmailTemplateManager onClose={vi.fn()} />);

        await waitFor(() => {
            expect(screen.getByText('Welcome')).toBeTruthy();
        });

        const deleteButtons = screen.getAllByRole('button');
        const trashButtons = deleteButtons.filter(btn => btn.querySelector('svg.lucide-trash-2'));
        fireEvent.click(trashButtons[0]);

        await waitFor(() => {
            expect(screen.getByText('Excluir template?')).toBeTruthy();
        });

        fireEvent.click(screen.getByText('Confirmar'));

        await waitFor(() => {
            expect(EmailService.deleteTemplate).toHaveBeenCalledWith('t1');
        });
    });

    it('does NOT delete template when confirm is cancelled', async () => {
        vi.mocked(EmailService.deleteTemplate).mockResolvedValue(undefined);
        renderWithProvider(<EmailTemplateManager onClose={vi.fn()} />);

        await waitFor(() => {
            expect(screen.getByText('Welcome')).toBeTruthy();
        });

        const deleteButtons = screen.getAllByRole('button');
        const trashButtons = deleteButtons.filter(btn => btn.querySelector('svg.lucide-trash-2'));
        fireEvent.click(trashButtons[0]);

        await waitFor(() => {
            expect(screen.getByText('Excluir template?')).toBeTruthy();
        });

        fireEvent.click(screen.getByText('Cancelar'));

        await waitFor(() => {
            expect(EmailService.deleteTemplate).not.toHaveBeenCalled();
        });
    });
});
