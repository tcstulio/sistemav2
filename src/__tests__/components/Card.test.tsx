import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card } from '../../components/ui/Card';

describe('Card', () => {
    it('renders children', () => {
        render(<Card>Card Content</Card>);
        expect(screen.getByText('Card Content')).toBeTruthy();
    });

    it('renders with className', () => {
        const { container } = render(<Card className="custom-class">Content</Card>);
        expect(container.firstChild).toHaveClass('custom-class');
    });

    it('renders with default padding', () => {
        const { container } = render(<Card>Content</Card>);
        const content = container.querySelector('[class*="p-"]');
        expect(content).toBeTruthy();
    });

    it('renders with sm padding', () => {
        const { container } = render(<Card padding="sm">Content</Card>);
        const content = container.querySelector('[class*="p-3"]');
        expect(content).toBeTruthy();
    });

    it('renders with lg padding', () => {
        const { container } = render(<Card padding="lg">Content</Card>);
        const content = container.querySelector('[class*="p-6"]');
        expect(content).toBeTruthy();
    });

    it('renders header when provided', () => {
        render(<Card header="Card Header">Content</Card>);
        expect(screen.getByText('Card Header')).toBeTruthy();
    });

    it('renders footer when provided', () => {
        render(<Card footer="Card Footer">Content</Card>);
        expect(screen.getByText('Card Footer')).toBeTruthy();
    });

    it('renders with children in header area', () => {
        render(<Card header={<span data-testid="custom-header">Custom Header</span>}>Content</Card>);
        expect(screen.getByTestId('custom-header')).toBeTruthy();
    });

    it('renders as clickable button when onClick provided', () => {
        const handleClick = vi.fn();
        const { container } = render(<Card onClick={handleClick}>Content</Card>);
        expect(container.querySelector('button')).toBeTruthy();
    });

    it('shows selected state styling', () => {
        const { container } = render(<Card selected>Content</Card>);
        expect(container.firstChild).toHaveClass('border-indigo-500');
    });

    it('shows hoverable styling', () => {
        const { container } = render(<Card hoverable>Content</Card>);
        expect(container.firstChild).toHaveClass('hover:shadow-md');
    });

    it('calls onClick when clicked', () => {
        const handleClick = vi.fn();
        const { getByText } = render(<Card onClick={handleClick}>Clickable</Card>);
        getByText('Clickable').click();
        expect(handleClick).toHaveBeenCalled();
    });
});