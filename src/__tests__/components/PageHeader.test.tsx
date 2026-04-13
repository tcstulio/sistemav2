import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';

describe('PageHeader', () => {
    it('renders title', () => {
        render(<PageHeader title="Page Title" />);
        expect(screen.getByText('Page Title')).toBeTruthy();
    });

    it('renders subtitle when provided', () => {
        render(<PageHeader title="Title" subtitle="Page subtitle" />);
        expect(screen.getByText('Page subtitle')).toBeTruthy();
    });

    it('renders actions when provided', () => {
        render(
            <PageHeader
                title="Title"
                actions={<Button>Action</Button>}
            />
        );
        expect(screen.getByText('Action')).toBeTruthy();
    });

    it('shows back button when onBack is provided', () => {
        render(<PageHeader title="Title" onBack={vi.fn()} />);
        const backButton = document.querySelector('button');
        expect(backButton).toBeTruthy();
    });

    it('does not show back button when onBack is not provided', () => {
        render(<PageHeader title="Title" />);
        const buttons = document.querySelectorAll('button');
        expect(buttons.length).toBe(0);
    });

    it('calls onBack when back button is clicked', () => {
        const handleBack = vi.fn();
        render(<PageHeader title="Title" onBack={handleBack} />);
        const backButton = document.querySelector('button');
        backButton?.click();
        expect(handleBack).toHaveBeenCalled();
    });

    it('renders with custom className', () => {
        const { container } = render(
            <PageHeader title="Title" className="custom-header" />
        );
        expect(container.firstChild).toHaveClass('custom-header');
    });

    it('renders tabs when provided', () => {
        render(
            <PageHeader
                title="Title"
                tabs={<div data-testid="tabs">Tab Content</div>}
            />
        );
        expect(screen.getByTestId('tabs')).toBeTruthy();
    });
});