import React, { useState, useEffect } from 'react';
import { DolibarrConfig, UserGroup } from '../../../types';
import * as HRAdmin from '../../../services/api/hrAdmin';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { notifyError } from '../../../utils/notifyError';

interface GroupModalProps {
    isOpen: boolean;
    onClose: () => void;
    config: DolibarrConfig;
    groupToEdit?: UserGroup | null;
    onRefresh?: () => void;
    initialForm?: Partial<{ name: string; note: string }>; // prefill do agente (#57/#78)
}

export const GroupModal: React.FC<GroupModalProps> = ({
    isOpen,
    onClose,
    config,
    groupToEdit,
    onRefresh,
    initialForm
}) => {
    const [groupForm, setGroupForm] = useState({ name: '', note: '' });
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (isOpen) {
            if (groupToEdit) {
                setGroupForm({
                    name: initialForm?.name ?? groupToEdit.name ?? '',
                    note: initialForm?.note ?? groupToEdit.note ?? ''
                });
            } else {
                setGroupForm({ name: initialForm?.name || '', note: initialForm?.note || '' });
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, groupToEdit]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!groupForm.name) return;

        setIsSubmitting(true);
        try {
            if (groupToEdit) {
                await HRAdmin.updateGroup(config, groupToEdit.id, groupForm);
            } else {
                await HRAdmin.createGroup(config, groupForm);
            }

            if (onRefresh) onRefresh();
            onClose();
        } catch (e) {
            notifyError('Salvar grupo', e);
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-xl p-6 w-full max-w-md shadow-2xl border border-slate-200 dark:border-slate-800">
                <h3 className="font-bold text-xl mb-6 dark:text-white">
                    {groupToEdit ? 'Editar Grupo' : 'Novo Grupo'}
                </h3>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nome do Grupo *</label>
                        <input
                            className="w-full p-2.5 border rounded-lg bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                            placeholder="Ex: Recursos Humanos"
                            value={groupForm.name}
                            onChange={e => setGroupForm({ ...groupForm, name: e.target.value })}
                            autoFocus
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Descrição / Nota</label>
                        <textarea
                            className="w-full p-2.5 border rounded-lg bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all min-h-[100px]"
                            placeholder="Descrição do propósito deste grupo..."
                            value={groupForm.note}
                            onChange={e => setGroupForm({ ...groupForm, note: e.target.value })}
                        />
                    </div>

                    <div className="flex justify-end gap-3 mt-6 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors font-medium"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting || !groupForm.name}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg flex items-center gap-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm shadow-indigo-200 dark:shadow-none"
                        >
                            {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}
                            {groupToEdit ? 'Salvar Alterações' : 'Criar Grupo'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
