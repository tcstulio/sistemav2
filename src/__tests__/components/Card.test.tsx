import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Card } from '../../components/ui/Card';

describe('Card', () => {
    it('renders children', () => {
        render(<Card>Card content</Card>);
        expect(screen.getByText('Card content')).toBeInTheDocument();
    });

    it('renders with header', () => {
        render(<Card header="Card Header">Content</Card>);
        expect(screen.getByText('Card Header')).toBeInTheDocument();
    });

    it('renders with footer', () => {
        render(<Card footer="Card Footer">Content</Card>);
        expect(screen.getByText('Card Footer')).toBeInTheDocument();
    });

    it('renders header and footer with content', () => {
        render(
            <Card header="Header" footer="Footer">
                <span>Middle</span>
            </Card>
        );
        expect(screen.getByText('Header')).toBeInTheDocument();
        expect(screen.getByText('Middle')).toBeInTheDocument();
        expect(screen.getByText('Footer')).toBeInTheDocument();
    });

    it('handles click when onClick provided', () => {
        const handleClick = vi.fn();
        render(<Card onClick={handleClick}>Clickable</Card>);
        fireEvent.click(screen.getByText('Clickable'));
        expect(handleClick).toHaveBeenCalled();
    });

    it('applies selected styling', () => {
        const { container } = render(<Card selected>Selected</Card>);
        expect(container.firstChild).toHaveClass('border-indigo-500');
    });

    it('applies hoverable styling', () => {
        const { container } = render(<Card hoverable>Hoverable</Card>);
        expect(container.firstChild).toHaveClass('hover:shadow-md');
    });

    it('renders as button when onClick is provided', () => {
        render(<Card onClick={() => {}}>Button Card</Card>);
        expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('renders as div when no onClick', () => {
        const { container } = render(<Card>Div Card</Card>);
        expect(container.querySelector('div')).toBeInTheDocument();
    });

    it('applies custom className', () => {
        const { container } = render(<Card className="custom-class">Custom</Card>);
        expect(container.firstChild).toHaveClass('custom-class');
    });

});