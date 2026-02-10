import React from 'react';
import { EmailMessage } from '../../types/email';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface EmailListProps {
    messages: EmailMessage[];
    selectedMessageId: number | null;
    onSelect: (msg: EmailMessage) => void;
    isLoading: boolean;
    selectionMode?: boolean;
    selectedUids?: Set<number>;
    onToggleSelect?: (uid: number) => void;
    onSelectAll?: () => void;
}

export const EmailList: React.FC<EmailListProps> = ({
    messages,
    selectedMessageId,
    onSelect,
    isLoading,
    selectionMode = false,
    selectedUids = new Set(),
    onToggleSelect,
    onSelectAll
}) => {

    if (isLoading) {
        return <div className="p-8 text-center text-slate-400">Carregando mensagens...</div>;
    }

    if (messages.length === 0) {
        return <div className="p-8 text-center text-slate-400">Nenhuma mensagem nesta pasta.</div>;
    }

    return (
        <div className="flex flex-col h-full divide-y divide-slate-100 dark:divide-slate-800">
            {/* Select All header in selection mode */}
            {selectionMode && onSelectAll && (
                <div className="px-4 py-2 bg-blue-50 dark:bg-blue-900/20 flex items-center gap-3 border-b border-blue-100 dark:border-blue-900">
                    <input
                        type="checkbox"
                        checked={selectedUids.size === messages.length && messages.length > 0}
                        onChange={onSelectAll}
                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                        {selectedUids.size > 0 ? `${selectedUids.size} selecionado(s)` : 'Selecionar todos'}
                    </span>
                </div>
            )}

            {messages.map(msg => {
                const isSelected = selectedMessageId === msg.id;
                const isChecked = selectedUids.has(msg.id);
                const fromName = typeof msg.from === 'string' ? msg.from : (msg.from.name || msg.from.address);
                const date = new Date(msg.date);
                const isUnread = !msg.flags?.includes('\\Seen');
                const threadCount = (msg as any).threadCount;

                return (
                    <div
                        key={msg.id}
                        onClick={() => {
                            if (selectionMode && onToggleSelect) {
                                onToggleSelect(msg.id);
                            } else {
                                onSelect(msg);
                            }
                        }}
                        className={`p-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${
                            isSelected ? 'bg-blue-50 dark:bg-blue-900/10 border-l-4 border-blue-500' : 'border-l-4 border-transparent'
                        } ${isChecked ? 'bg-blue-50/50 dark:bg-blue-900/5' : ''}`}
                    >
                        <div className="flex items-start gap-3">
                            {/* Checkbox or Unread Dot */}
                            {selectionMode ? (
                                <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(e) => {
                                        e.stopPropagation();
                                        onToggleSelect?.(msg.id);
                                    }}
                                    onClick={e => e.stopPropagation()}
                                    className="mt-1 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 shrink-0"
                                />
                            ) : (
                                isUnread && (
                                    <div className="mt-2 w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0" />
                                )
                            )}

                            <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-start mb-1">
                                    <h3 className={`text-sm truncate pr-2 ${
                                        isUnread ? 'font-bold text-slate-900 dark:text-white' : 'font-semibold text-slate-700 dark:text-slate-300'
                                    } ${isSelected ? 'text-blue-900 dark:text-blue-200' : ''}`}>
                                        {fromName}
                                    </h3>
                                    <div className="flex items-center gap-2 shrink-0">
                                        {threadCount && threadCount > 1 && (
                                            <span className="text-[10px] px-1.5 py-0.5 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-full font-medium">
                                                {threadCount}
                                            </span>
                                        )}
                                        <span className="text-xs text-slate-400 whitespace-nowrap">
                                            {format(date, 'dd/MM HH:mm', { locale: ptBR })}
                                        </span>
                                    </div>
                                </div>
                                <p className={`text-sm truncate mb-1 ${
                                    isUnread ? 'text-slate-800 dark:text-slate-200 font-medium' : 'text-slate-600 dark:text-slate-400'
                                } ${isSelected ? 'text-slate-700 dark:text-slate-300' : ''}`}>
                                    {msg.subject}
                                </p>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};
