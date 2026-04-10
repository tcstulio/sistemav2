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
    Filter,
    History,
    Loader2,
    ChevronDown,
    ChevronUp,
    Landmark,
    Send,
    FileText,
    CreditCard,
    Zap
} from 'lucide-react';
import { logger } from '../../utils/logger';

const log = logger.child('ApprovalDashboard');

// ===== Types =====

interface PendingAction {
    id: string;
    type: 'pagar_boleto' | 'enviar_pix' | 'baixar_fatura' | 'enviar_documento';
    banco?: 'inter' | 'itau';
    payload: any;
    description: string;
    riskLevel: 'low' | 'medium' | 'high';
    requestedBy: string;
    requestedAt: string;
    status: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';
    reviewedBy?: string;
    reviewedAt?: string;
    rejectionReason?: string;
    executedAt?: string;
    result?: any;
    error?: string;
}

interface ApprovalStats {
    pending: number;
    approved: number;
    rejected: number;
    executed: number;
    failed: number;
}

// ===== Helper Functions =====

const API_BASE = '/api/approvals';

const getRiskBadgeColor = (risk: string) => {
    switch (risk) {
        case 'high': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
        case 'medium': return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400';
        case 'low': return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
        default: return 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400';
    }
};

const getTypeIcon = (type: string) => {
    switch (type) {
        case 'pagar_boleto': return <CreditCard className="h-5 w-5" />;
        case 'enviar_pix': return <Zap className="h-5 w-5" />;
        case 'baixar_fatura': return <FileText className="h-5 w-5" />;
        case 'enviar_documento': return <Send className="h-5 w-5" />;
        default: return <FileText className="h-5 w-5" />;
    }
};

const getTypeName = (type: string) => {
    switch (type) {
        case 'pagar_boleto': return 'Pagamento de Boleto';
        case 'enviar_pix': return 'Enviar PIX';
        case 'baixar_fatura': return 'Baixar Fatura';
        case 'enviar_documento': return 'Enviar Documento';
        default: return type;
    }
};

const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('pt-BR');
};

const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
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
    const [rejectReason, setRejectReason] = useState('');

    // Fetch data
    const fetchData = useCallback(async () => {
        try {
            const [pendingRes, historyRes, statsRes] = await Promise.all([
                fetch(`${API_BASE}/pending`),
                fetch(`${API_BASE}/history?limit=50`),
                fetch(`${API_BASE}/stats`),
            ]);

            if (pendingRes.ok) {
                const data = await pendingRes.json();
                setPendingActions(data.actions || []);
            }

            if (historyRes.ok) {
                const data = await historyRes.json();
                setHistoryActions(data.history || []);
            }

            if (statsRes.ok) {
                const data = await statsRes.json();
                setStats(data.stats);
            }
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

    // Approve action
    const handleApprove = async (actionId: string) => {
        setActionLoading(actionId);
        try {
            const res = await fetch(`${API_BASE}/${actionId}/approve`, { method: 'POST' });
            const data = await res.json();

            if (data.success) {
                fetchData();
            } else {
                toast.error(`Erro: ${data.error}`);
            }
        } catch (error: any) {
            toast.error(`Erro: ${error.message}`);
        } finally {
            setActionLoading(null);
        }
    };

    // Reject action
    const handleReject = async (actionId: string) => {
        setActionLoading(actionId);
        try {
            const res = await fetch(`${API_BASE}/${actionId}/reject`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: rejectReason }),
            });
            const data = await res.json();

            if (data.success) {
                setRejectReason('');
                setExpandedAction(null);
                fetchData();
            } else {
                toast.error(`Erro: ${data.error}`);
            }
        } catch (error: any) {
            toast.error(`Erro: ${error.message}`);
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
                            {getTypeIcon(action.type)}
                        </div>
                        <div>
                            <p className="font-medium text-slate-800 dark:text-white">{action.description}</p>
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                {getTypeName(action.type)} • {formatDate(action.requestedAt)}
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
                        <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
                            <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Detalhes:</p>
                            <pre className="text-xs text-slate-700 dark:text-slate-300 overflow-x-auto">
                                {JSON.stringify(action.payload, null, 2)}
                            </pre>
                        </div>

                        <div className="mt-3 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                            <Clock className="h-4 w-4" />
                            <span>Solicitado por: {action.requestedBy}</span>
                        </div>

                        {/* Actions (only for pending) */}
                        {isPending && (
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
                                </div>

                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={rejectReason}
                                        onChange={(e) => setRejectReason(e.target.value)}
                                        placeholder="Motivo da rejeição (opcional)"
                                        className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-sm"
                                    />
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
