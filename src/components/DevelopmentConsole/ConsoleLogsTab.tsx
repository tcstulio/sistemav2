
import React, { useState, useEffect } from 'react';
import { Terminal, RefreshCw, Trash2, AlertTriangle, Sparkles, X } from 'lucide-react';
import { ApiLog } from '../../types';
import { dbService } from '../../services/dbService';

interface ConsoleLogsTabProps {
    onAnalyzeError: (log: ApiLog) => void;
}

export const ConsoleLogsTab: React.FC<ConsoleLogsTabProps> = ({ onAnalyzeError }) => {
    const [logs, setLogs] = useState<ApiLog[]>([]);
    const [selectedLog, setSelectedLog] = useState<ApiLog | null>(null);
    const [isLoadingLogs, setIsLoadingLogs] = useState(false);

    const loadLogs = async () => {
        setIsLoadingLogs(true);
        try {
            const data = await dbService.getAll<ApiLog>('api_logs');
            setLogs(data.sort((a, b) => b.timestamp - a.timestamp));
        } catch (e) {
            console.error("Failed to load logs", e);
        } finally {
            setIsLoadingLogs(false);
        }
    };

    const clearLogs = async () => {
        if (!confirm("Limpar todos os logs?")) return;
        try {
            await dbService.clearAll();
            setLogs([]);
        } catch (e) {
            console.error(e);
        }
    };

    useEffect(() => {
        loadLogs();
    }, []);

    return (
        <div className="h-full overflow-y-auto p-4 md:p-6 bg-slate-50 dark:bg-slate-950/50">
            {/* Toolbar */}
            <div className="flex justify-end gap-2 mb-4">
                <button onClick={loadLogs} className="p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-300 transition-colors" title="Atualizar">
                    <RefreshCw size={16} className={isLoadingLogs ? 'animate-spin' : ''} />
                </button>
                <button onClick={clearLogs} className="p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-red-600 dark:text-red-400 transition-colors" title="Limpar">
                    <Trash2 size={16} />
                </button>
            </div>

            {logs.length === 0 ? (
                <div className="text-center py-20 text-slate-400">
                    <Terminal size={48} className="mx-auto mb-4 opacity-50" />
                    <p>Nenhum log de API encontrado.</p>
                </div>
            ) : (
                <div className="space-y-2 font-mono text-sm">
                    {logs.map(log => (
                        <div key={log.id} className={`bg-white dark:bg-slate-900 border rounded-lg p-3 cursor-pointer hover:shadow-md transition-all ${log.status === 'error' ? 'border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-900/10' : 'border-slate-200 dark:border-slate-800'}`} onClick={() => setSelectedLog(log)}>
                            <div className="flex justify-between items-start mb-1">
                                <div className="flex items-center gap-2">
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${log.request_method === 'GET' ? 'bg-blue-100 text-blue-700' : log.request_method === 'POST' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>{log.request_method || 'GET'}</span>
                                    <span className="font-semibold text-slate-700 dark:text-slate-300">{log.endpoint_or_task}</span>
                                </div>
                                <span className="text-xs text-slate-400">{new Date(log.timestamp).toLocaleTimeString()}</span>
                            </div>
                            <div className="text-xs text-slate-500 truncate mb-1">{log.input_context}</div>
                            {log.status === 'error' && (
                                <div className="flex justify-between items-center mt-2">
                                    <span className="text-red-600 text-xs font-bold flex items-center gap-1"><AlertTriangle size={12} /> Erro Detectado</span>
                                    <button onClick={(e) => { e.stopPropagation(); onAnalyzeError(log); }} className="text-xs bg-indigo-600 text-white px-2 py-1 rounded flex items-center gap-1 hover:bg-indigo-700"><Sparkles size={12} /> Corrigir com IA</button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {selectedLog && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[80vh]">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
                            <h3 className="font-bold text-lg dark:text-white">Detalhes do Log</h3>
                            <button onClick={() => setSelectedLog(null)}><X size={20} /></button>
                        </div>
                        <div className="p-4 overflow-y-auto space-y-4 font-mono text-xs">
                            <div>
                                <label className="block text-slate-500 font-bold mb-1">Requisição</label>
                                <div className="bg-slate-100 dark:bg-slate-800 p-3 rounded overflow-x-auto">
                                    {selectedLog.request_method} {selectedLog.input_context}
                                    {selectedLog.request_body && <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">{selectedLog.request_body}</div>}
                                </div>
                            </div>
                            <div>
                                <label className="block text-slate-500 font-bold mb-1">Resposta</label>
                                <div className="bg-slate-100 dark:bg-slate-800 p-3 rounded overflow-x-auto max-h-64 whitespace-pre-wrap">
                                    {selectedLog.output_data}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
