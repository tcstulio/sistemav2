import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Package } from 'lucide-react';
import { EmptyState } from '../../components/ui/EmptyState';
import { Button } from '../../components/ui/Button';

describe('EmptyState', () => {
    it('renders title', () => {
        render(<EmptyState title="Nenhum produto encontrado" />);
        expect(screen.getByText('Nenhum produto encontrado')).toBeInTheDocument();
    });

    it('renders description when provided', () => {
        render(<EmptyState title="Nenhum produto" description="Adicione seu primeiro produto" />);
        expect(screen.getByText('Adicione seu primeiro produto')).toBeInTheDocument();
    });

    it('does not render description when not provided', () => {
        const { container } = render(<EmptyState title="Only Title" />);
        expect(container.querySelector('p')).not.toBeInTheDocument();
    });

    it('renders icon when provided', () => {
        render(<EmptyState title="Test" icon={Package} />);
        const iconDiv = screen.getByText('Test').previousElementSibling;
        expect(iconDiv?.querySelector('svg')).toBeInTheDocument();
    });

    it('renders action when provided', () => {
        render(
            <EmptyState
                title="No items"
                action={<Button>Add Item</Button>}
            />
        );
        expect(screen.getByText('Add Item')).toBeInTheDocument();
    });

    it('renders with custom className', () => {
        const { container } = render(<EmptyState title="Custom" className="my-class" />);
        expect(container.firstChild).toHaveClass('my-class');
    });

    it('renders default size', () => {
        const { container } = render(<EmptyState title="Size Test" />);
        expect(container.firstChild).toHaveClass('py-12');
    });

    it('renders small size', () => {
        const { container } = render(<EmptyState title="Small" size="sm" />);
        expect(container.firstChild).toHaveClass('py-6');
    });

    it('renders large size', () => {
        const { container } = render(<EmptyState title="Large" size="lg" />);
        expect(container.firstChild).toHaveClass('py-20');
    });
});