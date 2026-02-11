import React, { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { logger } from '../utils/logger';

const log = logger.child('ErrorBoundary');

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            errorInfo: null
        };
    }

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error, errorInfo: null };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        log.error(`Uncaught error: ${error.message}`, errorInfo);
        this.setState({ errorInfo });
    }

    private handleReload = () => {
        window.location.reload();
    };

    private handleGoHome = () => {
        window.location.href = '/';
    };

    public render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4 font-sans text-slate-800 dark:text-slate-200">
                    <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                        <div className="bg-red-50 dark:bg-red-900/20 p-6 flex flex-col items-center border-b border-red-100 dark:border-red-900/30">
                            <div className="w-16 h-16 bg-red-100 dark:bg-red-800/30 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center mb-4">
                                <AlertTriangle size={32} />
                            </div>
                            <h1 className="text-xl font-bold text-red-700 dark:text-red-400">Algo deu errado</h1>
                        </div>

                        <div className="p-6">
                            <p className="text-slate-600 dark:text-slate-400 mb-4 text-center">
                                Ocorreu um erro inesperado na aplicação. Nossa equipe foi notificada (log local).
                            </p>

                            <div className="bg-slate-100 dark:bg-slate-950 p-3 rounded-lg text-xs font-mono text-slate-500 overflow-x-auto mb-6 max-h-32">
                                {this.state.error?.toString()}
                            </div>

                            <div className="flex gap-3">
                                <button
                                    onClick={this.handleReload}
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors"
                                >
                                    <RefreshCw size={18} /> Recarregar Página
                                </button>
                                <button
                                    onClick={this.handleGoHome}
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg font-medium transition-colors"
                                >
                                    <Home size={18} /> Início
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
