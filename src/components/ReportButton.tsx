import React, { useState } from 'react';
import { Bug, X, Send, Loader2, CheckCircle2, ExternalLink } from 'lucide-react';
import { GithubService } from '../services/githubService';
import { captureContext, ReportContext } from '../utils/reportContext';

/**
 * Botão flutuante "Reportar problema" — sempre disponível.
 * Captura o contexto (tela/breadcrumb, erros de console, chamadas de API que falharam)
 * NO MOMENTO DO CLIQUE (antes de abrir o modal, p/ o breadcrumb refletir a tela real)
 * e cria uma issue no GitHub via o backend.
 */
export const ReportButton: React.FC = () => {
    const [open, setOpen] = useState(false);
    const [ctx, setCtx] = useState<ReportContext | null>(null);
    const [title, setTitle] = useState('');
    const [desc, setDesc] = useState('');
    const [sending, setSending] = useState(false);
    const [result, setResult] = useState<{ ok: boolean; url?: string; number?: number; error?: string } | null>(null);

    const openModal = () => {
        setCtx(captureContext()); // snapshot ANTES de abrir o modal
        setTitle('');
        setDesc('');
        setResult(null);
        setOpen(true);
    };

    const close = () => { if (!sending) setOpen(false); };

    const submit = async () => {
        if (!title.trim() || sending) return;
        setSending(true);
        const r = await GithubService.createIssue({
            title: title.trim(),
            description: desc,
            context: ctx,
            labels: ['from-app'],
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
                aria-label="Reportar problema"
                title="Reportar problema"
                className="fixed bottom-6 left-6 z-50 flex items-center justify-center w-12 h-12 rounded-full bg-rose-600 text-white shadow-lg hover:bg-rose-700 transition-colors"
            >
                <Bug size={20} />
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
                                <p className="text-slate-700 dark:text-slate-200 font-medium">Report enviado! Issue #{result.number} criada.</p>
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

                                {/* Transparência: mostra o contexto que será anexado */}
                                {ctx && (
                                    <details className="text-xs text-slate-500 bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3">
                                        <summary className="cursor-pointer font-semibold">Contexto que será anexado</summary>
                                        <div className="mt-2 space-y-1 break-words">
                                            <p><b>Onde:</b> {ctx.breadcrumb || '—'}</p>
                                            <p><b>URL:</b> {ctx.url}</p>
                                            <p><b>Erros de console:</b> {ctx.consoleErrors.length} · <b>API falhas:</b> {ctx.failedRequests.length}</p>
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
