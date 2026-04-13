import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PageHeader } from '../../components/ui/PageHeader';

describe('PageHeader', () => {
    it('renders title', () => {
        render(<PageHeader title="Page Title" />);
        expect(screen.getByText('Page Title')).toBeInTheDocument();
    });

    it('renders subtitle when provided', () => {
        render(<PageHeader title="Title" subtitle="Page Subtitle" />);
        expect(screen.getByText('Page Subtitle')).toBeInTheDocument();
    });

    it('does not render subtitle when not provided', () => {
        const { container } = render(<PageHeader title="Title" />);
        expect(container.querySelector('p')).not.toBeInTheDocument();
    });

    it('renders actions when provided', () => {
        render(
            <PageHeader
                title="Title"
                actions={<button>Action</button>}
            />
        );
        expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument();
    });

    it('renders back button when onBack is provided', () => {
        const handleBack = vi.fn();
        render(<PageHeader title="Title" onBack={handleBack} />);
        const backButton = screen.getByRole('button');
        fireEvent.click(backButton);
        expect(handleBack).toHaveBeenCalled();
    });

    it('does not render back button when onBack is not provided', () => {
        render(<PageHeader title="Title" />);
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('renders tabs when provided', () => {
        render(
            <PageHeader
                title="Title"
                tabs={<div>Tab Content</div>}
            />
        );
        expect(screen.getByText('Tab Content')).toBeInTheDocument();
    });

    it('applies custom className', () => {
        const { container } = render(<PageHeader title="Title" className="custom-class" />);
        expect(container.firstChild).toHaveClass('custom-class');
    });

    it('renders with ReactNode title', () => {
        render(<PageHeader title={<span>React Title</span>} />);
        expect(screen.getByText('React Title')).toBeInTheDocument();
    });
});