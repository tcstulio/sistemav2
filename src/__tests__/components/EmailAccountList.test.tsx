import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmailAccountList } from '../../components/Email/EmailAccountList';
import { EmailAccount } from '../../types/email';

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

describe('EmailAccountList', () => {
    it('renders with accounts', () => {
        render(
            <EmailAccountList
                accounts={mockAccounts}
                selectedAccountId={null}
                onSelect={() => {}}
                onAddAccount={() => {}}
                onEditAccount={() => {}}
                onDeleteAccount={() => {}}
            />
        );
        expect(document.body.textContent).toBeTruthy();
    });

    it('renders account names and emails', () => {
        render(
            <EmailAccountList
                accounts={mockAccounts}
                selectedAccountId={null}
                onSelect={() => {}}
                onAddAccount={() => {}}
                onEditAccount={() => {}}
                onDeleteAccount={() => {}}
            />
        );
        expect(screen.getByText('Work Email')).toBeTruthy();
        expect(screen.getByText('work@example.com')).toBeTruthy();
        expect(screen.getByText('Personal Email')).toBeTruthy();
        expect(screen.getByText('personal@example.com')).toBeTruthy();
    });

    it('renders empty state when no accounts', () => {
        render(
            <EmailAccountList
                accounts={[]}
                selectedAccountId={null}
                onSelect={() => {}}
                onAddAccount={() => {}}
                onEditAccount={() => {}}
                onDeleteAccount={() => {}}
            />
        );
        expect(screen.getByText('Nenhuma conta configurada.')).toBeTruthy();
    });

    it('renders add account button', () => {
        render(
            <EmailAccountList
                accounts={mockAccounts}
                selectedAccountId={null}
                onSelect={() => {}}
                onAddAccount={() => {}}
                onEditAccount={() => {}}
                onDeleteAccount={() => {}}
            />
        );
        expect(screen.getByTitle('Adicionar Conta')).toBeTruthy();
    });

    it('calls onSelect when clicking an account', () => {
        let selectedId: string | null = null;
        render(
            <EmailAccountList
                accounts={mockAccounts}
                selectedAccountId={null}
                onSelect={(id) => { selectedId = id; }}
                onAddAccount={() => {}}
                onEditAccount={() => {}}
                onDeleteAccount={() => {}}
            />
        );
        screen.getByText('Work Email').click();
        expect(selectedId).toBe('1');
    });

    it('renders selected account with styling', () => {
        render(
            <EmailAccountList
                accounts={mockAccounts}
                selectedAccountId="1"
                onSelect={() => {}}
                onAddAccount={() => {}}
                onEditAccount={() => {}}
                onDeleteAccount={() => {}}
            />
        );
        expect(screen.getByText('Work Email')).toBeTruthy();
    });

    it('renders unread counts', () => {
        render(
            <EmailAccountList
                accounts={mockAccounts}
                selectedAccountId={null}
                onSelect={() => {}}
                onAddAccount={() => {}}
                onEditAccount={() => {}}
                onDeleteAccount={() => {}}
                unreadCounts={{ '1': 5, '2': 100 }}
            />
        );
        expect(screen.getByText('5')).toBeTruthy();
        expect(screen.getByText('99+')).toBeTruthy();
    });

    it('shows edit and delete buttons on hover', () => {
        render(
            <EmailAccountList
                accounts={[mockAccounts[0]]}
                selectedAccountId={null}
                onSelect={() => {}}
                onAddAccount={() => {}}
                onEditAccount={() => {}}
                onDeleteAccount={() => {}}
            />
        );
        expect(screen.getByTitle('Editar conta')).toBeTruthy();
        expect(screen.getByTitle('Remover conta')).toBeTruthy();
    });
});
