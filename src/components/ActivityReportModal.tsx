import React, { useState, useEffect } from 'react';
import { X, Sparkles, Download, Copy, RefreshCw, FileText } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { SystemLog } from '../types';
import { useDolibarr } from '../context/DolibarrContext';
import { useProjects, useInvoices, useTickets, useProposals } from '../hooks/dolibarr';
import { AiService } from '../services/aiService';

interface ActivityReportModalProps {
    isOpen: boolean;
    onClose: () => void;
    logs: SystemLog[];
    dateRange: { start: string; end: string };
    userName?: string;
}

const ActivityReportModal: React.FC<ActivityReportModalProps> = ({ isOpen, onClose, logs, dateRange, userName }) => {
    const { config } = useDolibarr();

    // Context Data
    const { data: projects = [] } = useProjects(config, !!config && isOpen);
    const { data: invoices = [] } = useInvoices(config, !!config && isOpen);
    const { data: tickets = [] } = useTickets(config, !!config && isOpen);
    const { data: proposals = [] } = useProposals(config, !!config && isOpen);

    // State
    const [report, setReport] = useState<string>('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [progressStep, setProgressStep] = useState<string>('');

    // Generate Report Logic
    const generateReport = async () => {
        if (!config || logs.length === 0) return;

        setIsGenerating(true);
        setReport('');

        try {
            // 1. Prepare Data
            setProgressStep('Analisando atividades...');

            // Limit logs to avoid token limits (e.g., last 100 or most relevant)
            // For a report, maybe we take a sample or summarize locally first? 
            // Let's take up to 100 logs.
            const processLogs = logs.slice(0, 100);

            let context = `Contexto do Relatório:\n`;
            context += `Período: ${dateRange.start || 'Início'} até ${dateRange.end || 'Agora'}\n`;
            context += `Usuário Principal: ${userName || 'Todos'}\n`;
            context += `Total de Atividades Filtradas: ${logs.length}\n\n`;
            context += `Detalhes das Atividades (Amostra de ${processLogs.length}):\n`;

            // 2. Enrich Logs with Entity Data
            setProgressStep('Buscando detalhes de projetos e faturas...');

            processLogs.forEach(log => {
                const date = new Date(log.date_action).toLocaleString('pt-BR');
                let details = '';

                // Enrich based on element type
                if (log.elementtype === 'project' && log.fk_element) {
                    const prj = projects.find(p => p.id === String(log.fk_element));
                    if (prj) details = `[Projeto: ${prj.title}, Status: ${(prj as any).statut_label || prj.statut}]`;
                } else if (log.elementtype === 'facture' && log.fk_element) {
                    const inv = invoices.find(i => i.id === String(log.fk_element));
                    if (inv) details = `[Fatura: ${inv.ref}, Valor: ${inv.total_ttc}, Status: ${inv.statut}]`;
                } else if (log.elementtype === 'ticket' && log.fk_element) {
                    const tkt = tickets.find(t => t.id === String(log.fk_element));
                    if (tkt) details = `[Ticket: ${tkt.ref}, Assunto: ${tkt.subject}]`;
                }

                context += `- [${date}] ${log.label || 'Ação desconhecida'} (${log.type_code}) ${details}\n`;
            });

            // 3. Call AI
            setProgressStep('Gerando análise com IA...');
            const result = await AiService.generateActivityReport(context);

            if (result) {
                setReport(result);
            } else {
                setReport('Não foi possível gerar o relatório. Tente novamente.');
            }

        } catch (error) {
            console.error(error);
            setReport('Erro ao processar solicitação.');
        } finally {
            setIsGenerating(false);
            setProgressStep('');
        }
    };

    // Auto-generate on open if empty
    useEffect(() => {
        if (isOpen && !report && !isGenerating && logs.length > 0) {
            generateReport();
        }
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col animate-in zoom-in-95 border border-slate-200 dark:border-slate-800">

                {/* Header */}
                <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 rounded-t-xl">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg">
                            <Sparkles size={20} className="text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <div>
                            <h3 className="font-bold text-lg text-slate-800 dark:text-white">Relatório de Atividades IA</h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                {userName ? `Análise de ${userName}` : 'Análise Geral'} • {logs.length} atividades selecionadas
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors text-slate-500">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 md:p-8 bg-slate-50/30 dark:bg-slate-950/30">
                    {isGenerating ? (
                        <div className="flex flex-col items-center justify-center h-full space-y-4">
                            <div className="relative">
                                <div className="w-16 h-16 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
                                <Sparkles className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-indigo-600 animate-pulse" size={24} />
                            </div>
                            <p className="text-slate-600 dark:text-slate-300 font-medium animate-pulse">{progressStep}</p>
                            <p className="text-xs text-slate-400">Isso pode levar alguns segundos...</p>
                        </div>
                    ) : (
                        <div className="prose prose-slate dark:prose-invert max-w-none">
                            <ReactMarkdown>{report}</ReactMarkdown>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-b-xl flex justify-between items-center">
                    <button
                        onClick={generateReport}
                        disabled={isGenerating}
                        className="flex items-center gap-2 px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg font-medium transition-colors"
                    >
                        <RefreshCw size={16} className={isGenerating ? 'animate-spin' : ''} /> Regenerar
                    </button>

                    <div className="flex gap-2">
                        <button
                            onClick={() => navigator.clipboard.writeText(report)}
                            className="flex items-center gap-2 px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg font-medium transition-colors"
                        >
                            <Copy size={16} /> Copiar
                        </button>
                        <button
                            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium shadow-sm transition-colors"
                            onClick={() => {
                                alert("Exportação para PDF será implementada em breve.");
                            }}
                        >
                            <Download size={16} /> Exportar PDF
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ActivityReportModal;
