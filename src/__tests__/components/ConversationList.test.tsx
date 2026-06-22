import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConversationList } from '../../components/whatsapp/ConversationList';
import { WhatsAppConversation, WhatsAppAccount } from '../../types';

const mockConversations: WhatsAppConversation[] = [
    {
        id: '1',
        accountId: '1',
        customerName: 'John Doe',
        customerNumber: '1199999999',
        lastMessage: 'Hello there!',
        lastMessageTimestamp: Date.now() - 60000,
        unreadCount: 2,
        status: 'open',
        assignedUserId: '1',
    },
    {
        id: '2',
        accountId: '2',
        customerName: 'Jane Smith',
        customerNumber: '1188888888',
        lastMessage: 'Hi!',
        lastMessageTimestamp: Date.now() - 120000,
        unreadCount: 0,
        status: 'open',
    },
];

const mockAccounts: WhatsAppAccount[] = [
    { id: '1', name: 'Session 1', status: 'connected', phoneNumber: '1199999999', platform: 'WAHA' },
    { id: '2', name: 'Session 2', status: 'disconnected', phoneNumber: '1188888888', platform: 'WAHA' },
];

const defaultProps = {
    conversations: mockConversations,
    selectedConversationId: undefined as string | undefined,
    onSelect: () => {},
    accounts: mockAccounts,
    selectedAccount: '1',
    onAccountChange: () => {},
    onRefresh: () => {},
    isLoading: false,
    onCreateSession: () => {},
    searchTerm: '',
    onSearchChange: () => {},
    filterMode: 'all' as const,
    onFilterChange: () => {},
    currentUser: { id: '1', login: 'test' },
    users: [],
};

describe('ConversationList', () => {
    it('renders with conversations', () => {
        render(<ConversationList {...defaultProps} />);
        expect(document.body.textContent).toBeTruthy();
    });

    it('renders conversation names', () => {
        render(<ConversationList {...defaultProps} />);
        expect(screen.getByText('John Doe')).toBeTruthy();
        expect(screen.getByText('Jane Smith')).toBeTruthy();
    });

    it('renders title', () => {
        render(<ConversationList {...defaultProps} />);
        expect(screen.getByText('WhatsApp')).toBeTruthy();
    });

    it('renders account selector', () => {
        render(<ConversationList {...defaultProps} />);
        const select = document.querySelector('select');
        expect(select).toBeTruthy();
    });

    it('calls onSelect when clicking a conversation', () => {
        let selectedId: string | null = null;
        render(
            <ConversationList
                {...defaultProps}
                onSelect={(conv) => { selectedId = conv.id; }}
            />
        );
        screen.getByText('John Doe').click();
        expect(selectedId).toBe('1');
    });

    it('renders empty state when no conversations', () => {
        render(
            <ConversationList
                {...defaultProps}
                conversations={[]}
            />
        );
        expect(screen.getByText(/Nenhuma conversa/)).toBeTruthy();
    });

    it('renders unread badge', () => {
        render(<ConversationList {...defaultProps} />);
        const badge = document.querySelector('.bg-green-500.text-white');
        expect(badge).toBeTruthy();
    });

    it('shows CRM badge when conversation has customer_id', () => {
        const conversationsWithCRM: typeof mockConversations = [
            {
                ...mockConversations[0],
                customer_id: 'cust-1',
            },
            mockConversations[1],
        ];
        render(
            <ConversationList
                {...defaultProps}
                conversations={conversationsWithCRM}
            />
        );
        expect(screen.getByText('CRM')).toBeTruthy();
    });

    it('does not show CRM badge when conversation has no customer_id', () => {
        render(<ConversationList {...defaultProps} />);
        const crmBadge = screen.queryByText('CRM');
        expect(crmBadge).toBeNull();
    });
});
