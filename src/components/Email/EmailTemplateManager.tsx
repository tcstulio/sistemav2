import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Edit3, Save } from 'lucide-react';
import { EmailTemplate } from '../../types/email';
import { EmailService } from '../../services/emailService';
import { toast } from 'sonner';
import { useConfirm } from '../../hooks/useConfirm';

interface EmailTemplateManagerProps {
    onClose: () => void;
}

export const EmailTemplateManager: React.FC<EmailTemplateManagerProps> = ({ onClose }) => {
    const confirm = useConfirm();
    const [templates, setTemplates] = useState<EmailTemplate[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState({ name: '', subject: '', body: '' });
    const [isCreating, setIsCreating] = useState(false);

    useEffect(() => {
        loadTemplates();
    }, []);

    const loadTemplates = async () => {
        setLoading(true);
        try {
            const data = await EmailService.getTemplates();
            setTemplates(data);
        } catch {
            toast.error('Erro ao carregar templates');
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async () => {
        if (!editForm.name) {
            toast.error('Nome é obrigatório');
            return;
        }
        try {
            await EmailService.addTemplate(editForm);
            toast.success('Template criado');
            setIsCreating(false);
            setEditForm({ name: '', subject: '', body: '' });
            loadTemplates();
        } catch {
            toast.error('Erro ao criar template');
        }
    };

    const handleUpdate = async () => {
        if (!editingId) return;
        try {
            await EmailService.updateTemplate(editingId, editForm);
            toast.success('Template atualizado');
            setEditingId(null);
            setEditForm({ name: '', subject: '', body: '' });
            loadTemplates();
        } catch {
            toast.error('Erro ao atualizar template');
        }
    };

    const handleDelete = async (id: string) => {
        if (!(await confirm('Excluir template?'))) return;
        try {
            await EmailService.deleteTemplate(id);
            toast.success('Template excluído');
            loadTemplates();
        } catch {
            toast.error('Erro ao excluir template');
        }
    };

    const startEdit = (template: EmailTemplate) => {
        setEditingId(template.id);
        setEditForm({ name: template.name, subject: template.subject, body: template.body });
        setIsCreating(false);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 w-full max-w-2xl rounded-xl shadow-2xl flex flex-col max-h-[80vh] overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                    <h2 className="text-xl font-bold text-slate-800 dark:text-white">Templates de Email</h2>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => { setIsCreating(true); setEditingId(null); setEditForm({ name: '', subject: '', body: '' }); }}
                            className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                        >
                            <Plus size={18} />
                        </button>
                        <button onClick={onClose} className="text-slate-500 hover:text-slate-700 dark:hover:text-white">
                            <X size={24} />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    {/* Create / Edit Form */}
                    {(isCreating || editingId) && (
                        <div className="mb-6 p-4 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 space-y-3">
                            <h3 className="font-semibold text-sm text-slate-700 dark:text-slate-300">
                                {isCreating ? 'Novo Template' : 'Editar Template'}
                            </h3>
                            <input
                                type="text"
                                placeholder="Nome do template"
                                value={editForm.name}
                                onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
                                className="w-full p-2 border rounded text-sm bg-white dark:bg-slate-800 dark:border-slate-600"
                            />
                            <input
                                type="text"
                                placeholder="Assunto"
                                value={editForm.subject}
                                onChange={e => setEditForm(p => ({ ...p, subject: e.target.value }))}
                                className="w-full p-2 border rounded text-sm bg-white dark:bg-slate-800 dark:border-slate-600"
                            />
                            <textarea
                                placeholder="Corpo do email"
                                value={editForm.body}
                                onChange={e => setEditForm(p => ({ ...p, body: e.target.value }))}
                                className="w-full p-2 border rounded text-sm h-32 bg-white dark:bg-slate-800 dark:border-slate-600"
                            />
                            <div className="flex gap-2">
                                <button
                                    onClick={isCreating ? handleCreate : handleUpdate}
                                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                                >
                                    <Save size={14} />
                                    {isCreating ? 'Criar' : 'Salvar'}
                                </button>
                                <button
                                    onClick={() => { setIsCreating(false); setEditingId(null); }}
                                    className="px-4 py-2 text-slate-600 dark:text-slate-300 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 rounded"
                                >
                                    Cancelar
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Templates List */}
                    {loading ? (
                        <p className="text-slate-400 text-center py-8">Carregando...</p>
                    ) : templates.length === 0 ? (
                        <p className="text-slate-400 text-center py-8">Nenhum template criado.</p>
                    ) : (
                        <div className="space-y-3">
                            {templates.map(t => (
                                <div key={t.id} className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/50">
                                    <div className="flex items-start justify-between">
                                        <div className="min-w-0 flex-1">
                                            <h4 className="font-semibold text-sm text-slate-800 dark:text-white">{t.name}</h4>
                                            <p className="text-xs text-slate-500 truncate mt-1">Assunto: {t.subject || '(vazio)'}</p>
                                            <p className="text-xs text-slate-400 mt-1 line-clamp-2">{t.body || '(vazio)'}</p>
                                        </div>
                                        <div className="flex items-center gap-1 ml-3">
                                            <button
                                                onClick={() => startEdit(t)}
                                                className="p-1.5 text-slate-400 hover:text-blue-500"
                                            >
                                                <Edit3 size={14} />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(t.id)}
                                                className="p-1.5 text-slate-400 hover:text-red-500"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
