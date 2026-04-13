import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageLayout } from '../../components/ui/PageLayout';

describe('PageLayout', () => {
    it('renders children', () => {
        render(<PageLayout>Page Content</PageLayout>);
        expect(screen.getByText('Page Content')).toBeInTheDocument();
    });

    it('renders with role main', () => {
        const { container } = render(<PageLayout>Content</PageLayout>);
        expect(container.querySelector('[role="main"]')).toBeInTheDocument();
    });

    it('renders with aria-label when title provided', () => {
        render(<PageLayout title="Page Title">Content</PageLayout>);
        expect(screen.getByRole('main')).toHaveAttribute('aria-label', 'Page Title');
    });

    it('does not have aria-label when title not provided', () => {
        render(<PageLayout>Content</PageLayout>);
        expect(screen.getByRole('main')).not.toHaveAttribute('aria-label');
    });

    it('applies custom className', () => {
        const { container } = render(<PageLayout className="custom-class">Content</PageLayout>);
        expect(container.firstChild).toHaveClass('custom-class');
    });

    it('renders nested content structure', () => {
        render(<PageLayout>Content</PageLayout>);
        const main = screen.getByRole('main');
        expect(main.firstChild).toHaveClass('mx-auto');
    });
});