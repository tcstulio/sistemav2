import React, { useState } from 'react';
import { AiService } from '../../services/aiService';
import { Sparkles, Loader2, TrendingUp, AlertTriangle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface FinancialHealthWidgetProps {
    data: any;
    title?: string;
}

export const FinancialHealthWidget: React.FC<FinancialHealthWidgetProps> = ({ data, title = "Análise Financeira IA" }) => {
    const [analysis, setAnalysis] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const handleAnalyze = async () => {
        setIsLoading(true);
        try {
            const result = await AiService.analyzeFinancialHealth(data);
            setAnalysis(result);
        } catch (e) {
            setAnalysis("Erro ao gerar análise.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden">
            {/* Decorator */}
            <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
                <Sparkles size={60} className="text-indigo-600" />
            </div>

            <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                    <Sparkles size={18} className="text-indigo-600" />
                    {title}
                </h3>
                {!analysis && (
                    <button
                        onClick={handleAnalyze}
                        disabled={isLoading}
                        className="text-xs flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 rounded-lg transition-colors font-medium border border-indigo-200 dark:border-indigo-800"
                    >
                        {isLoading ? <Loader2 size={14} className="animate-spin" /> : <TrendingUp size={14} />}
                        Gerar Insights
                    </button>
                )}
            </div>

            <div className="min-h-[100px]">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-8 text-slate-400 space-y-2 animate-pulse">
                        <Loader2 size={24} className="animate-spin text-indigo-500" />
                        <span className="text-sm">Analisando saúde financeira...</span>
                    </div>
                ) : analysis ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-strong:text-indigo-600 dark:prose-strong:text-indigo-400">
                        <ReactMarkdown>{analysis}</ReactMarkdown>
                        <div className="mt-4 flex justify-end">
                            <button
                                onClick={handleAnalyze}
                                className="text-xs text-slate-400 hover:text-indigo-500 flex items-center gap-1 transition-colors"
                            >
                                <Sparkles size={12} /> Regenerar
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-6 text-slate-400 border-2 border-dashed border-slate-100 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-800/20">
                        <p className="text-sm text-center max-w-[200px]">
                            Clique para gerar um relatório inteligente sobre o fluxo de caixa e status financeiro.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};
