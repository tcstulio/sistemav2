import React, { useState, useRef, useEffect } from 'react';
import { useDolibarr, PreviewTarget } from '../../context/DolibarrContext';
import { DolibarrService } from '../../services/dolibarrService';
import { Menu, Settings, RefreshCw, User, LogOut, ChevronDown, Eye, EyeOff, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { UserAvatar } from '../HR/UserAvatar';
import { NotificationBell } from '../NotificationBell';

interface HeaderProps {
    setIsSidebarOpen: (open: boolean) => void;
    setIsNotificationPanelOpen: (open: boolean) => void;
    setIsSearchOpen: (open: boolean) => void;
}

export const Header: React.FC<HeaderProps> = ({ setIsSidebarOpen, setIsNotificationPanelOpen, setIsSearchOpen }) => {
    const { config, notifications, isSyncing, currentUser, logout, previewTarget, setPreviewTarget } = useDolibarr();
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
    const [isPreviewMenuOpen, setIsPreviewMenuOpen] = useState(false);
    const [previewSearch, setPreviewSearch] = useState('');
    const [previewUsers, setPreviewUsers] = useState<Array<{ id: string; name: string }>>([]);
    const [previewGroups, setPreviewGroups] = useState<Array<{ id: string; name: string }>>([]);
    const [previewTab, setPreviewTab] = useState<'user' | 'group'>('user');
    const menuRef = useRef<HTMLDivElement>(null);
    const previewRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();

    const isAdmin = currentUser?.admin === 1 || currentUser?.admin === '1' || (currentUser?.admin as unknown) === true;

    // Close menus when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsUserMenuOpen(false);
            }
            if (previewRef.current && !previewRef.current.contains(event.target as Node)) {
                setIsPreviewMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Load users/groups when preview menu opens
    useEffect(() => {
        if (!isPreviewMenuOpen || !config) return;
        DolibarrService.fetchUsers(config)
            .then(users => setPreviewUsers(users.map(u => ({
                id: String(u.id),
                name: `${u.firstname || ''} ${u.lastname || ''}`.trim() || u.login || String(u.id),
            }))))
            .catch(() => {});
        DolibarrService.listGroups(config)
            .then(groups => setPreviewGroups(groups.map(g => ({ id: g.id, name: g.name }))))
            .catch(() => {});
    }, [isPreviewMenuOpen, config]);

    const selectPreviewUser = async (user: { id: string; name: string }) => {
        if (!config) return;
        let groupIds: string[] = [];
        let rights: any; let admin: any;
        try {
            // Busca grupos + direitos REAIS do alvo (p/ o preview refletir o que ele realmente vê).
            const [groups, full] = await Promise.all([
                DolibarrService.getUserGroups(config, user.id),
                DolibarrService.getUserById(config, user.id),
            ]);
            groupIds = groups.map(g => String(g.id));
            rights = full?.rights; admin = full?.admin;
        } catch {}
        const target: PreviewTarget = { type: 'user', id: user.id, name: user.name, groupIds, rights, admin };
        setPreviewTarget(target);
        setIsPreviewMenuOpen(false);
    };

    const selectPreviewGroup = async (group: { id: string; name: string }) => {
        let rights: any;
        try { if (config) rights = await DolibarrService.getGroupRights(config, group.id); } catch {}
        // grupo nunca é admin; rights montados via custom_sync (REST não expõe direitos de grupo).
        const target: PreviewTarget = { type: 'group', id: group.id, name: group.name, groupIds: [group.id], rights, admin: '0' };
        setPreviewTarget(target);
        setIsPreviewMenuOpen(false);
    };

    if (!config) return null;

    const handleLogout = () => {
        logout();
        navigate('/');
    };

    const filteredList = (previewTab === 'user' ? previewUsers : previewGroups)
        .filter(item => item.name.toLowerCase().includes(previewSearch.toLowerCase()));

    return (
        <>
            {/* Preview banner */}
            {previewTarget && (
                <div className="bg-amber-500 text-white px-4 py-1.5 flex items-center justify-between gap-3 text-sm z-30">
                    <span className="flex items-center gap-2">
                        <Eye size={14} />
                        Vendo como <strong>{previewTarget.name}</strong> ({previewTarget.type === 'user' ? 'usuário' : 'grupo'}) — somente leitura
                    </span>
                    <button
                        onClick={() => setPreviewTarget(null)}
                        className="flex items-center gap-1 px-2 py-0.5 bg-white/20 hover:bg-white/30 rounded text-xs font-medium"
                    >
                        <EyeOff size={12} /> Sair da pré-visualização
                    </button>
                </div>
            )}

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

                    {/* Ver como — admin only (#540) */}
                    {isAdmin && (
                        <div className="relative" ref={previewRef}>
                            <button
                                onClick={() => setIsPreviewMenuOpen(!isPreviewMenuOpen)}
                                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                                    previewTarget
                                        ? 'bg-amber-100 border-amber-300 text-amber-700 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-300'
                                        : 'bg-slate-100 border-slate-200 text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                                }`}
                                title="Ver como usuário/grupo"
                            >
                                <Eye size={13} />
                                <span className="hidden md:inline">Ver como</span>
                            </button>

                            {isPreviewMenuOpen && (
                                <div className="absolute right-0 top-full mt-2 w-72 bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-100 dark:border-slate-800 py-2 animate-in zoom-in-95 origin-top-right z-50">
                                    <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800">
                                        <p className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Pré-visualizar como</p>
                                        <div className="flex gap-1 mb-2">
                                            <button
                                                onClick={() => setPreviewTab('user')}
                                                className={`flex-1 text-xs py-1 rounded font-medium ${previewTab === 'user' ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'}`}
                                            >Usuário</button>
                                            <button
                                                onClick={() => setPreviewTab('group')}
                                                className={`flex-1 text-xs py-1 rounded font-medium ${previewTab === 'group' ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'}`}
                                            >Grupo</button>
                                        </div>
                                        <div className="relative">
                                            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                                            <input
                                                type="text"
                                                placeholder="Buscar..."
                                                value={previewSearch}
                                                onChange={e => setPreviewSearch(e.target.value)}
                                                className="w-full pl-6 pr-2 py-1 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded"
                                            />
                                        </div>
                                    </div>
                                    <div className="max-h-48 overflow-y-auto py-1">
                                        {filteredList.length === 0 ? (
                                            <p className="text-xs text-slate-400 text-center py-3">Nenhum resultado</p>
                                        ) : filteredList.map(item => (
                                            <button
                                                key={item.id}
                                                onClick={() => previewTab === 'user' ? selectPreviewUser(item) : selectPreviewGroup(item)}
                                                className="w-full text-left px-3 py-2 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2"
                                            >
                                                <div className="w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-[9px] font-bold shrink-0">
                                                    {item.name.slice(0, 1).toUpperCase()}
                                                </div>
                                                <span className="truncate">{item.name}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    <NotificationBell
                        unreadCount={notifications.filter(n => !n.read).length}
                        onClick={() => setIsNotificationPanelOpen(true)}
                    />

                    {/* User Dropdown */}
                    <div className="relative" ref={menuRef}>
                        <button
                            onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                            className="flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full p-1 pl-1 pr-2 transition-colors"
                        >
                            {currentUser ? (
                                <UserAvatar user={currentUser} config={config} size="sm" />
                            ) : (
                                <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-xs border-2 border-slate-100 dark:border-slate-700">
                                    AD
                                </div>
                            )}
                            <ChevronDown size={14} className={`text-slate-400 transition-transform ${isUserMenuOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {isUserMenuOpen && (
                            <div className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-100 dark:border-slate-800 py-2 animate-in zoom-in-95 origin-top-right">
                                <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800 mb-2">
                                    <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                                        {currentUser ? `${currentUser.firstname || ''} ${currentUser.lastname || ''}`.trim() || currentUser.login : 'Admin'}
                                    </p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                        {currentUser?.job ? `${currentUser.job} • ` : ''} 
                                        {currentUser?.email || currentUser?.login || 'Usuário'}
                                    </p>
                                </div>

                                <button
                                    onClick={() => { navigate('/settings'); setIsUserMenuOpen(false); }}
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
        </>
    );
};
