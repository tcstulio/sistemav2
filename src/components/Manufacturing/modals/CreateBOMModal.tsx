import React, { useState, useEffect } from 'react';
import { DolibarrConfig, Product } from '../../../types';
import { Loader2, CheckCircle2, X } from 'lucide-react';
import { DolibarrService } from '../../../services/dolibarrService';
import { toast } from 'sonner';
import { notifyError } from '../../../utils/notifyError';

interface CreateBOMModalProps {
    isOpen: boolean;
    onClose: () => void;
    config: DolibarrConfig;
    products: Product[];
    onSuccess: () => void;
    initialForm?: Partial<{ label: string; product_id: string; qty: string; duration: string }>; // prefill (#57)
    editId?: string; // quando presente, o modal salva (PUT /boms/:id) em vez de criar — deeplink HITL (#78)
}

export const CreateBOMModal: React.FC<CreateBOMModalProps> = ({ isOpen, onClose, config, products, onSuccess, initialForm, editId }) => {
    const isEdit = !!editId;
    const [bomForm, setBomForm] = useState({
        label: '',
        product_id: '',
        qty: 1,
        duration: 3600
    });
    const [isSubmittingBom, setIsSubmittingBom] = useState(false);

    // ao abrir, sincroniza com o prefill (vazio se não houver) — deeplink HITL.
    useEffect(() => {
        if (isOpen) {
            setBomForm({
                label: initialForm?.label || '',
                product_id: initialForm?.product_id || '',
                qty: initialForm?.qty ? (parseInt(initialForm.qty) || 1) : 1,
                duration: initialForm?.duration ? (parseInt(initialForm.duration) || 3600) : 3600,
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    const handleCreateBom = async (e: React.FormEvent) => {
        e.preventDefault();
        // na criação, o produto final é obrigatório; na edição ele é imutável (não enviado).
        if (!isEdit && !bomForm.product_id) return;
        setIsSubmittingBom(true);
        try {
            if (isEdit) {
                // produto final (product_id) é imutável — só altera label/qty/duration.
                await DolibarrService.updateObject(config, 'boms', editId!, {
                    label: bomForm.label,
                    qty: bomForm.qty,
                    duration: bomForm.duration,
                });
                toast.success("BOM Atualizada com Sucesso");
            } else {
                await DolibarrService.createBOM(config, bomForm);
                toast.success("BOM Criada com Sucesso");
            }
            onSuccess();
            onClose();
            setBomForm({ label: '', product_id: '', qty: 1, duration: 3600 });
        } catch (e) { notifyError(isEdit ? 'Atualizar BOM' : 'Criar BOM', e); } finally { setIsSubmittingBom(false); }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg p-6">
                <div className="flex justify-between mb-4">
                    <h3 className="font-bold text-lg dark:text-white">{isEdit ? 'Editar Lista de Materiais (BOM)' : 'Nova Lista de Materiais (BOM)'}</h3>
                    <button onClick={onClose}><X size={20} /></button>
                </div>
                <form onSubmit={handleCreateBom} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium dark:text-slate-300">Rótulo</label>
                        <input className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={bomForm.label} onChange={e => setBomForm({ ...bomForm, label: e.target.value })} placeholder="BOM Padrão" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium dark:text-slate-300">Produto</label>
                        <select className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white disabled:opacity-60" value={bomForm.product_id} onChange={e => setBomForm({ ...bomForm, product_id: e.target.value })} required={!isEdit} disabled={isEdit}>
                            <option value="">Selecionar...</option>
                            {products.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                        </select>
                        {isEdit && <p className="text-xs text-slate-400 mt-1">O produto final não pode ser alterado.</p>}
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium dark:text-slate-300">Qtd Produzida</label>
                            <input type="number" className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={bomForm.qty} onChange={e => setBomForm({ ...bomForm, qty: parseInt(e.target.value) })} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium dark:text-slate-300">Duração (seg)</label>
                            <input type="number" className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={bomForm.duration} onChange={e => setBomForm({ ...bomForm, duration: parseInt(e.target.value) })} />
                        </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-slate-500">Cancelar</button>
                        <button type="submit" disabled={isSubmittingBom} className="px-4 py-2 bg-indigo-600 text-white rounded flex items-center gap-2">
                            {isSubmittingBom ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />} {isEdit ? 'Salvar' : 'Criar'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
