import React, { useState, useEffect } from 'react';
import { AiService } from '../../services/aiService';
import { Sparkles, Loader2, TrendingUp, AlertTriangle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { saveFinancialAnalysis } from '../../services/dashboardArtifacts';

// Janela para considerar a análise "desatualizada" (#492).
const STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

// Formata timestamp (ms) como "dd/mm/yyyy HH:mm" (ex.: "14/07/2025 18:00").
const formatLastRun = (ms: number): string => {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// O backend persiste o payload da IA em `data` (geralmente markdown em string,
// mas pode ser objeto). Normaliza para uma string renderizável.
const coerceAnalysis = (data: unknown): string => {
    if (typeof data === 'string') return data;
    if (data && typeof data === 'object') return JSON.stringify(data, null, 2);
    return '';
};

interface FinancialHealthWidgetProps {
    data: any;
    title?: string;
}

export const FinancialHealthWidget: React.FC<FinancialHealthWidgetProps> = ({ data, title = "Análise Financeira IA" }) => {
    const [analysis, setAnalysis] = useState<string | null>(null);
    const [lastRunAt, setLastRunAt] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [loadingLatest, setLoadingLatest] = useState(true);
    const [hasNone, setHasNone] = useState(false);

    // Carrega a última análise persistida (org-wide) automaticamente, sem exigir
    // clique manual — GET /analyze/financial-analysis/latest (#492).
    useEffect(() => {
        let cancelled = false;
        AiService.getLatestFinancialAnalysis().then((snap) => {
            if (cancelled) return;
            if (snap && snap.status === 'success' && snap.data != null) {
                setAnalysis(coerceAnalysis(snap.data));
                setLastRunAt(snap.lastRunAt ? new Date(snap.lastRunAt).getTime() : null);
            } else {
                setHasNone(true);
            }
            setLoadingLatest(false);
        });
        return () => { cancelled = true; };
    }, []);

    const handleAnalyze = async () => {
        setIsLoading(true);
        try {
            const result = await AiService.analyzeFinancialHealth(data);
            const text = typeof result === 'string' ? result : coerceAnalysis(result);
            setAnalysis(text);
            setHasNone(false);
            const now = Date.now();
            setLastRunAt(now);
            const saved = await saveFinancialAnalysis(text); // persiste pra todos
            if (saved?.generatedAt) setLastRunAt(saved.generatedAt);
        } catch (e) {
            setAnalysis("Erro ao gerar análise.");
        } finally {
            setIsLoading(false);
        }
    };

    const isStale = lastRunAt != null && (Date.now() - lastRunAt) > STALE_MS;

    return (
        <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden">
            {/* Decorator */}
            <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
                <Sparkles size={60} className="text-indigo-600" />
            </div>

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4 relative z-10">
                <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                    <Sparkles size={18} className="text-indigo-600" />
                    {title}
                </h3>
                <button
                    onClick={handleAnalyze}
                    disabled={isLoading}
                    className="text-xs flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 rounded-lg transition-colors font-medium border border-indigo-200 dark:border-indigo-800 self-end sm:self-auto"
                >
                    {isLoading ? <Loader2 size={14} className="animate-spin" /> : <TrendingUp size={14} />}
                    {analysis ? 'Regenerar' : 'Gerar Análise'}
                </button>
            </div>

            <div className="min-h-[100px]">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-8 text-slate-400 space-y-2 animate-pulse">
                        <Loader2 size={24} className="animate-spin text-indigo-500" />
                        <span className="text-sm">Analisando saúde financeira...</span>
                    </div>
                ) : loadingLatest ? (
                    <div className="flex flex-col items-center justify-center py-8 text-slate-400 space-y-2 animate-pulse">
                        <Loader2 size={24} className="animate-spin text-indigo-500" />
                        <span className="text-sm">Carregando última análise...</span>
                    </div>
                ) : analysis ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-strong:text-indigo-600 dark:prose-strong:text-indigo-400">
                        {isStale && (
                            <div className="mb-3 not-prose flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                                <AlertTriangle size={14} />
                                Análise desatualizada (mais de 7 dias). Considere regerar.
                            </div>
                        )}
                        <ReactMarkdown>{analysis}</ReactMarkdown>
                        {lastRunAt != null && (
                            <div className="mt-4 not-prose">
                                <span className="text-[11px] text-slate-400">
                                    Última análise: {formatLastRun(lastRunAt)}
                                </span>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-6 text-slate-400 border-2 border-dashed border-slate-100 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-800/20">
                        <p className="text-sm text-center max-w-[220px]">
                            {hasNone ? 'Nenhuma análise disponível ainda.' : 'Clique para gerar um relatório inteligente sobre o fluxo de caixa e status financeiro.'}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};
