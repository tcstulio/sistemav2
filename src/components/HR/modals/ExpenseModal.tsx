import React, { useState, useEffect } from 'react';
import { DolibarrConfig, DolibarrUser } from '../../../types';
import { DolibarrService } from '../../../services/dolibarrService';
import { Banknote, X, Loader2, CheckCircle2 } from 'lucide-react';
import { logger } from '../../../utils/logger';
import { toast } from 'sonner';

const log = logger.child('ExpenseModal');

interface ExpenseModalProps {
    isOpen: boolean;
    onClose: () => void;
    config: DolibarrConfig;
    users: DolibarrUser[];
    onRefresh?: () => void;
    initialForm?: Partial<{ fk_user_author: string; date_debut: string; date_fin: string; total_ttc: string; note_public: string }>; // prefill (#57/#78)
    editId?: string; // se definido, modo edição da despesa
}

const emptyForm = { fk_user_author: '', date_debut: '', date_fin: '', total_ttc: '', note_public: '' };

export const ExpenseModal: React.FC<ExpenseModalProps> = ({ isOpen, onClose, config, users, onRefresh, initialForm, editId }) => {
    const [form, setForm] = useState(emptyForm);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const isEdit = !!editId;

    // ao abrir, sincroniza com o prefill (vazio se não houver) — deeplink HITL.
    useEffect(() => {
        if (isOpen) {
            setForm({
                fk_user_author: initialForm?.fk_user_author || '',
                date_debut: initialForm?.date_debut || '',
                date_fin: initialForm?.date_fin || '',
                total_ttc: initialForm?.total_ttc || '',
                note_public: initialForm?.note_public || '',
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.date_debut || !form.date_fin) return;
        if (!isEdit && !form.fk_user_author) return;
        setIsSubmitting(true);
        try {
            // fk_user_author é imutável após a criação (não troca o dono da despesa).
            const data: Record<string, unknown> = {
                date_debut: new Date(form.date_debut).getTime() / 1000,
                date_fin: new Date(form.date_fin).getTime() / 1000,
                total_ttc: form.total_ttc ? Number(form.total_ttc) : 0,
                note_public: form.note_public,
            };
            if (isEdit) {
                await DolibarrService.updateObject(config, 'expensereports', editId!, data);
            } else {
                await DolibarrService.createExpenseReport(config, { ...data, fk_user_author: form.fk_user_author });
            }
            onClose();
            setForm(emptyForm);
            toast.success(isEdit ? 'Despesa atualizada com sucesso' : 'Relatório de despesa criado com sucesso');
            if (onRefresh) onRefresh();
        } catch (err) { log.error(err); } finally { setIsSubmitting(false); }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-xl p-6 w-full max-w-md shadow-lg border border-slate-200 dark:border-slate-800 animate-in zoom-in-95">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-lg dark:text-white flex items-center gap-2"><Banknote size={18} className="text-emerald-500" /> {isEdit ? 'Editar Despesa' : 'Nova Despesa'}</h3>
                    <button onClick={onClose}><X size={20} className="text-slate-400" /></button>
                </div>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Funcionário</label>
                        <select disabled={isEdit} className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white disabled:opacity-60" value={form.fk_user_author} onChange={e => setForm({ ...form, fk_user_author: e.target.value })}>
                            <option value="">Selecione Usuário...</option>
                            {users.map(u => <option key={u.id} value={u.id}>{u.firstname} {u.lastname} ({u.login})</option>)}
                        </select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Início</label>
                            <input type="date" className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={form.date_debut} onChange={e => setForm({ ...form, date_debut: e.target.value })} />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Fim</label>
                            <input type="date" className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={form.date_fin} onChange={e => setForm({ ...form, date_fin: e.target.value })} />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Valor Total (R$)</label>
                        <input type="number" step="0.01" className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={form.total_ttc} onChange={e => setForm({ ...form, total_ttc: e.target.value })} placeholder="0,00" />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Notas</label>
                        <textarea className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white resize-none" value={form.note_public} onChange={e => setForm({ ...form, note_public: e.target.value })} placeholder="Descrição da despesa..." />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-slate-500 hover:text-slate-700">Cancelar</button>
                        <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-medium flex items-center gap-2">
                            {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} {isEdit ? 'Salvar' : 'Criar'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
