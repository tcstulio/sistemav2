/**
 * CustomerConversations tests
 * - Renders conversation list from mocked data
 * - Simulates selecting a conversation and shows its messages
 * - Shows EmptyState when no conversations
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CustomerConversations from '../../components/CustomerConversations';
import { WhatsAppConversation } from '../../types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../contexts/WhatsAppContext', () => ({
    useWhatsAppContext: vi.fn(() => ({ socket: null })),
}));

const mockRefreshConversations = vi.fn();
const mockUseConversations = vi.fn();
const mockUseMessages = vi.fn();

vi.mock('../../hooks/whatsapp/useConversations', () => ({
    useConversations: (...args: unknown[]) => mockUseConversations(...args),
}));

vi.mock('../../hooks/whatsapp/useMessages', () => ({
    useMessages: (...args: unknown[]) => mockUseMessages(...args),
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({
        config: { baseUrl: 'http://test', apiKey: 'key' },
        currentUser: { id: 'u1', login: 'tester' },
    })),
}));

vi.mock('sonner', () => ({
    toast: { error: vi.fn(), success: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockConversations: WhatsAppConversation[] = [
    {
        id: 'conv-1',
        accountId: 'sess1',
        customerName: 'Maria Silva',
        customerNumber: '5511999990001',
        lastMessage: 'Olá, preciso de ajuda!',
        lastMessageTimestamp: Date.now() - 60000,
        unreadCount: 2,
        status: 'open',
    },
    {
        id: 'conv-2',
        accountId: 'sess1',
        customerName: 'João Santos',
        customerNumber: '5511999990002',
        lastMessage: 'Obrigado!',
        lastMessageTimestamp: Date.now() - 120000,
        unreadCount: 0,
        status: 'open',
    },
];

const mockMessages = [
    {
        id: 'msg-1',
        conversationId: 'conv-1',
        text: 'Olá, preciso de ajuda!',
        sender: 'user' as const,
        timestamp: Date.now() - 90000,
        status: 'delivered' as const,
    },
    {
        id: 'msg-2',
        conversationId: 'conv-1',
        text: 'Claro! Como posso ajudar?',
        sender: 'agent' as const,
        timestamp: Date.now() - 60000,
        status: 'read' as const,
    },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CustomerConversations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default: messages hook returns empty (no conversation selected yet)
        mockUseMessages.mockReturnValue({
            messages: [],
            loading: false,
            error: null,
            refetch: vi.fn(),
            sendMessage: vi.fn(),
        });
    });

    it('renders conversation names and last-message previews', () => {
        mockUseConversations.mockReturnValue({
            conversations: mockConversations,
            loading: false,
            refreshConversations: mockRefreshConversations,
        });

        render(<CustomerConversations />);

        expect(screen.getByText('Maria Silva')).toBeTruthy();
        expect(screen.getByText('João Santos')).toBeTruthy();
        expect(screen.getByText('Olá, preciso de ajuda!')).toBeTruthy();
        expect(screen.getByText('Obrigado!')).toBeTruthy();
    });

    it('renders customer phone numbers', () => {
        mockUseConversations.mockReturnValue({
            conversations: mockConversations,
            loading: false,
            refreshConversations: mockRefreshConversations,
        });

        render(<CustomerConversations />);

        expect(screen.getByText('5511999990001')).toBeTruthy();
        expect(screen.getByText('5511999990002')).toBeTruthy();
    });

    it('shows EmptyState when conversations list is empty', () => {
        mockUseConversations.mockReturnValue({
            conversations: [],
            loading: false,
            refreshConversations: mockRefreshConversations,
        });

        render(<CustomerConversations />);

        expect(screen.getByText('Nenhuma conversa')).toBeTruthy();
    });

    it('shows loading spinner while fetching conversations', () => {
        mockUseConversations.mockReturnValue({
            conversations: [],
            loading: true,
            refreshConversations: mockRefreshConversations,
        });

        const { container } = render(<CustomerConversations />);

        // Loading spinner should be present
        const spinner = container.querySelector('.animate-spin');
        expect(spinner).toBeTruthy();
    });

    it('shows message history when a conversation is selected', async () => {
        mockUseConversations.mockReturnValue({
            conversations: mockConversations,
            loading: false,
            refreshConversations: mockRefreshConversations,
        });
        mockUseMessages.mockReturnValue({
            messages: mockMessages,
            loading: false,
            sendMessage: vi.fn(),
        });

        const user = userEvent.setup();
        render(<CustomerConversations />);

        // Click on first conversation
        await user.click(screen.getByText('Maria Silva'));

        await waitFor(() => {
            expect(screen.getByText('Claro! Como posso ajudar?')).toBeTruthy();
        });
    });

    it('shows EmptyState for messages when selected conversation has no messages', async () => {
        mockUseConversations.mockReturnValue({
            conversations: mockConversations,
            loading: false,
            refreshConversations: mockRefreshConversations,
        });
        mockUseMessages.mockReturnValue({
            messages: [],
            loading: false,
            sendMessage: vi.fn(),
        });

        const user = userEvent.setup();
        render(<CustomerConversations />);

        await user.click(screen.getByText('Maria Silva'));

        await waitFor(() => {
            expect(screen.getByText('Sem mensagens')).toBeTruthy();
        });
    });

    it('passes sessionId=all to useConversations hook', () => {
        mockUseConversations.mockReturnValue({
            conversations: [],
            loading: false,
            refreshConversations: mockRefreshConversations,
        });

        render(<CustomerConversations />);

        expect(mockUseConversations).toHaveBeenCalledWith('all');
    });

    // ── Estados de erro (#829) ─────────────────────────────────────────
    describe('Estados de erro (#829)', () => {
        it('exibe ErrorState com retry quando a lista de conversas falha', () => {
            mockUseConversations.mockReturnValue({
                conversations: [],
                loading: false,
                error: 'Não foi possível carregar as conversas.',
                refreshConversations: mockRefreshConversations,
            });

            render(<CustomerConversations />);

            expect(screen.getByText('Não foi possível carregar as conversas.')).toBeTruthy();
            expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeTruthy();
        });

        it('botão "Tentar novamente" da lista chama refreshConversations', async () => {
            const user = userEvent.setup();
            mockUseConversations.mockReturnValue({
                conversations: [],
                loading: false,
                error: 'Não foi possível carregar as conversas.',
                refreshConversations: mockRefreshConversations,
            });

            render(<CustomerConversations />);

            await user.click(screen.getByRole('button', { name: /tentar novamente/i }));

            expect(mockRefreshConversations).toHaveBeenCalled();
        });

        it('exibe ErrorState no painel de mensagens quando useMessages falha', async () => {
            const mockRefetchMessages = vi.fn();
            mockUseConversations.mockReturnValue({
                conversations: mockConversations,
                loading: false,
                refreshConversations: mockRefreshConversations,
            });
            mockUseMessages.mockReturnValue({
                messages: [],
                loading: false,
                error: 'Não foi possível carregar as mensagens.',
                refetch: mockRefetchMessages,
                sendMessage: vi.fn(),
            });

            const user = userEvent.setup();
            render(<CustomerConversations />);

            await user.click(screen.getByText('Maria Silva'));

            await waitFor(() => {
                expect(screen.getByText('Não foi possível carregar as mensagens.')).toBeTruthy();
                expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeTruthy();
            });
        });

        it('botão "Tentar novamente" do painel chama refetch de mensagens', async () => {
            const mockRefetchMessages = vi.fn();
            mockUseConversations.mockReturnValue({
                conversations: mockConversations,
                loading: false,
                refreshConversations: mockRefreshConversations,
            });
            mockUseMessages.mockReturnValue({
                messages: [],
                loading: false,
                error: 'Não foi possível carregar as mensagens.',
                refetch: mockRefetchMessages,
                sendMessage: vi.fn(),
            });

            const user = userEvent.setup();
            render(<CustomerConversations />);

            await user.click(screen.getByText('Maria Silva'));

            const retryBtn = await screen.findByRole('button', { name: /tentar novamente/i });
            await user.click(retryBtn);

            expect(mockRefetchMessages).toHaveBeenCalled();
        });
    });
});
