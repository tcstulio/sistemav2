import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { usePrefill, PrefillResult } from '../hooks/usePrefill';
import { useDolibarr } from '../context/DolibarrContext';
import { getBatchEntity } from '../services/batchCreate';
import { Loader2, CheckCircle2, XCircle, Layers, ArrowLeft } from 'lucide-react';
import { logger } from '../utils/logger';

const log = logger.child('BatchCreateView');

type ItemStatus = 'pending' | 'creating' | 'ok' | 'error';

// Tela de revisão de criação EM LOTE (Opção B, #117). Lê o deeplink batch_create
// ({entity, items[]}), mostra os N itens (campos + linhas) e, ao confirmar, cria cada um
// com status ✓/✗ individual (falhas isoladas, com opção de re-tentar só os que falharam).
const BatchCreateView: React.FC = () => {
    const { config } = useDolibarr();
    const navigate = useNavigate();
    const prefill = usePrefill();
    const appliedRef = useRef<PrefillResult | null>(null);

    const [entity, setEntity] = useState<string>('');
    const [items, setItems] = useState<any[]>([]);
    const [statuses, setStatuses] = useState<ItemStatus[]>([]);
    const [errors, setErrors] = useState<(string | undefined)[]>([]);
    const [running, setRunning] = useState(false);
    const [done, setDone] = useState(false);

    useEffect(() => {
        if (!prefill || appliedRef.current === prefill) return;
        if (prefill.kind === 'batch_create') {
            appliedRef.current = prefill;
            const its = Array.isArray(prefill.data.items) ? prefill.data.items : [];
            setEntity(String(prefill.data.entity || ''));
            setItems(its);
            setStatuses(its.map(() => 'pending' as ItemStatus));
            setErrors(its.map(() => undefined));
            toast.info(`Revise os ${its.length} itens e confirme a criação em lote.`);
        }
    }, [prefill]);

    const def = getBatchEntity(entity);

    const handleConfirm = async () => {
        if (!config || !def) return;
        setRunning(true);
        const st = [...statuses];
        const er = [...errors];
        for (let i = 0; i < items.length; i++) {
            if (st[i] === 'ok') continue; // re-tentativa: não recria os que já deram certo
            st[i] = 'creating'; setStatuses([...st]);
            try {
                await def.create(config, items[i]);
                st[i] = 'ok'; er[i] = undefined;
            } catch (e: any) {
                st[i] = 'error'; er[i] = e?.response?.data?.error || e?.message || 'Erro ao criar';
                log.error(`Falha no item ${i + 1}`, e);
            }
            setStatuses([...st]); setErrors([...er]);
        }
        setRunning(false); setDone(true);
        const ok = st.filter((s) => s === 'ok').length;
        const fail = st.filter((s) => s === 'error').length;
        if (fail === 0) toast.success(`${ok} ${def.label}(s) criados com sucesso.`);
        else toast.warning(`${ok} criados, ${fail} com erro.`);
    };

    if (!config) return <div className="p-8 text-center text-slate-400">Carregando configuração...</div>;
    if (!entity || items.length === 0) {
        return <div className="p-8 text-center text-slate-400">Nenhum lote para revisar. Abra pelo link gerado pelo assistente.</div>;
    }
    if (!def) {
        return <div className="p-8 text-center text-slate-400">Criação em lote ainda não suportada para "{entity}".</div>;
    }

    const okCount = statuses.filter((s) => s === 'ok').length;
    const hasFail = statuses.some((s) => s === 'error');

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 overflow-y-auto">
            <div className="max-w-3xl mx-auto w-full p-4 md:p-6">
                <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 mb-3">
                    <ArrowLeft size={16} /> Voltar
                </button>
                <div className="flex items-center gap-2 mb-1">
                    <Layers className="text-indigo-500" />
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Criação em lote — {def.label}</h2>
                </div>
                <p className="text-sm text-slate-500 mb-4">Revise os {items.length} itens abaixo. Ao confirmar, cada um será criado no sistema (com a sua sessão).</p>

                <div className="space-y-2">
                    {items.map((it, i) => (
                        <div key={i} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3 flex justify-between items-start gap-3">
                            <div className="min-w-0">
                                <div className="text-sm font-medium text-slate-800 dark:text-white">#{i + 1}</div>
                                <div className="text-xs text-slate-500 break-words">
                                    {Object.entries(it).filter(([k]) => k !== 'lines').map(([k, v]) => `${k}: ${v}`).join(' · ') || '(sem campos escalares)'}
                                </div>
                                {Array.isArray(it.lines) && it.lines.length > 0 && (
                                    <ul className="mt-1 text-xs text-slate-500 list-disc list-inside">
                                        {it.lines.map((l: any, j: number) => (
                                            <li key={j}>{l.desc} — qtd {l.qty} × {l.subprice}{l.remise_percent ? ` (-${l.remise_percent}%)` : ''}</li>
                                        ))}
                                    </ul>
                                )}
                                {errors[i] && <div className="text-xs text-red-500 mt-1">{errors[i]}</div>}
                            </div>
                            <div className="flex-shrink-0 pt-1">
                                {statuses[i] === 'creating' && <Loader2 className="animate-spin text-slate-400" size={18} />}
                                {statuses[i] === 'ok' && <CheckCircle2 className="text-emerald-500" size={18} />}
                                {statuses[i] === 'error' && <XCircle className="text-red-500" size={18} />}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="flex justify-end items-center gap-3 mt-4 sticky bottom-0 bg-slate-50 dark:bg-slate-950 py-3">
                    {done && <span className="text-sm text-slate-600 dark:text-slate-300">{okCount}/{items.length} criados.</span>}
                    {(!done || hasFail) && (
                        <button
                            onClick={handleConfirm}
                            disabled={running}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium flex items-center gap-2"
                        >
                            {running ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />}
                            {done ? 'Tentar novamente os que falharam' : `Confirmar criação de ${items.length}`}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default BatchCreateView;
