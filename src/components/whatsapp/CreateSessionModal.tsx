import React, { useState } from 'react';
import { X, Wifi } from 'lucide-react';

interface CreateSessionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSessionCreated: (sessionId: string, name: string) => void;
    isLoading?: boolean;
}

const slugify = (text: string): string => {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
};

export const CreateSessionModal: React.FC<CreateSessionModalProps> = ({
    isOpen,
    onClose,
    onSessionCreated,
    isLoading = false
}) => {
    const [name, setName] = useState('');

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;

        const slug = slugify(trimmed);
        const sessionId = `${slug}_${Math.floor(Math.random() * 10000)}`;
        onSessionCreated(sessionId, trimmed);
        setName('');
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
            <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-700 relative">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors"
                >
                    <X size={24} />
                </button>

                <div className="text-center mb-6">
                    <div className="mx-auto w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-3">
                        <Wifi className="text-green-600 dark:text-green-400" size={24} />
                    </div>
                    <h3 className="text-2xl font-bold text-slate-800 dark:text-white mb-2">Nova Conta WhatsApp</h3>
                    <p className="text-slate-500 dark:text-slate-400 text-sm">
                        Dê um nome para identificar esta conta (ex: Vendas, Suporte, Pessoal)
                    </p>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="mb-6">
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            Nome da Conta
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Ex: Vendas, Suporte, Financeiro..."
                            className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:ring-2 focus:ring-green-500 outline-none text-sm"
                            autoFocus
                            maxLength={50}
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={!name.trim() || isLoading}
                        className="w-full py-3 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-colors"
                    >
                        {isLoading ? 'Criando...' : 'Criar e Conectar'}
                    </button>
                </form>
            </div>
        </div>
    );
};
