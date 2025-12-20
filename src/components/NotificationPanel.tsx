
import React from 'react';
import { AppNotification, AppView } from '../types';
import { X, Bell, AlertTriangle, CheckCircle, Info, Clock, AlertCircle as AlertCircleIcon } from 'lucide-react';

interface NotificationPanelProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: AppNotification[];
  onMarkRead: (id: string) => void;
  onNavigate: (view: AppView, id: string) => void;
  onClearAll: () => void;
}

const NotificationPanel: React.FC<NotificationPanelProps> = ({ isOpen, onClose, notifications, onMarkRead, onNavigate, onClearAll }) => {
  if (!isOpen) return null;

  const getIcon = (type: string, priority: string) => {
      if (priority === 'high') return <AlertCircleIcon size={20} className="text-red-500" />;
      if (type === 'stock') return <AlertTriangle size={20} className="text-orange-500" />;
      if (type === 'invoice') return <AlertTriangle size={20} className="text-yellow-500" />;
      return <Info size={20} className="text-blue-500" />;
  };

  const sortedNotifications = [...notifications].sort((a, b) => b.date - a.date);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm lg:hidden" onClick={onClose}></div>
      <div className="fixed top-0 right-0 z-50 h-full w-80 md:w-96 bg-white dark:bg-slate-900 shadow-2xl border-l border-slate-200 dark:border-slate-800 transform transition-transform duration-300 ease-out animate-in slide-in-from-right">
        
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/80 dark:bg-slate-900/80 backdrop-blur">
            <div className="flex items-center gap-2">
                <Bell size={18} className="text-slate-600 dark:text-slate-300" />
                <h3 className="font-bold text-slate-800 dark:text-white">Notificações</h3>
                <span className="text-xs bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 px-2 py-0.5 rounded-full font-bold">
                    {notifications.filter(n => !n.read).length}
                </span>
            </div>
            <div className="flex gap-2">
                <button onClick={onClearAll} className="text-xs text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 font-medium">Limpar Tudo</button>
                <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
            </div>
        </div>

        <div className="overflow-y-auto h-[calc(100%-60px)] p-2">
            {sortedNotifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 space-y-3">
                    <CheckCircle size={48} className="opacity-20" />
                    <p>Tudo em dia!</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {sortedNotifications.map(note => (
                        <div 
                            key={note.id} 
                            className={`p-3 rounded-lg border transition-all ${note.read ? 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 opacity-60' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-sm border-l-4 border-l-indigo-500'}`}
                            onClick={() => {
                                onMarkRead(note.id);
                                if (note.linkTo) {
                                    onNavigate(note.linkTo.view, note.linkTo.id);
                                    onClose();
                                }
                            }}
                        >
                            <div className="flex gap-3">
                                <div className="mt-1 shrink-0">{getIcon(note.type, note.priority)}</div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-start">
                                        <h4 className={`text-sm font-semibold ${note.read ? 'text-slate-600 dark:text-slate-400' : 'text-slate-800 dark:text-white'}`}>{note.title}</h4>
                                        <span className="text-[10px] text-slate-400 whitespace-nowrap ml-2">{new Date(note.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">{note.message}</p>
                                    
                                    {!note.read && (
                                        <div className="flex justify-end mt-2">
                                            <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1 cursor-pointer">
                                                Revisar <Clock size={10} />
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
      </div>
    </>
  );
};

export default NotificationPanel;