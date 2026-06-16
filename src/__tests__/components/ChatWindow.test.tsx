import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatWindow } from '../../components/whatsapp/ChatWindow';
import { ConfirmProvider } from '../../hooks/useConfirm';
import { WhatsAppMessage, WhatsAppConversation, DolibarrUser } from '../../types';

vi.mock('sonner', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
    },
}));

vi.mock('../../utils/notifyError', () => ({
    notifyError: vi.fn(),
}));

vi.mock('../../services/aiService', () => ({
    AiService: {
        extractCustomerInfo: vi.fn(),
        analyzeSentiment: vi.fn().mockResolvedValue(null),
    },
}));

vi.mock('../../utils/dateUtils', () => ({
    formatTime: vi.fn(() => '12:00'),
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({ config: { baseUrl: 'http://test', apiKey: 'key' } })),
}));

vi.mock('../../hooks/useMutations', () => ({
    useCustomerMutations: vi.fn(() => ({
        createCustomer: { mutateAsync: vi.fn() },
    })),
}));

const { notifyError } = await import('../../utils/notifyError');
const { toast } = await import('sonner');
const { AiService } = await import('../../services/aiService');
const { useCustomerMutations } = await import('../../hooks/useMutations');

const mockCurrentUser: DolibarrUser = {
    id: 'u1',
    login: 'currentUser',
    firstname: 'Current',
    lastname: 'User',
    email: '',
    job: '',
    statut: '1',
} as any;

const mockOtherUser: DolibarrUser = {
    id: 'u2',
    login: 'otherAgent',
    firstname: 'Other',
    lastname: 'Agent',
    email: '',
    job: '',
    statut: '1',
} as any;

const baseConversation: WhatsAppConversation = {
    id: 'c1',
    accountId: 'sess1',
    customerName: 'Test Customer',
    customerNumber: '5511999999999',
    lastMessage: 'Hello',
    lastMessageTimestamp: Date.now(),
    unreadCount: 0,
    status: 'open',
    isGroup: false,
};

const userMessages: WhatsAppMessage[] = [
    {
        id: 'm1',
        conversationId: 'c1',
        text: 'Olá, quero comprar um produto',
        sender: 'user',
        timestamp: Date.now(),
        status: 'read',
    },
];

const defaultProps = {
    messages: userMessages,
    currentUser: mockCurrentUser,
    users: [mockCurrentUser, mockOtherUser],
    selectedConversation: baseConversation,
    isLoading: false,
    error: null,
    onAssign: vi.fn(),
    onClose: vi.fn(),
    onOpenContext: vi.fn(),
    isContextOpen: false,
    onRetry: vi.fn(),
};

const renderChat = (overrides: Partial<typeof defaultProps> = {}) =>
    render(
        <ConfirmProvider>
            <ChatWindow {...defaultProps} {...overrides} />
        </ConfirmProvider>
    );

describe('ChatWindow — no native alert/confirm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(AiService.analyzeSentiment).mockResolvedValue(null);
    });

    it('shows in-app confirm dialog when stealing a conversation assigned to another agent', async () => {
        const user = userEvent.setup();
        const onAssign = vi.fn();

        renderChat({
            selectedConversation: { ...baseConversation, assignedUserId: 'u2' },
            onAssign,
        });

        // The "steal" button is an <button> with text "Assumir" inside a span
        // There may be multiple "Assumir" buttons, the steal one is an <a>-like text button
        const stealBtn = screen.getByText('Assumir', { selector: 'button.text-xs' });
        await user.click(stealBtn);

        const dialog = await screen.findByRole('dialog');
        expect(dialog).toBeTruthy();
        expect(within(dialog).getByText(/Esta conversa está com otherAgent/)).toBeTruthy();
    });

    it('calls onAssign when steal is confirmed', async () => {
        const user = userEvent.setup();
        const onAssign = vi.fn();

        renderChat({
            selectedConversation: { ...baseConversation, assignedUserId: 'u2' },
            onAssign,
        });

        const stealBtn = screen.getByText('Assumir', { selector: 'button.text-xs' });
        await user.click(stealBtn);

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Confirmar'));

        await waitFor(() => {
            expect(onAssign).toHaveBeenCalledWith('u1');
        });
    });

    it('does not call onAssign when steal is cancelled', async () => {
        const user = userEvent.setup();
        const onAssign = vi.fn();

        renderChat({
            selectedConversation: { ...baseConversation, assignedUserId: 'u2' },
            onAssign,
        });

        const stealBtn = screen.getByText('Assumir', { selector: 'button.text-xs' });
        await user.click(stealBtn);

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Cancelar'));

        await waitFor(() => {
            expect(screen.queryByRole('dialog')).toBeNull();
        });
        expect(onAssign).not.toHaveBeenCalled();
    });

    it('uses notifyError when AI extraction fails instead of alert', async () => {
        const user = userEvent.setup();
        vi.mocked(AiService.extractCustomerInfo).mockRejectedValue(new Error('AI down'));

        renderChat();

        const extractBtn = screen.getByText('Extrair Cliente');
        await user.click(extractBtn);

        await waitFor(() => {
            expect(notifyError).toHaveBeenCalledWith('Extração IA', expect.any(Error));
        });
    });

    it('uses notifyError when customer creation fails instead of alert', async () => {
        const user = userEvent.setup();
        vi.mocked(AiService.extractCustomerInfo).mockResolvedValue({ name: 'John Doe', email: 'john@test.com' });

        const mutateAsync = vi.fn().mockRejectedValue(new Error('DB error'));
        vi.mocked(useCustomerMutations).mockReturnValue({
            createCustomer: { mutateAsync },
        } as any);

        renderChat();

        const extractBtn = screen.getByText('Extrair Cliente');
        await user.click(extractBtn);

        // Modal opens — submit the form
        const submitBtn = await screen.findByText('Criar Prospect');
        await user.click(submitBtn);

        await waitFor(() => {
            expect(notifyError).toHaveBeenCalledWith('Criar cliente', expect.any(Error));
        });
    });

    it('uses toast.success when customer is created successfully', async () => {
        const user = userEvent.setup();
        vi.mocked(AiService.extractCustomerInfo).mockResolvedValue({ name: 'John Doe', email: 'john@test.com' });

        const mutateAsync = vi.fn().mockResolvedValue('123');
        vi.mocked(useCustomerMutations).mockReturnValue({
            createCustomer: { mutateAsync },
        } as any);

        renderChat();

        const extractBtn = screen.getByText('Extrair Cliente');
        await user.click(extractBtn);

        const submitBtn = await screen.findByText('Criar Prospect');
        await user.click(submitBtn);

        await waitFor(() => {
            expect(toast.success).toHaveBeenCalledWith('Cliente John Doe criado com sucesso!');
        });
    });
});
