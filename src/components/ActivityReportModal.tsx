import React, { useState, useEffect } from 'react';
import { Sparkles, Download, Copy, RefreshCw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { SystemLog } from '../types';
import { useDolibarr } from '../context/DolibarrContext';
import { useProjects, useInvoices, useTickets, useProposals } from '../hooks/dolibarr';
import { AiService } from '../services/aiService';
import { logger } from '../utils/logger';
import { Modal, Button } from './ui';

const log = logger.child('ActivityReportModal');

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
    // const { data: proposals = [] } = useProposals(config, !!config && isOpen);

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
            log.error(error);
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

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={
                <span className="flex items-center gap-2">
                    <Sparkles size={20} className="text-indigo-600" /> Relatório de Atividades IA
                </span>
            }
            size="xl"
            footer={
                <div className="flex justify-between w-full">
                    <Button
                        variant="ghost"
                        onClick={generateReport}
                        disabled={isGenerating}
                        icon={<RefreshCw size={16} className={isGenerating ? 'animate-spin' : ''} />}
                    >
                        Regenerar
                    </Button>

                    <div className="flex gap-2">
                        <Button
                            variant="secondary"
                            onClick={() => navigator.clipboard.writeText(report)}
                            icon={<Copy size={16} />}
                        >
                            Copiar
                        </Button>
                        <Button
                            onClick={() => alert("Exportação para PDF será implementada em breve.")}
                            icon={<Download size={16} />}
                        >
                            Exportar PDF
                        </Button>
                    </div>
                </div>
            }
        >
            <div className="min-h-[400px] flex flex-col">
                <div className="text-sm text-slate-500 mb-4 pb-2 border-b border-slate-100 dark:border-slate-800">
                    {userName ? `Análise de ${userName}` : 'Análise Geral'} • {logs.length} atividades selecionadas
                </div>

                {isGenerating ? (
                    <div className="flex flex-col items-center justify-center flex-1 space-y-4 py-20">
                        <div className="relative">
                            <div className="w-16 h-16 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
                            <Sparkles className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-indigo-600 animate-pulse" size={24} />
                        </div>
                        <p className="text-slate-600 dark:text-slate-300 font-medium animate-pulse">{progressStep}</p>
                        <p className="text-xs text-slate-400">Isso pode levar alguns segundos...</p>
                    </div>
                ) : (
                    <div className="prose prose-slate dark:prose-invert max-w-none flex-1 overflow-y-auto max-h-[60vh] custom-scrollbar">
                        <ReactMarkdown>{report}</ReactMarkdown>
                    </div>
                )}
            </div>
        </Modal>
    );
};

export default ActivityReportModal;
