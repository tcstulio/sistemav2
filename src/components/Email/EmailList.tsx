import React from 'react';
import { EmailMessage } from '../../types/email';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface EmailListProps {
    messages: EmailMessage[];
    selectedMessageId: number | null;
    onSelect: (msg: EmailMessage) => void;
    isLoading: boolean;
}

export const EmailList: React.FC<EmailListProps> = ({ messages, selectedMessageId, onSelect, isLoading }) => {

    if (isLoading) {
        return <div className="p-8 text-center text-slate-400">Carregando mensagens...</div>;
    }

    if (messages.length === 0) {
        return <div className="p-8 text-center text-slate-400">Nenhuma mensagem nesta pasta.</div>;
    }

    return (
        <div className="flex flex-col h-full divide-y divide-slate-100 dark:divide-slate-800">
            {messages.map(msg => {
                const isSelected = selectedMessageId === msg.id;
                const fromName = typeof msg.from === 'string' ? msg.from : (msg.from.name || msg.from.address);
                const date = new Date(msg.date);

                return (
                    <div
                        key={msg.id}
                        onClick={() => onSelect(msg)}
                        className={`p-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${isSelected ? 'bg-blue-50 dark:bg-blue-900/10 border-l-4 border-blue-500' : 'border-l-4 border-transparent'
                            }`}
                    >
                        <div className="flex justify-between items-start mb-1">
                            <h3 className={`font-semibold text-sm truncate pr-2 ${isSelected ? 'text-blue-900 dark:text-blue-200' : 'text-slate-900 dark:text-slate-100'}`}>
                                {fromName}
                            </h3>
                            <span className="text-xs text-slate-400 shrink-0 whitespace-nowrap">
                                {format(date, 'dd/MM HH:mm', { locale: ptBR })}
                            </span>
                        </div>
                        <p className={`text-sm truncate mb-1 ${isSelected ? 'text-slate-700 dark:text-slate-300' : 'text-slate-600 dark:text-slate-400'}`}>
                            {msg.subject}
                        </p>
                    </div>
                );
            })}
        </div>
    );
};
