import React from 'react';
import { X } from 'lucide-react';

interface EditProjectForm {
    title: string;
    status: string;
    date_start: string;
    date_end: string;
    description: string;
}

interface EditProjectModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (e: React.FormEvent) => Promise<void>;
    form: EditProjectForm;
    setForm: (form: EditProjectForm) => void;
    isSubmitting: boolean;
}

export const EditProjectModal: React.FC<EditProjectModalProps> = ({
    isOpen,
    onClose,
    onSubmit,
    form,
    setForm,
    isSubmitting
}) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md border border-slate-200 dark:border-slate-800">
                <div className="flex justify-between items-center p-4 border-b border-slate-100 dark:border-slate-800">
                    <h3 className="font-bold text-lg dark:text-white">Editar Projeto</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                        <X size={20} />
                    </button>
                </div>
                <form onSubmit={onSubmit} className="p-4 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Título</label>
                        <input
                            type="text"
                            required
                            className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                            value={form.title}
                            onChange={e => setForm({ ...form, title: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Status</label>
                        <select
                            className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                            value={form.status}
                            onChange={e => setForm({ ...form, status: e.target.value })}
                        >
                            <option value="0">Rascunho</option>
                            <option value="1">Aberto</option>
                            <option value="2">Fechado</option>
                        </select>
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
                    <div className="pt-2 flex justify-end gap-2">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancelar</button>
                        <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50">
                            {isSubmitting ? 'Salvando...' : 'Salvar Alterações'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default EditProjectModal;
