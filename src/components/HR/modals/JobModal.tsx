import React, { useState, useEffect } from 'react';
import { DolibarrConfig } from '../../../types';
import { DolibarrService } from '../../../services/dolibarrService';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { logger } from '../../../utils/logger';

const log = logger.child('JobModal');

interface JobModalProps {
    isOpen: boolean;
    onClose: () => void;
    config: DolibarrConfig;
    onRefresh?: () => void;
    initialForm?: Partial<{ label: string; qty: string; description: string }>; // prefill do agente (#57)
    editId?: string; // se definido, modo edição da vaga (#57/#78)
}

export const JobModal: React.FC<JobModalProps> = ({ isOpen, onClose, config, onRefresh, initialForm, editId }) => {
    const [jobForm, setJobForm] = useState({ label: '', qty: 1, description: '' });
    const [isSubmittingJob, setIsSubmittingJob] = useState(false);
    const isEdit = !!editId;

    // ao abrir, sincroniza com o prefill (vazio se não houver) — deeplink HITL.
    useEffect(() => {
        if (isOpen) {
            setJobForm({
                label: initialForm?.label || '',
                qty: initialForm?.qty ? (parseInt(initialForm.qty) || 1) : 1,
                description: initialForm?.description || '',
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!jobForm.label) return;
        setIsSubmittingJob(true);
        try {
            if (isEdit) {
                await DolibarrService.updateObject(config, 'recruitmentjobpositions', editId!, jobForm);
            } else {
                await DolibarrService.createJobPosition(config, jobForm);
            }
            onClose();
            setJobForm({ label: '', qty: 1, description: '' });
            if (onRefresh) onRefresh();
        } catch (e) { log.error(e); } finally { setIsSubmittingJob(false); }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-xl p-6 w-full max-w-md">
                <h3 className="font-bold text-lg mb-4 dark:text-white">{isEdit ? 'Editar Posição' : 'Nova Posição'}</h3>
                <input className="w-full p-2 border rounded mb-2 dark:bg-slate-800 dark:border-slate-700 dark:text-white" placeholder="Título" value={jobForm.label} onChange={e => setJobForm({ ...jobForm, label: e.target.value })} />
                <input className="w-full p-2 border rounded mb-2 dark:bg-slate-800 dark:border-slate-700 dark:text-white" type="number" placeholder="Qtd" value={jobForm.qty} onChange={e => setJobForm({ ...jobForm, qty: parseInt(e.target.value) })} />
                <textarea className="w-full p-2 border rounded mb-4 dark:bg-slate-800 dark:border-slate-700 dark:text-white" placeholder="Descrição" value={jobForm.description} onChange={e => setJobForm({ ...jobForm, description: e.target.value })} />
                <div className="flex justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-2 text-slate-500 hover:text-slate-700">Cancelar</button>
                    <button onClick={handleSubmit} disabled={isSubmittingJob} className="px-4 py-2 bg-indigo-600 text-white rounded flex items-center gap-2">
                        {isSubmittingJob ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />} {isEdit ? 'Salvar' : 'Criar'}
                    </button>
                </div>
            </div>
        </div>
    );
};
