import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmailList } from '../../components/Email/EmailList';
import { EmailMessage } from '../../types/email';

const mockMessages: EmailMessage[] = [
    {
        id: 1,
        subject: 'Test Email 1',
        message: 'Test body 1',
        from: { name: 'John Doe', address: 'john@example.com' },
        to: [{ name: 'Jane', address: 'jane@example.com' }],
        date: new Date('2024-01-15T10:30:00').toISOString(),
        flags: ['\\Seen'],
    },
    {
        id: 2,
        subject: 'Test Email 2',
        message: 'Test body 2',
        from: { name: 'Alice Smith', address: 'alice@example.com' },
        to: [{ name: 'Jane', address: 'jane@example.com' }],
        date: new Date('2024-01-15T11:00:00').toISOString(),
        flags: [],
    },
    {
        id: 3,
        subject: 'Test Email 3',
        message: 'Test body 3',
        from: 'bob@example.com',
        to: [{ name: 'Jane', address: 'jane@example.com' }],
        date: new Date('2024-01-15T12:00:00').toISOString(),
        flags: ['\\Seen'],
    },
];

describe('EmailList', () => {
    it('renders with messages', () => {
        render(
            <EmailList
                messages={mockMessages}
                selectedMessageId={null}
                onSelect={() => {}}
                isLoading={false}
            />
        );
        expect(document.body.textContent).toBeTruthy();
    });

    it('renders loading state', () => {
        render(
            <EmailList
                messages={[]}
                selectedMessageId={null}
                onSelect={() => {}}
                isLoading={true}
            />
        );
        expect(screen.getByText('Carregando mensagens...')).toBeTruthy();
    });

    it('renders empty state', () => {
        render(
            <EmailList
                messages={[]}
                selectedMessageId={null}
                onSelect={() => {}}
                isLoading={false}
            />
        );
        expect(screen.getByText('Nenhuma mensagem nesta pasta.')).toBeTruthy();
    });

    it('renders email subjects', () => {
        render(
            <EmailList
                messages={mockMessages}
                selectedMessageId={null}
                onSelect={() => {}}
                isLoading={false}
            />
        );
        expect(screen.getByText('Test Email 1')).toBeTruthy();
        expect(screen.getByText('Test Email 2')).toBeTruthy();
        expect(screen.getByText('Test Email 3')).toBeTruthy();
    });

    it('renders sender names', () => {
        render(
            <EmailList
                messages={mockMessages}
                selectedMessageId={null}
                onSelect={() => {}}
                isLoading={false}
            />
        );
        expect(screen.getByText('John Doe')).toBeTruthy();
        expect(screen.getByText('Alice Smith')).toBeTruthy();
    });

    it('shows unread indicator for unread messages', () => {
        render(
            <EmailList
                messages={mockMessages}
                selectedMessageId={null}
                onSelect={() => {}}
                isLoading={false}
            />
        );
        const unreadDot = document.querySelector('.bg-blue-500');
        expect(unreadDot).toBeTruthy();
    });

    it('renders selected message with styling', () => {
        render(
            <EmailList
                messages={mockMessages}
                selectedMessageId={1}
                onSelect={() => {}}
                isLoading={false}
            />
        );
        expect(screen.getByText('Test Email 1')).toBeTruthy();
    });

    it('renders from string instead of object', () => {
        render(
            <EmailList
                messages={[mockMessages[2]]}
                selectedMessageId={null}
                onSelect={() => {}}
                isLoading={false}
            />
        );
        expect(screen.getByText('bob@example.com')).toBeTruthy();
    });

    it('handles selection mode with checkboxes', () => {
        render(
            <EmailList
                messages={mockMessages}
                selectedMessageId={null}
                onSelect={() => {}}
                isLoading={false}
                selectionMode={true}
                selectedUids={new Set([1])}
                onToggleSelect={() => {}}
                onSelectAll={() => {}}
            />
        );
        const checkboxes = document.querySelectorAll('input[type="checkbox"]');
        expect(checkboxes.length).toBeGreaterThan(0);
    });

    it('calls onSelect when clicking a message', () => {
        let selectedId: number | null = null;
        render(
            <EmailList
                messages={mockMessages}
                selectedMessageId={null}
                onSelect={(msg) => { selectedId = msg.id; }}
                isLoading={false}
            />
        );
        screen.getByText('Test Email 1').click();
        expect(selectedId).toBe(1);
    });
});
