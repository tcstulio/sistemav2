import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import EmailView from '../../components/Email/EmailView';
import { ConfirmProvider } from '../../hooks/useConfirm';
import { EmailService } from '../../services/emailService';

vi.mock('../../services/emailService', () => ({
    EmailService: {
        getAccounts: vi.fn(),
        getUserStore: vi.fn(),
        getFolders: vi.fn(),
        getMessages: vi.fn(),
        getUnreadCount: vi.fn(),
        deleteMessages: vi.fn(),
        modifyFlags: vi.fn(),
        moveMessages: vi.fn(),
        updateUserSettings: vi.fn(),
        searchMessages: vi.fn(),
        getMessageBody: vi.fn(),
        getThreadSettings: vi.fn(),
        getAssignment: vi.fn(),
    },
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({ config: { baseUrl: 'http://test', apiKey: 'key' } })),
}));

vi.mock('../../hooks/dolibarr', () => ({
    useUsers: vi.fn(() => ({ data: [] })),
    useCustomers: vi.fn(() => ({ data: [] })),
    useInvoices: vi.fn(() => ({ data: [] })),
    useOrders: vi.fn(() => ({ data: [] })),
    useTickets: vi.fn(() => ({ data: [] })),
}));

const mockAccounts = [
    {
        id: 'acc1',
        name: 'Test Account',
        email: 'test@example.com',
        imapHost: 'imap.test.com',
        imapPort: 993,
        imapUser: 'test@test.com',
        imapTls: true,
        smtpHost: 'smtp.test.com',
        smtpPort: 587,
        smtpUser: 'test@test.com',
        smtpSecure: true,
    },
];

const mockMessages = [
    {
        id: 100,
        seq: '1',
        from: { name: 'Sender One', address: 'sender1@test.com' },
        subject: 'Subject One',
        date: new Date('2024-01-15T10:00:00').toISOString(),
        flags: ['\\Seen'],
        messageId: 'msg-100',
    },
    {
        id: 200,
        seq: '2',
        from: { name: 'Sender Two', address: 'sender2@test.com' },
        subject: 'Subject Two',
        date: new Date('2024-01-15T11:00:00').toISOString(),
        flags: [],
        messageId: 'msg-200',
    },
];

const setupEmailServiceMocks = () => {
    vi.mocked(EmailService.getAccounts).mockResolvedValue(mockAccounts);
    vi.mocked(EmailService.getUserStore).mockResolvedValue({ userSettings: {} });
    vi.mocked(EmailService.getFolders).mockResolvedValue([]);
    vi.mocked(EmailService.getMessages).mockResolvedValue(mockMessages);
    vi.mocked(EmailService.getUnreadCount).mockResolvedValue(0);
    vi.mocked(EmailService.deleteMessages).mockResolvedValue({} as any);
    vi.mocked(EmailService.getMessageBody).mockResolvedValue({} as any);
    vi.mocked(EmailService.getThreadSettings).mockResolvedValue({} as any);
    vi.mocked(EmailService.getAssignment).mockResolvedValue(null);
};

const renderWithProvider = () =>
    render(
        <MemoryRouter>
            <ConfirmProvider>
                <EmailView />
            </ConfirmProvider>
        </MemoryRouter>
    );

const enterSelectionModeAndSelectMessage = async (user: ReturnType<typeof userEvent.setup>) => {
    renderWithProvider();

    await waitFor(() => {
        expect(screen.getByText('Subject One')).toBeTruthy();
    });

    await user.click(screen.getByTitle('Modo seleção'));

    await user.click(screen.getByText('Subject One'));
};

describe('EmailView', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setupEmailServiceMocks();
    });

    it('deletes messages when user confirms', async () => {
        const user = userEvent.setup();
        await enterSelectionModeAndSelectMessage(user);

        await waitFor(() => {
            expect(screen.getByText('Excluir')).toBeTruthy();
        });

        await user.click(screen.getByText('Excluir'));

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Confirmar'));

        await waitFor(() => {
            expect(EmailService.deleteMessages).toHaveBeenCalledWith(
                'acc1',
                'INBOX',
                expect.arrayContaining([100])
            );
        });
    });

    it('does NOT delete messages when user cancels', async () => {
        const user = userEvent.setup();
        await enterSelectionModeAndSelectMessage(user);

        await waitFor(() => {
            expect(screen.getByText('Excluir')).toBeTruthy();
        });

        await user.click(screen.getByText('Excluir'));

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Cancelar'));

        await waitFor(() => {
            expect(EmailService.deleteMessages).not.toHaveBeenCalled();
        });
    });
});
