import React, { useEffect, useState, useMemo } from 'react';
import {
    Save, RotateCcw, History, Loader2, AlertTriangle, Lock, Sparkles, FileText, Plus,
} from 'lucide-react';
import { toast } from 'sonner';
import {
    getAgentPromptConfig,
    updateAgentPrompt,
    AgentPromptSnapshot,
    AgentPromptHistoryEntry,
} from '../../services/agentPromptService';
import { logger } from '../../utils/logger';

const log = logger.child('AgentConfigEditor');

interface DiffLine {
    type: 'same' | 'add' | 'del';
    text: string;
}

/** Diff de linhas (LCS) entre o prompt anterior e o novo — para o histórico. */
function lineDiff(oldText: string, newText: string): DiffLine[] {
    const a = (oldText || '').split('\n');
    const b = (newText || '').split('\n');
    const n = a.length;
    const m = b.length;
    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
            else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const out: DiffLine[] = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            out.push({ type: 'same', text: a[i] });
            i++;
            j++;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            out.push({ type: 'del', text: a[i] });
            i++;
        } else {
            out.push({ type: 'add', text: b[j] });
            j++;
        }
    }
    while (i < n) {
        out.push({ type: 'del', text: a[i] });
        i++;
    }
    while (j < m) {
        out.push({ type: 'add', text: b[j] });
        j++;
    }
    return out;
}

const PRESETS: { id: string; label: string; snippet: string }[] = [
    {
        id: 'conciso',
        label: 'Conciso',
        snippet: '\n\n[PRESET: Conciso] Seja extremamente curto. Responda em no máximo 2-3 frases, direto ao ponto.',
    },
    {
        id: 'detalhado',
        label: 'Detalhado',
        snippet: '\n\n[PRESET: Detalhado] Explique o raciocínio passo a passo e cite de onde veio cada informação consultada.',
    },
    {
        id: 'anti-concordancia',
        label: 'Anti-concordância ON',
        snippet: '\n\n[PRESET: Anti-concordância] NUNCA concorde só para agradar. Se o usuário estiver errado, diga — com educação e evidências.',
    },
];

export interface AgentConfigEditorProps {
    isAdmin: boolean;
}

export const AgentConfigEditor: React.FC<AgentConfigEditorProps> = ({ isAdmin }) => {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [snapshot, setSnapshot] = useState<AgentPromptSnapshot | null>(null);
    const [draft, setDraft] = useState('');
    const [confirm, setConfirm] = useState<null | 'save' | 'restore'>(null);
    const [error, setError] = useState<string | null>(null);

    const canEdit = isAdmin && (snapshot?.canEdit ?? true);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            const snap = await getAgentPromptConfig();
            if (cancelled) return;
            if (snap) {
                setSnapshot(snap);
                setDraft(snap.systemPrompt);
            } else {
                setError('Falha ao carregar o system prompt.');
            }
            setLoading(false);
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const hasChanges = useMemo(() => {
        if (!snapshot) return false;
        return draft.trim() !== snapshot.systemPrompt.trim();
    }, [draft, snapshot]);

    const handleSave = async () => {
        if (!snapshot || !canEdit || !hasChanges) return;
        setSaving(true);
        setError(null);
        try {
            const snap = await updateAgentPrompt({ systemPrompt: draft });
            setSnapshot(snap);
            setDraft(snap.systemPrompt);
            toast.success('System prompt salvo. Próxima sessão do Marciano usará o novo texto.');
        } catch (e: any) {
            log.error('Falha ao salvar system prompt', e);
            const msg = e?.response?.data?.error || e?.message || 'Falha ao salvar.';
            setError(msg);
            toast.error(msg);
        } finally {
            setSaving(false);
            setConfirm(null);
        }
    };

    const handleRestore = async () => {
        if (!snapshot || !canEdit) return;
        setSaving(true);
        setError(null);
        try {
            const snap = await updateAgentPrompt({ restoreDefault: true });
            setSnapshot(snap);
            setDraft(snap.systemPrompt);
            toast.success('System prompt restaurado para o padrão.');
        } catch (e: any) {
            log.error('Falha ao restaurar system prompt', e);
            const msg = e?.response?.data?.error || e?.message || 'Falha ao restaurar.';
            setError(msg);
            toast.error(msg);
        } finally {
            setSaving(false);
            setConfirm(null);
        }
    };

    const applyPreset = (snippet: string) => {
        if (!canEdit) return;
        setDraft(prev => (prev.includes(snippet) ? prev : prev + snippet));
    };

    if (loading) {
        return (
            <div className="p-6 flex items-center gap-2 text-slate-500 dark:text-slate-400">
                <Loader2 size={18} className="animate-spin" /> Carregando config do agente…
            </div>
        );
    }

    if (!snapshot) {
        return (
            <div className="p-6 flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
                <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />
                <span>{error || 'Não foi possível carregar o system prompt.'}</span>
            </div>
        );
    }

    return (
        <div className="p-6 space-y-5">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h3 className="text-base font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                        <Sparkles size={18} className="text-indigo-600" />
                        Prompt-base do Marciano
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Texto-base do system prompt do agente. Alterações afetam TODAS as sessões a partir da próxima.
                    </p>
                </div>
                {!canEdit && (
                    <span className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                        <Lock size={12} /> read-only
                    </span>
                )}
            </div>

            {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-600 dark:text-red-400">
                    <AlertTriangle size={16} className="flex-shrink-0" />
                    {error}
                </div>
            )}

            {/* Presets */}
            {canEdit && (
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-slate-400 flex items-center gap-1">
                        <Plus size={12} /> Presets:
                    </span>
                    {PRESETS.map(p => (
                        <button
                            key={p.id}
                            type="button"
                            onClick={() => applyPreset(p.snippet)}
                            className="text-xs px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-slate-700 dark:text-slate-300 transition-colors"
                        >
                            {p.label}
                        </button>
                    ))}
                </div>
            )}

            {/* Textarea */}
            <div>
                <label htmlFor="agent-system-prompt" className="block text-xs font-mono text-slate-500 dark:text-slate-400 mb-1">
                    SYSTEM PROMPT
                </label>
                <textarea
                    id="agent-system-prompt"
                    aria-label="System prompt do Marciano"
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    disabled={!canEdit || saving}
                    rows={14}
                    maxLength={20000}
                    className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 dark:text-white resize-y font-mono text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                    placeholder="Texto-base do system prompt do agente…"
                />
                <div className="flex justify-between mt-1">
                    <span className="text-xs text-slate-400">
                        {draft.length} / 20000 caracteres
                    </span>
                    {hasChanges && canEdit && (
                        <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                            <AlertTriangle size={12} /> alterações não salvas
                        </span>
                    )}
                </div>
            </div>

            {/* Confirm panel */}
            {confirm && (
                <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg">
                    <AlertTriangle size={18} className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 text-sm">
                        <p className="font-semibold text-amber-700 dark:text-amber-300">
                            {confirm === 'restore' ? 'Restaurar para o padrão?' : 'Confirmar alteração?'}
                        </p>
                        <p className="text-amber-600 dark:text-amber-400 mt-0.5">
                            Alterar o prompt impacta TODAS as sessões do Marciano a partir da próxima interação.
                        </p>
                        <div className="flex gap-2 mt-3">
                            <button
                                type="button"
                                onClick={confirm === 'restore' ? handleRestore : handleSave}
                                disabled={saving}
                                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold disabled:opacity-50 flex items-center gap-1.5"
                            >
                                {saving ? <Loader2 size={12} className="animate-spin" /> : null}
                                Confirmar alteração
                            </button>
                            <button
                                type="button"
                                onClick={() => setConfirm(null)}
                                disabled={saving}
                                className="px-3 py-1.5 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700"
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Actions */}
            {canEdit && !confirm && (
                <div className="flex justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <button
                        type="button"
                        onClick={() => setConfirm('restore')}
                        disabled={saving || snapshot.systemPrompt === snapshot.defaultPrompt}
                        className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Voltar ao texto original"
                    >
                        <RotateCcw size={16} /> Restaurar padrão
                    </button>
                    <button
                        type="button"
                        onClick={() => setConfirm('save')}
                        disabled={saving || !hasChanges}
                        className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-bold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                        Salvar
                    </button>
                </div>
            )}

            {/* History */}
            <div>
                <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2 mb-3">
                    <History size={16} className="text-indigo-600" />
                    Histórico de versões
                    <span className="text-xs font-normal text-slate-400">(últimas 5)</span>
                </h4>
                {snapshot.history.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">Nenhuma alteração registrada.</p>
                ) : (
                    <div className="space-y-3">
                        {snapshot.history.map(h => (
                            <HistoryEntry key={h.id} entry={h} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

const HistoryEntry: React.FC<{ entry: AgentPromptHistoryEntry }> = ({ entry }) => {
    const [open, setOpen] = useState(false);
    const diff = useMemo(() => lineDiff(entry.previousPrompt, entry.prompt), [entry]);
    const when = new Date(entry.timestamp).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    return (
        <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 text-left"
            >
                <span className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <FileText size={13} className="text-slate-400" />
                    <span className="font-medium">{entry.changedBy.name || entry.changedBy.login}</span>
                    <span className="text-slate-400">·</span>
                    <span>{when}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${entry.action === 'restore' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'}`}>
                        {entry.action === 'restore' ? 'restaurou' : 'editou'}
                    </span>
                </span>
                <span className="text-xs text-slate-400">{open ? 'ocultar diff' : 'ver diff'}</span>
            </button>
            {open && (
                <pre className="p-3 bg-slate-900 text-xs font-mono overflow-x-auto max-h-64 overflow-y-auto">
                    {diff.map((line, idx) => (
                        <div
                            key={idx}
                            className={
                                line.type === 'add'
                                    ? 'text-emerald-400'
                                    : line.type === 'del'
                                    ? 'text-red-400 line-through opacity-70'
                                    : 'text-slate-500'
                            }
                        >
                            {line.type === 'add' ? '+ ' : line.type === 'del' ? '- ' : '  '}
                            {line.text}
                        </div>
                    ))}
                </pre>
            )}
        </div>
    );
};
