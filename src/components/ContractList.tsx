
import React, { useState, useMemo, useEffect } from 'react';
import { Contract, ThirdParty, DolibarrConfig, AppView, Project, Invoice } from '../types';
import { FileSignature, Search, Plus, X, Loader2, CheckCircle2, Ban, Calendar, User, FileText, Filter, List, Archive, FolderKanban, Receipt, ExternalLink } from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { useDolibarr } from '../context/DolibarrContext';
import { useContracts, useCustomers, useProjects, useInvoices } from '../hooks/dolibarr';
import { LinkedObjects } from './common/LinkedObjects';
import { formatDateOnly } from '../utils/dateUtils';

interface ContractListProps {
    onNavigate?: (view: AppView, id: string) => void;
    onRefresh?: () => void;
}

const ContractList: React.FC<ContractListProps> = ({ onNavigate, onRefresh }) => {
    const { config } = useDolibarr();
    const { data: contractsData } = useContracts(config);
    const contracts = contractsData || [];
    const { data: customersData } = useCustomers(config);
    const customers = customersData || [];
    const { data: projectsData } = useProjects(config);
    const projects = projectsData || [];
    const { data: invoicesData } = useInvoices(config);
    const invoices = invoicesData || [];

    if (!config) return <div className="p-8 text-center">Carregando configuração...</div>;

    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'draft' | 'closed'>('all');
    const [selectedContract, setSelectedContract] = useState<Contract | null>(null);
    const [activeTab, setActiveTab] = useState<'overview' | 'invoices'>('overview');
    const [processingId, setProcessingId] = useState<string | null>(null);

    // Creation State
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [newContractForm, setNewContractForm] = useState({
        socid: '',
        date_contrat: new Date().toISOString().split('T')[0],
        date_fin_validite: '',
        note_public: ''
    });
    const [isSubmitting, setIsSubmitting] = useState(false);

    const getCustomerName = (socid: string) => {
        const customer = customers.find(c => String(c.id) === String(socid));
        return customer ? customer.name : (socid ? `Desconhecido (${socid})` : 'Desconhecido');
    };

    const getProjectName = (projId?: string) => {
        if (!projId) return null;
        const p = projects.find(prj => String(prj.id) === String(projId));
        return p ? p.title : null;
    };

    const filteredContracts = useMemo(() => {
        return contracts.filter(c => {
            const customerName = getCustomerName(c.socid).toLowerCase();
            const matchesSearch =
                c.ref.toLowerCase().includes(searchTerm.toLowerCase()) ||
                customerName.includes(searchTerm.toLowerCase());

            if (filterStatus === 'active') return matchesSearch && c.statut === '1';
            if (filterStatus === 'draft') return matchesSearch && c.statut === '0';
            if (filterStatus === 'closed') return matchesSearch && c.statut === '2';

            return matchesSearch;
        });
    }, [contracts, customers, searchTerm, filterStatus]);

    // Find linked invoices
    const contractInvoices = useMemo(() => {
        if (!selectedContract) return [];
        // Match invoices either by explicit contract_id (if available) or by project/customer heuristics for demo
        return invoices.filter(inv =>
            (inv.contract_id && String(inv.contract_id) === String(selectedContract.id)) ||
            (selectedContract.project_id && String(inv.project_id) === String(selectedContract.project_id)) // Fallback to Project link
        );
    }, [selectedContract, invoices]);

    const getStatusBadge = (status: string) => {
        switch (status) {
            case '0': return <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">Rascunho</span>;
            case '1': return <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">Ativo</span>;
            case '2': return <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">Fechado</span>;
            default: return <span className="text-xs bg-slate-100">Desconhecido</span>;
        }
    };

    const handleCreateContract = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newContractForm.socid) return;
        setIsSubmitting(true);
        try {
            const payload = {
                socid: newContractForm.socid,
                date_contrat: new Date(newContractForm.date_contrat).getTime() / 1000,
                date_fin_validite: newContractForm.date_fin_validite ? new Date(newContractForm.date_fin_validite).getTime() / 1000 : undefined,
                note_public: newContractForm.note_public
            };
            await DolibarrService.createContract(config, payload);
            alert("Contrato Criado com Sucesso");
            setIsCreateModalOpen(false);
            setNewContractForm({ socid: '', date_contrat: new Date().toISOString().split('T')[0], date_fin_validite: '', note_public: '' });
            if (onRefresh) onRefresh();
        } catch (e: any) {
            console.error(e);
            alert(`Falha: ${e.message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleValidate = async () => {
        if (!selectedContract) return;
        if (!confirm("Validar este contrato?")) return;
        setProcessingId(selectedContract.id);
        try {
            await DolibarrService.validateContract(config, selectedContract.id);
            alert("Contrato Validado");
            if (onRefresh) onRefresh();
            setSelectedContract(null);
        } catch (e: any) {
            alert(`Erro: ${e.message}`);
        } finally {
            setProcessingId(null);
        }
    };

    const handleClose = async () => {
        if (!selectedContract) return;
        if (!confirm("Fechar este contrato?")) return;
        setProcessingId(selectedContract.id);
        try {
            await DolibarrService.closeContract(config, selectedContract.id);
            alert("Contrato Fechado");
            if (onRefresh) onRefresh();
            setSelectedContract(null);
        } catch (e: any) {
            alert(`Erro: ${e.message}`);
        } finally {
            setProcessingId(null);
        }
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 transition-colors relative">

            {/* Create Modal */}
            {isCreateModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg border border-slate-200 dark:border-slate-800 animate-in zoom-in-95">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 rounded-t-xl">
                            <h3 className="font-bold text-lg dark:text-white flex items-center gap-2">
                                <FileSignature size={18} className="text-indigo-600" /> Novo Contrato
                            </h3>
                            <button onClick={() => setIsCreateModalOpen(false)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleCreateContract} className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Cliente</label>
                                <select
                                    className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                    value={newContractForm.socid}
                                    onChange={e => setNewContractForm({ ...newContractForm, socid: e.target.value })}
                                    required
                                >
                                    <option value="">Selecione o Cliente...</option>
                                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Data Início</label>
                                    <input type="date" className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={newContractForm.date_contrat} onChange={e => setNewContractForm({ ...newContractForm, date_contrat: e.target.value })} required />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Data Fim (Opcional)</label>
                                    <input type="date" className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={newContractForm.date_fin_validite} onChange={e => setNewContractForm({ ...newContractForm, date_fin_validite: e.target.value })} />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Notas</label>
                                <textarea className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white resize-none h-20" value={newContractForm.note_public} onChange={e => setNewContractForm({ ...newContractForm, note_public: e.target.value })} placeholder="Detalhes do contrato..." />
                            </div>
                            <div className="flex justify-end gap-3 pt-2">
                                <button type="button" onClick={() => setIsCreateModalOpen(false)} className="px-4 py-2 text-slate-500 hover:text-slate-700 font-medium">Cancelar</button>
                                <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium shadow-sm flex items-center gap-2">
                                    {isSubmitting ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />} Criar
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Header */}
            <div className={`p-4 md:p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex-none ${selectedContract ? 'hidden lg:block' : 'block'}`}>
                <div className="flex justify-between items-center mb-4">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Contratos</h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400">Gerencie acordos de serviço e assinaturas</p>
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
                        <button onClick={() => setIsCreateModalOpen(true)} className={`p-2 bg-${config.themeColor}-600 hover:bg-${config.themeColor}-700 text-white rounded-lg transition-colors`}><Plus size={20} /></button>
                    </div>
                </div>
                <div className="flex gap-2 border-b border-slate-100 dark:border-slate-800 overflow-x-auto">
                    {['all', 'active', 'draft', 'closed'].map(status => (
                        <button
                            key={status}
                            onClick={() => setFilterStatus(status as any)}
                            className={`pb-2 px-3 text-sm font-medium transition-colors border-b-2 capitalize whitespace-nowrap ${filterStatus === status ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                        >
                            {status === 'all' ? 'Todos' : status === 'active' ? 'Ativos' : status === 'draft' ? 'Rascunhos' : 'Fechados'}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 min-h-0 flex overflow-hidden">
                {/* List */}
                <div className={`flex-1 overflow-y-auto p-4 md:p-6 ${selectedContract ? 'hidden lg:block lg:w-1/3 xl:w-1/4 border-r border-slate-200 dark:border-slate-800' : 'w-full'}`}>
                    {filteredContracts.length === 0 ? (
                        <div className="text-center py-20 text-slate-400">
                            <FileSignature size={48} className="mx-auto mb-4 opacity-50" />
                            <p>Nenhum contrato encontrado.</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {filteredContracts.map(contract => (
                                <div key={contract.id} onClick={() => { setSelectedContract(contract); setActiveTab('overview'); }} className={`p-4 border rounded-xl cursor-pointer transition-all ${selectedContract?.id === contract.id ? `border-${config.themeColor}-500 bg-${config.themeColor}-50 dark:bg-${config.themeColor}-900/20` : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:shadow-md'}`}>
                                    <div className="flex justify-between items-start mb-2">
                                        <h4 className="font-bold text-slate-800 dark:text-white text-sm">{contract.ref}</h4>
                                        {getStatusBadge(contract.statut)}
                                    </div>
                                    <div className="text-sm text-slate-600 dark:text-slate-300 font-medium mb-1">
                                        <span
                                            className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (onNavigate) onNavigate('customers', contract.socid);
                                            }}
                                        >
                                            {getCustomerName(contract.socid)}
                                        </span>
                                    </div>
                                    <div className="text-xs text-slate-500 flex items-center gap-1">
                                        <Calendar size={12} /> {formatDateOnly(contract.date_contrat)}
                                        {contract.date_fin_validite && ` - ${formatDateOnly(contract.date_fin_validite)}`}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Detail */}
                <div className={`flex-1 bg-white dark:bg-slate-900 flex flex-col ${selectedContract ? 'block absolute inset-0 z-20 lg:static lg:inset-auto' : 'hidden lg:flex lg:items-center lg:justify-center'}`}>
                    {selectedContract ? (
                        <>
                            <div className="flex-none bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-100 dark:border-slate-800 p-4 flex items-center justify-between z-10">
                                <div>
                                    <h2 className="text-lg font-bold dark:text-white flex items-center gap-2">{selectedContract.ref} {getStatusBadge(selectedContract.statut)}</h2>
                                    <span className="text-xs text-slate-500">Detalhes do Contrato</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    {selectedContract.statut === '0' && (
                                        <button onClick={handleValidate} disabled={!!processingId} className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium shadow-sm transition-colors disabled:opacity-50">
                                            {processingId ? <Loader2 className="animate-spin" size={14} /> : <CheckCircle2 size={14} />} Validar
                                        </button>
                                    )}
                                    {selectedContract.statut === '1' && (
                                        <button onClick={handleClose} disabled={!!processingId} className="flex items-center gap-2 px-3 py-1.5 bg-red-100 text-red-700 border border-red-200 hover:bg-red-200 rounded-lg text-xs font-medium transition-colors disabled:opacity-50">
                                            {processingId ? <Loader2 className="animate-spin" size={14} /> : <Archive size={14} />} Fechar
                                        </button>
                                    )}
                                    <button onClick={() => setSelectedContract(null)} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
                                </div>
                            </div>

                            <div className="flex border-b border-slate-100 dark:border-slate-800 px-4 overflow-x-auto flex-none bg-slate-50 dark:bg-slate-800/30">
                                <button onClick={() => setActiveTab('overview')} className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'overview' ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>Visão Geral</button>
                                <button onClick={() => setActiveTab('invoices')} className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'invoices' ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>Faturamento ({contractInvoices.length})</button>
                            </div>

                            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950/50">
                                <div className="max-w-3xl mx-auto space-y-6">
                                    {activeTab === 'overview' && (
                                        <>
                                            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                                                <h3 className="font-bold text-slate-800 dark:text-white mb-4 border-b border-slate-100 dark:border-slate-800 pb-2">Informações</h3>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                    <div>
                                                        <label className="text-xs text-slate-500 uppercase font-bold">Cliente</label>
                                                        <div
                                                            className="flex items-center gap-2 mt-1 text-slate-800 dark:text-white font-medium cursor-pointer hover:underline hover:text-indigo-600 dark:hover:text-indigo-400"
                                                            onClick={() => onNavigate && onNavigate('customers', selectedContract.socid)}
                                                        >
                                                            <User size={16} className="text-indigo-500" /> {getCustomerName(selectedContract.socid)}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label className="text-xs text-slate-500 uppercase font-bold">Duração</label>
                                                        <div className="flex items-center gap-2 mt-1 text-slate-800 dark:text-white font-medium">
                                                            <Calendar size={16} className="text-indigo-500" />
                                                            {formatDateOnly(selectedContract.date_contrat)}
                                                            {selectedContract.date_fin_validite ? ` → ${formatDateOnly(selectedContract.date_fin_validite)}` : ' (Sem Data Final)'}
                                                        </div>
                                                    </div>
                                                    {selectedContract.project_id && (
                                                        <div className="col-span-2">
                                                            <label className="text-xs text-slate-500 uppercase font-bold">Projeto Vinculado</label>
                                                            <div
                                                                className="flex items-center gap-2 mt-1 text-indigo-600 dark:text-indigo-400 font-medium cursor-pointer hover:underline"
                                                                onClick={() => onNavigate && onNavigate('projects', selectedContract.project_id!)}
                                                            >
                                                                <FolderKanban size={16} /> {getProjectName(selectedContract.project_id)}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                                {selectedContract.note_public && (
                                                    <div className="mt-6">
                                                        <label className="text-xs text-slate-500 uppercase font-bold">Notas</label>
                                                        <div className="mt-2 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-800 text-sm text-slate-700 dark:text-slate-300">
                                                            {selectedContract.note_public}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="mt-6">
                                                <LinkedObjects
                                                    id={selectedContract.id}
                                                    type="contrat"
                                                    onNavigate={onNavigate}
                                                />
                                            </div>
                                        </>
                                    )}

                                    {activeTab === 'invoices' && (
                                        <div className="space-y-4">
                                            {contractInvoices.length === 0 ? (
                                                <div className="text-center py-10 text-slate-400 bg-white dark:bg-slate-900 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
                                                    <Receipt size={48} className="mx-auto mb-4 opacity-50" />
                                                    <p>Nenhuma fatura vinculada a este contrato.</p>
                                                </div>
                                            ) : (
                                                contractInvoices.map(inv => (
                                                    <div
                                                        key={inv.id}
                                                        className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex justify-between items-center hover:shadow-md cursor-pointer transition-all"
                                                        onClick={() => onNavigate && onNavigate('invoices', inv.id)}
                                                    >
                                                        <div>
                                                            <div className="font-bold text-slate-800 dark:text-white text-sm flex items-center gap-2">
                                                                {inv.ref}
                                                                {inv.statut === '2' ? <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">Pago</span> : <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded">Não Pago</span>}
                                                            </div>
                                                            <div className="text-xs text-slate-500 mt-1">{formatDateOnly(inv.date)}</div>
                                                        </div>
                                                        <div className="flex items-center gap-4">
                                                            <span className="font-bold text-slate-800 dark:text-white">${inv.total_ttc.toLocaleString()}</span>
                                                            <ExternalLink size={14} className="text-slate-400" />
                                                        </div>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-slate-400">
                            <FileSignature size={48} className="mb-4 opacity-50" />
                            <p>Selecione um contrato para ver detalhes.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ContractList;
