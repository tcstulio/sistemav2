import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '../ui';
import { X, FileText, Plus, Minus, ChevronDown, ChevronRight, ExternalLink, RotateCcw, GitMerge, XCircle, Image as ImageIcon, Camera, Loader2 } from 'lucide-react';
import { TaskService } from '../../services/taskService';

interface DiffFile {
    path: string;
    additions: number;
    deletions: number;
    hunks: DiffLine[][];
}

interface DiffLine {
    type: 'add' | 'remove' | 'context' | 'header';
    content: string;
    oldLine?: number;
    newLine?: number;
}

function parseDiff(diffText: string): DiffFile[] {
    const files: DiffFile[] = [];
    const lines = diffText.split('\n');
    let currentFile: DiffFile | null = null;
    let currentHunk: DiffLine[] = [];
    let additions = 0;
    let deletions = 0;

    for (const line of lines) {
        if (line.startsWith('diff --git')) {
            if (currentFile && currentHunk.length) {
                currentFile.hunks.push(currentHunk);
            }
            const match = line.match(/b\/(.+)$/);
            currentFile = { path: match ? match[1] : line, additions: 0, deletions: 0, hunks: [] };
            additions = 0;
            deletions = 0;
            files.push(currentFile);
            currentHunk = [];
        } else if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('index ') || line.startsWith('@@@')) {
            continue;
        } else if (line.startsWith('@@')) {
            if (currentHunk.length) {
                currentFile?.hunks.push(currentHunk);
            }
            currentHunk = [{ type: 'header', content: line }];
        } else if (line.startsWith('+')) {
            additions++;
            currentHunk.push({ type: 'add', content: line.slice(1) });
            if (currentFile) currentFile.additions = additions;
        } else if (line.startsWith('-')) {
            deletions++;
            currentHunk.push({ type: 'remove', content: line.slice(1) });
            if (currentFile) currentFile.deletions = deletions;
        } else if (line.startsWith(' ')) {
            currentHunk.push({ type: 'context', content: line.slice(1) });
        }
    }
    if (currentHunk.length && currentFile) {
        currentFile.hunks.push(currentHunk);
    }
    return files;
}

const DiffFileBlock: React.FC<{ file: DiffFile }> = ({ file }) => {
    const [collapsed, setCollapsed] = useState(false);
    const pathParts = file.path.split('/');
    const fileName = pathParts[pathParts.length - 1];
    const dir = pathParts.length > 1 ? pathParts.slice(0, -1).join('/') + '/' : '';

    return (
        <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
            <button
                onClick={() => setCollapsed(!collapsed)}
                className="w-full flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-750 transition-colors text-left"
            >
                {collapsed ? <ChevronRight size={14} className="text-slate-400 shrink-0" /> : <ChevronDown size={14} className="text-slate-400 shrink-0" />}
                <FileText size={14} className="text-slate-400 shrink-0" />
                <span className="text-xs text-slate-400 font-mono">{dir}</span>
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 font-mono">{fileName}</span>
                <div className="flex items-center gap-2 ml-auto">
                    {file.additions > 0 && <span className="text-[10px] font-mono text-green-600 bg-green-50 dark:bg-green-900/20 px-1.5 py-0.5 rounded flex items-center gap-0.5"><Plus size={8} />{file.additions}</span>}
                    {file.deletions > 0 && <span className="text-[10px] font-mono text-red-600 bg-red-50 dark:bg-red-900/20 px-1.5 py-0.5 rounded flex items-center gap-0.5"><Minus size={8} />{file.deletions}</span>}
                </div>
            </button>
            {!collapsed && (
                <div className="overflow-x-auto text-[11px] font-mono">
                    {file.hunks.map((hunk, hi) => (
                        <div key={hi}>
                            {hunk[0]?.type === 'header' && (
                                <div className="px-3 py-1 bg-blue-50 dark:bg-blue-900/10 text-blue-600 dark:text-blue-400 text-[10px]">
                                    {hunk[0].content}
                                </div>
                            )}
                            {hunk.filter(l => l.type !== 'header').map((line, li) => (
                                <div
                                    key={li}
                                    className={`flex ${
                                        line.type === 'add'
                                            ? 'bg-green-50 dark:bg-green-900/15 text-green-800 dark:text-green-300'
                                            : line.type === 'remove'
                                            ? 'bg-red-50 dark:bg-red-900/15 text-red-800 dark:text-red-300'
                                            : 'text-slate-600 dark:text-slate-400'
                                    }`}
                                >
                                    <span className="w-6 shrink-0 text-right pr-1 text-slate-300 dark:text-slate-600 select-none border-r border-slate-100 dark:border-slate-800">
                                        {line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' '}
                                    </span>
                                    <pre className="pl-2 whitespace-pre-wrap break-all flex-1 leading-relaxed">{line.content}</pre>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// Painel "Prova visual": mostra before/after AUTENTICADOS + score/resumo do Judge Visual (advisory),
// e permite gerar/regerar sob demanda. As imagens são buscadas por fetch autenticado (blob) — a
// apiKey nunca vai na querystring do <img src>.
const VisualProofPanel: React.FC<{ issueNumber: number; initialScore?: number; initialReview?: string }> = ({ issueNumber, initialScore, initialReview }) => {
    const [beforeSrc, setBeforeSrc] = useState<string | null>(null);
    const [afterSrc, setAfterSrc] = useState<string | null>(null);
    const [score, setScore] = useState<number | undefined>(initialScore);
    const [review, setReview] = useState<string | undefined>(initialReview);
    const [loading, setLoading] = useState(false);
    const [loadedShots, setLoadedShots] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const loadShots = useCallback(async () => {
        const b = await TaskService.getScreenshotBlobUrl(issueNumber, 'before').catch(() => null);
        const a = await TaskService.getScreenshotBlobUrl(issueNumber, 'after').catch(() => null);
        setBeforeSrc(prev => { if (prev && prev !== b) URL.revokeObjectURL(prev); return b; });
        setAfterSrc(prev => { if (prev && prev !== a) URL.revokeObjectURL(prev); return a; });
        setLoadedShots(true);
    }, [issueNumber]);

    useEffect(() => { loadShots(); }, [loadShots]);

    const generate = async () => {
        setLoading(true); setErr(null);
        try {
            const r = await TaskService.generateVisualProof(issueNumber);
            setScore(r.visualScore);
            setReview(r.visualReview);
            if (!r.hasScreenshots) setErr(r.visualReview || 'Não foi possível capturar as telas (o preview não subiu?).');
            await loadShots();
        } catch (e: any) {
            setErr(e?.response?.data?.error || e?.message || 'Falha ao gerar a prova visual');
        } finally {
            setLoading(false);
        }
    };

    const hasProof = !!(beforeSrc || afterSrc);
    const scoreColor = score === undefined ? '' : score >= 8
        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
        : score >= 5 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
        : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300';

    return (
        <div className="mx-6 mt-4 p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/30">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <ImageIcon size={15} className="text-indigo-500" />
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Prova visual</span>
                    {score !== undefined && <span className={`text-xs font-mono px-2 py-0.5 rounded-full ${scoreColor}`}>{score}/10</span>}
                </div>
                <Button variant="ghost" size="sm" icon={loading ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />} onClick={generate} disabled={loading}>
                    {loading ? 'Gerando…' : hasProof ? 'Regerar' : 'Gerar prova visual'}
                </Button>
            </div>

            {review && <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap mb-3">{review}</p>}

            {hasProof ? (
                <div className="grid grid-cols-2 gap-3">
                    <figure className="space-y-1 m-0">
                        <figcaption className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Antes (main)</figcaption>
                        {beforeSrc ? <img src={beforeSrc} alt="Antes" className="rounded-lg border border-slate-200 dark:border-slate-700 w-full" /> : <div className="text-xs text-slate-400 py-8 text-center">—</div>}
                    </figure>
                    <figure className="space-y-1 m-0">
                        <figcaption className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Depois (esta branch)</figcaption>
                        {afterSrc ? <img src={afterSrc} alt="Depois" className="rounded-lg border border-slate-200 dark:border-slate-700 w-full" /> : <div className="text-xs text-slate-400 py-8 text-center">—</div>}
                    </figure>
                </div>
            ) : loading ? (
                <div className="text-xs text-slate-400 py-6 text-center">Subindo o preview e fotografando as telas autenticadas… (pode levar ~1-2 min)</div>
            ) : (
                <div className="text-xs text-slate-400 py-4 text-center">
                    {loadedShots ? 'Sem prova visual ainda — clique em "Gerar prova visual" para fotografar a tela autenticada antes/depois.' : 'Carregando…'}
                </div>
            )}

            {err && <p className="text-xs text-red-500 mt-2 whitespace-pre-wrap">{err}</p>}
        </div>
    );
};

interface DiffViewerProps {
    diff: string;
    issueNumber?: number;
    judgeScore?: number;
    judgeReview?: string;
    visualScore?: number;
    visualReview?: string;
    screenVerify?: { ok: boolean; routes: string[]; screens: { route: string; ok: boolean; errors: string[] }[] };
    prUrl?: string;
    onClose: () => void;
    onMerge: () => void;
    onFix: () => void;
    onReject: () => void;
}

const DiffViewer: React.FC<DiffViewerProps> = ({ diff, issueNumber, judgeScore, judgeReview, visualScore, visualReview, screenVerify, prUrl, onClose, onMerge, onFix, onReject }) => {
    const files = parseDiff(diff);
    const totalAdd = files.reduce((s, f) => s + f.additions, 0);
    const totalDel = files.reduce((s, f) => s + f.deletions, 0);

    return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center overflow-y-auto p-4">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-5xl my-8 flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 shrink-0">
                    <div>
                        <h2 className="text-lg font-bold text-slate-800 dark:text-white">Revisão do PR</h2>
                        <div className="flex items-center gap-3 mt-1">
                            <span className="text-xs text-green-600 font-mono">+{totalAdd}</span>
                            <span className="text-xs text-red-600 font-mono">-{totalDel}</span>
                            <span className="text-xs text-slate-400">{files.length} arquivo(s)</span>
                            {prUrl && (
                                <a href={prUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1">
                                    Ver no GitHub <ExternalLink size={10} />
                                </a>
                            )}
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400">
                        <X size={20} />
                    </button>
                </div>

                {/* Judge Review */}
                {judgeReview && (
                    <div className={`mx-6 mt-4 p-4 rounded-xl border ${
                        judgeScore !== undefined && judgeScore >= 7
                            ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800'
                            : 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800'
                    }`}>
                        <div className="flex items-center gap-2 mb-2">
                            <span className="text-sm font-bold">LLM Judge</span>
                            {judgeScore !== undefined && (
                                <span className={`text-xs font-mono px-2 py-0.5 rounded-full ${
                                    judgeScore >= 7 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                                }`}>
                                    {judgeScore}/10
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{judgeReview}</p>
                    </div>
                )}

                {/* Prova visual (advisory) — só quando temos a task */}
                {issueNumber !== undefined && (
                    <VisualProofPanel issueNumber={issueNumber} initialScore={visualScore} initialReview={visualReview} />
                )}

                {/* Verificação das TELAS AFETADAS (o robô conferiu a tela que mexeu, com dado mockado) */}
                {screenVerify && screenVerify.routes.length > 0 && (
                    <div className={`mx-6 mt-4 p-4 rounded-xl border ${screenVerify.ok ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800'}`}>
                        <div className="flex items-center gap-2 mb-2">
                            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Telas afetadas</span>
                            <span className={`text-xs font-mono px-2 py-0.5 rounded-full ${screenVerify.ok ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'}`}>
                                {screenVerify.ok ? 'renderizam OK' : 'FALHA'}
                            </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {screenVerify.screens.map((s) => (
                                <span key={s.route} title={s.errors.join(' | ')} className={`text-xs px-2 py-1 rounded-lg font-mono ${s.ok ? 'bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-300'}`}>
                                    {s.ok ? '✅' : '❌'} {s.route}{!s.ok && s.errors[0] ? ` — ${s.errors[0].slice(0, 60)}` : ''}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {/* Diff Content */}
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
                    {files.length === 0 ? (
                        <div className="text-center py-12 text-slate-400">
                            <p className="text-sm">Nenhum diff disponível</p>
                            <p className="text-xs mt-1">O PR ainda está sendo gerado ou não há mudanças</p>
                        </div>
                    ) : (
                        files.map((file, i) => <DiffFileBlock key={i} file={file} />)
                    )}
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700 shrink-0">
                    <div className="flex gap-2">
                        <Button variant="ghost" size="sm" icon={<XCircle size={14} />} onClick={onReject}>
                            Rejeitar
                        </Button>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="ghost" size="sm" icon={<RotateCcw size={14} />} onClick={onFix}>
                            Corrigir
                        </Button>
                        <Button variant="primary" size="sm" icon={<GitMerge size={14} />} onClick={onMerge}>
                            Merge
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DiffViewer;
