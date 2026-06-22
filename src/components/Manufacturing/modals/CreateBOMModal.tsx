import React, { useState, useEffect } from 'react';
import { DolibarrConfig, Product, BOMLine } from '../../../types';
import { Loader2, CheckCircle2, X, Plus, Trash2 } from 'lucide-react';
import { DolibarrService } from '../../../services/dolibarrService';
import { toast } from 'sonner';
import { notifyError } from '../../../utils/notifyError';

interface DraftBOMLine {
    id?: string; // existing line id (for edit/delete)
    fk_product: string;
    qty: number;
    efficiency: number;
}

interface CreateBOMModalProps {
    isOpen: boolean;
    onClose: () => void;
    config: DolibarrConfig;
    products: Product[];
    onSuccess: () => void;
    initialForm?: Partial<{ label: string; product_id: string; qty: string; duration: string }>; // prefill (#57)
    editId?: string; // quando presente, o modal salva (PUT /boms/:id) em vez de criar — deeplink HITL (#78)
    initialLines?: BOMLine[]; // componentes existentes quando editando
}

export const CreateBOMModal: React.FC<CreateBOMModalProps> = ({ isOpen, onClose, config, products, onSuccess, initialForm, editId, initialLines }) => {
    const isEdit = !!editId;
    const [bomForm, setBomForm] = useState({
        label: '',
        product_id: '',
        qty: 1,
        duration: 3600
    });
    const [lines, setLines] = useState<DraftBOMLine[]>([]);
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
            // seed existing lines when editing
            if (isEdit && initialLines && initialLines.length > 0) {
                setLines(initialLines.map(l => ({
                    id: l.id,
                    fk_product: l.fk_product,
                    qty: l.qty,
                    efficiency: l.efficiency ?? 1,
                })));
            } else {
                setLines([]);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    const addLine = () => {
        setLines(prev => [...prev, { fk_product: '', qty: 1, efficiency: 1 }]);
    };

    const removeLine = (idx: number) => {
        setLines(prev => prev.filter((_, i) => i !== idx));
    };

    const updateLine = (idx: number, patch: Partial<DraftBOMLine>) => {
        setLines(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
    };

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

                // Sync component lines: delete removed existing lines, add new ones, update changed ones
                const originalIds = (initialLines || []).map(l => l.id);
                const keptIds = lines.filter(l => l.id).map(l => l.id as string);
                const toDelete = originalIds.filter(id => !keptIds.includes(id));

                // delete removed lines
                await Promise.all(toDelete.map(lineId =>
                    DolibarrService.deleteBOMLine(config, editId!, lineId).catch(() => {})
                ));

                // update existing lines
                await Promise.all(
                    lines
                        .filter(l => l.id)
                        .map(l => DolibarrService.updateBOMLine(config, editId!, l.id!, {
                            fk_product: l.fk_product,
                            qty: l.qty,
                            efficiency: l.efficiency,
                        }).catch(() => {}))
                );

                // add new lines (no id)
                await Promise.all(
                    lines
                        .filter(l => !l.id && l.fk_product)
                        .map(l => DolibarrService.addBOMLine(config, editId!, {
                            fk_product: l.fk_product,
                            qty: l.qty,
                            efficiency: l.efficiency,
                        }).catch(() => {}))
                );

                toast.success("BOM Atualizada com Sucesso");
            } else {
                const newBomId = await DolibarrService.createBOM(config, {
                    label: bomForm.label,
                    fk_product: bomForm.product_id,
                    qty: bomForm.qty,
                    duration: bomForm.duration,
                });
                // add component lines to new BOM if provided
                const bomId = typeof newBomId === 'string' ? newBomId : String(newBomId);
                if (bomId && lines.length > 0) {
                    await Promise.all(
                        lines
                            .filter(l => l.fk_product)
                            .map(l => DolibarrService.addBOMLine(config, bomId, {
                                fk_product: l.fk_product,
                                qty: l.qty,
                                efficiency: l.efficiency,
                            }).catch(() => {}))
                    );
                }
                toast.success("BOM Criada com Sucesso");
            }
            onSuccess();
            onClose();
            setBomForm({ label: '', product_id: '', qty: 1, duration: 3600 });
            setLines([]);
        } catch (e) { notifyError(isEdit ? 'Atualizar BOM' : 'Criar BOM', e); } finally { setIsSubmittingBom(false); }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
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

                    {/* BOM Lines / Components */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="block text-sm font-medium dark:text-slate-300">Componentes</label>
                            <button
                                type="button"
                                onClick={addLine}
                                className="flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                                data-testid="bom-add-line-btn"
                            >
                                <Plus size={14} /> Adicionar componente
                            </button>
                        </div>
                        {lines.length === 0 ? (
                            <p className="text-xs text-slate-400 italic">Nenhum componente adicionado ainda.</p>
                        ) : (
                            <div className="space-y-2">
                                {lines.map((line, idx) => (
                                    <div key={idx} className="flex items-center gap-2 p-2 border rounded dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50" data-testid={`bom-line-${idx}`}>
                                        <select
                                            className="flex-1 p-1.5 border rounded text-sm dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                            value={line.fk_product}
                                            onChange={e => updateLine(idx, { fk_product: e.target.value })}
                                            required
                                        >
                                            <option value="">Produto...</option>
                                            {products.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                                        </select>
                                        <div className="flex flex-col items-center">
                                            <label className="text-xs text-slate-400">Qtd</label>
                                            <input
                                                type="number"
                                                min={0.001}
                                                step="any"
                                                className="w-20 p-1.5 border rounded text-sm dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                                value={line.qty}
                                                onChange={e => updateLine(idx, { qty: parseFloat(e.target.value) || 1 })}
                                            />
                                        </div>
                                        <div className="flex flex-col items-center">
                                            <label className="text-xs text-slate-400">Efic. (%)</label>
                                            <input
                                                type="number"
                                                min={1}
                                                max={100}
                                                className="w-20 p-1.5 border rounded text-sm dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                                value={Math.round((line.efficiency ?? 1) * 100)}
                                                onChange={e => updateLine(idx, { efficiency: (parseInt(e.target.value) || 100) / 100 })}
                                            />
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => removeLine(idx)}
                                            className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                                            data-testid={`bom-remove-line-${idx}`}
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
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
