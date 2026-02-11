import React, { useState } from 'react';
import { ApiLog } from '../../types';
import { dbService } from '../../services/dbService';
import { AiService } from '../../services/aiService';
import { Loader2, Zap } from 'lucide-react';
import { logger } from '../../utils/logger';

const log = logger.child('OptimizeTab');

interface OptimizationSuggestion {
    title: string;
    impact: 'High' | 'Medium' | 'Low';
    description: string;
    suggestion: string;
}

interface OptimizeTabProps {
    logs: ApiLog[];
}

export const OptimizeTab: React.FC<OptimizeTabProps> = ({ logs }) => {
    const [optimizations, setOptimizations] = useState<OptimizationSuggestion[]>([]);
    const [isOptimizing, setIsOptimizing] = useState(false);

    // Initial load? No, user triggers it.

    const handleOptimize = async () => {
        setIsOptimizing(true);
        try {
            // Check if we have logs passed in prop, if not try to load from DB? 
            // Better to rely on what's available or fetch fresh if needed.
            // If logs prop is empty, try fetch.
            let logsToAnalyze = logs;
            if (logsToAnalyze.length === 0) {
                logsToAnalyze = await dbService.getAll<ApiLog>('api_logs');
            }

            const suggestionsStr = await AiService.analyzeSystemLogs(logsToAnalyze);
            if (suggestionsStr) {
                setOptimizations(JSON.parse(suggestionsStr));
            }
        } catch (e) {
            log.error(e);
        } finally {
            setIsOptimizing(false);
        }
    };

    return (
        <div className="p-6 h-full overflow-y-auto">
            <div className="max-w-4xl mx-auto">
                <div className="bg-gradient-to-r from-amber-500 to-orange-600 rounded-xl p-6 text-white mb-6">
                    <h3 className="text-2xl font-bold mb-2 flex items-center gap-2"><Zap /> Otimização de Performance</h3>
                    <p className="opacity-90 mb-4">
                        A IA irá analisar seus logs de API recentes para identificar gargalos, chamadas redundantes e oportunidades de cache.
                    </p>
                    <button
                        onClick={handleOptimize}
                        disabled={isOptimizing}
                        className="bg-white text-orange-600 px-6 py-2 rounded-lg font-bold hover:bg-orange-50 transition-colors disabled:opacity-80 flex items-center gap-2"
                    >
                        {isOptimizing ? <Loader2 className="animate-spin" /> : <Zap size={18} />}
                        {isOptimizing ? "Analisando..." : "Iniciar Análise"}
                    </button>
                </div>

                <div className="space-y-4">
                    {optimizations.map((opt, idx) => (
                        <div key={idx} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-xl shadow-sm">
                            <h4 className="font-bold text-slate-800 dark:text-white flex items-center justify-between">
                                {opt.title}
                                <span className={`text-xs px-2 py-1 rounded-full ${opt.impact === 'High' ? 'bg-red-100 text-red-600' : opt.impact === 'Medium' ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'}`}>
                                    {opt.impact} Impact
                                </span>
                            </h4>
                            <p className="text-slate-600 dark:text-slate-300 text-sm mt-1">{opt.description}</p>
                            <div className="mt-3 p-3 bg-slate-50 dark:bg-slate-800 rounded text-xs font-mono text-slate-500">
                                {opt.suggestion}
                            </div>
                        </div>
                    ))}
                    {optimizations.length === 0 && !isOptimizing && (
                        <p className="text-center text-slate-400 py-8">Nenhuma sugestão gerada ainda.</p>
                    )}
                </div>
            </div>
        </div>
    );
};
