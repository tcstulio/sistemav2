import React, { useState, useEffect } from 'react';
import { DolibarrConfig, Product, Warehouse, AppView } from '../../../types';
import { Loader2, ArrowDownCircle, X } from 'lucide-react';
import { DolibarrService } from '../../../services/dolibarrService';
import { logger } from '../../../utils/logger';

const log = logger.child('ConsumeModal');

interface ConsumeModalProps {
    isOpen: boolean;
    onClose: () => void;
    config: DolibarrConfig;
    products: Product[];
    warehouses: Warehouse[];
    selectedMORef: string;
    onNavigate?: (view: AppView, id: string) => void;
}

export const ConsumeModal: React.FC<ConsumeModalProps> = ({
    isOpen,
    onClose,
    config,
    products,
    warehouses,
    selectedMORef,
    onNavigate
}) => {
    const [executionForm, setExecutionForm] = useState({
        warehouseId: '',
        productId: '',
        qty: 1
    });
    const [isExecuting, setIsExecuting] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setExecutionForm({
                warehouseId: warehouses.length > 0 ? warehouses[0].id : '',
                productId: products.length > 0 ? products[0].id : '',
                qty: 1
            });
        }
    }, [isOpen, warehouses, products]);


    const handleExecuteMovement = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!executionForm.warehouseId || !executionForm.productId) {
            alert("Por favor, verifique todos os campos.");
            return;
        }

        setIsExecuting(true);
        try {
            // Negative quantity for consumption
            const finalQty = -Math.abs(executionForm.qty);
            const label = `Consumido para MO ${selectedMORef}`;

            await DolibarrService.createStockCorrection(config, {
                product_id: executionForm.productId,
                warehouse_id: executionForm.warehouseId,
                qty: finalQty,
                label: label
            });

            alert(`Movimentação de estoque criada com sucesso`);
            onClose();
            if (onNavigate) {
                onNavigate('inventory', '');
            }

        } catch (err: any) {
            log.error(err);
            alert(`Falha: ${err.message}`);
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
                        <ArrowDownCircle className="text-red-500" size={20} /> Consumir Material
                    </h3>
                    <button onClick={onClose}><X size={20} /></button>
                </div>
                <form onSubmit={handleExecuteMovement} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium dark:text-slate-300">Produto a Consumir</label>
                        <select className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={executionForm.productId} onChange={e => setExecutionForm({ ...executionForm, productId: e.target.value })} required>
                            <option value="">Selecionar Matéria Prima...</option>
                            {products.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium dark:text-slate-300">Do Armazém</label>
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
                        <button type="submit" disabled={isExecuting} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded flex items-center gap-2">
                            {isExecuting ? <Loader2 className="animate-spin" size={16} /> : <ArrowDownCircle size={16} />} Confirmar
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
