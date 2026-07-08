/**
 * Approval Dashboard
 * 
 * Dashboard para gestores aprovarem automações bancárias pendentes
 */

import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import {
    CheckCircle,
    XCircle,
    Clock,
    AlertTriangle,
    RefreshCcw,
    History,
    Loader2,
    ChevronDown,
    ChevronUp,
    Landmark,
    Send,
    FileText,
    CreditCard,
    Zap,
    ShieldAlert
} from 'lucide-react';
import { logger } from '../../utils/logger';
import { useDolibarr } from '../../context/DolibarrContext';
import {
    getPendingActions,
    getActionHistory,
    getApprovalStats,
    approveAction,
    rejectAction,
    type PendingAction,
    type ApprovalStats,
} from '../../services/approvalService';

const log = logger.child('ApprovalDashboard');

// ===== Types (API vem de approvalService.ts) =====

// ===== Helper Functions =====

const getRiskBadgeColor = (risk: string) => {
    switch (risk) {
        case 'high': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
        case 'medium': return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400';
        case 'low': return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
        default: return 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400';
    }
};

const KNOWN_BANKING_TYPES = new Set<string>([
    'pagar_boleto',
    'enviar_pix',
    'baixar_fatura',
    'enviar_documento',
]);

const TYPE_META: Record<string, { label: string; icon: React.ReactNode }> = {
    pagar_boleto: { label: 'Pagamento de Boleto', icon: <CreditCard className="h-5 w-5" /> },
    enviar_pix: { label: 'Enviar PIX', icon: <Zap className="h-5 w-5" /> },
    baixar_fatura: { label: 'Baixar Fatura', icon: <FileText className="h-5 w-5" /> },
    enviar_documento: { label: 'Enviar Documento', icon: <Send className="h-5 w-5" /> },
};

const humanizeType = (type: string): string => {
    const cleaned = type.replace(/[_-]+/g, ' ').trim();
    if (!cleaned) return type;
    return cleaned
        .split(' ')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
};

const getTypeMeta = (type: string): { label: string; icon: React.ReactNode } => {
    const known = TYPE_META[type];
    if (known) return known;
    return { label: humanizeType(type), icon: <ShieldAlert className="h-5 w-5" /> };
};

const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('pt-BR');
};

const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
};

interface SemanticFieldDef {
    keys: string[];
    label: string;
    currency?: boolean;
}

const SEMANTIC_PAYLOAD_FIELDS: SemanticFieldDef[] = [
    { keys: ['description', 'descricao', 'desc', 'title', 'titulo'], label: 'Descrição' },
    { keys: ['value', 'valor', 'amount', 'preco', 'price'], label: 'Valor', currency: true },
    { keys: ['beneficiary', 'beneficiario', 'payee'], label: 'Beneficiário' },
    { keys: ['recipient', 'destinatario'], label: 'Destinatário' },
    { keys: ['tool', 'ferramenta'], label: 'Ferramenta' },
    { keys: ['target', 'alvo'], label: 'Alvo' },
    { keys: ['document', 'documento', 'cpf', 'cnpj', 'cpfcnpj'], label: 'Documento' },
    { keys: ['name', 'nome'], label: 'Nome' },
    { keys: ['reason', 'motivo', 'note', 'notes', 'observacao', 'observacoes'], label: 'Motivo' },
    { keys: ['status'], label: 'Status' },
];

const payloadValueToText = (raw: unknown): string => {
    if (typeof raw === 'string') return raw;
    if (typeof raw === 'boolean') return raw ? 'Sim' : 'Não';
    if (typeof raw === 'number') return String(raw);
    if (raw === null || raw === undefined) return '';
    try {
        return JSON.stringify(raw);
    } catch {
        return String(raw);
    }
};

const renderSemanticPayloadFields = (payload: unknown): React.ReactNode => {
    if (typeof payload !== 'object' || payload === null) {
        return null;
    }
    const obj = payload as Record<string, unknown>;
    const nodes: React.ReactNode[] = [];
    for (const field of SEMANTIC_PAYLOAD_FIELDS) {
        let raw: unknown;
        let matched = false;
        for (const key of field.keys) {
            const val = obj[key];
            if (val !== undefined && val !== null) {
                raw = val;
                matched = true;
                break;
            }
        }
        if (!matched) continue;
        const text =
            field.currency && typeof raw === 'number' && Number.isFinite(raw)
                ? formatCurrency(raw)
                : payloadValueToText(raw);
        if (!text) continue;
        nodes.push(
            <div key={field.keys[0]} className="flex items-start gap-2 text-sm">
                <span className="font-medium text-slate-600 dark:text-slate-400">{field.label}:</span>
                <span className="text-slate-700 dark:text-slate-300 break-all">{text}</span>
            </div>
        );
    }
    return nodes;
};

// ===== Component =====

export function ApprovalDashboard() {
    const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
    const [historyActions, setHistoryActions] = useState<PendingAction[]>([]);
    const [stats, setStats] = useState<ApprovalStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');
    const [expandedAction, setExpandedAction] = useState<string | null>(null);

    // Admin detection — aprovar/recusar é admin-only no backend (requireDolibarrAdmin).
    // admin pode chegar como número 1, string "1" ou boolean (mesmo guard do Dashboard).
    const { config, previewTarget } = useDolibarr();
    const currentUser = config?.currentUser;
    const isAdmin = !previewTarget && (
        currentUser?.admin === 1 ||
        currentUser?.admin === '1' ||
        (currentUser?.admin as unknown) === true
    );

    // Fetch data
    const fetchData = useCallback(async () => {
        try {
            const [pending, history, st] = await Promise.all([
                getPendingActions(),
                getActionHistory(50),
                getApprovalStats(),
            ]);

            setPendingActions(pending);
            setHistoryActions(history);
            if (st) setStats(st);
        } catch (error) {
            log.error('Erro ao carregar dados:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
        // Refresh a cada 30 segundos
        const interval = setInterval(fetchData, 30000);
        return () => clearInterval(interval);
    }, [fetchData]);

    // Approve action (admin-only no backend)
    const handleApprove = async (actionId: string) => {
        setActionLoading(actionId);
        try {
            const result = await approveAction(actionId);
            if (result.success) {
                toast.success('Ação aprovada e executada com sucesso');
                fetchData();
            } else if (result.status === 401 || result.status === 403) {
                toast.error('Você não tem permissão para aprovar esta ação.');
            } else {
                // Erro de regra de negócio/execução retornado pela API (approvalService.ts:262):
                // o backend EXECUTA e pode falhar — exibimos a mensagem, sem engolir.
                toast.error(result.error ? `Erro: ${result.error}` : 'Erro ao aprovar ação.');
            }
        } catch (error) {
            toast.error(`Erro: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setActionLoading(null);
        }
    };

    // Reject action — prompt pelo motivo (admin-only no backend)
    const handleReject = async (actionId: string) => {
        const reason = window.prompt('Motivo da rejeição:');
        if (reason === null) return; // usuário cancelou
        setActionLoading(actionId);
        try {
            const result = await rejectAction(actionId, reason);
            if (result.success) {
                toast.success('Ação rejeitada');
                fetchData();
            } else if (result.status === 401 || result.status === 403) {
                toast.error('Você não tem permissão para rejeitar esta ação.');
            } else {
                toast.error(result.error ? `Erro: ${result.error}` : 'Erro ao rejeitar ação.');
            }
        } catch (error) {
            toast.error(`Erro: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setActionLoading(null);
        }
    };

    // Render action card
    const renderActionCard = (action: PendingAction, isPending: boolean) => {
        const isExpanded = expandedAction === action.id;
        const isLoading = actionLoading === action.id;

        return (
            <div
                key={action.id}
                className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden"
            >
                {/* Header */}
                <div
                    className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50"
                    onClick={() => setExpandedAction(isExpanded ? null : action.id)}
                >
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${action.banco === 'inter' ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400' :
                                action.banco === 'itau' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' :
                                    'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                            }`}>
                            {getTypeMeta(action.type).icon}
                        </div>
                        <div>
                            <p className="font-medium text-slate-800 dark:text-white">{action.description}</p>
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                {getTypeMeta(action.type).label} • {formatDate(action.requestedAt)}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getRiskBadgeColor(action.riskLevel)}`}>
                            {action.riskLevel === 'high' ? 'Alto Risco' : action.riskLevel === 'medium' ? 'Médio' : 'Baixo'}
                        </span>
                        {isExpanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                    </div>
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                    <div className="px-4 pb-4 border-t border-slate-200 dark:border-slate-700">
                        {/* Payload Details */}
                        {KNOWN_BANKING_TYPES.has(action.type) ? (
                            <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
                                <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Detalhes:</p>
                                <pre className="text-xs text-slate-700 dark:text-slate-300 overflow-x-auto">
                                    {JSON.stringify(action.payload, null, 2)}
                                </pre>
                            </div>
                        ) : (
                            <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
                                {renderSemanticPayloadFields(action.payload)}
                                <details className="mt-2">
                                    <summary className="text-sm font-medium text-slate-600 dark:text-slate-400 cursor-pointer select-none">
                                        Detalhes técnicos
                                    </summary>
                                    <pre className="mt-2 text-xs text-slate-700 dark:text-slate-300 overflow-x-auto">
                                        {JSON.stringify(action.payload, null, 2)}
                                    </pre>
                                </details>
                            </div>
                        )}

                        <div className="mt-3 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                            <Clock className="h-4 w-4" />
                            <span>Solicitado por: {action.requestedBy}</span>
                        </div>

                        {/* Actions (only for pending AND admin — backend é requireDolibarrAdmin) */}
                        {isPending && isAdmin && (
                            <div className="mt-4 space-y-3">
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleApprove(action.id)}
                                        disabled={isLoading}
                                        className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                                    >
                                        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                                        Aprovar e Executar
                                    </button>
                                    <button
                                        onClick={() => handleReject(action.id)}
                                        disabled={isLoading}
                                        className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                                    >
                                        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                                        Rejeitar
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Status for history */}
                        {!isPending && (
                            <div className="mt-4 flex items-center gap-2">
                                {action.status === 'executed' && (
                                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-full text-sm">
                                        <CheckCircle className="h-4 w-4" /> Executado
                                    </span>
                                )}
                                {action.status === 'rejected' && (
                                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded-full text-sm">
                                        <XCircle className="h-4 w-4" /> Rejeitado
                                    </span>
                                )}
                                {action.status === 'failed' && (
                                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 rounded-full text-sm">
                                        <AlertTriangle className="h-4 w-4" /> Falhou
                                    </span>
                                )}
                                {action.reviewedBy && (
                                    <span className="text-sm text-slate-500 dark:text-slate-400">
                                        por {action.reviewedBy} em {formatDate(action.reviewedAt!)}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            </div>
        );
    }

    return (
        <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-500/10 rounded-lg">
                        <Landmark className="h-6 w-6 text-blue-600" />
                    </div>
                    <div>
                        <h2 className="text-xl font-semibold text-slate-800 dark:text-white">
                            Aprovações Pendentes
                        </h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                            Revise e aprove automações bancárias
                        </p>
                    </div>
                </div>
                <button
                    onClick={fetchData}
                    className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                    <RefreshCcw className="h-4 w-4" />
                    Atualizar
                </button>
            </div>

            {/* Stats */}
            {stats && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                    <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-xl p-4">
                        <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400">
                            <Clock className="h-5 w-5" />
                            <span className="text-2xl font-bold">{stats.pending}</span>
                        </div>
                        <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">Pendentes</p>
                    </div>
                    <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4">
                        <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                            <CheckCircle className="h-5 w-5" />
                            <span className="text-2xl font-bold">{stats.executed}</span>
                        </div>
                        <p className="text-sm text-green-700 dark:text-green-300 mt-1">Executadas</p>
                    </div>
                    <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-4">
                        <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                            <XCircle className="h-5 w-5" />
                            <span className="text-2xl font-bold">{stats.rejected}</span>
                        </div>
                        <p className="text-sm text-red-700 dark:text-red-300 mt-1">Rejeitadas</p>
                    </div>
                    <div className="bg-orange-50 dark:bg-orange-900/20 rounded-xl p-4">
                        <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
                            <AlertTriangle className="h-5 w-5" />
                            <span className="text-2xl font-bold">{stats.failed}</span>
                        </div>
                        <p className="text-sm text-orange-700 dark:text-orange-300 mt-1">Falharam</p>
                    </div>
                    <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4">
                        <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                            <History className="h-5 w-5" />
                            <span className="text-2xl font-bold">{stats.approved + stats.rejected + stats.executed + stats.failed}</span>
                        </div>
                        <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">Total</p>
                    </div>
                </div>
            )}

            {/* Tabs */}
            <div className="flex gap-2 border-b border-slate-200 dark:border-slate-700">
                <button
                    onClick={() => setActiveTab('pending')}
                    className={`px-4 py-2 font-medium border-b-2 transition-colors ${activeTab === 'pending'
                            ? 'text-blue-600 border-blue-600'
                            : 'text-slate-500 border-transparent hover:text-slate-700'
                        }`}
                >
                    Pendentes ({pendingActions.length})
                </button>
                <button
                    onClick={() => setActiveTab('history')}
                    className={`px-4 py-2 font-medium border-b-2 transition-colors ${activeTab === 'history'
                            ? 'text-blue-600 border-blue-600'
                            : 'text-slate-500 border-transparent hover:text-slate-700'
                        }`}
                >
                    Histórico
                </button>
            </div>

            {/* Content */}
            <div className="space-y-4">
                {activeTab === 'pending' && (
                    <>
                        {pendingActions.length === 0 ? (
                            <div className="text-center py-12 text-slate-500 dark:text-slate-400">
                                <CheckCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
                                <p>Nenhuma ação pendente de aprovação</p>
                            </div>
                        ) : (
                            pendingActions.map(action => renderActionCard(action, true))
                        )}
                    </>
                )}

                {activeTab === 'history' && (
                    <>
                        {historyActions.length === 0 ? (
                            <div className="text-center py-12 text-slate-500 dark:text-slate-400">
                                <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
                                <p>Nenhum histórico de aprovações</p>
                            </div>
                        ) : (
                            historyActions.map(action => renderActionCard(action, false))
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

export default ApprovalDashboard;
