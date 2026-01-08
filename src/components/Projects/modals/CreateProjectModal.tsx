import React, { useState } from 'react';
import { X } from 'lucide-react';
import { ThirdParty } from '../../../types/crm';

interface CreateProjectModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (form: { ref: string; title: string; socid: string }) => Promise<void>;
    customers: ThirdParty[];
    isSubmitting: boolean;
}

export const CreateProjectModal: React.FC<CreateProjectModalProps> = ({
    isOpen,
    onClose,
    onSubmit,
    customers,
    isSubmitting
}) => {
    const [form, setForm] = useState({ ref: '', title: '', socid: '' });

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        await onSubmit(form);
        setForm({ ref: '', title: '', socid: '' });
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
