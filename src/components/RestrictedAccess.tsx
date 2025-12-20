import React from 'react';
import { Layout, Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface RestrictedAccessProps {
    view: string;
}

export const RestrictedAccess: React.FC<RestrictedAccessProps> = ({ view }) => {
    const navigate = useNavigate();

    return (
        <div className="flex flex-col items-center justify-center h-full text-slate-500 dark:text-slate-400">
            <div className="bg-red-50 dark:bg-red-900/10 p-6 rounded-full mb-4">
                <Lock size={48} className="text-red-500" />
            </div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-2">Acesso Restrito</h2>
            <p className="max-w-md text-center mb-6">
                Você não tem permissão para acessar o módulo <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{view}</span>.
                Entre em contato com o administrador se acredita que isso é um erro.
            </p>
            <button
                onClick={() => navigate('/')}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors flex items-center gap-2"
            >
                <Layout size={18} /> Voltar ao Painel
            </button>
        </div>
    );
};
