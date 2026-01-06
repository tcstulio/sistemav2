import React, { useMemo } from 'react';
import { UserGroup, DolibarrConfig } from '../../../types';
import { Users, ChevronDown, Edit, Trash2 } from 'lucide-react';
import { useGroups } from '../../../hooks/dolibarr';

interface GroupsTabProps {
    groups: UserGroup[];
    searchTerm: string;
    sortConfig: { key: string, direction: 'asc' | 'desc' };
    displayLimit: number;
    config: DolibarrConfig;
    onSelectGroup: (group: UserGroup) => void;
    onEditGroup: (group: UserGroup) => void;
    onDeleteGroup: (groupId: string) => void;
    setDisplayLimit: React.Dispatch<React.SetStateAction<number>>;
}

export const GroupsTab: React.FC<GroupsTabProps> = ({
    groups,
    searchTerm,
    sortConfig,
    displayLimit,
    config,
    onSelectGroup,
    onEditGroup,
    onDeleteGroup,
    setDisplayLimit
}) => {

    const filteredGroups = useMemo(() => {
        let result = groups.filter(g =>
            (g.name?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
            (g.note?.toLowerCase() || '').includes(searchTerm.toLowerCase())
        );

        if (sortConfig.key !== 'default') {
            result.sort((a, b) => {
                let valA: any = '', valB: any = '';
                if (sortConfig.key === 'name') {
                    valA = (a.name || '').toLowerCase();
                    valB = (b.name || '').toLowerCase();
                } else if (sortConfig.key === 'date') {
                    valA = a.datec || 0;
                    valB = b.datec || 0;
                }

                if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
                if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return result;
    }, [groups, searchTerm, sortConfig]);

    const displayedGroups = filteredGroups.slice(0, displayLimit);

    if (displayedGroups.length === 0) {
        return (
            <div className="text-center py-20 text-slate-400">
                <Users size={48} className="mx-auto mb-4 opacity-50" />
                <p>Nenhum grupo encontrado.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4">
                {displayedGroups.map(group => (
                    <div
                        key={group.id}
                        className="group relative p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:shadow-md transition-all flex items-center justify-between gap-4 cursor-pointer"
                        onClick={() => onSelectGroup(group)}
                    >
                        <div className="flex items-center gap-4 flex-1">
                            <div className={`shrink-0 w-10 h-10 rounded-full bg-${config.themeColor}-100 dark:bg-${config.themeColor}-900 flex items-center justify-center text-${config.themeColor}-600 dark:text-${config.themeColor}-400 font-bold`}>
                                <Users size={20} />
                            </div>
                            <div>
                                <h4 className="font-bold text-slate-800 dark:text-white">{group.name}</h4>
                                <p className="text-xs text-slate-500 line-clamp-1">{group.note || 'Sem descrição'}</p>
                            </div>
                        </div>

                        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onEditGroup(group);
                                }}
                                className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-blue-500 transition-colors"
                            >
                                <Edit size={16} />
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onDeleteGroup(group.id);
                                }}
                                className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-red-500 transition-colors"
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
            {filteredGroups.length > displayedGroups.length && (
                <button
                    onClick={() => setDisplayLimit(prev => prev + 50)}
                    className="w-full py-3 mt-4 text-sm font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 border border-dashed border-slate-300 dark:border-slate-700 rounded-lg hover:border-slate-400 transition-colors flex items-center justify-center gap-2"
                >
                    <ChevronDown size={16} /> Carregar Mais ({filteredGroups.length - displayedGroups.length} restantes)
                </button>
            )}
        </div>
    );
};
