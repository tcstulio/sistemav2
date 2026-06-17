import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, ChevronDown, ChevronUp, MessageSquare } from 'lucide-react';
import { logger } from '../../utils/logger';
import { captureError } from '../../utils/errorStore';
import { captureException } from '../../utils/sentry';

const log = logger.child('ErrorBoundary');

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
    onError?: (error: Error, errorInfo: ErrorInfo) => void;
    showDetails?: boolean;
    componentName?: string;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
    showStack: boolean;
}

/**
 * Error Boundary Component
 *
 * Catches JavaScript errors anywhere in the child component tree,
 * logs those errors, and displays a fallback UI instead of crashing.
 *
 * Usage:
 * ```tsx
 * <ErrorBoundary componentName="VirtualAssistant">
 *   <VirtualAssistant />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            errorInfo: null,
            showStack: false
        };
    }

    static getDerivedStateFromError(error: Error): Partial<State> {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        this.setState({ errorInfo });

        captureError({
            message: error.message,
            stack: error.stack,
            componentStack: errorInfo.componentStack || undefined,
            componentName: this.props.componentName
        });

        // Reporta ao Sentry (no-op se não houver DSN configurado).
        captureException(error, {
            componentStack: errorInfo.componentStack || undefined,
            componentName: this.props.componentName
        });

        if (process.env.NODE_ENV !== 'production') {
            log.error('Caught error', { error: error.message, stack: errorInfo.componentStack });
        }

        this.props.onError?.(error, errorInfo);
    }

    handleReset = (): void => {
        this.setState({
            hasError: false,
            error: null,
            errorInfo: null,
            showStack: false
        });
    };

    toggleStack = (): void => {
        this.setState(prev => ({ showStack: !prev.showStack }));
    };

    render(): ReactNode {
        const { hasError, error, errorInfo, showStack } = this.state;
        const { children, fallback, showDetails = true, componentName } = this.props;

        if (hasError) {
            // Use custom fallback if provided
            if (fallback) {
                return fallback;
            }

            // Default error UI
            return (
                <div className="flex flex-col items-center justify-center p-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl min-h-[200px]">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-red-100 dark:bg-red-900/40 rounded-lg">
                            <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold text-red-800 dark:text-red-200">
                                {componentName ? `Erro em ${componentName}` : 'Algo deu errado'}
                            </h3>
                            <p className="text-sm text-red-600 dark:text-red-400">
                                {error?.message || 'Ocorreu um erro inesperado'}
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={this.handleReset}
                        className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors mb-4"
                    >
                        <RefreshCw className="w-4 h-4" />
                        Tentar novamente
                    </button>

                    <button
                        onClick={() => {
                            window.dispatchEvent(new CustomEvent('open-virtual-assistant', {
                                detail: { message: `Erro em ${componentName || 'página'}: ${error?.message || 'erro desconhecido'}` }
                            }));
                        }}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors mb-4"
                    >
                        <MessageSquare className="w-4 h-4" />
                        Reportar ao Assistente
                    </button>

                    {showDetails && errorInfo && (
                        <div className="w-full">
                            <button
                                onClick={this.toggleStack}
                                className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200 transition-colors"
                            >
                                {showStack ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                {showStack ? 'Ocultar detalhes' : 'Ver detalhes técnicos'}
                            </button>

                            {showStack && (
                                <pre className="mt-3 p-3 bg-red-100 dark:bg-red-900/40 rounded-lg text-xs text-red-800 dark:text-red-200 overflow-auto max-h-48 font-mono">
                                    {error?.stack}
                                    {'\n\nComponent Stack:'}
                                    {errorInfo.componentStack}
                                </pre>
                            )}
                        </div>
                    )}
                </div>
            );
        }

        return children;
    }
}

/**
 * HOC to wrap a component with ErrorBoundary
 */
export function withErrorBoundary<P extends object>(
    WrappedComponent: React.ComponentType<P>,
    componentName?: string
): React.FC<P> {
    const WithErrorBoundary: React.FC<P> = (props) => (
        <ErrorBoundary componentName={componentName || WrappedComponent.displayName || WrappedComponent.name}>
            <WrappedComponent {...props} />
        </ErrorBoundary>
    );

    WithErrorBoundary.displayName = `WithErrorBoundary(${componentName || WrappedComponent.displayName || WrappedComponent.name})`;

    return WithErrorBoundary;
}

/**
 * Specialized Error Boundary for AI components
 * Shows a more user-friendly message for AI-related errors
 */
export const AIErrorBoundary: React.FC<{ children: ReactNode; componentName?: string }> = ({
    children,
    componentName = 'Assistente IA'
}) => {
    const handleAIError = (error: Error, errorInfo: ErrorInfo) => {
        // Could send to error tracking service like Sentry
        if (process.env.NODE_ENV !== 'production') {
            log.error(`AI Error in ${componentName}`, { message: error.message });
        }
    };

    const fallback = (
        <div className="flex flex-col items-center justify-center p-6 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
            <div className="p-3 bg-amber-100 dark:bg-amber-900/40 rounded-full mb-4">
                <AlertTriangle className="w-8 h-8 text-amber-600 dark:text-amber-400" />
            </div>
            <h3 className="text-lg font-semibold text-amber-800 dark:text-amber-200 mb-2">
                {componentName} temporariamente indisponível
            </h3>
            <p className="text-sm text-amber-600 dark:text-amber-400 text-center max-w-md mb-4">
                O assistente de IA encontrou um problema. Por favor, tente novamente em alguns instantes.
            </p>
            <button
                onClick={() => window.location.reload()}
                className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors"
            >
                <RefreshCw className="w-4 h-4" />
                Recarregar página
            </button>
        </div>
    );

    return (
        <ErrorBoundary
            fallback={fallback}
            onError={handleAIError}
            componentName={componentName}
        >
            {children}
        </ErrorBoundary>
    );
};

export default ErrorBoundary;
