import React, { useState, useRef, useEffect } from 'react';
import { useDolibarr } from '../../context/DolibarrContext';
import { Menu, Settings, Bell, RefreshCw, User, LogOut, ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface HeaderProps {
    setIsSidebarOpen: (open: boolean) => void;
    setIsNotificationPanelOpen: (open: boolean) => void;
    setIsSearchOpen: (open: boolean) => void;
}

export const Header: React.FC<HeaderProps> = ({ setIsSidebarOpen, setIsNotificationPanelOpen, setIsSearchOpen }) => {
    const { config, notifications, isSyncing, currentUser, logout } = useDolibarr();
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();

    // Close menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsUserMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    if (!config) return null;

    const getInitials = () => {
        if (currentUser) {
            const first = currentUser.firstname ? currentUser.firstname[0] : '';
            const last = currentUser.lastname ? currentUser.lastname[0] : '';
            if (first || last) return (first + last).toUpperCase();
            return currentUser.login ? currentUser.login.substring(0, 2).toUpperCase() : 'AD';
        }
        return 'AD';
    };

    const handleLogout = () => {
        logout();
        navigate('/'); // Usually unnecessary as App will render SetupWizard, but safe.
    };

    return (
        <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 h-16 flex items-center justify-between px-4 lg:px-6 shadow-sm z-20">
            <div className="flex items-center gap-3">
                <button onClick={() => setIsSidebarOpen(true)} className="lg:hidden p-2 -ml-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"><Menu size={20} /></button>
                <button
                    onClick={() => setIsSearchOpen(true)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-sm w-48 lg:w-64"
                >
                    <Settings size={14} className="opacity-0 w-0" /> {/* Spacer */}
                    <span>Buscar...</span>
                    <div className="ml-auto text-xs border border-slate-300 dark:border-slate-600 px-1.5 rounded">⌘K</div>
                </button>
            </div>

            <div className="flex items-center gap-3">
                {/* Sync Indicator */}
                {isSyncing && (
                    <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-full text-xs font-medium animate-in fade-in slide-in-from-right-4 mr-2">
                        <RefreshCw size={12} className="animate-spin" />
                        <span>Sincronizando...</span>
                    </div>
                )}

                <button
                    onClick={() => setIsNotificationPanelOpen(true)}
                    className="relative p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
                >
                    <Bell size={20} />
                    {notifications.some(n => !n.read) && <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border border-white dark:border-slate-900"></span>}
                </button>

                {/* User Dropdown */}
                <div className="relative" ref={menuRef}>
                    <button
                        onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                        className="flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full p-1 pl-1 pr-2 transition-colors"
                    >
                        <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-xs border-2 border-slate-100 dark:border-slate-700">
                            {getInitials()}
                        </div>
                        <ChevronDown size={14} className={`text-slate-400 transition-transform ${isUserMenuOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {isUserMenuOpen && (
                        <div className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-100 dark:border-slate-800 py-2 animate-in zoom-in-95 origin-top-right">
                            <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800 mb-2">
                                <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                                    {currentUser ? `${currentUser.firstname || ''} ${currentUser.lastname || ''}`.trim() || currentUser.login : 'Admin'}
                                </p>
                                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                    {currentUser?.email || currentUser?.login || 'Usuário'}
                                </p>
                            </div>

                            <button
                                onClick={() => { navigate('/perfil'); setIsUserMenuOpen(false); }}
                                className="w-full text-left px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2"
                            >
                                <User size={16} /> Meu Perfil
                            </button>

                            <div className="border-t border-slate-100 dark:border-slate-800 my-1"></div>

                            <button
                                onClick={handleLogout}
                                className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/10 flex items-center gap-2"
                            >
                                <LogOut size={16} /> Sair
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
};
