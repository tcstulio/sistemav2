import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary, withErrorBoundary, AIErrorBoundary } from '../../components/ui/ErrorBoundary';
import React from 'react';

describe('ErrorBoundary', () => {
    it('renders children when no error', () => {
        render(
            <ErrorBoundary>
                <div data-testid="child">Child Content</div>
            </ErrorBoundary>
        );
        expect(screen.getByTestId('child')).toBeTruthy();
        expect(screen.getByText('Child Content')).toBeTruthy();
    });

    it('renders custom fallback on error', () => {
        const ThrowError = () => {
            throw new Error('Test error');
        };

        render(
            <ErrorBoundary fallback={<div data-testid="fallback">Custom Fallback</div>}>
                <ThrowError />
            </ErrorBoundary>
        );

        expect(screen.getByTestId('fallback')).toBeTruthy();
    });

    it('calls onError callback when error occurs', () => {
        const handleError = vi.fn();
        const ThrowError = () => {
            throw new Error('Test error');
        };

        render(
            <ErrorBoundary onError={handleError}>
                <ThrowError />
            </ErrorBoundary>
        );

        expect(handleError).toHaveBeenCalled();
    });

    it('renders default error UI with component name', () => {
        const ThrowError = () => {
            throw new Error('Test error message');
        };

        render(
            <ErrorBoundary componentName="TestComponent">
                <ThrowError />
            </ErrorBoundary>
        );

        expect(screen.getByText(/Erro em TestComponent/i)).toBeTruthy();
    });

    it('has a retry button in default error UI', () => {
        const ThrowError = () => {
            throw new Error('Test error');
        };

        render(
            <ErrorBoundary>
                <ThrowError />
            </ErrorBoundary>
        );

        expect(screen.getByText(/tentar novamente/i)).toBeTruthy();
    });
});

describe('withErrorBoundary HOC', () => {
    it('wraps component with ErrorBoundary', () => {
        const TestComponent = () => <div data-testid="wrapped">Wrapped</div>;
        const Wrapped = withErrorBoundary(TestComponent, 'TestComponent');

        render(<Wrapped />);
        expect(screen.getByTestId('wrapped')).toBeTruthy();
    });
});

describe('AIErrorBoundary', () => {
    it('renders children when no error', () => {
        render(
            <AIErrorBoundary>
                <div data-testid="ai-child">AI Content</div>
            </AIErrorBoundary>
        );
        expect(screen.getByTestId('ai-child')).toBeTruthy();
    });

    it('shows reload button on error', () => {
        const ThrowError = () => {
            throw new Error('AI Error');
        };

        render(
            <AIErrorBoundary>
                <ThrowError />
            </AIErrorBoundary>
        );

        expect(screen.getByText(/recarregar página/i)).toBeTruthy();
    });
});