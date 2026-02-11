import React, { useMemo, useState } from 'react';
import { DolibarrConfig, PermissionDefinition } from '../../types';
import { usePermissions, useGroupRights, useUserRights, useGroups, useGroupUsers } from '../../hooks/dolibarr';
import * as HRAdmin from '../../services/api/hrAdmin';
import { Lock, Check, Search, AlertCircle, Loader2, Users, CheckSquare, Square } from 'lucide-react';
import { logger } from '../../utils/logger';

const log = logger.child('PermissionManager');

interface PermissionManagerProps {
    targetId: string;
    targetType: 'user' | 'group';
    config: DolibarrConfig;
}

export const PermissionManager: React.FC<PermissionManagerProps> = ({ targetId, targetType, config }) => {
    // Shared Data
    const { data: permissionsData, isLoading: isLoadingPerms } = usePermissions(config);

    // Conditional Data Fetching
    const { data: groupRightsData, isLoading: isLoadingGroupRights, refetch: refetchGroupRights } = useGroupRights(config);
    const { data: userRightsData, isLoading: isLoadingUserRights, refetch: refetchUserRights } = useUserRights(config);

    // Inheritance Data (Only for Users)
    const { data: allGroups } = useGroups(config);
    const { data: allGroupLinks } = useGroupUsers(config);

    const [searchTerm, setSearchTerm] = useState('');
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [bulkProcessingModule, setBulkProcessingModule] = useState<string | null>(null);

    // Determine Loading State
    const isLoadingRights = targetType === 'group' ? isLoadingGroupRights : isLoadingUserRights;
    const isLoading = isLoadingPerms || isLoadingRights;

    // Filter permissions
    const filteredPermissions = useMemo(() => {
        if (!permissionsData) return [];
        return permissionsData.filter(p =>
            p.module.toLowerCase().includes(searchTerm.toLowerCase()) ||
            p.libelle.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [permissionsData, searchTerm]);

    // Group by module
    const groupedPermissions = useMemo(() => {
        const groups: Record<string, PermissionDefinition[]> = {};
        filteredPermissions.forEach(p => {
            const moduleName = p.module || 'Outros';
            if (!groups[moduleName]) groups[moduleName] = [];
            groups[moduleName].push(p);
        });
        return groups;
    }, [filteredPermissions]);

    // Get assigned rights IDs based on target type
    const assignedRightIds = useMemo(() => {
        const ids = new Set<string>();

        if (targetType === 'group' && groupRightsData) {
            groupRightsData
                .filter(gr => String(gr.fk_usergroup) === String(targetId))
                .forEach(gr => ids.add(String(gr.fk_id)));
        } else if (targetType === 'user' && userRightsData) {
            userRightsData
                .filter(ur => String(ur.fk_user) === String(targetId))
                .forEach(ur => ids.add(String(ur.fk_id)));
        }

        return ids;
    }, [targetType, targetId, groupRightsData, userRightsData]);

    // Calculate Inherited Permissions (For Users)
    const inheritedRights = useMemo(() => {
        const inherited = new Map<string, string[]>(); // Permission ID -> List of Group Names

        if (targetType === 'user' && allGroups && allGroupLinks && groupRightsData) {
            // Debug Logs
            log.debug('Calculating inherited rights', { targetId, allGroupLinks });

            // 1. Find groups the user belongs to
            const userGroupIds = allGroupLinks
                .filter(link => {
                    const match = String(link.fk_user) === String(targetId);
                    if (match) log.debug('Found link match', link);
                    return match;
                })
                .map(link => String(link.fk_usergroup));

            log.debug('User group IDs', userGroupIds);

            // 2. For each group, find its rights
            userGroupIds.forEach(groupId => {
                const groupName = allGroups.find(g => String(g.id) === groupId)?.name || 'Grupo Desconhecido';

                const rights = groupRightsData.filter(gr => String(gr.fk_usergroup) === groupId);
                log.debug(`Rights for group ${groupId} (${groupName})`, rights);

                rights.forEach(r => {
                    const pid = String(r.fk_id);
                    if (!inherited.has(pid)) {
                        inherited.set(pid, []);
                    }
                    inherited.get(pid)?.push(groupName);
                });
            });
            log.debug('Final inherited map', inherited);
        }
        return inherited;
    }, [targetType, targetId, allGroups, allGroupLinks, groupRightsData]);

    const handleTogglePermission = async (perm: PermissionDefinition) => {
        if (processingId) return;
        setProcessingId(perm.id);

        const isAssigned = assignedRightIds.has(String(perm.id));

        try {
            if (targetType === 'group') {
                if (isAssigned) {
                    await HRAdmin.removePermissionFromGroup(config, targetId, perm.id);
                } else {
                    await HRAdmin.addPermissionToGroup(config, targetId, perm.id);
                }
                setTimeout(() => refetchGroupRights(), 1000);
            } else {
                if (isAssigned) {
                    await HRAdmin.removePermissionFromUser(config, targetId, perm.id);
                } else {
                    await HRAdmin.addPermissionToUser(config, targetId, perm.id);
                }
                setTimeout(() => refetchUserRights(), 1000);
            }
        } catch (e) {
            log.error("Failed to toggle permission", e);
            alert("Erro ao alterar permissão via API.");
        } finally {
            setProcessingId(null);
        }
    };

    const handleBulkAction = async (module: string, action: 'addAll' | 'removeAll') => {
        if (bulkProcessingModule) return;
        setBulkProcessingModule(module);

        const perms = groupedPermissions[module];
        const promises: Promise<any>[] = [];

        for (const perm of perms) {
            const isAssigned = assignedRightIds.has(String(perm.id));

            if (action === 'addAll' && !isAssigned) {
                if (targetType === 'group') {
                    promises.push(HRAdmin.addPermissionToGroup(config, targetId, perm.id));
                } else {
                    promises.push(HRAdmin.addPermissionToUser(config, targetId, perm.id));
                }
            } else if (action === 'removeAll' && isAssigned) {
                if (targetType === 'group') {
                    promises.push(HRAdmin.removePermissionFromGroup(config, targetId, perm.id));
                } else {
                    promises.push(HRAdmin.removePermissionFromUser(config, targetId, perm.id));
                }
            }
        }

        try {
            await Promise.all(promises);
            setTimeout(() => {
                if (targetType === 'group') refetchGroupRights();
                else refetchUserRights();
            }, 1000);
        } catch (e) {
            log.error("Bulk action failed", e);
            alert("Erro na atualização em massa.");
        } finally {
            setBulkProcessingModule(null);
        }
    };

    if (isLoading) {
        return <div className="p-8 text-center flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div>;
    }

    return (
        <div className="flex flex-col h-full">
            <div className="mb-4 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                    type="text"
                    placeholder={`Buscar permissão para ${targetType === 'group' ? 'grupo' : 'usuário'}...`}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 border border-slate-300 dark:border-slate-700 rounded-lg text-sm bg-white dark:bg-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                />
            </div>

            <div className="flex-1 overflow-y-auto pr-2 space-y-6">
                {Object.entries(groupedPermissions).sort().map(([module, perms]) => {
                    const isBulkProcessing = bulkProcessingModule === module;
                    return (
                        <div key={module} className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                            <div className="bg-slate-50 dark:bg-slate-900/50 px-4 py-2 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center group">
                                <h3 className="font-semibold text-sm text-slate-700 dark:text-slate-300 uppercase tracking-wide">{module}</h3>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-slate-500 mr-2">{perms.length} permissões</span>
                                    {isBulkProcessing ? (
                                        <Loader2 size={14} className="animate-spin text-slate-400" />
                                    ) : (
                                        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                                            <button
                                                onClick={() => handleBulkAction(module, 'addAll')}
                                                className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-slate-500 hover:text-green-600"
                                                title="Adicionar Todas"
                                            >
                                                <CheckSquare size={14} />
                                            </button>
                                            <button
                                                onClick={() => handleBulkAction(module, 'removeAll')}
                                                className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-slate-500 hover:text-red-600"
                                                title="Remover Todas (Diretas)"
                                            >
                                                <Square size={14} />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                {perms.map(perm => {
                                    const isAssigned = assignedRightIds.has(String(perm.id));
                                    const inheritedGroups = inheritedRights.get(String(perm.id));
                                    const isInherited = inheritedGroups && inheritedGroups.length > 0;
                                    const isProcessing = processingId === perm.id;

                                    return (
                                        <div key={perm.id} className="p-3 flex items-start gap-3 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                                            <button
                                                onClick={() => handleTogglePermission(perm)}
                                                disabled={isProcessing}
                                                className={`mt-0.5 flex-none w-5 h-5 rounded border flex items-center justify-center transition-colors ${isAssigned
                                                    ? 'bg-green-500 border-green-500 text-white'
                                                    : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-transparent hover:border-green-400'
                                                    }`}
                                                title={isAssigned ? "Permissão atribuída diretamente (Clique para remover)" : "Clique para atribuir diretamente"}
                                            >
                                                {isProcessing ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                                            </button>

                                            <div className="flex-1">
                                                <div className="flex items-center gap-2">
                                                    <p className="text-sm text-slate-800 dark:text-slate-200 font-medium">{perm.libelle}</p>
                                                    {isInherited && (
                                                        <div className="flex items-center gap-1 px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-[10px] rounded border border-blue-200 dark:border-blue-800" title={`Herdado de: ${inheritedGroups?.join(', ')}`}>
                                                            <Users size={10} />
                                                            HERDADO
                                                        </div>
                                                    )}
                                                </div>
                                                <p className="text-xs text-slate-500 font-mono mt-0.5">{perm.perms} {perm.subperms ? `(${perm.subperms})` : ''}</p>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}

                {filteredPermissions.length === 0 && (
                    <div className="text-center py-12 text-slate-400">
                        <Lock size={48} className="mx-auto mb-3 opacity-20" />
                        <p>Nenhuma permissão encontrada para "{searchTerm}"</p>
                    </div>
                )}
            </div>

            <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300 rounded-lg text-xs flex gap-2">
                <AlertCircle size={16} className="flex-none mt-0.5" />
                <div>
                    <p className="font-semibold mb-1">Legenda:</p>
                    <ul className="list-disc list-inside space-y-0.5 opacity-80">
                        <li><span className="inline-block w-3 h-3 bg-green-500 rounded-sm align-middle mr-1"></span> Permissão Direta (Clique para remover)</li>
                        <li><span className="inline-block w-3 h-3 border border-slate-400 bg-white rounded-sm align-middle mr-1"></span> Sem Permissão Direta (Clique para adicionar)</li>
                        <li><span className="inline-flex items-center gap-0.5 px-1 py-0.5 bg-blue-100 text-blue-700 text-[10px] rounded align-middle mr-1"><Users size={8} /> HERDADO</span> Permissão via Grupo (Aditiva)</li>
                    </ul>
                </div>
            </div>
        </div>
    );
};
