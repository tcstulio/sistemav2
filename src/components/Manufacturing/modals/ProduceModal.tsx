import React, { useState, useEffect } from 'react';
import { DolibarrConfig, Warehouse, AppView, ManufacturingOrder } from '../../../types';
import { Loader2, ArrowUpCircle, X } from 'lucide-react';
import { DolibarrService } from '../../../services/dolibarrService';
import { logger } from '../../../utils/logger';
import { notifyError } from '../../../utils/notifyError';
import { toast } from 'sonner';

const log = logger.child('ProduceModal');

interface ProduceModalProps {
    isOpen: boolean;
    onClose: () => void;
    config: DolibarrConfig;
    warehouses: Warehouse[];
    selectedMO: ManufacturingOrder | null;
    onNavigate?: (view: AppView, id: string) => void;
}

export const ProduceModal: React.FC<ProduceModalProps> = ({
    isOpen,
    onClose,
    config,
    warehouses,
    selectedMO,
    onNavigate
}) => {
    const [executionForm, setExecutionForm] = useState({
        warehouseId: '',
        productId: '',
        qty: 1
    });
    const [isExecuting, setIsExecuting] = useState(false);

    useEffect(() => {
        if (isOpen && selectedMO) {
            setExecutionForm({
                warehouseId: warehouses.length > 0 ? warehouses[0].id : '',
                productId: selectedMO.product_to_produce_id || '',
                qty: selectedMO.qty || 1
            });
        }
    }, [isOpen, warehouses, selectedMO]);


    const handleExecuteMovement = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedMO || !executionForm.warehouseId || !executionForm.productId) {
            toast.warning("Por favor, verifique todos os campos.");
            return;
        }

        setIsExecuting(true);
        try {
            // Positive quantity for production
            const finalQty = Math.abs(executionForm.qty);
            const label = `Produzido por MO ${selectedMO.ref}`;

            await DolibarrService.createStockCorrection(config, {
                product_id: executionForm.productId,
                warehouse_id: executionForm.warehouseId,
                qty: finalQty,
                label: label
            });

            toast.success("Movimentação de estoque criada com sucesso");
            onClose();
            if (onNavigate) {
                onNavigate('inventory', '');
            }

        } catch (err: any) {
            notifyError('Movimentação de estoque', err);
        } finally {
            setIsExecuting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md p-6">
                <div className="flex justify-between mb-4">
                    <h3 className="font-bold text-lg dark:text-white flex items-center gap-2">
                        <ArrowUpCircle className="text-emerald-500" size={20} /> Produzir Saída
                    </h3>
                    <button onClick={onClose}><X size={20} /></button>
                </div>
                <form onSubmit={handleExecuteMovement} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium dark:text-slate-300">Para Armazém</label>
                        <select className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={executionForm.warehouseId} onChange={e => setExecutionForm({ ...executionForm, warehouseId: e.target.value })} required>
                            <option value="">Selecionar Armazém...</option>
                            {warehouses.map(w => <option key={w.id} value={w.id}>{w.label}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium dark:text-slate-300">Quantidade</label>
                        <input type="number" className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={executionForm.qty} onChange={e => setExecutionForm({ ...executionForm, qty: parseInt(e.target.value) })} required min="1" />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-slate-500">Cancelar</button>
                        <button type="submit" disabled={isExecuting} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded flex items-center gap-2">
                            {isExecuting ? <Loader2 className="animate-spin" size={16} /> : <ArrowUpCircle size={16} />} Confirmar
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
