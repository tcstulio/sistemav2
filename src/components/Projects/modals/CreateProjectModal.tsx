import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { ThirdParty } from '../../../types/crm';

interface CreateProjectForm {
    ref: string;
    title: string;
    socid: string;
    description: string;
    date_start: string;
    date_end: string;
    budget_amount: string;
}

interface CreateProjectModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (form: CreateProjectForm) => Promise<void>;
    customers: ThirdParty[];
    isSubmitting: boolean;
    initialForm?: Partial<{ ref: string; title: string; socid: string }>; // prefill do agente (#57)
}

export const CreateProjectModal: React.FC<CreateProjectModalProps> = ({
    isOpen,
    onClose,
    onSubmit,
    customers,
    isSubmitting,
    initialForm
}) => {
    const [form, setForm] = useState<CreateProjectForm>({ ref: '', title: '', socid: '', description: '', date_start: '', date_end: '', budget_amount: '' });

    // ao abrir, sincroniza com o prefill (vazio se não houver) — deeplink HITL do agente.
    useEffect(() => {
        if (isOpen) {
            if (initialForm?.ref) {
                setForm({ ref: initialForm.ref, title: initialForm?.title || '', socid: initialForm?.socid || '', description: '', date_start: '', date_end: '', budget_amount: '' });
            } else {
                const year = new Date().getFullYear();
                const nextNum = String(Math.floor(Math.random() * 999) + 1).padStart(3, '0');
                setForm({ ref: `PROJ-${year}-${nextNum}`, title: '', socid: '', description: '', date_start: '', date_end: '', budget_amount: '' });
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        await onSubmit(form);
        setForm({ ref: '', title: '', socid: '', description: '', date_start: '', date_end: '', budget_amount: '' });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md border border-slate-200 dark:border-slate-800">
                <div className="flex justify-between items-center p-4 border-b border-slate-100 dark:border-slate-800">
                    <h3 className="font-bold text-lg dark:text-white">Novo Projeto</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                        <X size={20} />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="p-4 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Referência</label>
                        <input
                            type="text"
                            required
                            className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                            value={form.ref}
                            onChange={e => setForm({ ...form, ref: e.target.value.toUpperCase() })}
                            placeholder="PROJ-2024-001"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Título</label>
                        <input
                            type="text"
                            required
                            className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                            value={form.title}
                            onChange={e => setForm({ ...form, title: e.target.value })}
                            placeholder="Nome do projeto"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Cliente (SocID)</label>
                        <select
                            required
                            className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                            value={form.socid}
                            onChange={e => setForm({ ...form, socid: e.target.value })}
                        >
                            <option value="">Selecione...</option>
                            {customers.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Descrição</label>
                        <textarea
                            rows={3}
                            className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white resize-none"
                            value={form.description}
                            onChange={e => setForm({ ...form, description: e.target.value })}
                            placeholder="Descrição do projeto (opcional)"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Data Início</label>
                            <input
                                type="date"
                                className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                value={form.date_start}
                                onChange={e => setForm({ ...form, date_start: e.target.value })}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Data Fim</label>
                            <input
                                type="date"
                                className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                value={form.date_end}
                                onChange={e => setForm({ ...form, date_end: e.target.value })}
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Orçamento (R$)</label>
                        <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                            value={form.budget_amount}
                            onChange={e => setForm({ ...form, budget_amount: e.target.value })}
                            placeholder="0,00"
                        />
                    </div>
                    <div className="pt-2 flex justify-end gap-2">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancelar</button>
                        <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50">
                            {isSubmitting ? 'Criando...' : 'Criar Projeto'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CreateProjectModal;
