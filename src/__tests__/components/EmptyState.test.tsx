import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Package, Inbox } from 'lucide-react';
import { EmptyState } from '../../components/ui/EmptyState';
import { Button } from '../../components/ui/Button';

describe('EmptyState', () => {
    it('renders title', () => {
        render(<EmptyState title="No items found" />);
        expect(screen.getByText('No items found')).toBeTruthy();
    });

    it('renders description when provided', () => {
        render(<EmptyState title="No items" description="Add your first item" />);
        expect(screen.getByText('Add your first item')).toBeTruthy();
    });

    it('does not render description when not provided', () => {
        const { container } = render(<EmptyState title="No items" />);
        expect(container.querySelector('p')).toBeNull();
    });

    it('renders icon when provided', () => {
        render(<EmptyState title="No items" icon={Package} />);
        const icon = document.querySelector('svg');
        expect(icon).toBeTruthy();
    });

    it('renders action when provided', () => {
        render(
            <EmptyState
                title="No items"
                action={<Button>Add Item</Button>}
            />
        );
        expect(screen.getByText('Add Item')).toBeTruthy();
    });

    it('renders with different sizes', () => {
        const sizes = ['sm', 'md', 'lg'] as const;
        sizes.forEach(size => {
            const { container } = render(
                <EmptyState title="Test" size={size} />
            );
            expect(container.querySelector('.text-center')).toBeTruthy();
        });
    });

    it('renders with custom className', () => {
        const { container } = render(
            <EmptyState title="Test" className="custom-empty" />
        );
        expect(container.firstChild).toHaveClass('custom-empty');
    });

    it('renders with icon and action', () => {
        render(
            <EmptyState
                title="Empty inbox"
                icon={Inbox}
                description="No messages yet"
                action={<Button>Send Message</Button>}
            />
        );
        expect(screen.getByText('Empty inbox')).toBeTruthy();
        expect(screen.getByText('No messages yet')).toBeTruthy();
        expect(screen.getByText('Send Message')).toBeTruthy();
    });
});