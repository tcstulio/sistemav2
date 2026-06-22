import React, { useMemo, useState } from 'react';
import { useUsers, useProjects, useEvents } from '../../hooks/dolibarr';
import { useDolibarr } from '../../context/DolibarrContext';
import { Search, Briefcase, MessageSquare, Clock, Plus } from 'lucide-react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';

interface ChatSidebarProps {
    onSelect: (type: 'user' | 'project' | 'topic', id: string, name: string) => void;
}

export const ChatSidebar: React.FC<ChatSidebarProps> = ({ onSelect }) => {
    const { currentUser, config } = useDolibarr();
    const navigate = useNavigate();
    const { id: activeId } = useParams();
    const location = useLocation();
    const [searchTerm, setSearchTerm] = useState('');
    const [showNewConversation, setShowNewConversation] = useState(false);

    // Fetch data
    const { data: users } = useUsers(config);
    const { data: projects } = useProjects(config);
    const { data: events } = useEvents(config);

    // Compute Active Conversations (Entities with chat history)
    const { activeUserIds, activeProjectIds } = useMemo(() => {
        const userIds = new Set<string>();
        const projectIds = new Set<string>();

        if (events && currentUser) {
            events.forEach((e: any) => {
                const myId = String(currentUser.id);

                // Identify DM counterparts
                if (e.elementtype === 'user') {
                    const authorId = String(e.fk_user_author);
                    const targetId = String(e.fk_element);

                    if (authorId === myId) userIds.add(targetId);
                    else if (targetId === myId) userIds.add(authorId);
                }
                // Identify Projects with activity
                else if (e.elementtype === 'project' || e.elementtype === 'projet') {
                    if (e.fk_element) projectIds.add(String(e.fk_element));
                    if (e.project_id) projectIds.add(String(e.project_id));
                }
            });
        }
        return { activeUserIds: userIds, activeProjectIds: projectIds };
    }, [events, currentUser]);

    // Filtered lists
    const filteredUsers = useMemo(() => {
        if (!users) return [];
        let list = users.filter((u: any) => String(u.statut) === '1' && String(u.id) !== String(currentUser?.id));

        if (!searchTerm && !showNewConversation) {
            // Show only recent conversations
            return list.filter((u: any) => activeUserIds.has(String(u.id)));
        } else {
            // Global Search
            return list.filter((u: any) =>
                (u.firstname + ' ' + u.lastname).toLowerCase().includes(searchTerm.toLowerCase()) ||
                (u.login || '').toLowerCase().includes(searchTerm.toLowerCase())
            );
        }
    }, [users, searchTerm, currentUser, activeUserIds]);

    const filteredProjects = useMemo(() => {
        if (!projects) return [];

        if (!searchTerm && !showNewConversation) {
            // Recent: Show ANY project with chat history, regardless of status
            return projects.filter((p: any) => activeProjectIds.has(String(p.id)));
        } else {
            // Search: Show only OPEN projects matching term
            return projects
                .filter((p: any) => String(p.statut) === '1') // Open projects
                .filter((p: any) => p.ref.toLowerCase().includes(searchTerm.toLowerCase()) || p.title.toLowerCase().includes(searchTerm.toLowerCase()));
        }
    }, [projects, searchTerm, activeProjectIds]);

    const handleItemClick = (type: 'user' | 'project', item: any) => {
        const id = String(item.id);
        const name = type === 'user' ? (item.firstname || item.login) : item.ref;

        onSelect(type, id, name);
        setShowNewConversation(false);
        navigate(`/chat/${type}/${id}`);
    };

    const handleNewConversationClick = () => {
        setShowNewConversation(true);
        setSearchTerm('');
    };

    return (
        <div className="h-full bg-slate-50 dark:bg-slate-900 flex flex-col">
            {/* Header */}
            <div className="p-4 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <MessageSquare className="w-5 h-5 text-indigo-500" />
                        Mensagens
                    </h2>
                    <button
                        data-testid="nova-conversa-btn"
                        onClick={handleNewConversationClick}
                        title="Nova conversa"
                        className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-800 transition-colors"
                    >
                        <Plus size={14} />
                        Nova
                    </button>
                </div>
                <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                    <input
                        type="text"
                        placeholder={showNewConversation ? 'Buscar pessoa ou projeto...' : 'Buscar para iniciar...'}
                        value={searchTerm}
                        onChange={(e) => { setSearchTerm(e.target.value); if (e.target.value) setShowNewConversation(false); }}
                        className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg pl-9 pr-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                    />
                </div>
                {showNewConversation && !searchTerm && (
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        Mostrando todas as pessoas e projetos disponíveis. Digite para filtrar.
                    </p>
                )}
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-6">

                {/* Direct Messages */}
                <div>
                    <h3 className="px-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 flex justify-between">
                        <span>Pessoas</span>
                        {!searchTerm && <Clock size={12} className="text-slate-400" />}
                    </h3>
                    <div className="space-y-1">
                        {filteredUsers.length === 0 && (
                            <div className="px-3 text-xs text-slate-400 italic">
                                {searchTerm ? 'Nenhum usuário encontrado' : (
                                    <span>
                                        Nenhuma conversa recente.{' '}
                                        <button
                                            onClick={handleNewConversationClick}
                                            className="text-indigo-500 hover:text-indigo-700 underline"
                                        >
                                            Iniciar nova conversa
                                        </button>
                                    </span>
                                )}
                            </div>
                        )}
                        {filteredUsers.map((user: any) => (
                            <button
                                key={user.id}
                                onClick={() => handleItemClick('user', user)}
                                className={`w-full text-left flex items-center gap-3 px-4 py-3 rounded-md transition-colors ${location.pathname.includes(`/chat/user/${user.id}`)
                                    ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                                    : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                                    }`}
                            >
                                <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-800 flex items-center justify-center text-indigo-600 dark:text-indigo-300 font-medium text-xs">
                                    {(user.firstname?.[0] || user.login?.[0] || '?').toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium truncate">
                                        {user.firstname ? `${user.firstname} ${user.lastname || ''}` : user.login}
                                    </div>
                                    <div className="text-xs text-slate-400 truncate">
                                        {user.job || 'Usuário do Sistema'}
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Projects */}
                <div>
                    <h3 className="px-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 flex justify-between">
                        <span>Projetos</span>
                        {!searchTerm && <Clock size={12} className="text-slate-400" />}
                    </h3>
                    <div className="space-y-1">
                        {filteredProjects.length === 0 && (
                            <div className="px-3 text-xs text-slate-400 italic">
                                {searchTerm ? 'Nenhum projeto encontrado' : (
                                    <span>
                                        Nenhuma conversa recente.{' '}
                                        <button
                                            onClick={handleNewConversationClick}
                                            className="text-indigo-500 hover:text-indigo-700 underline"
                                        >
                                            Iniciar nova conversa
                                        </button>
                                    </span>
                                )}
                            </div>
                        )}
                        {filteredProjects.map((project: any) => (
                            <button
                                key={project.id}
                                onClick={() => handleItemClick('project', project)}
                                className={`w-full text-left flex items-center gap-3 px-4 py-3 rounded-md transition-colors ${location.pathname.includes(`/chat/project/${project.id}`)
                                    ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                                    : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                                    }`}
                            >
                                <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-800 flex items-center justify-center text-emerald-600 dark:text-emerald-300">
                                    <Briefcase size={14} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium truncate">
                                        {project.ref}
                                    </div>
                                    <div className="text-xs text-slate-400 truncate">
                                        {project.title}
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

            </div>
        </div>
    );
};
