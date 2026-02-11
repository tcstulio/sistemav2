import React, { useState } from 'react';
import { X, Save, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { EmailAccount } from '../../types/email';
import { EmailService } from '../../services/emailService';
import { toast } from 'sonner';
import { logger } from '../../utils/logger';

const log = logger.child('StoreConfigModal');

interface StoreConfigModalProps {
    onClose: () => void;
    onSave: (data: any) => Promise<void>;
    editAccount?: EmailAccount | null;
}

export const StoreConfigModal: React.FC<StoreConfigModalProps> = ({ onClose, onSave, editAccount }) => {
    const isEdit = !!editAccount;

    const [formData, setFormData] = useState(() => {
        if (editAccount) {
            return {
                name: editAccount.name || '',
                email: editAccount.email || '',
                imapHost: editAccount.imapHost || '',
                imapPort: editAccount.imapPort || 993,
                imapUser: editAccount.imapUser || '',
                imapPassword: '',
                imapTls: editAccount.imapTls ?? true,
                smtpHost: editAccount.smtpHost || '',
                smtpPort: editAccount.smtpPort || 465,
                smtpUser: editAccount.smtpUser || '',
                smtpPassword: '',
                smtpSecure: editAccount.smtpSecure ?? true,
                signature: editAccount.signature || ''
            };
        }
        return {
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
        };
    });

    const [loading, setLoading] = useState(false);
    const [testingImap, setTestingImap] = useState(false);
    const [testingSmtp, setTestingSmtp] = useState(false);
    const [imapResult, setImapResult] = useState<{ success: boolean; message: string } | null>(null);
    const [smtpResult, setSmtpResult] = useState<{ success: boolean; message: string } | null>(null);

    const handleTestImap = async () => {
        setTestingImap(true);
        setImapResult(null);
        try {
            const result = await EmailService.testConnection('imap', {
                host: formData.imapHost,
                port: formData.imapPort,
                user: formData.imapUser,
                password: formData.imapPassword,
                tls: formData.imapTls
            }, isEdit ? editAccount!.id : undefined);
            setImapResult(result);
            if (result.success) toast.success('IMAP conectado com sucesso');
            else toast.error(`IMAP falhou: ${result.message}`);
        } catch (error: any) {
            setImapResult({ success: false, message: error.message });
            toast.error('Erro ao testar IMAP');
        } finally {
            setTestingImap(false);
        }
    };

    const handleTestSmtp = async () => {
        setTestingSmtp(true);
        setSmtpResult(null);
        try {
            const result = await EmailService.testConnection('smtp', {
                host: formData.smtpHost,
                port: formData.smtpPort,
                user: formData.smtpUser,
                password: formData.smtpPassword,
                secure: formData.smtpSecure
            }, isEdit ? editAccount!.id : undefined);
            setSmtpResult(result);
            if (result.success) toast.success('SMTP conectado com sucesso');
            else toast.error(`SMTP falhou: ${result.message}`);
        } catch (error: any) {
            setSmtpResult({ success: false, message: error.message });
            toast.error('Erro ao testar SMTP');
        } finally {
            setTestingSmtp(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            if (isEdit) {
                const updates: Record<string, unknown> = {};
                for (const [key, value] of Object.entries(formData)) {
                    if (key === 'imapPassword' || key === 'smtpPassword') {
                        if (value) updates[key] = value;
                    } else {
                        updates[key] = value;
                    }
                }
                await onSave(updates);
            } else {
                await onSave(formData);
            }
            toast.success(isEdit ? 'Conta atualizada' : 'Conta adicionada');
            onClose();
        } catch (error) {
            log.error(error);
            toast.error('Erro ao salvar configuração');
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (field: string, value: any) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const TestResultIcon = ({ result }: { result: { success: boolean; message: string } | null }) => {
        if (!result) return null;
        return result.success
            ? <CheckCircle size={16} className="text-green-500" />
            : <XCircle size={16} className="text-red-500" />;
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 w-full max-w-2xl rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                    <h2 className="text-xl font-bold text-slate-800 dark:text-white">
                        {isEdit ? 'Editar Conta de Email' : 'Adicionar Conta de Email'}
                    </h2>
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
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="font-semibold text-slate-800 dark:text-white">Recebimento (IMAP)</h3>
                                <div className="flex items-center gap-2">
                                    <TestResultIcon result={imapResult} />
                                    <button
                                        type="button"
                                        onClick={handleTestImap}
                                        disabled={testingImap || !formData.imapHost || !formData.imapUser || (!formData.imapPassword && !isEdit)}
                                        className="px-3 py-1 text-xs font-medium rounded border border-blue-300 text-blue-600 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-900/30 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                                    >
                                        {testingImap ? <><Loader2 size={12} className="animate-spin" /> Testando...</> : 'Testar IMAP'}
                                    </button>
                                </div>
                            </div>
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
                                    <input
                                        type="password"
                                        required={!isEdit}
                                        placeholder={isEdit ? 'Deixe vazio para manter' : ''}
                                        className="input w-full p-2 border rounded text-sm"
                                        value={formData.imapPassword}
                                        onChange={e => handleChange('imapPassword', e.target.value)}
                                    />
                                </div>
                                <div className="flex items-center gap-2 pt-4">
                                    <input type="checkbox" checked={formData.imapTls} onChange={e => handleChange('imapTls', e.target.checked)} id="imapTls" />
                                    <label htmlFor="imapTls" className="text-sm">Usar TLS</label>
                                </div>
                            </div>
                        </div>

                        {/* SMTP */}
                        <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 bg-slate-50 dark:bg-slate-900/50">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="font-semibold text-slate-800 dark:text-white">Envio (SMTP)</h3>
                                <div className="flex items-center gap-2">
                                    <TestResultIcon result={smtpResult} />
                                    <button
                                        type="button"
                                        onClick={handleTestSmtp}
                                        disabled={testingSmtp || !formData.smtpHost || !formData.smtpUser || (!formData.smtpPassword && !isEdit)}
                                        className="px-3 py-1 text-xs font-medium rounded border border-blue-300 text-blue-600 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-900/30 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                                    >
                                        {testingSmtp ? <><Loader2 size={12} className="animate-spin" /> Testando...</> : 'Testar SMTP'}
                                    </button>
                                </div>
                            </div>
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
                                    <input
                                        type="password"
                                        required={!isEdit}
                                        placeholder={isEdit ? 'Deixe vazio para manter' : ''}
                                        className="input w-full p-2 border rounded text-sm"
                                        value={formData.smtpPassword}
                                        onChange={e => handleChange('smtpPassword', e.target.value)}
                                    />
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
                        {loading ? 'Salvando...' : isEdit ? 'Salvar Alterações' : 'Salvar Configuração'}
                    </button>
                </div>
            </div>
        </div>
    );
};
