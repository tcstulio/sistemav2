import React, { useState } from 'react';
import { DolibarrConfig, Product } from '../../../types';
import { Loader2, CheckCircle2, X } from 'lucide-react';
import { DolibarrService } from '../../../services/dolibarrService';

interface CreateBOMModalProps {
    isOpen: boolean;
    onClose: () => void;
    config: DolibarrConfig;
    products: Product[];
    onSuccess: () => void;
}

export const CreateBOMModal: React.FC<CreateBOMModalProps> = ({ isOpen, onClose, config, products, onSuccess }) => {
    const [bomForm, setBomForm] = useState({
        label: '',
        product_id: '',
        qty: 1,
        duration: 3600
    });
    const [isSubmittingBom, setIsSubmittingBom] = useState(false);

    const handleCreateBom = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!bomForm.product_id) return;
        setIsSubmittingBom(true);
        try {
            await DolibarrService.createBOM(config, bomForm);
            alert("BOM Criada com Sucesso");
            onSuccess();
            onClose();
            setBomForm({ label: '', product_id: '', qty: 1, duration: 3600 });
        } catch (e) { console.error(e); } finally { setIsSubmittingBom(false); }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg p-6">
                <div className="flex justify-between mb-4">
                    <h3 className="font-bold text-lg dark:text-white">Nova Lista de Materiais (BOM)</h3>
                    <button onClick={onClose}><X size={20} /></button>
                </div>
                <form onSubmit={handleCreateBom} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium dark:text-slate-300">Rótulo</label>
                        <input className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={bomForm.label} onChange={e => setBomForm({ ...bomForm, label: e.target.value })} placeholder="BOM Padrão" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium dark:text-slate-300">Produto</label>
                        <select className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={bomForm.product_id} onChange={e => setBomForm({ ...bomForm, product_id: e.target.value })} required>
                            <option value="">Selecionar...</option>
                            {products.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                        </select>
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
                            {isSubmittingBom ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />} Criar
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
