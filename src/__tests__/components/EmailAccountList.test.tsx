import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EmailAccountList } from '../../components/Email/EmailAccountList';
import { EmailAccount } from '../../types/email';
import { ConfirmProvider } from '../../hooks/useConfirm';

const mockAccounts: EmailAccount[] = [
    {
        id: '1',
        name: 'Work Email',
        email: 'work@example.com',
        imapHost: 'imap.example.com',
        imapPort: 993,
        imapUser: 'work@example.com',
        imapTls: true,
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
        smtpUser: 'work@example.com',
        smtpSecure: true,
    },
    {
        id: '2',
        name: 'Personal Email',
        email: 'personal@example.com',
        imapHost: 'imap.gmail.com',
        imapPort: 993,
        imapUser: 'personal@example.com',
        imapTls: true,
        smtpHost: 'smtp.gmail.com',
        smtpPort: 587,
        smtpUser: 'personal@example.com',
        smtpSecure: true,
    },
];

const renderWithProvider = (ui: React.ReactElement) =>
    render(<ConfirmProvider>{ui}</ConfirmProvider>);

const baseProps = {
    accounts: mockAccounts,
    selectedAccountId: null as string | null,
    onSelect: vi.fn(),
    onAddAccount: vi.fn(),
    onEditAccount: vi.fn(),
    onDeleteAccount: vi.fn(),
};

describe('EmailAccountList', () => {
    it('renders with accounts', () => {
        renderWithProvider(<EmailAccountList {...baseProps} />);
        expect(document.body.textContent).toBeTruthy();
    });

    it('renders account names and emails', () => {
        renderWithProvider(<EmailAccountList {...baseProps} />);
        expect(screen.getByText('Work Email')).toBeTruthy();
        expect(screen.getByText('work@example.com')).toBeTruthy();
        expect(screen.getByText('Personal Email')).toBeTruthy();
        expect(screen.getByText('personal@example.com')).toBeTruthy();
    });

    it('renders empty state when no accounts', () => {
        renderWithProvider(<EmailAccountList {...baseProps} accounts={[]} />);
        expect(screen.getByText('Nenhuma conta configurada.')).toBeTruthy();
    });

    it('renders add account button', () => {
        renderWithProvider(<EmailAccountList {...baseProps} />);
        expect(screen.getByTitle('Adicionar Conta')).toBeTruthy();
    });

    it('calls onSelect when clicking an account', () => {
        renderWithProvider(<EmailAccountList {...baseProps} />);
        fireEvent.click(screen.getByText('Work Email'));
        expect(baseProps.onSelect).toHaveBeenCalledWith('1');
    });

    it('renders selected account with styling', () => {
        renderWithProvider(<EmailAccountList {...baseProps} selectedAccountId="1" />);
        expect(screen.getByText('Work Email')).toBeTruthy();
    });

    it('renders unread counts', () => {
        renderWithProvider(
            <EmailAccountList {...baseProps} unreadCounts={{ '1': 5, '2': 100 }} />
        );
        expect(screen.getByText('5')).toBeTruthy();
        expect(screen.getByText('99+')).toBeTruthy();
    });

    it('shows edit and delete buttons on hover', () => {
        renderWithProvider(<EmailAccountList {...baseProps} accounts={[mockAccounts[0]]} />);
        expect(screen.getByTitle('Editar conta')).toBeTruthy();
        expect(screen.getByTitle('Remover conta')).toBeTruthy();
    });

    it('calls onDeleteAccount when delete is confirmed', async () => {
        const onDeleteAccount = vi.fn();
        renderWithProvider(
            <EmailAccountList {...baseProps} accounts={[mockAccounts[0]]} onDeleteAccount={onDeleteAccount} />
        );

        fireEvent.click(screen.getByTitle('Remover conta'));

        await waitFor(() => {
            expect(screen.getByText('Remover conta?')).toBeTruthy();
        });

        fireEvent.click(screen.getByText('Confirmar'));

        await waitFor(() => {
            expect(onDeleteAccount).toHaveBeenCalledWith('1');
        });
    });

    it('does NOT call onDeleteAccount when delete is cancelled', async () => {
        const onDeleteAccount = vi.fn();
        renderWithProvider(
            <EmailAccountList {...baseProps} accounts={[mockAccounts[0]]} onDeleteAccount={onDeleteAccount} />
        );

        fireEvent.click(screen.getByTitle('Remover conta'));

        await waitFor(() => {
            expect(screen.getByText('Remover conta?')).toBeTruthy();
        });

        fireEvent.click(screen.getByText('Cancelar'));

        await waitFor(() => {
            expect(onDeleteAccount).not.toHaveBeenCalled();
        });
    });
});
