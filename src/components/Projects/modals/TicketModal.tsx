import React from 'react';
import { X } from 'lucide-react';

interface TicketForm {
    subject: string;
    message: string;
    type_code: string;
    severity_code: string;
}

interface TicketModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (e: React.FormEvent) => Promise<void>;
    form: TicketForm;
    setForm: (form: TicketForm) => void;
    isSubmitting: boolean;
    isEditing: boolean;
}

export const TicketModal: React.FC<TicketModalProps> = ({
    isOpen,
    onClose,
    onSubmit,
    form,
    setForm,
    isSubmitting,
    isEditing
}) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md border border-slate-200 dark:border-slate-800">
                <div className="flex justify-between items-center p-4 border-b border-slate-100 dark:border-slate-800">
                    <h3 className="font-bold text-lg dark:text-white">{isEditing ? 'Editar Chamado' : 'Novo Chamado'}</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                        <X size={20} />
                    </button>
                </div>
                <form onSubmit={onSubmit} className="p-4 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Assunto</label>
                        <input
                            type="text"
                            required
                            className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                            value={form.subject}
                            onChange={e => setForm({ ...form, subject: e.target.value })}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo</label>
                            <select
                                className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                value={form.type_code}
                                onChange={e => setForm({ ...form, type_code: e.target.value })}
                            >
                                <option value="ISSUE">Incidente</option>
                                <option value="REQUEST">Requisição</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Severidade</label>
                            <select
                                className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                value={form.severity_code}
                                onChange={e => setForm({ ...form, severity_code: e.target.value })}
                            >
                                <option value="LOW">Baixa</option>
                                <option value="NORMAL">Normal</option>
                                <option value="HIGH">Alta</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Mensagem/Descrição</label>
                        <textarea
                            className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white h-24"
                            value={form.message}
                            onChange={e => setForm({ ...form, message: e.target.value })}
                        />
                    </div>
                    <div className="pt-2 flex justify-end gap-2">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancelar</button>
                        <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors disabled:opacity-50">
                            {isSubmitting ? 'Salvando...' : (isEditing ? 'Atualizar' : 'Criar')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default TicketModal;
