import React, { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import NotificationPanel from '../NotificationPanel';
import GlobalSearch from '../GlobalSearch';
import VirtualAssistant from '../VirtualAssistant';
import { useDolibarr } from '../../context/DolibarrContext';

export const MainLayout: React.FC = () => {
    const {
        config, setConfig,
        notifications, setNotifications,
    } = useDolibarr();

    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isNotificationPanelOpen, setIsNotificationPanelOpen] = useState(false);
    const [isSearchOpen, setIsSearchOpen] = useState(false);

    const navigate = useNavigate();

    // Adapter for legacy onNavigate support in GlobalSearch/Notifications
    // Many child components still use (view, id) signature.
    const handleNavigate = (view: string, id: string = '') => {
        // Map abstract view names to paths if necessary, or assume 1:1
        // Special cases?
        if (id) {
            navigate(`/${view}/${id}`);
        } else {
            navigate(`/${view}`);
        }
    };

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

                <div className="flex-1 overflow-hidden relative p-0">
                    <Outlet />
                </div>

                <VirtualAssistant />

                <NotificationPanel
                    isOpen={isNotificationPanelOpen}
                    onClose={() => setIsNotificationPanelOpen(false)}
                    notifications={notifications}
                    onMarkRead={(id) => setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))}
                    onNavigate={handleNavigate}
                    onClearAll={() => setNotifications([])}
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
