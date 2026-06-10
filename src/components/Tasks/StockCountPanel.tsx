import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Boxes, Loader2, ClipboardList, Check } from 'lucide-react';
import { DolibarrConfig } from '../../types';
import { DolibarrService } from '../../services/dolibarrService';
import { logger } from '../../utils/logger';
import { notifyError } from '../../utils/notifyError';
import { toast } from 'sonner';
import { allCountsValid, buildMovements, CountRow } from './stockCount';

const log = logger.child('StockCountPanel');
const TEMPLATE = 'contagem_de_estoque';

interface Props {
    config: DolibarrConfig;
    taskId: string;
    products: any[];     // produtos disponíveis (id, label/ref, stock)
    warehouses: any[];   // armazéns (id, label/ref)
    onChanged?: () => void;
}

/**
 * Template estruturado "contagem de estoque" (verificação N2). Resposta LIMITADA: número por item.
 * Ao registrar: gera os movimentos de ajuste no Dolibarr e marca a tarefa 100% (o motor reporta).
 * Self-gating: só renderiza a contagem quando a delegação tem template = contagem_de_estoque.
 */
export const StockCountPanel: React.FC<Props> = ({ config, taskId, products, warehouses, onChanged }) => {
    const [del, setDel] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [warehouseSel, setWarehouseSel] = useState('');
    const [counts, setCounts] = useState<Record<string, string>>({});

    const reload = useCallback(async () => {
        setLoading(true);
        try { setDel(await DolibarrService.getDelegation(config, taskId)); }
        catch (e) { log.warn('Falha ao carregar delegação', e); setDel(null); }
        finally { setLoading(false); }
    }, [config, taskId]);

    useEffect(() => { reload(); }, [reload]);

    const isStock = del?.template === TEMPLATE;
    const warehouseId = del?.templateConfig?.warehouseId;

    const items = useMemo(
        () => (products || []).slice(0, 100).map((p) => ({
            productId: String(p.id), label: p.label || p.ref || `#${p.id}`, current: Number(p.stock) || 0,
        })),
        [products],
    );

    const start = async () => {
        if (!warehouseSel) return;
        setSaving(true);
        try {
            await DolibarrService.setDelegationTemplate(config, taskId, TEMPLATE, { warehouseId: warehouseSel });
            await reload();
        } catch (e) { notifyError('Iniciar contagem', e); }
        finally { setSaving(false); }
    };

    const register = async () => {
        const rows: CountRow[] = items.map((it) => ({
            ...it,
            counted: counts[it.productId] === undefined || counts[it.productId] === '' ? null : Number(counts[it.productId]),
        }));
        if (!allCountsValid(rows)) { toast.warning('Preencha todas as contagens (quantidade ≥ 0) antes de enviar.'); return; }
        setSaving(true);
        try {
            for (const mv of buildMovements(rows)) {
                await DolibarrService.createStockMovement(config, {
                    product_id: mv.productId,
                    warehouse_id: warehouseId,
                    qty: mv.delta,
                    type: mv.delta >= 0 ? 0 : 1,
                    movementlabel: 'Contagem de estoque',
                });
            }
            await DolibarrService.updateTask(config, taskId, { progress: 100 });
            onChanged?.();
        } catch (e) { notifyError('Registrar a contagem', e); }
        finally { setSaving(false); }
    };

    if (loading) return null;

    return (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                <Boxes size={18} className="text-indigo-500" /> Contagem de estoque
                {saving && <Loader2 size={16} className="animate-spin text-slate-400" />}
            </h2>

            {!isStock ? (
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-slate-500">Transformar esta delegação numa contagem de estoque:</span>
                    <select aria-label="Armazém" value={warehouseSel} onChange={(e) => setWarehouseSel(e.target.value)}
                        className="text-sm p-1.5 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white">
                        <option value="">Armazém…</option>
                        {(warehouses || []).map((w) => <option key={w.id} value={w.id}>{w.label || w.ref || `#${w.id}`}</option>)}
                    </select>
                    <button type="button" onClick={start} disabled={saving || !warehouseSel}
                        className="flex items-center gap-1 text-sm px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50">
                        <ClipboardList size={14} /> Iniciar contagem
                    </button>
                </div>
            ) : (
                <div className="space-y-3">
                    <p className="text-xs text-slate-500">Informe a quantidade contada de cada item (número ≥ 0). Ao registrar, o estoque é ajustado e a tarefa é concluída.</p>
                    <ul className="space-y-1.5 max-h-80 overflow-auto">
                        {items.map((it) => (
                            <li key={it.productId} className="flex items-center gap-3 p-2 bg-slate-50 dark:bg-slate-800 rounded-lg">
                                <span className="flex-1 text-sm text-slate-900 dark:text-white truncate">{it.label}</span>
                                <span className="text-xs text-slate-400">atual {it.current}</span>
                                <input type="number" min={0} aria-label={`Contagem ${it.label}`}
                                    value={counts[it.productId] ?? ''} onChange={(e) => setCounts((c) => ({ ...c, [it.productId]: e.target.value }))}
                                    className="w-20 text-sm p-1.5 border rounded-lg dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
                            </li>
                        ))}
                    </ul>
                    <button type="button" onClick={register} disabled={saving}
                        className="flex items-center gap-1 text-sm px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50">
                        <Check size={14} /> Registrar contagem
                    </button>
                </div>
            )}
        </div>
    );
};

export default StockCountPanel;
