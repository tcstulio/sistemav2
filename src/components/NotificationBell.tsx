import React from 'react';
import { Bell } from 'lucide-react';

interface NotificationBellProps {
    unreadCount: number;
    onClick: () => void;
}

/**
 * Sino de notificações do header (#1004).
 * Exibe um badge com a contagem de não-lidas e é totalmente acessível por teclado/leitor de tela.
 */
export const NotificationBell: React.FC<NotificationBellProps> = ({ unreadCount, onClick }) => {
    const hasUnread = unreadCount > 0;
    return (
        <button
            type="button"
            aria-label={hasUnread ? `Notificações (${unreadCount} não lidas)` : 'Notificações'}
            aria-haspopup="dialog"
            title="Notificações"
            onClick={onClick}
            className="relative p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
        >
            <Bell size={20} />
            {hasUnread && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border border-white dark:border-slate-900 leading-none">
                    {unreadCount > 99 ? '99+' : unreadCount}
                </span>
            )}
        </button>
    );
};
