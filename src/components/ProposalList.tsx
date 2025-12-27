
import React, { useState, useMemo } from 'react';
import { Proposal, ThirdParty, DolibarrConfig, AppView, Product, Project } from '../types';
import { FileText, Search, ExternalLink, PenTool, CheckCircle, XCircle, Send, Archive, Kanban, List, ShoppingCart, Download, Loader2, FileSignature, Scale, AlertTriangle, ShieldCheck, X, Plus, Trash2, FolderKanban, Ban, Check } from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { AiService } from '../services/aiService';
import { LinkedObjects } from './common/LinkedObjects';
import { useDolibarr } from '../context/DolibarrContext';
import { useDolibarrLink } from '../hooks/useDolibarrLink';
import { useProposals, useCustomers, useProducts, useProjects, useProposalLines, useUsers } from '../hooks/dolibarr';

interface ProposalListProps {
    onNavigate?: (view: AppView, id: string) => void;
    onRefresh?: () => void;
    initialItemId?: string;
}

const ProposalList: React.FC<ProposalListProps> = ({ onNavigate, onRefresh, initialItemId }) => {
    const { config } = useDolibarr();
    const { data: proposalsData } = useProposals(config);
    const proposals = proposalsData || [];
    const { data: customersData } = useCustomers(config);
    const customers = customersData || [];
    const { data: productsData } = useProducts(config);
    const products = productsData || [];
    const { data: projectsData } = useProjects(config);
    const projects = projectsData || [];
    const { data: proposalLinesData } = useProposalLines(config);
    const proposalLines = proposalLinesData || [];
    const { data: users = [] } = useUsers(config);

    if (!config) return <div className="p-8 text-center">Carregando configuração...</div>;

    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'signed' | 'draft' | 'declined'>('all');
    const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [auditResult, setAuditResult] = useState<{ id: string, result: any } | null>(null);
    const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
    const [showDebug, setShowDebug] = useState(false);

    // Deep Link Effect
    React.useEffect(() => {
        if (initialItemId && proposals.length > 0) {
            const match = proposals.find(p => String(p.id) === String(initialItemId));
            if (match) {
                setSelectedProposal(match);
            }
        }
    }, [initialItemId, proposals]);

    // Creation State
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [newProposal, setNewProposal] = useState({
        socid: '',
        date: new Date().toISOString().split('T')[0],
        items: [] as { productId: string, desc: string, qty: number, price: number }[]
    });

    const getCustomerName = (socid: string) => {
        const customer = customers.find(c => String(c.id) === String(socid));
        return customer ? customer.name : (socid ? `Desconhecido (${socid})` : 'Desconhecido');
    };

    const getUserName = (id?: string) => {
        if (!id) return '-';
        const u = users.find(user => String(user.id) === String(id));
        return u ? (u.firstname ? `${u.firstname} ${u.lastname}` : u.login) : `User ${id}`;
    };

    const getProjectName = (projId?: string) => {
        if (!projId) return null;
        const p = projects.find(prj => String(prj.id) === String(projId));
        return p ? p.title : null;
    };

    const filteredProposals = useMemo(() => {
        return proposals.filter(p => {
            const customerName = getCustomerName(p.socid).toLowerCase();
            const matchesSearch =
                p.ref.toLowerCase().includes(searchTerm.toLowerCase()) ||
                customerName.includes(searchTerm.toLowerCase());

            if (viewMode === 'kanban') return matchesSearch;

            if (filterStatus === 'open') return matchesSearch && p.statut === '1';
            if (filterStatus === 'signed') return matchesSearch && (p.statut === '2' || p.statut === '4');
            if (filterStatus === 'draft') return matchesSearch && p.statut === '0';
            if (filterStatus === 'declined') return matchesSearch && p.statut === '3';

            return matchesSearch;
        });
    }, [proposals, customers, searchTerm, filterStatus, viewMode]);

    const getStatusBadge = (status: string) => {
        switch (status) {
            case '0':
                return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700"><PenTool size={12} /> Rascunho</span>;
            case '1':
                return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800"><Send size={12} /> Aberta</span>;
            case '2':
                return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"><CheckCircle size={12} /> Assinada</span>;
            case '3':
                return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800"><XCircle size={12} /> Recusada</span>;
            case '4':
                return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"><Archive size={12} /> Faturada</span>;
            default:
                return null;
        }
    };

    const { openLink } = useDolibarrLink(config);

    const openInDolibarr = (id: string) => {
        openLink('proposal', id);
    };

    const handleAudit = async (e: React.MouseEvent, prop: Proposal) => {
        e.stopPropagation();
        setProcessingId(prop.id);
        try {
            const resultStr = await AiService.auditProposal(`Ref: ${prop.ref}. Total: ${prop.total_ttc}`);
            if (resultStr) {
                setAuditResult({ id: prop.id, result: JSON.parse(resultStr) });
            }
        } catch (err) { console.error(err); } finally { setProcessingId(null); }
    };

    const handleDownloadPdf = (e: React.MouseEvent, ref: string) => {
        e.stopPropagation();
        DolibarrService.downloadDocument(config, 'proposal', ref);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setTimeout(() => { setIsSubmitting(false); setIsCreateModalOpen(false); alert("Criado!"); if (onRefresh) onRefresh(); }, 1000);
    };

    const handleCloseProposal = async (status: '2' | '3') => {
        if (!selectedProposal) return;
        setProcessingId(selectedProposal.id);
        try {
            await DolibarrService.closeProposal(config, selectedProposal.id, parseInt(status) as 2 | 3);
            alert(status === '2' ? "Proposta Assinada!" : "Proposta Recusada.");
            setSelectedProposal(null);
            if (onRefresh) onRefresh();
        } catch (e) {
            console.error(e);
            alert("Ação falhou. Verifique permissões da API.");
        } finally {
            setProcessingId(null);
        }
    };

    const handleCreateOrder = async () => {
        if (!selectedProposal) return;
        setProcessingId(selectedProposal.id);
        try {
            await DolibarrService.createOrderFromProposal(config, selectedProposal.id);
            alert("Pedido de Venda Criado!");
            setSelectedProposal(null);
            if (onNavigate) onNavigate('orders', ''); // Navigate to orders list
        } catch (e) {
            console.error(e);
            alert("Falha ao criar pedido.");
        } finally {
            setProcessingId(null);
        }
    };

    // Kanban Columns
    const kanbanColumns = [
        { id: '0', title: 'Rascunho', color: 'slate' },
        { id: '1', title: 'Aberto', color: 'blue' },
        { id: '2', title: 'Assinado', color: 'emerald' },
        { id: '3', title: 'Recusado', color: 'red' },
    ];

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 transition-colors relative">

            {/* Detail Modal Overlay */}
            {selectedProposal && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-3xl border border-slate-200 dark:border-slate-800 animate-in zoom-in-95 flex flex-col max-h-[90vh]">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 rounded-t-xl">
                            <div className="flex items-center gap-3">
                                <h3 className="font-bold text-lg dark:text-white">{selectedProposal.ref}</h3>
                                {getStatusBadge(selectedProposal.statut)}
                            </div>
                            <button onClick={() => setSelectedProposal(null)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"><X size={20} /></button>
                        </div>

                        <div className="p-6 overflow-y-auto space-y-6">
                            {/* Action Bar for Open Proposals */}
                            {selectedProposal.statut === '1' && (
                                <div className="flex items-center justify-between p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-900/30">
                                    <span className="text-sm font-medium text-blue-800 dark:text-blue-300">Ação de Resposta do Cliente:</span>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handleCloseProposal('3')}
                                            disabled={!!processingId}
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 text-red-600 border border-red-200 dark:border-red-900 rounded-md text-sm font-medium hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50"
                                        >
                                            {processingId === selectedProposal.id ? <Loader2 size={16} className="animate-spin" /> : <Ban size={16} />} Recusar
                                        </button>
                                        <button
                                            onClick={() => handleCloseProposal('2')}
                                            disabled={!!processingId}
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-md text-sm font-medium hover:bg-emerald-700 shadow-sm disabled:opacity-50"
                                        >
                                            {processingId === selectedProposal.id ? <Loader2 size={16} className="animate-spin" /> : <FileSignature size={16} />} Assinar / Aceitar
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Create Order Button for Signed Proposals */}
                            {selectedProposal.statut === '2' && (
                                <div className="flex items-center justify-between p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-100 dark:border-emerald-900/30">
                                    <div className="flex items-center gap-2">
                                        <CheckCircle size={18} className="text-emerald-600 dark:text-emerald-400" />
                                        <span className="text-sm font-medium text-emerald-800 dark:text-emerald-300">Proposta Assinada. Pronta para processamento.</span>
                                    </div>
                                    <button
                                        onClick={handleCreateOrder}
                                        disabled={!!processingId}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 shadow-sm disabled:opacity-50"
                                    >
                                        {processingId === selectedProposal.id ? <Loader2 size={16} className="animate-spin" /> : <ShoppingCart size={16} />} Criar Pedido
                                    </button>
                                </div>
                            )}

                            {/* Header Info */}
                            <div className="flex flex-col items-end mb-2">
                                <button
                                    onClick={() => setShowDebug(!showDebug)}
                                    className="text-xs text-red-500 underline"
                                >
                                    [DEBUG: {showDebug ? 'Ocultar' : 'Ver'} Dados Raw]
                                </button>
                                {showDebug && (
                                    <textarea
                                        readOnly
                                        className="w-full h-48 text-xs font-mono p-2 border border-red-200 bg-red-50 mt-2 rounded"
                                        value={JSON.stringify(selectedProposal, null, 2)}
                                    />
                                )}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg">
                                    <span className="text-xs text-slate-500 uppercase font-bold">Cliente</span>
                                    <div className="font-medium text-slate-800 dark:text-white mt-1">{getCustomerName(selectedProposal.socid)}</div>
                                </div>
                                <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg">
                                    <span className="text-xs text-slate-500 uppercase font-bold">Contexto do Projeto</span>
                                    <div className="font-medium text-slate-800 dark:text-white mt-1 flex items-center gap-2">
                                        {selectedProposal.project_id ? (
                                            <>
                                                <FolderKanban size={16} className="text-indigo-500" />
                                                <span
                                                    className="cursor-pointer hover:underline text-indigo-600 dark:text-indigo-400"
                                                    onClick={() => { setSelectedProposal(null); onNavigate && onNavigate('projects', selectedProposal.project_id!); }}
                                                >
                                                    {getProjectName(selectedProposal.project_id) || 'Ver Projeto'}
                                                </span>
                                            </>
                                        ) : (
                                            <span className="text-slate-400 italic">Não vinculado a projeto</span>
                                        )}
                                    </div>
                                </div>
                                <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg">
                                    <span className="text-xs text-slate-500 uppercase font-bold">Responsáveis</span>
                                    <div className="mt-1 space-y-1">
                                        <div className="text-sm flex justify-between">
                                            <span className="text-slate-500">Criado:</span> <span className="font-medium text-slate-800 dark:text-white">{getUserName(selectedProposal.fk_user_author)}</span>
                                        </div>
                                        {selectedProposal.fk_user_valid && (
                                            <div className="text-sm flex justify-between">
                                                <span className="text-slate-500">Validado:</span> <span className="font-medium text-slate-800 dark:text-white">{getUserName(selectedProposal.fk_user_valid)}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Computed Lines */}
                            {(() => {
                                const selectedProposalLines = proposalLines.filter(l => String(l.parent_id) === String(selectedProposal.id))
                                    .sort((a, b) => (a.rang || 0) - (b.rang || 0));

                                return (
                                    <div>
                                        <h4 className="font-bold text-slate-800 dark:text-white mb-3">Itens da Proposta</h4>
                                        <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                                            <table className="w-full text-sm text-left">
                                                <thead className="bg-slate-50 dark:bg-slate-800/80 text-xs text-slate-500 uppercase font-semibold">
                                                    <tr>
                                                        <th className="px-4 py-3">Descrição</th>
                                                        <th className="px-4 py-3 text-right">Qtd</th>
                                                        <th className="px-4 py-3 text-right">Preço Unit.</th>
                                                        <th className="px-4 py-3 text-right">Total</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                                    {selectedProposalLines.length > 0 ? (
                                                        selectedProposalLines.map((line: any, idx: number) => (
                                                            <tr key={idx}>
                                                                <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                                                                    <div className="font-medium">{line.label}</div>
                                                                    <div
                                                                        className="text-xs text-slate-500 mt-0.5"
                                                                        dangerouslySetInnerHTML={{ __html: line.description }}
                                                                    />
                                                                </td>
                                                                <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400">{line.qty}</td>
                                                                <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400">${line.subprice?.toLocaleString()}</td>
                                                                <td className="px-4 py-3 text-right font-medium text-slate-800 dark:text-white">${line.total_ht?.toLocaleString()}</td>
                                                            </tr>
                                                        ))
                                                    ) : (
                                                        <tr>
                                                            <td colSpan={4} className="px-4 py-8 text-center text-slate-400 italic">Nenhum item disponível nesta visualização.</td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                                <tfoot className="bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-800">
                                                    <tr>
                                                        <td colSpan={3} className="px-4 py-3 text-right font-bold text-slate-700 dark:text-slate-300">Total (S/ Imposto)</td>
                                                        <td className="px-4 py-3 text-right font-bold text-slate-800 dark:text-white text-lg">${selectedProposal.total_ht?.toLocaleString()}</td>
                                                    </tr>
                                                    <tr>
                                                        <td colSpan={3} className="px-4 py-3 text-right font-bold text-slate-700 dark:text-slate-300">Total (C/ Imposto)</td>
                                                        <td className="px-4 py-3 text-right font-bold text-indigo-600 dark:text-indigo-400 text-lg">${selectedProposal.total_ttc.toLocaleString()}</td>
                                                    </tr>
                                                </tfoot>
                                            </table>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                        <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2 bg-slate-50 dark:bg-slate-800/50 rounded-b-xl">
                            {/* Linked Objects */}
                            <LinkedObjects
                                id={selectedProposal.id}
                                type="propal"
                                onNavigate={onNavigate}
                            />
                        </div>
                        <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2 bg-slate-50 dark:bg-slate-800/50 rounded-b-xl">
                            <button onClick={() => handleDownloadPdf({} as any, selectedProposal.ref)} className="px-4 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-600">Baixar PDF</button>
                            <button onClick={() => setSelectedProposal(null)} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">Fechar</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Create Proposal Modal (Simplified for display) */}
            {isCreateModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-2xl p-6">
                        <h3 className="text-lg font-bold mb-4 dark:text-white">Criar Proposta (Simulação)</h3>
                        <p className="text-slate-500 mb-6">Simulação de formulário de criação de proposta...</p>
                        <div className="flex justify-end gap-3">
                            <button onClick={() => setIsCreateModalOpen(false)} className="px-4 py-2 text-slate-500">Cancelar</button>
                            <button onClick={handleSubmit} className="px-4 py-2 bg-indigo-600 text-white rounded">Criar</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Audit Modal */}
            {auditResult && (
                <div className="absolute inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md p-6">
                        <div className="flex justify-between mb-4">
                            <h3 className="font-bold text-lg dark:text-white">Resultado da Auditoria</h3>
                            <button onClick={() => setAuditResult(null)}><X size={20} /></button>
                        </div>
                        <div className="space-y-4">
                            <div className="text-3xl font-bold text-emerald-500">{auditResult.result.riskScore}/100</div>
                            <p className="text-sm dark:text-slate-300">{auditResult.result.summary}</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Main Header */}
            <div className="p-4 md:p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex-none">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Propostas Comerciais</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input
                                type="text"
                                placeholder="Buscar..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-10 pr-4 py-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white w-64"
                            />
                        </div>

                        <button onClick={() => setIsCreateModalOpen(true)} className={`flex items-center gap-1.5 px-3 py-2 bg-${config.themeColor}-600 text-white rounded-lg`}>
                            <Plus size={18} /> Nova
                        </button>

                        <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
                            <button onClick={() => setViewMode('list')} className={`p-2 rounded-md ${viewMode === 'list' ? 'bg-white dark:bg-slate-700 shadow-sm' : ''}`}><List size={18} /></button>
                            <button onClick={() => setViewMode('kanban')} className={`p-2 rounded-md ${viewMode === 'kanban' ? 'bg-white dark:bg-slate-700 shadow-sm' : ''}`}><Kanban size={18} /></button>
                        </div>
                    </div>
                </div>

                {viewMode === 'list' && (
                    <div className="flex gap-2 border-b border-slate-100 dark:border-slate-800 overflow-x-auto">
                        {['all', 'open', 'signed', 'draft'].map((status) => (
                            <button key={status} onClick={() => setFilterStatus(status as any)} className={`pb-2 px-3 text-sm font-medium border-b-2 capitalize ${filterStatus === status ? `border-${config.themeColor}-600 text-${config.themeColor}-600` : 'border-transparent text-slate-500'}`}>
                                {status === 'all' ? 'Todas' : status === 'open' ? 'Abertas' : status === 'signed' ? 'Assinadas' : 'Rascunhos'}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6">

                {/* LIST VIEW */}
                {viewMode === 'list' && (
                    <div className="grid grid-cols-1 gap-4">
                        {filteredProposals.map((prop) => (
                            <div key={prop.id} onClick={() => setSelectedProposal(prop)} className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer">
                                <div className="flex items-start gap-4">
                                    <div className={`p-3 rounded-lg bg-${config.themeColor}-50 dark:bg-${config.themeColor}-900/20 text-${config.themeColor}-600`}>
                                        <FileText size={24} />
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="font-bold text-slate-800 dark:text-white">{prop.ref}</span>
                                            {getStatusBadge(prop.statut)}
                                        </div>
                                        <div className="text-slate-600 dark:text-slate-300 font-medium">{getCustomerName(prop.socid)}</div>
                                        {prop.project_id && <div className="text-xs text-indigo-500 mt-1 flex items-center gap-1"><FolderKanban size={10} /> {getProjectName(prop.project_id)}</div>}
                                    </div>
                                </div>

                                <div className="flex items-center gap-3">
                                    <div className="text-right mr-3">
                                        <div className="text-xs text-slate-500">Total</div>
                                        <div className="text-lg font-bold text-slate-800 dark:text-white">${prop.total_ttc.toLocaleString()}</div>
                                    </div>
                                    <button onClick={(e) => handleAudit(e, prop)} className="p-2 rounded-lg bg-violet-50 text-violet-600 hover:bg-violet-100" title="Auditoria"><Scale size={18} /></button>
                                    <button onClick={(e) => handleDownloadPdf(e, prop.ref)} className="p-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200"><Download size={18} /></button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* KANBAN VIEW */}
                {viewMode === 'kanban' && (
                    <div className="flex overflow-x-auto gap-6 h-full pb-4">
                        {kanbanColumns.map(col => {
                            const colProposals = filteredProposals.filter(p => {
                                if (col.id === '2') return p.statut === '2' || p.statut === '4';
                                return p.statut === col.id;
                            });
                            return (
                                <div key={col.id} className="min-w-[300px] w-80 flex flex-col h-full rounded-xl bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800">
                                    <div className="p-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-t-xl font-bold">{col.title} ({colProposals.length})</div>
                                    <div className="flex-1 overflow-y-auto p-3 space-y-3">
                                        {colProposals.map(prop => (
                                            <div key={prop.id} onClick={() => setSelectedProposal(prop)} className="bg-white dark:bg-slate-800 p-3 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 cursor-pointer hover:shadow-md">
                                                <div className="flex justify-between mb-2"><span className="text-xs font-mono">{prop.ref}</span></div>
                                                <h4 className="font-medium text-sm mb-1">{getCustomerName(prop.socid)}</h4>
                                                <div className="flex justify-between items-end mt-3">
                                                    <span className="font-bold text-sm">${prop.total_ttc.toLocaleString()}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ProposalList;
