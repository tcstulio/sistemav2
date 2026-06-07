import React, { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { Breadcrumbs } from '../ui/Breadcrumbs';
import NotificationPanel from '../NotificationPanel';
import GlobalSearch from '../GlobalSearch';
import VirtualAssistant from '../VirtualAssistant';
import { useDolibarr } from '../../context/DolibarrContext';
import { useNotifications, useNotificationActions } from '../../hooks/useNotifications';

export const MainLayout: React.FC = () => {
    const {
        config,
        notifications, setNotifications,
    } = useDolibarr();

    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isNotificationPanelOpen, setIsNotificationPanelOpen] = useState(false);
    const [isSearchOpen, setIsSearchOpen] = useState(false);

    const navigate = useNavigate();
    const notificationAction = useNotificationActions();

    const handleNavigate = (view: string, id: string = '') => {
        if (id) {
            navigate(`/${view}/${id}`);
        } else {
            navigate(`/${view}`);
        }
    };

    useNotifications(setNotifications, handleNavigate);

    if (!config) return null;

    return (
        <div className={`flex h-screen bg-slate-50 dark:bg-slate-950 transition-colors ${config.themeColor}`}>
            <Sidebar isOpen={isSidebarOpen} setIsOpen={setIsSidebarOpen} />

            <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
                <Header
                    setIsSidebarOpen={setIsSidebarOpen}
                    setIsNotificationPanelOpen={setIsNotificationPanelOpen}
                    setIsSearchOpen={setIsSearchOpen}
                />

                <Breadcrumbs className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0" />

                <div className="flex-1 overflow-hidden relative p-0">
                    <Outlet />
                </div>

                <VirtualAssistant />

                <NotificationPanel
                    isOpen={isNotificationPanelOpen}
                    onClose={() => setIsNotificationPanelOpen(false)}
                    notifications={notifications}
                    onMarkRead={async (id) => {
                        setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
                        await notificationAction('markRead', id);
                    }}
                    onMarkAllRead={async () => {
                        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
                        await notificationAction('markAllRead');
                    }}
                    onNavigate={handleNavigate}
                    onClearAll={async () => {
                        setNotifications([]);
                        await notificationAction('clearAll');
                    }}
                />

                <GlobalSearch
                    isOpen={isSearchOpen}
                    onClose={() => setIsSearchOpen(false)}
                    onNavigate={handleNavigate}
                />
            </main>
        </div>
    );
};
