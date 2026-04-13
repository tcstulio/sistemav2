import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Spinner, LoadingOverlay, LoadingCard, LoadingButton, Skeleton, SkeletonText, SkeletonCard, SkeletonTableRow, EmptyState, ErrorState } from '../../components/ui/LoadingStates';

describe('LoadingStates', () => {
    describe('Spinner', () => {
        it('renders spinner', () => {
            const { container } = render(<Spinner />);
            expect(container.querySelector('svg')).toBeInTheDocument();
        });

        it('applies default size', () => {
            const { container } = render(<Spinner />);
            expect(container.querySelector('svg')).toHaveClass('h-6', 'w-6');
        });

        it('applies small size', () => {
            const { container } = render(<Spinner size="sm" />);
            expect(container.querySelector('svg')).toHaveClass('h-4', 'w-4');
        });

        it('applies large size', () => {
            const { container } = render(<Spinner size="lg" />);
            expect(container.querySelector('svg')).toHaveClass('h-8', 'w-8');
        });

        it('applies custom className', () => {
            const { container } = render(<Spinner className="custom-class" />);
            expect(container.querySelector('svg')).toHaveClass('custom-class');
        });
    });

    describe('LoadingOverlay', () => {
        it('renders default message', () => {
            render(<LoadingOverlay />);
            expect(screen.getByText('Carregando...')).toBeInTheDocument();
        });

        it('renders custom message', () => {
            render(<LoadingOverlay message="Aguarde..." />);
            expect(screen.getByText('Aguarde...')).toBeInTheDocument();
        });

        it('renders spinner', () => {
            const { container } = render(<LoadingOverlay />);
            expect(container.querySelector('svg')).toBeInTheDocument();
        });
    });

    describe('LoadingCard', () => {
        it('renders default message', () => {
            render(<LoadingCard />);
            expect(screen.getByText('Carregando...')).toBeInTheDocument();
        });

        it('renders custom message', () => {
            render(<LoadingCard message="Carregando dados..." />);
            expect(screen.getByText('Carregando dados...')).toBeInTheDocument();
        });

        it('renders spinner', () => {
            const { container } = render(<LoadingCard />);
            expect(container.querySelector('svg')).toBeInTheDocument();
        });

        it('applies custom className', () => {
            const { container } = render(<LoadingCard className="custom-class" />);
            expect(container.firstChild).toHaveClass('custom-class');
        });
    });

    describe('LoadingButton', () => {
        it('renders children when not loading', () => {
            render(<LoadingButton isLoading={false}>Click me</LoadingButton>);
            expect(screen.getByText('Click me')).toBeInTheDocument();
        });

        it('renders loading text when loading', () => {
            render(<LoadingButton isLoading={true}>Click me</LoadingButton>);
            expect(screen.getByText('Aguarde...')).toBeInTheDocument();
        });

        it('renders custom loading text', () => {
            render(<LoadingButton isLoading={true} loadingText="Salvando...">Click me</LoadingButton>);
            expect(screen.getByText('Salvando...')).toBeInTheDocument();
        });

        it('disables button when loading', () => {
            render(<LoadingButton isLoading={true}>Click me</LoadingButton>);
            expect(screen.getByRole('button')).toBeDisabled();
        });

        it('disables button when disabled prop is true', () => {
            render(<LoadingButton isLoading={false} disabled>Click me</LoadingButton>);
            expect(screen.getByRole('button')).toBeDisabled();
        });

        it('handles click when not loading', () => {
            const handleClick = vi.fn();
            render(<LoadingButton isLoading={false} onClick={handleClick}>Click me</LoadingButton>);
            fireEvent.click(screen.getByRole('button'));
            expect(handleClick).toHaveBeenCalled();
        });
    });

    describe('Skeleton', () => {
        it('renders skeleton', () => {
            const { container } = render(<Skeleton />);
            expect(container.querySelector('div')).toHaveClass('animate-pulse');
        });

        it('applies custom className', () => {
            const { container } = render(<Skeleton className="custom-class" />);
            expect(container.querySelector('div')).toHaveClass('custom-class');
        });
    });

    describe('SkeletonText', () => {
        it('renders default number of lines', () => {
            const { container } = render(<SkeletonText />);
            expect(container.querySelectorAll('div.animate-pulse')).toHaveLength(3);
        });

        it('renders custom number of lines', () => {
            const { container } = render(<SkeletonText lines={5} />);
            expect(container.querySelectorAll('div.animate-pulse')).toHaveLength(5);
        });
    });

    describe('SkeletonCard', () => {
        it('renders skeleton card', () => {
            const { container } = render(<SkeletonCard />);
            expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
        });
    });

    describe('SkeletonTableRow', () => {
        it('renders default number of columns', () => {
            const { container } = render(<SkeletonTableRow />);
            expect(container.querySelectorAll('td')).toHaveLength(5);
        });

        it('renders custom number of columns', () => {
            const { container } = render(<SkeletonTableRow columns={3} />);
            expect(container.querySelectorAll('td')).toHaveLength(3);
        });
    });

    describe('EmptyState', () => {
        it('renders title', () => {
            render(<EmptyState title="No items" />);
            expect(screen.getByText('No items')).toBeInTheDocument();
        });

        it('renders description when provided', () => {
            render(<EmptyState title="No items" description="Add your first item" />);
            expect(screen.getByText('Add your first item')).toBeInTheDocument();
        });

        it('renders icon when provided', () => {
            render(<EmptyState title="No items" icon={<span>icon</span>} />);
            expect(screen.getByText('icon')).toBeInTheDocument();
        });

        it('renders action when provided', () => {
            render(<EmptyState title="No items" action={<button>Add</button>} />);
            expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
        });
    });

    describe('ErrorState', () => {
        it('renders default title', () => {
            render(<ErrorState message="Something went wrong" />);
            expect(screen.getByText('Ocorreu um erro')).toBeInTheDocument();
        });

        it('renders custom title', () => {
            render(<ErrorState title="Erro" message="Algo falhou" />);
            expect(screen.getByText('Erro')).toBeInTheDocument();
        });

        it('renders message', () => {
            render(<ErrorState message="Network error" />);
            expect(screen.getByText('Network error')).toBeInTheDocument();
        });

        it('renders retry button when onRetry provided', () => {
            render(<ErrorState message="Error" onRetry={() => {}} />);
            expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
        });

        it('calls onRetry when retry button clicked', () => {
            const handleRetry = vi.fn();
            render(<ErrorState message="Error" onRetry={handleRetry} />);
            fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
            expect(handleRetry).toHaveBeenCalled();
        });
    });
});