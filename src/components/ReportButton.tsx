import React, { useState } from 'react';
import { Bug, X, Send, Loader2, CheckCircle2, ExternalLink } from 'lucide-react';
import { GithubService } from '../services/githubService';
import { captureFullContext, ReportContext, CaptureMeta } from '../utils/reportContext';

/** Texto curto p/ exibir ao usuário o motivo de captura visual parcial/omitida. */
function captureMetaLabel(reason: NonNullable<CaptureMeta['reason']>): string {
    switch (reason) {
        case 'sensitive-route': return 'rota sensível (login/senha) — snapshot/screenshot omitidos por segurança';
        case 'timeout': return 'timeout na captura do screenshot (≥5s) — os demais dados foram preservados';
        case 'error': return 'erro ao gerar screenshot — os demais dados foram preservados';
        case 'unavailable': return 'captura visual indisponível neste navegador';
    }
}

/**
 * Botão flutuante "Reportar problema" — sempre disponível.
 * Captura o contexto (tela/breadcrumb, erros e logs de console, chamadas de API
 * que falharam, snapshot HTML e screenshot da viewport) NO MOMENTO DO CLIQUE
 * (antes de abrir o modal, p/ o breadcrumb refletir a tela real) e cria uma
 * issue no GitHub via o backend. O screenshot/html têm timeout de 5s — se
 * estourar, envia o restante normalmente.
 */
export const ReportButton: React.FC = () => {
    const [open, setOpen] = useState(false);
    const [capturing, setCapturing] = useState(false);
    const [ctx, setCtx] = useState<ReportContext | null>(null);
    const [title, setTitle] = useState('');
    const [desc, setDesc] = useState('');
    const [sending, setSending] = useState(false);
    const [result, setResult] = useState<{ ok: boolean; url?: string; number?: number; error?: string } | null>(null);
    const [autoFix, setAutoFix] = useState(false);

    const openModal = async () => {
        if (capturing) return;
        setCapturing(true); // loading enquanto captura (async)
        try {
            // captureFullContext aplica timeout de 5s; em caso de timeout,
            // devolve o contexto sem screenshot/HTML, preservando logs e erros.
            const snapshot = await captureFullContext();
            setCtx(snapshot);
        } catch {
            setCtx(null);
        } finally {
            setCapturing(false);
            setTitle('');
            setDesc('');
            setAutoFix(false);
            setResult(null);
            setOpen(true);
        }
    };

    const close = () => { if (!sending) setOpen(false); };

    const submit = async () => {
        if (!title.trim() || sending) return;
        setSending(true);
        const r = await GithubService.createIssue({
            title: title.trim(),
            description: desc,
            context: ctx ?? undefined,
            // autoFix → adiciona 'opencode-task' p/ o TaskRunner pegar (o agente tenta corrigir e
            // abre um PR). 'from-app' fica sempre, p/ rastrear a origem. Sem autoFix = só triagem humana.
            labels: autoFix ? ['from-app', 'opencode-task'] : ['from-app'],
        });
        setResult(r);
        setSending(false);
    };

    return (
        <>
            {/* FAB — canto inferior esquerdo (evita o assistente, que fica à direita) */}
            <button
                type="button"
                onClick={openModal}
                disabled={capturing}
                aria-label="Reportar problema"
                title="Reportar problema"
                className="fixed bottom-6 left-6 z-50 flex items-center justify-center w-12 h-12 rounded-full bg-rose-600 text-white shadow-lg hover:bg-rose-700 transition-colors disabled:opacity-70"
            >
                {capturing ? <Loader2 size={20} className="animate-spin" /> : <Bug size={20} />}
            </button>

            {open && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4" onClick={close}>
                    <div
                        role="dialog"
                        aria-modal="true"
                        className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-h-[90vh] overflow-y-auto"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800">
                            <h2 className="text-lg font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                                <Bug size={18} className="text-rose-500" /> Reportar problema
                            </h2>
                            <button type="button" onClick={close} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                                <X size={20} />
                            </button>
                        </div>

                        {result?.ok ? (
                            <div className="p-6 text-center space-y-3">
                                <CheckCircle2 size={40} className="mx-auto text-green-500" />
                                <p className="text-slate-700 dark:text-slate-200 font-medium">{autoFix ? `Report enviado! Issue #${result.number} criada e marcada para o agente corrigir.` : `Report enviado! Issue #${result.number} criada.`}</p>
                                {result.url && (
                                    <a href={result.url} target="_blank" rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline">
                                        Ver no GitHub <ExternalLink size={14} />
                                    </a>
                                )}
                                <div>
                                    <button type="button" onClick={() => setOpen(false)}
                                        className="mt-2 text-sm px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700">
                                        Fechar
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="p-5 space-y-4">
                                <div>
                                    <label className="block text-xs uppercase font-bold text-slate-500 mb-1">Título</label>
                                    <input
                                        type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                                        placeholder="Resumo curto do problema"
                                        className="w-full text-sm p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                        autoFocus
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs uppercase font-bold text-slate-500 mb-1">O que aconteceu?</label>
                                    <textarea
                                        value={desc} onChange={(e) => setDesc(e.target.value)}
                                        placeholder="O que você fez, o que esperava e o que aconteceu."
                                        className="w-full text-sm p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white h-28"
                                    />
                                </div>

                                <label className="flex items-start gap-2 cursor-pointer select-none rounded-lg bg-indigo-50 dark:bg-indigo-900/20 p-3">
                                    <input type="checkbox" checked={autoFix} onChange={(e) => setAutoFix(e.target.checked)} className="mt-0.5" />
                                    <span className="text-xs text-slate-600 dark:text-slate-300">
                                        <b className="text-indigo-600 dark:text-indigo-400">🤖 Pedir correção automática</b> — cria a issue como tarefa do agente (opencode-task). Ele tenta resolver e abre um PR para revisão. Um admin precisa iniciar a execução.
                                    </span>
                                </label>

                                {/* Transparência: mostra o contexto que será anexado */}
                                {ctx && (
                                    <details className="text-xs text-slate-500 bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3">
                                        <summary className="cursor-pointer font-semibold">Contexto que será anexado</summary>
                                        <div className="mt-2 space-y-1 break-words">
                                            <p><b>Onde:</b> {ctx.breadcrumb || '—'}</p>
                                            <p><b>URL:</b> {ctx.url}</p>
                                            <p><b>Erros de console:</b> {ctx.consoleErrors.length} · <b>Logs:</b> {ctx.consoleLogs.length} · <b>API falhas:</b> {ctx.failedRequests.length}</p>
                                            <p><b>Snapshot HTML:</b> {ctx.htmlSnapshot ? `${Math.round(ctx.htmlSnapshot.length / 1024)} kB` : 'não capturado'} · <b>Screenshot:</b> {ctx.screenshot ? 'sim' : 'não'}</p>
                                            {ctx.captureMeta?.reason && (
                                                <p className="text-amber-600 dark:text-amber-400">
                                                    <b>Obs.:</b> {captureMetaLabel(ctx.captureMeta.reason)}
                                                </p>
                                            )}
                                        </div>
                                    </details>
                                )}

                                {result && !result.ok && (
                                    <p className="text-sm text-red-600">Falha ao enviar: {result.error}</p>
                                )}

                                <div className="flex justify-end gap-2 pt-1">
                                    <button type="button" onClick={close} disabled={sending}
                                        className="text-sm px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg disabled:opacity-50">
                                        Cancelar
                                    </button>
                                    <button type="button" onClick={submit} disabled={sending || !title.trim()}
                                        className="flex items-center gap-1 text-sm px-4 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50">
                                        {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Enviar
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
};

export default ReportButton;
