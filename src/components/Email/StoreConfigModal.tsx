import React, { useState } from 'react';
import { X, Save } from 'lucide-react';

interface StoreConfigModalProps {
    onClose: () => void;
    onSave: (data: any) => Promise<void>;
}

export const StoreConfigModal: React.FC<StoreConfigModalProps> = ({ onClose, onSave }) => {
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        imapHost: '',
        imapPort: 993,
        imapUser: '',
        imapPassword: '',
        imapTls: true,
        smtpHost: '',
        smtpPort: 465,
        smtpUser: '',
        smtpPassword: '',
        smtpSecure: true,
        signature: ''
    });

    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await onSave(formData);
            onClose();
        } catch (error) {
            console.error(error);
            alert('Erro ao salvar configuração');
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (field: string, value: any) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 w-full max-w-2xl rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                    <h2 className="text-xl font-bold text-slate-800 dark:text-white">Adicionar Conta de Email</h2>
                    <button onClick={onClose} className="text-slate-500 hover:text-slate-700 dark:hover:text-white">
                        <X size={24} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    <form id="configForm" onSubmit={handleSubmit} className="space-y-6">
                        {/* Identificação */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nome da Conta</label>
                                <input type="text" required className="input w-full p-2 border rounded" value={formData.name} onChange={e => handleChange('name', e.target.value)} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Email</label>
                                <input type="email" required className="input w-full p-2 border rounded" value={formData.email} onChange={e => handleChange('email', e.target.value)} />
                            </div>
                        </div>

                        {/* IMAP */}
                        <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 bg-slate-50 dark:bg-slate-900/50">
                            <h3 className="font-semibold mb-3 text-slate-800 dark:text-white">Recebimento (IMAP)</h3>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1">Host</label>
                                    <input type="text" required className="input w-full p-2 border rounded text-sm" value={formData.imapHost} onChange={e => handleChange('imapHost', e.target.value)} />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1">Porta</label>
                                    <input type="number" required className="input w-full p-2 border rounded text-sm" value={formData.imapPort} onChange={e => handleChange('imapPort', parseInt(e.target.value))} />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1">Usuário</label>
                                    <input type="text" required className="input w-full p-2 border rounded text-sm" value={formData.imapUser} onChange={e => handleChange('imapUser', e.target.value)} />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1">Senha</label>
                                    <input type="password" required className="input w-full p-2 border rounded text-sm" value={formData.imapPassword} onChange={e => handleChange('imapPassword', e.target.value)} />
                                </div>
                                <div className="flex items-center gap-2 pt-4">
                                    <input type="checkbox" checked={formData.imapTls} onChange={e => handleChange('imapTls', e.target.checked)} id="imapTls" />
                                    <label htmlFor="imapTls" className="text-sm">Usar TLS</label>
                                </div>
                            </div>
                        </div>

                        {/* SMTP */}
                        <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 bg-slate-50 dark:bg-slate-900/50">
                            <h3 className="font-semibold mb-3 text-slate-800 dark:text-white">Envio (SMTP)</h3>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1">Host</label>
                                    <input type="text" required className="input w-full p-2 border rounded text-sm" value={formData.smtpHost} onChange={e => handleChange('smtpHost', e.target.value)} />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1">Porta</label>
                                    <input type="number" required className="input w-full p-2 border rounded text-sm" value={formData.smtpPort} onChange={e => handleChange('smtpPort', parseInt(e.target.value))} />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1">Usuário</label>
                                    <input type="text" required className="input w-full p-2 border rounded text-sm" value={formData.smtpUser} onChange={e => handleChange('smtpUser', e.target.value)} />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1">Senha</label>
                                    <input type="password" required className="input w-full p-2 border rounded text-sm" value={formData.smtpPassword} onChange={e => handleChange('smtpPassword', e.target.value)} />
                                </div>
                                <div className="flex items-center gap-2 pt-4">
                                    <input type="checkbox" checked={formData.smtpSecure} onChange={e => handleChange('smtpSecure', e.target.checked)} id="smtpSecure" />
                                    <label htmlFor="smtpSecure" className="text-sm">Usar SSL/Secure</label>
                                </div>
                            </div>
                        </div>

                        {/* Assinatura */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Assinatura</label>
                            <textarea className="w-full p-3 border rounded text-sm h-24" value={formData.signature} onChange={e => handleChange('signature', e.target.value)} />
                        </div>
                    </form>
                </div>

                <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2 bg-slate-50 dark:bg-slate-800">
                    <button onClick={onClose} className="px-4 py-2 border rounded text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700">
                        Cancelar
                    </button>
                    <button
                        form="configForm"
                        type="submit"
                        disabled={loading}
                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2"
                    >
                        <Save size={18} />
                        {loading ? 'Salvando...' : 'Salvar Configuração'}
                    </button>
                </div>
            </div>
        </div>
    );
};
