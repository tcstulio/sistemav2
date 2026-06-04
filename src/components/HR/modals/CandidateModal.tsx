import React, { useState, useEffect } from 'react';
import { DolibarrConfig, RecruitmentJobPosition } from '../../../types';
import { DolibarrService } from '../../../services/dolibarrService';
import { UserPlus, X, Loader2, CheckCircle2 } from 'lucide-react';
import { logger } from '../../../utils/logger';

const log = logger.child('CandidateModal');

interface CandidateModalProps {
    isOpen: boolean;
    onClose: () => void;
    config: DolibarrConfig;
    jobPositions: RecruitmentJobPosition[];
    onRefresh?: () => void;
    initialForm?: Partial<{ firstname: string; lastname: string; email: string; phone: string; fk_job_position: string; note_public: string }>; // prefill (#57)
    editId?: string; // se definido, modo edição do candidato (#57/#78)
}

const emptyForm = { firstname: '', lastname: '', email: '', phone: '', fk_job_position: '', note_public: '' };

export const CandidateModal: React.FC<CandidateModalProps> = ({ isOpen, onClose, config, jobPositions, onRefresh, initialForm, editId }) => {
    const [form, setForm] = useState(emptyForm);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const isEdit = !!editId;

    // ao abrir, sincroniza com o prefill (vazio se não houver) — deeplink HITL.
    useEffect(() => {
        if (isOpen) {
            setForm({
                firstname: initialForm?.firstname || '',
                lastname: initialForm?.lastname || '',
                email: initialForm?.email || '',
                phone: initialForm?.phone || '',
                fk_job_position: initialForm?.fk_job_position || '',
                note_public: initialForm?.note_public || '',
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.firstname || !form.lastname || !form.email) return;
        setIsSubmitting(true);
        try {
            // Dolibarr usa fk_recruitment_jobposition no objeto de candidatura.
            const payload: Record<string, unknown> = {
                firstname: form.firstname,
                lastname: form.lastname,
                email: form.email,
                phone: form.phone,
                note_public: form.note_public,
                fk_recruitment_jobposition: form.fk_job_position || undefined,
            };
            if (isEdit) {
                await DolibarrService.updateCandidate(config, editId!, payload);
            } else {
                await DolibarrService.createCandidate(config, payload);
            }
            onClose();
            setForm(emptyForm);
            if (onRefresh) onRefresh();
        } catch (err) { log.error(err); } finally { setIsSubmitting(false); }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-xl p-6 w-full max-w-md shadow-lg border border-slate-200 dark:border-slate-800 animate-in zoom-in-95">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-lg dark:text-white flex items-center gap-2"><UserPlus size={18} className="text-emerald-500" /> {isEdit ? 'Editar Candidato' : 'Novo Candidato'}</h3>
                    <button onClick={onClose}><X size={20} className="text-slate-400" /></button>
                </div>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nome</label>
                            <input className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={form.firstname} onChange={e => setForm({ ...form, firstname: e.target.value })} />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Sobrenome</label>
                            <input className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={form.lastname} onChange={e => setForm({ ...form, lastname: e.target.value })} />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Email</label>
                        <input type="email" className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Telefone</label>
                        <input className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Vaga</label>
                        <select className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={form.fk_job_position} onChange={e => setForm({ ...form, fk_job_position: e.target.value })}>
                            <option value="">Espontâneo / Sem vaga</option>
                            {jobPositions.map(j => <option key={j.id} value={j.id}>{j.label}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Observações</label>
                        <textarea className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white resize-none" value={form.note_public} onChange={e => setForm({ ...form, note_public: e.target.value })} placeholder="Notas sobre o candidato..." />
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
