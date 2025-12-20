
import React, { useState, useEffect } from 'react';
import { Bug, Sparkles, Loader2 } from 'lucide-react';
import { ApiLog } from '../../types';
import { AiService } from '../../services/aiService';

interface AiFixTabProps {
    selectedLog: ApiLog | null;
}

export const AiFixTab: React.FC<AiFixTabProps> = ({ selectedLog }) => {
    const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    useEffect(() => {
        if (selectedLog) {
            analyzeError(selectedLog);
        } else {
            setAiAnalysis(null);
        }
    }, [selectedLog]);

    const analyzeError = async (log: ApiLog) => {
        setIsAnalyzing(true);
        setAiAnalysis(null);
        try {
            const suggestion = await AiService.fixApiCallWithDocs(log, "Standard Dolibarr REST API conventions apply.");
            setAiAnalysis(suggestion);
        } catch (e: any) {
            setAiAnalysis(`Análise falhou: ${e.message}`);
        } finally {
            setIsAnalyzing(false);
        }
    };

    return (
        <div className="p-6 h-full overflow-y-auto">
            {!selectedLog ? (
                <div className="text-center py-20 text-slate-400">
                    <Sparkles size={48} className="mx-auto mb-4 opacity-50 text-indigo-400" />
                    <p>Selecione um log de erro no Console para iniciar o diagnóstico.</p>
                </div>
            ) : (
                <div className="max-w-3xl mx-auto space-y-6">
                    <div className="bg-red-50 dark:bg-red-900/10 p-4 rounded-xl border border-red-100 dark:border-red-900/30">
                        <h3 className="font-bold text-red-800 dark:text-red-400 mb-2 flex items-center gap-2"><Bug size={18} /> Requisição Falhou</h3>
                        <div className="font-mono text-xs text-red-700 dark:text-red-300">
                            {selectedLog.endpoint_or_task}
                        </div>
                        <div className="mt-2 p-2 bg-white/50 dark:bg-black/20 rounded text-xs font-mono text-red-600 dark:text-red-300 whitespace-pre-wrap">
                            {selectedLog.output_data}
                        </div>
                    </div>

                    {aiAnalysis ? (
                        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm animate-in fade-in slide-in-from-bottom-4">
                            <h3 className="font-bold text-lg dark:text-white mb-4 flex items-center gap-2"><Sparkles className="text-indigo-500" size={20} /> Diagnóstico IA</h3>
                            <div className="prose prose-sm dark:prose-invert max-w-none">
                                <div className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300 leading-relaxed bg-slate-50 dark:bg-slate-800 p-4 rounded-lg border border-slate-100 dark:border-slate-700">
                                    {aiAnalysis}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-12">
                            <Loader2 className="animate-spin text-indigo-600 mb-4" size={32} />
                            <p className="text-slate-500">Analisando erro com Gemini 2.5 Flash...</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
