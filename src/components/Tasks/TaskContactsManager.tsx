import React, { useEffect, useState, useCallback } from 'react';
import { Users, X, Loader2, Plus, Crown } from 'lucide-react';
import { DolibarrConfig } from '../../types';
import { DolibarrService } from '../../services/dolibarrService';
import { logger } from '../../utils/logger';
import { notifyError } from '../../utils/notifyError';

const log = logger.child('TaskContactsManager');

// type_id em llx_element_contact: 45 = Responsável (TASKEXECUTIVE), 46 = Interveniente (TASKCONTRIBUTOR).
export const RESPONSAVEL_TYPE_ID = '45';
export const INTERVENIENTE_TYPE_ID = '46';

export interface TaskContactRow {
    id: string;        // rowid de element_contact (usado p/ remover)
    task_id: string;
    user_id: string;
    type_id: string;   // '45' | '46'
}

interface SimpleUser {
    id: string;
    firstname?: string;
    lastname?: string;
    login?: string;
}

/** Separa os contatos de uma tarefa em Responsável (único) e Intervenientes. Função pura (testável). */
export function splitTaskRoles(contacts: TaskContactRow[]): {
    responsavel: TaskContactRow | null;
    intervenientes: TaskContactRow[];
} {
    const responsavel = contacts.find((c) => String(c.type_id) === RESPONSAVEL_TYPE_ID) || null;
    const intervenientes = contacts.filter((c) => String(c.type_id) === INTERVENIENTE_TYPE_ID);
    return { responsavel, intervenientes };
}

interface Props {
    config: DolibarrConfig;
    taskId: string;
    users: SimpleUser[];
    /** chamado após cada gravação, p/ o pai re-sincronizar se quiser */
    onChange?: () => void;
}

/**
 * Gestão de Responsável/Intervenientes de uma tarefa (camada 2f).
 * Lê e grava ao vivo via /api/dolibarr/tasks/:id/contacts (canal custom_sync #72),
 * que é o único que de fato persiste o vínculo em element_contact.
 */
export const TaskContactsManager: React.FC<Props> = ({ config, taskId, users, onChange }) => {
    const [contacts, setContacts] = useState<TaskContactRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [addUserId, setAddUserId] = useState('');

    const userName = (userId?: string) => {
        if (!userId) return '-';
        const u = users.find((x) => String(x.id) === String(userId));
        return u ? `${u.firstname || ''} ${u.lastname || ''}`.trim() || u.login || `ID ${userId}` : `ID ${userId}`;
    };

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const rows = await DolibarrService.getTaskContacts(config, taskId);
            setContacts(Array.isArray(rows) ? (rows as TaskContactRow[]) : []);
        } catch (e) {
            log.warn('Falha ao carregar contatos da tarefa', e);
            setContacts([]);
        } finally {
            setLoading(false);
        }
    }, [config, taskId]);

    useEffect(() => {
        reload();
    }, [reload]);

    const { responsavel, intervenientes } = splitTaskRoles(contacts);

    const setResponsavel = async (userId: string) => {
        if (!userId || saving) return;
        setSaving(true);
        try {
            // add_contact não substitui: se já há um responsável diferente, remove antes.
            if (responsavel && String(responsavel.user_id) !== String(userId)) {
                await DolibarrService.removeTaskContact(config, taskId, responsavel.id);
            }
            await DolibarrService.setTaskContact(config, taskId, userId, 'TASKEXECUTIVE');
            await reload();
            onChange?.();
        } catch (e) {
            notifyError('Definir responsável', e);
        } finally {
            setSaving(false);
        }
    };

    const addInterveniente = async () => {
        if (!addUserId || saving) return;
        setSaving(true);
        try {
            await DolibarrService.setTaskContact(config, taskId, addUserId, 'TASKCONTRIBUTOR');
            setAddUserId('');
            await reload();
            onChange?.();
        } catch (e) {
            notifyError('Adicionar interveniente', e);
        } finally {
            setSaving(false);
        }
    };

    const removeContact = async (rowid: string) => {
        if (saving) return;
        setSaving(true);
        try {
            await DolibarrService.removeTaskContact(config, taskId, rowid);
            await reload();
            onChange?.();
        } catch (e) {
            notifyError('Remover contato', e);
        } finally {
            setSaving(false);
        }
    };

    // Não oferecer no "adicionar" quem já está envolvido.
    const involvedIds = new Set(contacts.map((c) => String(c.user_id)));
    const candidates = users.filter((u) => !involvedIds.has(String(u.id)));

    return (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                <Users size={18} className="text-indigo-500" /> Responsável e Envolvidos
                {(loading || saving) && <Loader2 size={16} className="animate-spin text-slate-400" />}
            </h2>

            {/* Responsável */}
            <div className="mb-5">
                <p className="text-xs uppercase font-bold text-slate-500 mb-2 flex items-center gap-1">
                    <Crown size={13} className="text-amber-500" /> Responsável
                </p>
                <div className="flex items-center gap-3">
                    {responsavel ? (
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-100 dark:border-amber-800/40">
                            <span className="text-sm font-medium text-slate-900 dark:text-white">{userName(responsavel.user_id)}</span>
                            <button
                                type="button"
                                onClick={() => removeContact(responsavel.id)}
                                disabled={saving}
                                aria-label="Remover responsável"
                                className="text-slate-400 hover:text-red-500 disabled:opacity-50"
                            >
                                <X size={14} />
                            </button>
                        </div>
                    ) : (
                        <span className="text-sm text-slate-400 italic">Sem responsável</span>
                    )}
                    <select
                        aria-label="Definir responsável"
                        value=""
                        disabled={saving}
                        onChange={(e) => setResponsavel(e.target.value)}
                        className="text-sm p-1.5 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white disabled:opacity-50"
                    >
                        <option value="">{responsavel ? 'Trocar…' : 'Definir…'}</option>
                        {users
                            .filter((u) => !responsavel || String(u.id) !== String(responsavel.user_id))
                            .map((u) => (
                                <option key={u.id} value={u.id}>
                                    {userName(u.id)}
                                </option>
                            ))}
                    </select>
                </div>
            </div>

            {/* Colaboradores */}
            <div>
                <p className="text-xs uppercase font-bold text-slate-500 mb-2 flex items-center gap-1">
                    <Users size={13} className="text-indigo-500" /> Colaboradores
                </p>
                {intervenientes.length === 0 ? (
                    <p className="text-sm text-slate-400 italic mb-2">Nenhum colaborador</p>
                ) : (
                    <div className="flex flex-wrap gap-2 mb-2">
                        {intervenientes.map((c) => (
                            <div
                                key={c.id}
                                className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700"
                            >
                                <span className="text-sm text-slate-900 dark:text-white">{userName(c.user_id)}</span>
                                <button
                                    type="button"
                                    onClick={() => removeContact(c.id)}
                                    disabled={saving}
                                    aria-label={`Remover ${userName(c.user_id)}`}
                                    className="text-slate-400 hover:text-red-500 disabled:opacity-50"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
                <div className="flex items-center gap-2">
                    <select
                        aria-label="Adicionar colaborador"
                        value={addUserId}
                        disabled={saving}
                        onChange={(e) => setAddUserId(e.target.value)}
                        className="text-sm p-1.5 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white disabled:opacity-50"
                    >
                        <option value="">Adicionar…</option>
                        {candidates.map((u) => (
                            <option key={u.id} value={u.id}>
                                {userName(u.id)}
                            </option>
                        ))}
                    </select>
                    <button
                        type="button"
                        onClick={addInterveniente}
                        disabled={saving || !addUserId}
                        className="flex items-center gap-1 text-sm px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                    >
                        <Plus size={14} /> Adicionar
                    </button>
                </div>
            </div>
        </div>
    );
};

export default TaskContactsManager;
