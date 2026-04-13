import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Spinner, LoadingOverlay, LoadingCard, LoadingButton } from '../../components/ui/LoadingStates';
import { Button } from '../../components/ui/Button';

describe('Spinner', () => {
    it('renders', () => {
        const { container } = render(<Spinner />);
        expect(container.querySelector('svg')).toBeTruthy();
    });

    it('renders with different sizes', () => {
        const sizes = ['sm', 'md', 'lg'] as const;
        sizes.forEach(size => {
            const { container } = render(<Spinner size={size} />);
            expect(container.querySelector('svg')).toBeTruthy();
        });
    });

    it('applies custom className', () => {
        const { container } = render(<Spinner className="custom-spinner" />);
        expect(container.firstChild).toHaveClass('custom-spinner');
    });
});

describe('LoadingOverlay', () => {
    it('renders with default message', () => {
        render(<LoadingOverlay />);
        expect(screen.getByText('Carregando...')).toBeTruthy();
    });

    it('renders with custom message', () => {
        render(<LoadingOverlay message="Loading data..." />);
        expect(screen.getByText('Loading data...')).toBeTruthy();
    });

    it('has full-screen styling', () => {
        const { container } = render(<LoadingOverlay />);
        expect(container.firstChild).toHaveClass('fixed', 'inset-0');
    });
});

describe('LoadingCard', () => {
    it('renders with default message', () => {
        render(<LoadingCard />);
        expect(screen.getByText('Carregando...')).toBeTruthy();
    });

    it('renders with custom message', () => {
        render(<LoadingCard message="Fetching items..." />);
        expect(screen.getByText('Fetching items...')).toBeTruthy();
    });

    it('renders with custom className', () => {
        const { container } = render(<LoadingCard className="custom-loading" />);
        expect(container.firstChild).toHaveClass('custom-loading');
    });
});

describe('LoadingButton', () => {
    it('renders children when not loading', () => {
        render(<LoadingButton isLoading={false}>Save</LoadingButton>);
        expect(screen.getByText('Save')).toBeTruthy();
    });

    it('renders loading text when loading', () => {
        render(<LoadingButton isLoading={true}>Save</LoadingButton>);
        expect(screen.getByText('Aguarde...')).toBeTruthy();
    });

    it('renders custom loading text', () => {
        render(<LoadingButton isLoading={true} loadingText="Processing...">Save</LoadingButton>);
        expect(screen.getByText('Processing...')).toBeTruthy();
    });

    it('renders with different types', () => {
        const types = ['button', 'submit', 'reset'] as const;
        types.forEach(type => {
            const { container } = render(
                <LoadingButton isLoading={false} type={type}>Click</LoadingButton>
            );
            const button = container.querySelector('button');
            expect(button?.type).toBe(type);
        });
    });

    it('is disabled when loading', () => {
        const { container } = render(<LoadingButton isLoading={true}>Save</LoadingButton>);
        const button = container.querySelector('button');
        expect(button?.disabled).toBe(true);
    });
});