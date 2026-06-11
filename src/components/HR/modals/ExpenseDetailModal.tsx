import React, { useMemo, useState, useEffect } from 'react';
import { DolibarrConfig, ExpenseReport, DolibarrUser, ExpenseReportLine, ExpenseReportPayment, Project } from '../../../types';
import { sanitizeHtml } from '../../../utils/sanitizeHtml';
import { DolibarrService } from '../../../services/dolibarrService';
import { Receipt, X, Calendar, User, FileText, Download, Send, CheckCircle, Banknote, FileEdit, Building, CreditCard, Box, DollarSign, FolderKanban, Upload, Loader2, Search, ExternalLink } from 'lucide-react';
import { formatDateOnly, formatDateTime } from '../../../utils/dateUtils';
import { formatCurrency } from '../../../utils/formatUtils';
import { getUserName } from '../utils';
import { toast } from 'sonner';
import { logger } from '../../../utils/logger';
import { notifyError } from '../../../utils/notifyError';
import { useConfirm } from '../../../hooks/useConfirm';

const log = logger.child('ExpenseDetailModal');

interface ExpenseDetailModalProps {
    expense: ExpenseReport | null;
    onClose: () => void;
    config: DolibarrConfig;
    users: DolibarrUser[];
    expenseReportLines?: ExpenseReportLine[];
    expenseReportPayments?: ExpenseReportPayment[];
    projects?: Project[];
    onNavigate?: (view: any, id: string) => void;
    variant?: 'center' | 'side' | 'embedded';
}

export const ExpenseDetailModal: React.FC<ExpenseDetailModalProps> = ({
    expense,
    onClose,
    config,
    users,
    expenseReportLines = [],
    expenseReportPayments = [],
    projects = [],
    onNavigate,
    variant = 'center'
}) => {
    const confirm = useConfirm();
    const [activeTab, setActiveTab] = useState<'details' | 'documents'>('details');
    const [documents, setDocuments] = useState<any[]>([]);
    const [isLoadingDocs, setIsLoadingDocs] = useState(false);

    // Load Documents when tab changes
    useEffect(() => {
        if (activeTab === 'documents' && expense) {
            loadDocuments();
        }
    }, [activeTab, expense]);

    const loadDocuments = async () => {
        if (!expense || !config) return;
        setIsLoadingDocs(true);
        try {
            const docs = await DolibarrService.fetchDocuments(config, 'expensereport', expense.id, expense.ref);
            setDocuments(Array.isArray(docs) ? docs : []);
        } catch (e) {
            log.error("Failed to load documents", e);
            toast.error("Erro ao carregar documentos");
        } finally {
            setIsLoadingDocs(false);
        }
    };

    const lines = useMemo(() => {
        if (!expense) return [];
        return expenseReportLines.filter(l => String(l.parent_id) === String(expense.id));
    }, [expense, expenseReportLines]);

    const payments = useMemo(() => {
        if (!expense) return [];
        return expenseReportPayments.filter(p => String(p.fk_expensereport) === String(expense.id));
    }, [expense, expenseReportPayments]);

    if (!expense) return null;

    const getProjectName = (id?: string) => {
        if (!id) return null;
        const project = projects.find(p => String(p.id) === String(id));
        return project ? project.title : null;
    };

    const getExpenseStatusBadge = (status: string) => {
        switch (status) {
            case '0': return <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full font-bold border border-slate-200"><FileEdit size={10} /> Rascunho</span>;
            case '1': return <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full font-bold border border-blue-200"><Send size={10} /> Submetido</span>;
            case '2': return <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full font-bold border border-indigo-200"><CheckCircle size={10} /> Aprovado</span>;
            case '4': return <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full font-bold border border-indigo-200"><CheckCircle size={10} /> Aprovado</span>;
            case '5': return <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full font-bold border border-emerald-200"><Banknote size={10} /> Pago</span>;
            case '6': return <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full font-bold border border-emerald-200"><Banknote size={10} /> Pago (Parcial)</span>;
            case '9': return <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-red-100 text-red-700 rounded-full font-bold border border-red-200"><X size={10} /> Recusado</span>;
            default: return <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-red-100 text-red-700 rounded-full font-bold border border-red-200"><X size={10} /> {status}</span>;
        }
    };

    const handleDownloadPdf = (doc: any) => {
        // Implementation depends on how files are served. Usually requires a specific fetch.
        // For now, if there is a 'download' link or we can construct one using the Service:
        DolibarrService.downloadDocument(config, 'expensereport', `${expense.ref}/${doc.name}`);
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !config) return;
        try {
            await DolibarrService.uploadDocument(config, file, 'expensereport', expense.ref);
            toast.success("Arquivo enviado!");
            loadDocuments();
        } catch (e) {
            log.error("Failed to upload document", e);
            toast.error("Erro ao enviar arquivo");
        }
    };

    // Calculate Paid Amount
    const paidAmount = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

    let containerClasses = "";
    let overlayClasses = "";

    if (variant === 'side') {
        containerClasses = "bg-white dark:bg-slate-900 shadow-2xl w-full max-w-2xl border-l border-slate-200 dark:border-slate-800 animate-in slide-in-from-right duration-300 flex flex-col h-full rounded-l-xl";
        overlayClasses = "fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex justify-end";
    } else if (variant === 'embedded') {
        containerClasses = "bg-white dark:bg-slate-900 w-full flex flex-col h-full border-l border-slate-200 dark:border-slate-800";
        overlayClasses = "contents"; // Render children directly without wrapper
    } else {
        // Center (Default)
        containerClasses = "bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-4xl border border-slate-200 dark:border-slate-800 animate-in zoom-in-95 flex flex-col max-h-[90vh]";
        overlayClasses = "fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4";
    }

    return (
        <div className={overlayClasses}>
            <div className={containerClasses}>

                {/* Header */}
                <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-white dark:bg-slate-900 rounded-t-xl">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
                            <Receipt size={20} />
                        </div>
                        <div>
                            <h3 className="font-bold text-lg dark:text-white flex items-center gap-2">
                                {expense.ref}
                                {getExpenseStatusBadge(expense.statut)}
                            </h3>
                            <a
                                href="#"
                                onClick={(e) => { e.preventDefault(); /* Navigation handled by parent usually, or generic link */ }}
                                className="text-xs text-indigo-500 hover:underline"
                            >
                                Autor: {getUserName(expense.fk_user_author, users)}
                            </a>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {expense.statut === '0' && (
                            <button
                                onClick={async () => {
                                    if (!(await confirm('Confirma/Submete este relatório de despesas?'))) return;
                                    try {
                                        await DolibarrService.approveExpenseReport(config, expense.id);
                                        onClose();
                                    } catch (e) {
                                        log.error("Failed to approve expense report", e);
                                        notifyError('Validar despesa', e);
                                    }
                                }}
                                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-1"
                            >
                                <Send size={14} /> Submeter
                            </button>
                        )}
                        {(expense.statut === '1' || expense.statut === '2' || expense.statut === '4') && (
                            <button
                                onClick={async () => {
                                    if (!(await confirm('Marcar despesa como Paga?'))) return;
                                    try {
                                        await DolibarrService.markExpenseReportAsPaid(config, expense.id);
                                        onClose();
                                    } catch (e) {
                                        log.error("Failed to mark expense as paid", e);
                                        notifyError('Marcar como paga', e);
                                    }
                                }}
                                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-1"
                            >
                                <Banknote size={14} /> Pagar
                            </button>
                        )}
                        <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors"><X size={20} /></button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="border-b border-slate-100 dark:border-slate-800 px-4 bg-slate-50 dark:bg-slate-800/50">
                    <div className="flex gap-4">
                        <button
                            onClick={() => setActiveTab('details')}
                            className={`py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'details' ? `border-indigo-600 text-indigo-600 dark:text-indigo-400` : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}
                        >
                            Detalhes
                        </button>
                        <button
                            onClick={() => setActiveTab('documents')}
                            className={`py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'documents' ? `border-indigo-600 text-indigo-600 dark:text-indigo-400` : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}
                        >
                            Documentos
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950/50">
                    {activeTab === 'details' ? (
                        <div className="max-w-3xl mx-auto space-y-6">

                            {/* Top Summary Card - Matching Supplier Invoice Standard */}
                            <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
                                <div className="flex justify-between items-start mb-6">
                                    <div>
                                        <p className="text-sm text-slate-500 uppercase font-bold mb-1">Valor Total</p>
                                        <p className="text-3xl font-bold text-slate-900 dark:text-white">{formatCurrency(expense.total_ttc)}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm text-slate-500 uppercase font-bold mb-1">Data</p>
                                        <p className="text-lg font-medium text-slate-800 dark:text-white">{formatDateOnly(expense.date_debut)}</p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-slate-100 dark:border-slate-800">
                                    <div>
                                        <p className="text-xs text-slate-500 uppercase font-bold mb-2">Projeto Vinculado</p>
                                        {expense.project_id ? (
                                            <div
                                                className={`flex items-center gap-2 p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700 ${onNavigate ? 'cursor-pointer hover:border-indigo-300 transition-colors' : ''}`}
                                                onClick={() => onNavigate && onNavigate('projects', expense.project_id!)}
                                            >
                                                <FolderKanban size={16} className="text-indigo-500" />
                                                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{getProjectName(expense.project_id)}</span>
                                                {onNavigate && <ExternalLink size={12} className="ml-auto text-slate-400" />}
                                            </div>
                                        ) : (
                                            <p className="text-sm text-slate-400 italic">Nenhum projeto vinculado</p>
                                        )}
                                    </div>

                                    <div>
                                        <p className="text-xs text-slate-500 uppercase font-bold mb-2">Responsáveis</p>
                                        <div className="space-y-3">
                                            <div className="flex justify-between items-center text-sm p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                                                <span className="text-slate-500 dark:text-slate-400 flex items-center gap-2"><User size={14} /> Criado por:</span>
                                                <span className="font-medium text-slate-800 dark:text-white">{getUserName(expense.fk_user_author, users)}</span>
                                            </div>
                                            {expense.fk_user_approve && (
                                                <div className="flex justify-between items-center text-sm p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                                                    <span className="text-slate-500 dark:text-slate-400 flex items-center gap-2"><CheckCircle size={14} /> Aprovado por:</span>
                                                    <span className="font-medium text-slate-800 dark:text-white">{getUserName(expense.fk_user_approve, users)}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            {/* Description if present - Added for Expense Context */}
                            {expense.note_public && (
                                <div className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm">
                                    <h4 className="font-bold text-slate-800 dark:text-white mb-2 text-sm flex items-center gap-2"><FileText size={14} /> Descrição</h4>
                                    <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">{expense.note_public}</p>
                                </div>
                            )}

                            {/* Items Table */}
                            <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
                                <h4 className="font-bold text-slate-800 dark:text-white mb-4">Itens da Despesa</h4>
                                {lines.length === 0 ? (
                                    <div className="text-center py-8 text-slate-400 italic bg-slate-50 dark:bg-slate-800/30 rounded-lg border border-dashed border-slate-200 dark:border-slate-700">
                                        Nenhum item encontrado.
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm text-left">
                                            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 font-medium">
                                                <tr>
                                                    <th className="px-4 py-3 rounded-l-lg">Descrição / Tipo</th>
                                                    <th className="px-4 py-3 text-right">Qtd</th>
                                                    <th className="px-4 py-3 text-right">Preço Un.</th>
                                                    <th className="px-4 py-3 text-right rounded-r-lg">Total</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                                {lines.map((line) => (
                                                    <tr key={line.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                                        <td className="px-4 py-3 max-w-xs">
                                                            <div className="font-medium text-slate-800 dark:text-slate-200">
                                                                {line.type_label}
                                                            </div>
                                                            {line.description && (
                                                                <div
                                                                    className="text-xs text-slate-500 mt-1 font-normal prose prose-sm max-w-none prose-p:my-0 prose-ul:my-0 prose-li:my-0"
                                                                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(line.description) }}
                                                                />
                                                            )}
                                                            <div className="text-xs text-slate-500 mt-1">
                                                                {formatDateOnly(line.date_expense)}
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400 font-mono">
                                                            {Number(line.qty)}
                                                        </td>
                                                        <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400 font-mono">
                                                            {formatCurrency(line.unit_price)}
                                                        </td>
                                                        <td className="px-4 py-3 text-right font-medium text-emerald-600 dark:text-emerald-400 font-mono">
                                                            {formatCurrency(line.total_ttc)}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                            <tfoot className="border-t border-slate-200 dark:border-slate-700">
                                                <tr>
                                                    <td colSpan={3} className="px-4 py-3 text-right font-bold text-slate-700 dark:text-slate-300 uppercase text-xs tracking-wider">Total Geral</td>
                                                    <td className="px-4 py-3 text-right font-bold text-emerald-600 dark:text-emerald-400 font-mono text-base">
                                                        {formatCurrency(expense.total_ttc)}
                                                    </td>
                                                </tr>
                                            </tfoot>
                                        </table>
                                    </div>
                                )}
                            </div>

                            {/* Payments Section */}
                            <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm mt-6">
                                <h4 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                                    <CreditCard size={18} className="text-emerald-500" /> Pagamentos Realizados
                                </h4>

                                {payments.length === 0 ? (
                                    <div className="text-center py-6 text-slate-400 italic bg-slate-50 dark:bg-slate-800/30 rounded-lg border border-dashed border-slate-200 dark:border-slate-700">
                                        Nenhum pagamento registrado.
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {payments.map(payment => (
                                            <div key={payment.id} className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700">
                                                <div className="flex items-center gap-3">
                                                    <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full">
                                                        <Banknote size={14} />
                                                    </div>
                                                    <div>
                                                        <div className="font-medium text-slate-900 dark:text-white text-sm">
                                                            {payment.ref}
                                                        </div>
                                                        <div className="text-xs text-slate-500">{formatDateOnly(payment.date_payment)}</div>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                                                        {formatCurrency(payment.amount)}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                        <div className="flex justify-between items-center pt-4 border-t border-slate-100 dark:border-slate-800">
                                            <div className="text-sm text-slate-500">Saldo a Pagar</div>
                                            <div className={`font-bold ${(expense.total_ttc - paidAmount) > 0.01 ? 'text-orange-500' : 'text-emerald-500'} text-lg`}>
                                                {formatCurrency(Math.max(0, expense.total_ttc - paidAmount))}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                        </div>
                    ) : (
                        <div className="max-w-4xl mx-auto space-y-6">
                            <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
                                <div className="flex justify-between items-center mb-6">
                                    <h3 className="font-bold text-slate-800 dark:text-white">Documentos Anexados</h3>
                                    <div className="relative">
                                        <input
                                            type="file"
                                            id="upload-doc-expense"
                                            className="hidden"
                                            onChange={handleFileUpload}
                                        />
                                        <label
                                            htmlFor="upload-doc-expense"
                                            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium cursor-pointer transition-colors"
                                        >
                                            <Upload size={16} /> Upload
                                        </label>
                                    </div>
                                </div>

                                {isLoadingDocs ? (
                                    <div className="p-8 text-center text-slate-500">
                                        <Loader2 className="animate-spin mx-auto mb-2" />
                                        Carregando documentos...
                                    </div>
                                ) : documents.length === 0 ? (
                                    <div className="text-center py-12 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-dashed border-slate-200 dark:border-slate-700">
                                        <FileText size={48} className="mx-auto mb-4 text-slate-300 dark:text-slate-600" />
                                        <p className="text-slate-500 dark:text-slate-400">Nenhum documento encontrado.</p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {documents.map((doc, idx) => (
                                            <div key={idx} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 group hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors">
                                                <div className="flex items-center gap-3 overflow-hidden">
                                                    <div className="p-2 bg-white dark:bg-slate-800 rounded-lg shadow-sm">
                                                        <FileText size={24} className="text-indigo-500" />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <div className="font-medium text-slate-800 dark:text-white text-sm truncate" title={doc.name}>{doc.name}</div>
                                                        <div className="text-xs text-slate-500">
                                                            {formatDateTime(doc.date)} • {doc.size ? (doc.size / 1024).toFixed(1) + ' KB' : '-'}
                                                        </div>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => handleDownloadPdf(doc)}
                                                    className="p-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                                                    title="Baixar"
                                                >
                                                    <Download size={18} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div >
    );
};


