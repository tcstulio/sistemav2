import React, { useMemo } from 'react';
import { DolibarrUser, DolibarrConfig } from '../../../types';
import { UserAvatar } from '../UserAvatar';
import { ChevronDown, User as UserIcon } from 'lucide-react';

interface TeamTabProps {
    users: DolibarrUser[];
    searchTerm: string;
    sortConfig: { key: string, direction: 'asc' | 'desc' };
    displayLimit: number;
    selectedUserId?: string | null;
    config: DolibarrConfig;
    onSelectUser: (u: DolibarrUser) => void;
    setDisplayLimit: React.Dispatch<React.SetStateAction<number>>;
}

export const TeamTab: React.FC<TeamTabProps> = ({
    users,
    searchTerm,
    sortConfig,
    displayLimit,
    selectedUserId,
    config,
    onSelectUser,
    setDisplayLimit
}) => {

    const filteredUsers = useMemo(() => {
        let result = users.filter(u =>
            (u.login?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
            (u.firstname?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
            (u.lastname?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
            (u.job?.toLowerCase() || '').includes(searchTerm.toLowerCase())
        );

        if (sortConfig.key !== 'default') {
            result.sort((a, b) => {
                let valA: any = '', valB: any = '';
                if (sortConfig.key === 'name') {
                    valA = `${a.firstname} ${a.lastname}`.toLowerCase();
                    valB = `${b.firstname} ${b.lastname}`.toLowerCase();
                } else if (sortConfig.key === 'job') {
                    valA = (a.job || '').toLowerCase();
                    valB = (b.job || '').toLowerCase();
                }

                if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
                if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return result;
    }, [users, searchTerm, sortConfig]);

    const displayedUsers = filteredUsers.slice(0, displayLimit);

    if (displayedUsers.length === 0) {
        return (
            <div className="text-center py-20 text-slate-400">
                <UserIcon size={48} className="mx-auto mb-4 opacity-50" />
                <p>Nenhum membro da equipe encontrado.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4">
                {displayedUsers.map(u => (
                    <div
                        key={u.id}
                        onClick={() => onSelectUser(u)}
                        className={`p-4 rounded-xl border cursor-pointer transition-all flex items-center justify-between gap-4 ${selectedUserId === u.id ? `bg-${config.themeColor}-50 dark:bg-${config.themeColor}-900/20 border-${config.themeColor}-200 dark:border-${config.themeColor}-800` : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:shadow-md'}`}
                    >
                        <div className="flex items-center gap-4">
                            <div className="shrink-0">
                                <UserAvatar user={u} config={config} size="md" />
                            </div>
                            <div>
                                <h4 className="font-bold text-slate-800 dark:text-white">{u.firstname} {u.lastname}</h4>
                                <p className="text-xs text-slate-500">{u.job || u.login}</p>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
            {filteredUsers.length > displayedUsers.length && (
                <button
                    onClick={() => setDisplayLimit(prev => prev + 50)}
                    className="w-full py-3 mt-4 text-sm font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 border border-dashed border-slate-300 dark:border-slate-700 rounded-lg hover:border-slate-400 transition-colors flex items-center justify-center gap-2"
                >
                    <ChevronDown size={16} /> Carregar Mais ({filteredUsers.length - displayedUsers.length} restantes)
                </button>
            )}
        </div>
    );
};
