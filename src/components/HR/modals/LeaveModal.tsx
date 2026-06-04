import React, { useState, useEffect } from 'react';
import { DolibarrConfig, DolibarrUser } from '../../../types';
import { DolibarrService } from '../../../services/dolibarrService';
import { Plane, X, Loader2, CheckCircle2 } from 'lucide-react';
import { logger } from '../../../utils/logger';

const log = logger.child('LeaveModal');

interface LeaveModalProps {
    isOpen: boolean;
    onClose: () => void;
    config: DolibarrConfig;
    users: DolibarrUser[];
    onRefresh?: () => void;
    initialForm?: Partial<{ fk_user: string; date_debut: string; date_fin: string; type: string; description: string }>; // prefill (#57)
    editId?: string; // se definido, modo edição da licença (#57/#78)
}

export const LeaveModal: React.FC<LeaveModalProps> = ({ isOpen, onClose, config, users, onRefresh, initialForm, editId }) => {
    const [leaveForm, setLeaveForm] = useState({ fk_user: '', date_debut: '', date_fin: '', type: 'Paid Vacation', description: '' });
    const [isSubmittingLeave, setIsSubmittingLeave] = useState(false);
    const isEdit = !!editId;

    // ao abrir, sincroniza com o prefill (vazio se não houver) — deeplink HITL.
    useEffect(() => {
        if (isOpen) {
            setLeaveForm({
                fk_user: initialForm?.fk_user || '',
                date_debut: initialForm?.date_debut || '',
                date_fin: initialForm?.date_fin || '',
                type: initialForm?.type || 'Paid Vacation',
                description: initialForm?.description || '',
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!leaveForm.date_debut || !leaveForm.date_fin) return;
        if (!isEdit && !leaveForm.fk_user) return;
        setIsSubmittingLeave(true);
        try {
            // fk_user não muda na edição (funcionário da licença é imutável).
            const data: Record<string, unknown> = {
                type: leaveForm.type,
                description: leaveForm.description,
                date_debut: new Date(leaveForm.date_debut).getTime() / 1000,
                date_fin: new Date(leaveForm.date_fin).getTime() / 1000
            };
            if (isEdit) {
                await DolibarrService.updateLeaveRequest(config, editId!, data);
            } else {
                await DolibarrService.createLeaveRequest(config, { ...data, fk_user: leaveForm.fk_user });
            }
            onClose();
            setLeaveForm({ fk_user: '', date_debut: '', date_fin: '', type: 'Paid Vacation', description: '' });
            alert(isEdit ? "Licença Atualizada com Sucesso" : "Solicitação de Licença Criada com Sucesso");
            if (onRefresh) onRefresh();
        } catch (e) { log.error(e); } finally { setIsSubmittingLeave(false); }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-xl p-6 w-full max-w-md shadow-lg border border-slate-200 dark:border-slate-800 animate-in zoom-in-95">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-lg dark:text-white flex items-center gap-2"><Plane size={18} className="text-blue-500" /> {isEdit ? 'Editar Licença' : 'Nova Solicitação de Licença'}</h3>
                    <button onClick={onClose}><X size={20} className="text-slate-400" /></button>
                </div>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Funcionário</label>
                        <select disabled={isEdit} className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white disabled:opacity-60" value={leaveForm.fk_user} onChange={e => setLeaveForm({ ...leaveForm, fk_user: e.target.value })}>
                            <option value="">Selecione Usuário...</option>
                            {users.map(u => <option key={u.id} value={u.id}>{u.firstname} {u.lastname} ({u.login})</option>)}
                        </select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Início</label>
                            <input type="date" className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={leaveForm.date_debut} onChange={e => setLeaveForm({ ...leaveForm, date_debut: e.target.value })} />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Fim</label>
                            <input type="date" className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={leaveForm.date_fin} onChange={e => setLeaveForm({ ...leaveForm, date_fin: e.target.value })} />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tipo</label>
                        <select className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={leaveForm.type} onChange={e => setLeaveForm({ ...leaveForm, type: e.target.value })}>
                            <option value="Paid Vacation">Férias Pagas</option>
                            <option value="Sick Leave">Licença Médica</option>
                            <option value="Unpaid">Licença Não Remunerada</option>
                            <option value="Other">Outro</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Descrição</label>
                        <textarea className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white resize-none" value={leaveForm.description} onChange={e => setLeaveForm({ ...leaveForm, description: e.target.value })} placeholder="Motivo..." />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-slate-500 hover:text-slate-700">Cancelar</button>
                        <button type="submit" disabled={isSubmittingLeave} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium flex items-center gap-2">
                            {isSubmittingLeave ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} {isEdit ? 'Salvar' : 'Enviar'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
