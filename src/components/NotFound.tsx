import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Home, ArrowLeft, Search, HelpCircle } from 'lucide-react';

interface NotFoundProps {
    title?: string;
    message?: string;
    showSearch?: boolean;
}

/**
 * 404 Not Found Page
 *
 * Displays a user-friendly error page when a route is not found.
 * Provides navigation options to help users get back on track.
 */
export const NotFound: React.FC<NotFoundProps> = ({
    title = 'Página não encontrada',
    message = 'A página que você está procurando não existe ou foi movida.',
    showSearch = true
}) => {
    const navigate = useNavigate();

    const handleGoBack = () => {
        if (window.history.length > 2) {
            navigate(-1);
        } else {
            navigate('/');
        }
    };

    const handleGoHome = () => {
        navigate('/');
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
            {/* 404 Illustration */}
            <div className="relative mb-8">
                <div className="text-[120px] md:text-[180px] font-black text-slate-100 dark:text-slate-800 select-none">
                    404
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                    <div className="p-4 bg-white dark:bg-slate-900 rounded-full shadow-lg">
                        <HelpCircle className="w-12 h-12 md:w-16 md:h-16 text-indigo-500" />
                    </div>
                </div>
            </div>

            {/* Error Message */}
            <h1 className="text-2xl md:text-3xl font-bold text-slate-800 dark:text-white mb-3 text-center">
                {title}
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-center max-w-md mb-8">
                {message}
            </p>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-3">
                <button
                    onClick={handleGoBack}
                    className="flex items-center justify-center gap-2 px-6 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Voltar
                </button>
                <button
                    onClick={handleGoHome}
                    className="flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                >
                    <Home className="w-4 h-4" />
                    Ir para o início
                </button>
            </div>

            {/* Helpful Links */}
            <div className="mt-12 text-center">
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                    Páginas populares:
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                    {[
                        { path: '/', label: 'Dashboard' },
                        { path: '/customers', label: 'Clientes' },
                        { path: '/invoices', label: 'Faturas' },
                        { path: '/projects', label: 'Projetos' },
                        { path: '/whatsapp', label: 'WhatsApp' },
                    ].map(link => (
                        <button
                            key={link.path}
                            onClick={() => navigate(link.path)}
                            className="px-3 py-1.5 text-sm bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                        >
                            {link.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default NotFound;
