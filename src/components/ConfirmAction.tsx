import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle, XCircle, Loader2, ShieldCheck } from 'lucide-react';
import { describeAction, executeAction, ConfirmDescribe } from '../services/agentActionService';

/**
 * Tela de confirmação humana (HITL) de uma ação irreversível preparada pelo agente
 * (robô-de-negócio §8.1). O deeplink `/confirm-action?token=…` cai aqui: mostramos a descrição
 * (via /describe, sem executar) e, ao confirmar, o backend EXECUTA com a chave do próprio usuário
 * logado (RBAC real). Acessível a qualquer usuário autenticado — a autorização é do backend.
 */
const ConfirmAction: React.FC = () => {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const token = params.get('token') || '';

    const [desc, setDesc] = useState<ConfirmDescribe | null>(null);
    const [loading, setLoading] = useState(true);
    const [executing, setExecuting] = useState(false);
    const [done, setDone] = useState<{ ok: boolean; msg: string } | null>(null);

    useEffect(() => {
        if (!token) { setDesc({ ok: false, error: 'Link de confirmação sem token.' }); setLoading(false); return; }
        let alive = true;
        describeAction(token)
            .then((d) => { if (alive) setDesc(d); })
            .catch(() => { if (alive) setDesc({ ok: false, error: 'Não foi possível carregar a confirmação.' }); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [token]);

    const confirm = async () => {
        setExecuting(true);
        try {
            const r = await executeAction(token);
            setDone(r.ok
                ? { ok: true, msg: 'Ação confirmada e executada com sucesso.' }
                : { ok: false, msg: r.error || 'Falha ao executar a ação.' });
        } catch {
            setDone({ ok: false, msg: 'Falha ao executar a ação.' });
        } finally {
            setExecuting(false);
        }
    };

    const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => (
        <div className="min-h-[60vh] flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-100 dark:border-slate-800 p-6">
                {children}
            </div>
        </div>
    );

    if (loading) {
        return <Card><div className="flex items-center gap-3 text-slate-500"><Loader2 className="animate-spin" size={20} /> Carregando confirmação…</div></Card>;
    }

    if (done) {
        return (
            <Card>
                <div className="flex flex-col items-center text-center gap-3">
                    {done.ok
                        ? <CheckCircle className="text-emerald-500" size={48} />
                        : <XCircle className="text-red-500" size={48} />}
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">{done.ok ? 'Confirmado' : 'Não concluído'}</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">{done.msg}</p>
                    <button onClick={() => navigate('/')} className="mt-2 px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700">
                        Voltar ao início
                    </button>
                </div>
            </Card>
        );
    }

    if (!desc?.ok) {
        return (
            <Card>
                <div className="flex flex-col items-center text-center gap-3">
                    <XCircle className="text-red-500" size={48} />
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">Confirmação inválida</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">{desc?.error || 'Este link de confirmação é inválido ou expirou.'}</p>
                    <button onClick={() => navigate('/')} className="mt-2 px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700">
                        Voltar ao início
                    </button>
                </div>
            </Card>
        );
    }

    return (
        <Card>
            <div className="flex items-center gap-2 mb-4">
                <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20">
                    <AlertTriangle className="text-amber-500" size={20} />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">{desc.title || 'Confirmar ação'}</h2>
                    <p className="text-xs text-slate-400">Ação irreversível — preparada pelo agente</p>
                </div>
            </div>

            <p className="text-sm text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 rounded-lg p-3 mb-4">{desc.summary}</p>

            <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-5">
                <ShieldCheck size={14} /> Será executada com a sua permissão do Dolibarr.
            </div>

            <div className="flex gap-2">
                <button
                    onClick={() => navigate('/')}
                    disabled={executing}
                    className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
                >
                    Cancelar
                </button>
                <button
                    onClick={confirm}
                    disabled={executing}
                    data-testid="confirm-action-btn"
                    className="flex-1 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2"
                >
                    {executing ? <><Loader2 className="animate-spin" size={16} /> Executando…</> : 'Confirmar e executar'}
                </button>
            </div>
        </Card>
    );
};

export default ConfirmAction;
