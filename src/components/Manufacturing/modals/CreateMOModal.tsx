import React, { useState, useEffect } from 'react';
import { DolibarrConfig, Project, Product } from '../../../types';
import { Loader2, CheckCircle2, X } from 'lucide-react';
import { DolibarrService } from '../../../services/dolibarrService';
import { toast } from 'sonner';
import { notifyError } from '../../../utils/notifyError';

interface CreateMOModalProps {
    isOpen: boolean;
    onClose: () => void;
    config: DolibarrConfig;
    products: Product[];
    projects: Project[];
    onSuccess: () => void;
    initialForm?: Partial<{ label: string; product_to_produce_id: string; qty: string; project_id: string; date_start: string }>; // prefill (#57)
    editId?: string; // quando presente, o modal salva (PUT /mrp/mo/:id) em vez de criar — deeplink HITL (#78)
}

export const CreateMOModal: React.FC<CreateMOModalProps> = ({ isOpen, onClose, config, products, projects, onSuccess, initialForm, editId }) => {
    const isEdit = !!editId;
    const [moForm, setMoForm] = useState({
        label: '',
        product_to_produce_id: '',
        qty: 1,
        project_id: '',
        date_start: new Date().toISOString().split('T')[0]
    });
    const [isSubmittingMo, setIsSubmittingMo] = useState(false);

    // ao abrir, sincroniza com o prefill (vazio se não houver) — deeplink HITL.
    useEffect(() => {
        if (isOpen) {
            setMoForm({
                label: initialForm?.label || '',
                product_to_produce_id: initialForm?.product_to_produce_id || '',
                qty: initialForm?.qty ? (parseInt(initialForm.qty) || 1) : 1,
                project_id: initialForm?.project_id || '',
                date_start: initialForm?.date_start || new Date().toISOString().split('T')[0],
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    const handleCreateMo = async (e: React.FormEvent) => {
        e.preventDefault();
        // na criação, o produto a produzir é obrigatório; na edição ele é imutável (não enviado).
        if (!isEdit && !moForm.product_to_produce_id) return;
        setIsSubmittingMo(true);
        try {
            if (isEdit) {
                // produto a produzir é imutável — só altera rótulo/quantidade (campos padrão seguros).
                await DolibarrService.updateObject(config, 'mrp/mo', editId!, {
                    label: moForm.label,
                    qty: moForm.qty,
                });
                toast.success("Ordem de Produção Atualizada com Sucesso");
            } else {
                await DolibarrService.createManufacturingOrder(config, moForm);
                toast.success("Ordem de Produção Criada com Sucesso");
            }
            onSuccess();
            onClose();
            setMoForm({ label: '', product_to_produce_id: '', qty: 1, project_id: '', date_start: new Date().toISOString().split('T')[0] });
        } catch (e) { notifyError(isEdit ? 'Atualizar ordem de produção' : 'Criar ordem de produção', e); } finally { setIsSubmittingMo(false); }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg p-6">
                <div className="flex justify-between mb-4">
                    <h3 className="font-bold text-lg dark:text-white">{isEdit ? 'Editar Ordem de Produção' : 'Nova Ordem de Produção'}</h3>
                    <button onClick={onClose}><X size={20} /></button>
                </div>
                <form onSubmit={handleCreateMo} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium dark:text-slate-300">Rótulo</label>
                        <input className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={moForm.label} onChange={e => setMoForm({ ...moForm, label: e.target.value })} placeholder="Produção Lote #1" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium dark:text-slate-300">Produto a Produzir</label>
                        <select className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white disabled:opacity-60" value={moForm.product_to_produce_id} onChange={e => setMoForm({ ...moForm, product_to_produce_id: e.target.value })} required={!isEdit} disabled={isEdit}>
                            <option value="">Selecionar...</option>
                            {products.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                        </select>
                        {isEdit && <p className="text-xs text-slate-400 mt-1">O produto a produzir não pode ser alterado.</p>}
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium dark:text-slate-300">Quantidade</label>
                            <input type="number" className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={moForm.qty} onChange={e => setMoForm({ ...moForm, qty: parseInt(e.target.value) })} />
                        </div>
                        {!isEdit && (
                            <div>
                                <label className="block text-sm font-medium dark:text-slate-300">Data Início</label>
                                <input type="date" className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={moForm.date_start} onChange={e => setMoForm({ ...moForm, date_start: e.target.value })} />
                            </div>
                        )}
                    </div>
                    {!isEdit && (
                        <div>
                            <label className="block text-sm font-medium dark:text-slate-300">Projeto</label>
                            <select className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={moForm.project_id} onChange={e => setMoForm({ ...moForm, project_id: e.target.value })}>
                                <option value="">Nenhum</option>
                                {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                            </select>
                        </div>
                    )}
                    <div className="flex justify-end gap-2 pt-2">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-slate-500">Cancelar</button>
                        <button type="submit" disabled={isSubmittingMo} className="px-4 py-2 bg-indigo-600 text-white rounded flex items-center gap-2">
                            {isSubmittingMo ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />} {isEdit ? 'Salvar' : 'Criar'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
