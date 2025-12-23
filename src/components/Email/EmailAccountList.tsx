import React from 'react';
import { EmailAccount } from '../../types/email';
import { Mail, Plus, Trash2 } from 'lucide-react';

interface EmailAccountListProps {
    accounts: EmailAccount[];
    selectedAccountId: string | null;
    onSelect: (id: string) => void;
    onAddAccount: () => void;
    onDeleteAccount: (id: string) => void;
}

export const EmailAccountList: React.FC<EmailAccountListProps> = ({
    accounts,
    selectedAccountId,
    onSelect,
    onAddAccount,
    onDeleteAccount
}) => {
    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
                <h2 className="text-lg font-bold text-slate-800 dark:text-white">Contas</h2>
                <button
                    onClick={onAddAccount}
                    className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    title="Adicionar Conta"
                >
                    <Plus size={18} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {accounts.map(account => (
                    <div
                        key={account.id}
                        onClick={() => onSelect(account.id)}
                        className={`group flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all ${selectedAccountId === account.id
                                ? 'bg-blue-100 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800'
                                : 'hover:bg-white dark:hover:bg-slate-800 border border-transparent hover:border-slate-200 dark:hover:border-slate-700'
                            }`}
                    >
                        <div className="flex items-center gap-3 overflow-hidden">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${selectedAccountId === account.id ? 'bg-blue-500 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-500'
                                }`}>
                                <Mail size={20} />
                            </div>
                            <div className="min-w-0">
                                <p className={`text-sm font-semibold truncate ${selectedAccountId === account.id ? 'text-blue-900 dark:text-blue-100' : 'text-slate-800 dark:text-slate-200'}`}>
                                    {account.name}
                                </p>
                                <p className="text-xs text-slate-500 truncate">{account.email}</p>
                            </div>
                        </div>

                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                if (window.confirm('Remover conta?')) onDeleteAccount(account.id);
                            }}
                            className="p-2 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-opacity"
                        >
                            <Trash2 size={16} />
                        </button>
                    </div>
                ))}

                {accounts.length === 0 && (
                    <div className="text-center p-4 text-slate-400 text-sm">
                        Nenhuma conta configurada.
                    </div>
                )}
            </div>
        </div>
    );
};
