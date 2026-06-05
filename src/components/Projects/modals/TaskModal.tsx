import React from 'react';
import { X } from 'lucide-react';

interface TaskForm {
    label: string;
    description: string;
    planned_workload: number;
    date_start: string;
    date_end: string;
    fk_user_assign: string;
}

interface DolibarrUser {
    id: string;
    lastname?: string;
    firstname?: string;
    email?: string;
    login?: string;
}

interface TaskModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (e: React.FormEvent) => Promise<void>;
    form: TaskForm;
    setForm: (form: TaskForm) => void;
    isSubmitting: boolean;
    isEditing: boolean;
    users?: DolibarrUser[];
}

export const TaskModal: React.FC<TaskModalProps> = ({
    isOpen,
    onClose,
    onSubmit,
    form,
    setForm,
    isSubmitting,
    isEditing,
    users = []
}) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md border border-slate-200 dark:border-slate-800">
                <div className="flex justify-between items-center p-4 border-b border-slate-100 dark:border-slate-800">
                    <h3 className="font-bold text-lg dark:text-white">{isEditing ? 'Editar Tarefa' : 'Nova Tarefa'}</h3>
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
                            value={form.label}
                            onChange={e => setForm({ ...form, label: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Responsável</label>
                        <select
                            className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                            value={form.fk_user_assign}
                            onChange={e => setForm({ ...form, fk_user_assign: e.target.value })}
                        >
                            <option value="">Nenhum</option>
                            {users.map(u => (
                                <option key={u.id} value={u.id}>
                                    {u.firstname || u.lastname ? `${u.firstname || ''} ${u.lastname || ''}`.trim() : u.login || `ID ${u.id}`}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Carga Horária Planejada (h)</label>
                        <input
                            type="number"
                            step="0.5"
                            className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                            value={form.planned_workload}
                            onChange={e => setForm({ ...form, planned_workload: parseFloat(e.target.value) || 0 })}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Início</label>
                            <input
                                type="date"
                                className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                value={form.date_start}
                                onChange={e => setForm({ ...form, date_start: e.target.value })}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Fim</label>
                            <input
                                type="date"
                                className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                value={form.date_end}
                                onChange={e => setForm({ ...form, date_end: e.target.value })}
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Descrição</label>
                        <textarea
                            className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white h-24"
                            value={form.description}
                            onChange={e => setForm({ ...form, description: e.target.value })}
                        />
                    </div>
                    <div className="pt-2 flex justify-end gap-2">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancelar</button>
                        <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50">
                            {isSubmitting ? 'Salvando...' : (isEditing ? 'Atualizar' : 'Criar')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default TaskModal;
