import React, { useState, useEffect, useMemo } from 'react';
import { UserGroup, DolibarrUser, GroupUser, DolibarrConfig } from '../../types';
import { X, UserPlus, Trash2, Save, Shield, Check, MinusCircle } from 'lucide-react';
import { useGroupUsers, useGroups } from '../../hooks/dolibarr';
import * as HRAdmin from '../../services/api/hrAdmin';
import { UserAvatar } from './UserAvatar';
import { PermissionManager } from './PermissionManager';


interface GroupDetailProps {
    group: UserGroup;
    users: DolibarrUser[];
    currentConfig: DolibarrConfig;
    onClose: () => void;
    onRefresh: () => void;
}

export const GroupDetail: React.FC<GroupDetailProps> = ({
    group,
    users,
    currentConfig,
    onClose,
    onRefresh
}) => {
    const { data: groupUsersLinks } = useGroupUsers(currentConfig);
    const { data: groups } = useGroups(currentConfig); // To check latest state if needed

    // Local State
    const [isAddingMember, setIsAddingMember] = useState(false);
    const [selectedUserIdToAdd, setSelectedUserIdToAdd] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [activeTab, setActiveTab] = useState<'members' | 'permissions'>('members');

    // Filter members
    const memberIds = useMemo(() => {
        if (!groupUsersLinks) return [];
        return groupUsersLinks
            .filter(link => String(link.fk_usergroup) === String(group.id))
            .map(link => String(link.fk_user));
    }, [groupUsersLinks, group.id]);

    const members = useMemo(() => {
        return users.filter(u => memberIds.includes(String(u.id)));
    }, [users, memberIds]);

    const nonMembers = useMemo(() => {
        return users.filter(u => !memberIds.includes(String(u.id)) && String(u.statut) === '1'); // Active users only
    }, [users, memberIds]);


    const handleAddMember = async () => {
        if (!selectedUserIdToAdd) return;
        setIsSaving(true);
        try {
            await HRAdmin.addUserToGroup(currentConfig, group.id, selectedUserIdToAdd);
            // Refresh sync to get new link
            onRefresh();
            setIsAddingMember(false);
            setSelectedUserIdToAdd('');
        } catch (e) {
            console.error(e);
            alert('Erro ao adicionar membro.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleRemoveMember = async (userId: string) => {
        if (!confirm('Remover usuário do grupo?')) return;
        setIsSaving(true);
        try {
            await HRAdmin.removeUserFromGroup(currentConfig, group.id, userId);
            onRefresh();
        } catch (e) {
            console.error(e);
            alert('Erro ao remover membro.');
        } finally {
            setIsSaving(false);
        }
    };

    // Placeholder for Permissions Management
    // Implementing full permission tree is complex without Rights Defs.
    // For now, listing members is the key value.

    return (
        <div className="h-full flex flex-col bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden relative">
            <div className="absolute top-0 right-0 p-4 z-10">
                <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                    <X size={20} />
                </button>
            </div>

            <div className="p-6 border-b border-slate-100 dark:border-slate-800">
                <h2 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                    {group.name}
                </h2>
                <p className="text-sm text-slate-500 mt-1">{group.note || 'Sem descrição'}</p>
            </div>

            <div className="flex border-b border-slate-100 dark:border-slate-800 px-6">
                <button
                    onClick={() => setActiveTab('members')}
                    className={`pb-3 pt-4 px-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'members' ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400' : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}
                >
                    <UserPlus size={16} /> Membros ({members.length})
                </button>
                <button
                    onClick={() => setActiveTab('permissions')}
                    className={`pb-3 pt-4 px-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'permissions' ? 'border-amber-500 text-amber-600 dark:text-amber-400 dark:border-amber-400' : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}
                >
                    <Shield size={16} /> Permissões
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8">

                {/* Members Section */}
                {activeTab === 'members' && (
                    <div>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                                <span className="bg-blue-100 text-blue-600 p-1 rounded"><UserPlus size={16} /></span>
                                Membros ({members.length})
                            </h3>
                            {!isAddingMember && (
                                <button
                                    onClick={() => setIsAddingMember(true)}
                                    className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                                >
                                    <UserPlus size={14} /> Adicionar
                                </button>
                            )}
                        </div>

                        {isAddingMember && (
                            <div className="mb-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700 animate-in fade-in slide-in-from-top-2">
                                <label className="block text-xs font-medium text-slate-500 mb-1">Selecionar Usuário</label>
                                <div className="flex gap-2">
                                    <select
                                        className="flex-1 p-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                        value={selectedUserIdToAdd}
                                        onChange={(e) => setSelectedUserIdToAdd(e.target.value)}
                                    >
                                        <option value="">Selecione...</option>
                                        {nonMembers.map(u => (
                                            <option key={u.id} value={u.id}>{u.firstname} {u.lastname} ({u.login})</option>
                                        ))}
                                    </select>
                                    <button
                                        onClick={handleAddMember}
                                        disabled={!selectedUserIdToAdd || isSaving}
                                        className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 text-sm font-bold"
                                    >
                                        {isSaving ? '...' : <Check size={16} />}
                                    </button>
                                    <button
                                        onClick={() => setIsAddingMember(false)}
                                        className="px-3 py-2 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded hover:bg-slate-300 dark:hover:bg-slate-600 text-sm"
                                    >
                                        <X size={16} />
                                    </button>
                                </div>
                            </div>
                        )}

                        <div className="space-y-2">
                            {members.length > 0 ? members.map(member => (
                                <div key={member.id} className="flex items-center justify-between p-3 rounded-lg border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                    <div className="flex items-center gap-3">
                                        <UserAvatar user={member} config={currentConfig} size="sm" />
                                        <div>
                                            <div className="text-sm font-medium text-slate-800 dark:text-white">{member.firstname} {member.lastname}</div>
                                            <div className="text-xs text-slate-500">{member.job || member.login}</div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleRemoveMember(member.id)}
                                        className="text-slate-400 hover:text-red-500 p-1 rounded transition-colors"
                                        title="Remover do grupo"
                                    >
                                        <MinusCircle size={16} />
                                    </button>
                                </div>
                            )) : (
                                <p className="text-sm text-slate-400 italic">Nenhum membro neste grupo.</p>
                            )}
                        </div>
                    </div>
                )}

                {/* Permissions Section */}
                {activeTab === 'permissions' && (
                    <div>
                        <h3 className="text-lg font-semibold text-slate-800 dark:text-white flex items-center gap-2 mb-4">
                            <span className="bg-amber-100 text-amber-600 p-1 rounded"><Shield size={16} /></span>
                            Permissões
                        </h3>
                        <div className="h-full overflow-hidden">
                            <PermissionManager targetId={group.id} targetType="group" config={currentConfig} />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
