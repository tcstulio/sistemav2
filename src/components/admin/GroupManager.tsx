import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Users, ShieldCheck, Plus, Trash2, Search, Lock, RefreshCw, Pencil } from 'lucide-react';
import { DolibarrConfig, UserGroup } from '../../types';
import { DolibarrService } from '../../services/dolibarrService';
import { useDolibarr } from '../../context/DolibarrContext';
import { useUsers, useGroupUsers } from '../../hooks/dolibarr';
import { logger } from '../../utils/logger';
import { notifyError } from '../../utils/notifyError';
import {
    PageLayout,
    PageHeader,
    Button,
    Input,
    Modal,
    ConfirmModal,
    EmptyState,
    Spinner,
} from '../ui';
import { GroupModal } from '../HR/modals/GroupModal';
import { GroupDetail } from '../HR/GroupDetail';

const log = logger.child('GroupManager');

interface GroupManagerProps {
    config: DolibarrConfig;
}

/**
 * GroupManager - ADMIN-ONLY screen to manage user groups (issue #128, 2nd slice — closes #592).
 *
 * Full CRUD: list / create / edit (name + note) / delete / members / permissions.
 * Card is clickable to open group detail panel.
 */
export const GroupManager: React.FC<GroupManagerProps> = ({ config }) => {
    const { currentUser } = useDolibarr();

    const isAdmin =
        currentUser?.admin === 1 ||
        currentUser?.admin === '1' ||
        (currentUser?.admin as unknown) === true;

    const [groups, setGroups] = useState<UserGroup[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');

    // Create modal state
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [form, setForm] = useState({ name: '', note: '' });
    const [isSaving, setIsSaving] = useState(false);

    // Edit modal state
    const [groupToEdit, setGroupToEdit] = useState<UserGroup | null>(null);

    // Detail panel state (members + permissions)
    const [selectedGroup, setSelectedGroup] = useState<UserGroup | null>(null);

    // Delete confirmation state
    const [groupToDelete, setGroupToDelete] = useState<UserGroup | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    // Users list for GroupDetail (members management)
    const { data: users = [] } = useUsers(config);

    const loadGroups = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await DolibarrService.listGroups(config);
            setGroups(data);
        } catch (e) {
            log.error('Falha ao carregar grupos', e);
            setError('Não foi possível carregar os grupos.');
        } finally {
            setIsLoading(false);
        }
    }, [config]);

    useEffect(() => {
        if (isAdmin) {
            loadGroups();
        } else {
            setIsLoading(false);
        }
    }, [isAdmin, loadGroups]);

    const filteredGroups = useMemo(() => {
        const term = searchTerm.toLowerCase().trim();
        if (!term) return groups;
        return groups.filter(
            g =>
                (g.name?.toLowerCase() || '').includes(term) ||
                (g.note?.toLowerCase() || '').includes(term)
        );
    }, [groups, searchTerm]);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.name.trim()) return;
        setIsSaving(true);
        try {
            await DolibarrService.createGroup(config, {
                name: form.name.trim(),
                note: form.note.trim(),
            });
            setForm({ name: '', note: '' });
            setIsCreateOpen(false);
            await loadGroups();
        } catch (err) {
            notifyError('Criar grupo', err);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!groupToDelete) return;
        setIsDeleting(true);
        try {
            await DolibarrService.deleteGroup(config, groupToDelete.id);
            setGroupToDelete(null);
            // If the deleted group was selected in the detail panel, close it
            if (selectedGroup?.id === groupToDelete.id) {
                setSelectedGroup(null);
            }
            await loadGroups();
        } catch (err) {
            notifyError('Excluir grupo', err);
        } finally {
            setIsDeleting(false);
        }
    };

    // After editing, refresh group list and update selectedGroup if open
    const handleEditRefresh = useCallback(async () => {
        await loadGroups();
        // Refresh selectedGroup if it was the one edited
        if (groupToEdit && selectedGroup?.id === groupToEdit.id) {
            // Will be refreshed from new groups list on next render via effect
        }
    }, [loadGroups, groupToEdit, selectedGroup]);

    // Sync selectedGroup with refreshed group list
    useEffect(() => {
        if (selectedGroup) {
            const fresh = groups.find(g => g.id === selectedGroup.id);
            if (fresh && (fresh.name !== selectedGroup.name || fresh.note !== selectedGroup.note)) {
                setSelectedGroup(fresh);
            }
        }
    }, [groups]); // eslint-disable-line react-hooks/exhaustive-deps

    const formatDate = (ts?: number) => {
        if (!ts) return null;
        return new Date(ts * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };

    // Access guard: ADMIN-ONLY
    if (!isAdmin) {
        return (
            <PageLayout title="Grupos" maxWidth="lg">
                <div className="flex flex-col items-center justify-center text-center py-20 text-slate-500 dark:text-slate-400">
                    <div className="bg-red-50 dark:bg-red-900/10 p-6 rounded-full mb-4">
                        <Lock size={48} className="text-red-500" />
                    </div>
                    <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-2">
                        Acesso Restrito
                    </h2>
                    <p className="max-w-md">
                        A gestão de grupos está disponível apenas para administradores.
                        Entre em contato com o administrador se acredita que isso é um erro.
                    </p>
                </div>
            </PageLayout>
        );
    }

    return (
        <PageLayout title="Grupos" maxWidth="lg" noPadding>
            <PageHeader
                title={
                    <span className="flex items-center gap-2">
                        <ShieldCheck size={24} className="text-indigo-500" />
                        Grupos
                    </span>
                }
                subtitle="Gerencie os grupos de usuários e suas permissões"
                actions={
                    <>
                        <Button
                            variant="outline"
                            icon={<RefreshCw size={16} />}
                            onClick={loadGroups}
                            disabled={isLoading}
                        >
                            Atualizar
                        </Button>
                        <Button
                            variant="primary"
                            icon={<Plus size={16} />}
                            onClick={() => {
                                setForm({ name: '', note: '' });
                                setIsCreateOpen(true);
                            }}
                        >
                            Novo Grupo
                        </Button>
                    </>
                }
            />

            <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
                <Input
                    placeholder="Buscar grupo por nome ou descrição..."
                    icon={<Search size={16} />}
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                />

                {isLoading ? (
                    <div className="flex justify-center py-20">
                        <Spinner />
                    </div>
                ) : error ? (
                    <EmptyState
                        icon={Users}
                        title="Erro ao carregar grupos"
                        description={error}
                        action={
                            <Button variant="outline" onClick={loadGroups}>
                                Tentar novamente
                            </Button>
                        }
                    />
                ) : filteredGroups.length === 0 ? (
                    <EmptyState
                        icon={Users}
                        title={searchTerm ? 'Nenhum grupo encontrado' : 'Nenhum grupo cadastrado'}
                        description={
                            searchTerm
                                ? 'Tente ajustar a busca.'
                                : 'Crie o primeiro grupo para começar a organizar permissões.'
                        }
                        action={
                            !searchTerm ? (
                                <Button
                                    variant="primary"
                                    icon={<Plus size={16} />}
                                    onClick={() => setIsCreateOpen(true)}
                                >
                                    Novo Grupo
                                </Button>
                            ) : undefined
                        }
                    />
                ) : (
                    <div className="grid grid-cols-1 gap-3">
                        {filteredGroups.map(group => (
                            /* Use a plain div (not Card's onClick) to avoid <button> inside <button> */
                            <div
                                key={group.id}
                                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm hover:shadow-md hover:ring-2 hover:ring-indigo-400/50 transition-all cursor-pointer p-4"
                                role="button"
                                tabIndex={0}
                                aria-label={`Abrir detalhes do grupo ${group.name}`}
                                onClick={() => setSelectedGroup(group)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter' || e.key === ' ') setSelectedGroup(group);
                                }}
                            >
                                <div className="flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-4 min-w-0">
                                        <div className="shrink-0 w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                                            <Users size={20} />
                                        </div>
                                        <div className="min-w-0">
                                            <h4 className="font-bold text-slate-800 dark:text-white truncate">
                                                {group.name || `Grupo #${group.id}`}
                                            </h4>
                                            <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">
                                                {group.note || 'Sem descrição'}
                                            </p>
                                            {(group.datec || group.tms) && (
                                                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                                                    {group.datec
                                                        ? `Criado em ${formatDate(group.datec)}`
                                                        : `Atualizado em ${formatDate(group.tms)}`}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            icon={<Pencil size={16} />}
                                            className="text-slate-400 hover:text-indigo-500"
                                            aria-label={`Editar grupo ${group.name}`}
                                            onClick={e => {
                                                e.stopPropagation();
                                                setGroupToEdit(group);
                                            }}
                                        />
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            icon={<Trash2 size={16} />}
                                            className="text-slate-400 hover:text-red-500"
                                            aria-label={`Excluir grupo ${group.name}`}
                                            onClick={e => {
                                                e.stopPropagation();
                                                setGroupToDelete(group);
                                            }}
                                        />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Create Group Modal */}
            <Modal
                isOpen={isCreateOpen}
                onClose={() => setIsCreateOpen(false)}
                title="Novo Grupo"
                size="md"
                footer={
                    <>
                        <Button
                            variant="ghost"
                            onClick={() => setIsCreateOpen(false)}
                            disabled={isSaving}
                        >
                            Cancelar
                        </Button>
                        <Button
                            variant="primary"
                            onClick={handleCreate}
                            loading={isSaving}
                            disabled={!form.name.trim()}
                            icon={<Plus size={16} />}
                        >
                            Criar Grupo
                        </Button>
                    </>
                }
            >
                <form onSubmit={handleCreate} className="space-y-4">
                    <Input
                        label="Nome do Grupo *"
                        placeholder="Ex: Recursos Humanos"
                        value={form.name}
                        onChange={e => setForm({ ...form, name: e.target.value })}
                        autoFocus
                    />
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Descrição / Nota
                        </label>
                        <textarea
                            className="w-full p-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors min-h-[100px]"
                            placeholder="Descrição do propósito deste grupo..."
                            value={form.note}
                            onChange={e => setForm({ ...form, note: e.target.value })}
                        />
                    </div>
                    {/* Hidden submit so Enter submits the form */}
                    <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
                </form>
            </Modal>

            {/* Edit Group Modal — reuses HR/modals/GroupModal */}
            <GroupModal
                isOpen={!!groupToEdit}
                onClose={() => setGroupToEdit(null)}
                config={config}
                groupToEdit={groupToEdit}
                onRefresh={handleEditRefresh}
            />

            {/* Group Detail Slide-over (members + permissions) */}
            {selectedGroup && (
                <div
                    className="fixed inset-0 z-40 flex"
                    role="dialog"
                    aria-modal="true"
                    aria-label={`Detalhes do grupo ${selectedGroup.name}`}
                >
                    {/* Backdrop */}
                    <div
                        className="flex-1 bg-black/30 backdrop-blur-sm"
                        onClick={() => setSelectedGroup(null)}
                    />
                    {/* Panel */}
                    <div className="w-full max-w-lg h-full">
                        <GroupDetail
                            group={selectedGroup}
                            users={users}
                            currentConfig={config}
                            onClose={() => setSelectedGroup(null)}
                            onRefresh={loadGroups}
                        />
                    </div>
                </div>
            )}

            {/* Delete Confirmation */}
            <ConfirmModal
                isOpen={!!groupToDelete}
                onClose={() => setGroupToDelete(null)}
                onConfirm={handleDelete}
                title="Excluir Grupo"
                message={`Tem certeza que deseja excluir o grupo "${groupToDelete?.name || ''}"? Esta ação não pode ser desfeita.`}
                confirmLabel="Excluir"
                isLoading={isDeleting}
                variant="danger"
            />
        </PageLayout>
    );
};

export default GroupManager;
