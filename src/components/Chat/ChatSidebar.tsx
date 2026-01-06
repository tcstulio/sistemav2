import React, { useMemo, useState } from 'react';
import { useUsers, useProjects, useEvents } from '../../hooks/dolibarr';
import { useDolibarr } from '../../context/DolibarrContext';
import { Search, Briefcase, MessageSquare, Clock } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';

interface ChatSidebarProps {
    onSelect: (type: 'user' | 'project' | 'topic', id: string, name: string) => void;
}

export const ChatSidebar: React.FC<ChatSidebarProps> = ({ onSelect }) => {
    const { currentUser, config } = useDolibarr();
    const navigate = useNavigate();
    const { id: activeId } = useParams(); // URL params if we use /chat/user/:id
    const [searchTerm, setSearchTerm] = useState('');

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

        if (!searchTerm) {
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

        if (!searchTerm) {
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
        navigate(`/chat/${type}/${id}`);
    };

    return (
        <div className="w-80 h-full bg-slate-50 dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col">
            {/* Header */}
            <div className="p-4 border-b border-slate-200 dark:border-slate-800">
                <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-indigo-500" />
                    Mensagens
                </h2>
                <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Buscar para iniciar..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg pl-9 pr-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                    />
                </div>
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
                                {searchTerm ? 'Nenhum usuário encontrado' : 'Nenhuma conversa recente'}
                            </div>
                        )}
                        {filteredUsers.map((user: any) => (
                            <button
                                key={user.id}
                                onClick={() => handleItemClick('user', user)}
                                className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${window.location.pathname.includes(`/chat/user/${user.id}`)
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
                                {searchTerm ? 'Nenhum projeto encontrado' : 'Nenhuma conversa recente'}
                            </div>
                        )}
                        {filteredProjects.map((project: any) => (
                            <button
                                key={project.id}
                                onClick={() => handleItemClick('project', project)}
                                className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${window.location.pathname.includes(`/chat/project/${project.id}`)
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
