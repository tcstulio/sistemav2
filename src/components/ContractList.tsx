
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { usePrefill, PrefillResult } from '../hooks/usePrefill';
import { Contract, AppView } from '../types';
import { FileSignature, Plus, Loader2, CheckCircle2, Calendar, User, FolderKanban, Receipt, ExternalLink, Archive, Pencil, Package } from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { useDolibarr } from '../context/DolibarrContext';
import { useContracts, useCustomers, useProjects, useInvoices } from '../hooks/dolibarr';
import { useListControls } from '../hooks/useListControls';
import { LinkedObjects } from './common/LinkedObjects';
import { formatDateOnly } from '../utils/dateUtils';
import { formatCurrency } from '../utils/formatUtils';
import { logger } from '../utils/logger';
import { notifyError } from '../utils/notifyError';
import { useConfirm } from '../hooks/useConfirm';

const log = logger.child('ContractList');

// Design System
import { PageHeader, MasterDetailLayout, Card, Button, Modal, Tabs, Tab, EmptyState, StatusBadge, ListToolbar, ConfirmDeleteButton } from './ui';
import type { StatusConfig } from './ui';

const contractStatuses: Record<string, StatusConfig> = {
    '0': { label: 'Rascunho', variant: 'slate' },
    '1': { label: 'Ativo', variant: 'emerald', icon: <CheckCircle2 size={12} /> },
    '2': { label: 'Fechado', variant: 'red', icon: <Archive size={12} /> },
};

interface ContractListProps {
    onNavigate?: (view: AppView, id: string) => void;
    onRefresh?: () => void;
}

const ContractList: React.FC<ContractListProps> = ({ onNavigate, onRefresh }) => {
    const { config, canDo } = useDolibarr();
    const { data: contractsData, refetch: refetchContracts } = useContracts(config);
    const contracts = contractsData || [];
    const { data: customersData } = useCustomers(config);
    const customers = customersData || [];
    const { data: projectsData } = useProjects(config);
    const projects = projectsData || [];
    const { data: invoicesData } = useInvoices(config);
    const invoices = invoicesData || [];

    if (!config) return null;

    const confirm = useConfirm();
    const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'draft' | 'closed'>('all');
    const [selectedContract, setSelectedContract] = useState<Contract | null>(null);
    const [activeTab, setActiveTab] = useState<'overview' | 'invoices'>('overview');
    const [processingId, setProcessingId] = useState<string | null>(null);

    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [editContractId, setEditContractId] = useState<string | undefined>(undefined);
    const [newContractForm, setNewContractForm] = useState({
        socid: '',
        project_id: '',
        date_contrat: new Date().toISOString().split('T')[0],
        date_fin_validite: '',
        note_public: ''
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const isEditContract = !!editContractId;

    const tsToInput = (ts?: number) => (ts ? new Date(ts < 1e11 ? ts * 1000 : ts).toISOString().split('T')[0] : '');

    const openEditContract = (c: Contract) => {
        setEditContractId(String(c.id));
        setNewContractForm({
            socid: String(c.socid),
            project_id: c.project_id || '',
            date_contrat: tsToInput(c.date_contrat),
            date_fin_validite: tsToInput(c.date_fin_validite),
            note_public: c.note_public || '',
        });
        setIsCreateModalOpen(true);
    };

    // Deeplink HITL do agente (#57/#78): create_contract / edit_contract abrem o modal pré-preenchido.
    const prefill = usePrefill();
    const appliedPrefillRef = useRef<PrefillResult | null>(null);
    useEffect(() => {
        if (!prefill || appliedPrefillRef.current === prefill) return;
        if (prefill.kind === 'create_contract') {
            appliedPrefillRef.current = prefill;
            setEditContractId(undefined);
            setNewContractForm({
                socid: prefill.data.socid || '',
                project_id: prefill.data.project_id || '',
                date_contrat: prefill.data.date_contrat || new Date().toISOString().split('T')[0],
                date_fin_validite: prefill.data.date_fin_validite || '',
                note_public: prefill.data.note_public || '',
            });
            setIsCreateModalOpen(true);
            toast.info('Revise os dados e confirme a criação do contrato.');
        } else if (prefill.kind === 'edit_contract') {
            const c = contracts.find(ct => String(ct.id) === String(prefill.data.id));
            if (!c) return; // aguarda os dados
            appliedPrefillRef.current = prefill;
            setEditContractId(String(c.id));
            setNewContractForm({
                socid: String(c.socid),
                project_id: prefill.data.project_id ?? c.project_id ?? '',
                date_contrat: prefill.data.date_contrat || tsToInput(c.date_contrat),
                date_fin_validite: prefill.data.date_fin_validite || tsToInput(c.date_fin_validite),
                note_public: prefill.data.note_public ?? c.note_public ?? '',
            });
            setIsCreateModalOpen(true);
            toast.info('Revise as mudanças e salve o contrato.');
        }
    }, [prefill, contracts]);

    const getCustomerName = (socid: string) => {
        const customer = customers.find(c => String(c.id) === String(socid));
        return customer ? customer.name : (socid ? `Desconhecido (${socid})` : 'Desconhecido');
    };

    const getProjectName = (projId?: string) => {
        if (!projId) return null;
        const p = projects.find(prj => String(prj.id) === String(projId));
        return p ? p.title : null;
    };

    // Busca + ordenação padronizadas (#121). O filtro por status fica nas Tabs e é
    // aplicado sobre controls.result.
    const controls = useListControls(contracts, {
        searchText: (c) => `${c.ref} ${getCustomerName(c.socid)}`,
        sorts: [
            { key: 'date_contrat', label: 'Data', get: (c) => c.date_contrat || 0 },
            { key: 'ref', label: 'Referência', get: (c) => c.ref },
            { key: 'customer', label: 'Cliente', get: (c) => getCustomerName(c.socid) },
        ],
        initialSortKey: 'date_contrat',
        initialSortDir: 'desc',
    });

    const filteredContracts = useMemo(() => {
        return controls.result.filter(c => {
            if (filterStatus === 'active') return c.statut === '1';
            if (filterStatus === 'draft') return c.statut === '0';
            if (filterStatus === 'closed') return c.statut === '2';
            return true;
        });
    }, [controls.result, filterStatus]);

    const contractInvoices = useMemo(() => {
        if (!selectedContract) return [];
        return invoices.filter(inv =>
            (inv.contract_id && String(inv.contract_id) === String(selectedContract.id)) ||
            (selectedContract.project_id && String(inv.project_id) === String(selectedContract.project_id))
        );
    }, [selectedContract, invoices]);

    const handleSubmitContract = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newContractForm.socid) return;
        setIsSubmitting(true);
        try {
            const payload: Record<string, unknown> = {
                socid: newContractForm.socid,
                date_contrat: new Date(newContractForm.date_contrat).getTime() / 1000,
                date_fin_validite: newContractForm.date_fin_validite ? new Date(newContractForm.date_fin_validite).getTime() / 1000 : undefined,
                note_public: newContractForm.note_public,
            };
            if (newContractForm.project_id) {
                payload.project_id = newContractForm.project_id;
            }
            if (editContractId) {
                await DolibarrService.updateObject(config, 'contracts', editContractId, payload);
                toast.success("Contrato atualizado");
            } else {
                await DolibarrService.createContract(config, payload);
                toast.success("Contrato criado com sucesso");
            }
            setIsCreateModalOpen(false);
            setEditContractId(undefined);
            setNewContractForm({ socid: '', project_id: '', date_contrat: new Date().toISOString().split('T')[0], date_fin_validite: '', note_public: '' });
            if (onRefresh) onRefresh();
        } catch (e: any) {
            notifyError('Salvar contrato', e);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleValidate = async () => {
        if (!selectedContract) return;
        if (!(await confirm("Validar este contrato?"))) return;
        setProcessingId(selectedContract.id);
        try {
            await DolibarrService.validateContract(config, selectedContract.id);
            toast.success("Contrato validado");
            if (onRefresh) onRefresh();
            setSelectedContract(null);
        } catch (e: any) {
            notifyError('Validar contrato', e);
        } finally {
            setProcessingId(null);
        }
    };

    const handleClose = async () => {
        if (!selectedContract) return;
        if (!(await confirm("Fechar este contrato?"))) return;
        setProcessingId(selectedContract.id);
        try {
            await DolibarrService.closeContract(config, selectedContract.id);
            toast.success("Contrato fechado");
            if (onRefresh) onRefresh();
            setSelectedContract(null);
        } catch (e: any) {
            notifyError('Fechar contrato', e);
        } finally {
            setProcessingId(null);
        }
    };

    const renderHeader = (
        <div className={selectedContract ? 'hidden lg:block' : 'block'}>
            <PageHeader
                title="Contratos"
                subtitle="Gerencie acordos de serviço e assinaturas"
                actions={
                    <div className="flex items-center gap-2">
                        <ListToolbar controls={controls} searchPlaceholder="Buscar contrato..." />
                        {canDo('create', 'contracts') && (
                        <Button icon={<Plus size={16} />} onClick={() => setIsCreateModalOpen(true)}>
                            Novo Contrato
                        </Button>
                        )}
                    </div>
                }
                tabs={
                    <Tabs value={filterStatus} onChange={(v) => setFilterStatus(v as any)}>
                        <Tab value="all">Todos</Tab>
                        <Tab value="active">Ativos</Tab>
                        <Tab value="draft">Rascunhos</Tab>
                        <Tab value="closed">Fechados</Tab>
                    </Tabs>
                }
            />
        </div>
    );

    const renderList = (
        <div className="p-4 md:p-6">
            {filteredContracts.length === 0 ? (
                <EmptyState icon={FileSignature} title="Nenhum contrato encontrado" description="Tente ajustar a busca ou crie um novo contrato." />
            ) : (
                <div className="space-y-3">
                    {filteredContracts.map(contract => (
                        <Card
                            key={contract.id}
                            onClick={() => { setSelectedContract(contract); setActiveTab('overview'); }}
                            selected={selectedContract?.id === contract.id}
                            className="cursor-pointer"
                        >
                            <div className="flex justify-between items-start mb-2">
                                <h4 className="font-bold text-slate-800 dark:text-white text-sm">{contract.ref}</h4>
                                <div className="flex items-center gap-1 shrink-0">
                                    <StatusBadge status={contract.statut} config={contractStatuses} size="sm" />
                                    {canDo('delete', 'contracts') && (contract.statut === '0' || contract.statut === '2') && (
                                        <ConfirmDeleteButton
                                            itemLabel={contract.ref}
                                            onDelete={() => DolibarrService.deleteContract(config, contract.id)}
                                            onDeleted={() => {
                                                if (selectedContract?.id === contract.id) setSelectedContract(null);
                                                refetchContracts();
                                                if (onRefresh) onRefresh();
                                            }}
                                        />
                                    )}
                                </div>
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
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );

    const renderDetail = selectedContract ? (
        <>
            <PageHeader
                onBack={() => setSelectedContract(null)}
                title={
                    <span className="flex items-center gap-2">
                        {selectedContract.ref}
                        <StatusBadge status={selectedContract.statut} config={contractStatuses} />
                    </span>
                }
                subtitle="Detalhes do Contrato"
                actions={
                    <div className="flex items-center gap-2">
                        {canDo('edit', 'contracts') && (
                        <Button variant="secondary" size="sm" icon={<Pencil size={14} />} onClick={() => openEditContract(selectedContract)}>
                            Editar
                        </Button>
                        )}
                        {canDo('validate', 'contracts') && selectedContract.statut === '0' && (
                            <Button size="sm" icon={processingId ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} onClick={handleValidate} disabled={!!processingId}>
                                Validar
                            </Button>
                        )}
                        {selectedContract.statut === '1' && (
                            <Button variant="danger" size="sm" icon={processingId ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />} onClick={handleClose} disabled={!!processingId}>
                                Fechar
                            </Button>
                        )}
                        {canDo('delete', 'contracts') && (selectedContract.statut === '0' || selectedContract.statut === '2') && (
                            <ConfirmDeleteButton
                                withLabel
                                itemLabel={selectedContract.ref}
                                stopPropagation={false}
                                onDelete={() => DolibarrService.deleteContract(config, selectedContract.id)}
                                onDeleted={() => {
                                    setSelectedContract(null);
                                    refetchContracts();
                                    if (onRefresh) onRefresh();
                                }}
                            />
                        )}
                    </div>
                }
                tabs={
                    <Tabs value={activeTab} onChange={(v) => setActiveTab(v as any)}>
                        <Tab value="overview">Visão Geral</Tab>
                        <Tab value="invoices">Faturamento ({contractInvoices.length})</Tab>
                    </Tabs>
                }
            />

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

                            {/* Contract lines */}
                            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                                <h3 className="font-bold text-slate-800 dark:text-white mb-4 border-b border-slate-100 dark:border-slate-800 pb-2">Linhas de Serviço</h3>
                                {!selectedContract.lines || selectedContract.lines.length === 0 ? (
                                    <EmptyState icon={Package} title="Sem linhas de serviço" description="Este contrato não possui linhas de serviço cadastradas." />
                                ) : (
                                    <div className="space-y-2">
                                        {selectedContract.lines.map((line, idx) => (
                                            <div key={line.id || idx} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-800 text-sm">
                                                <div className="flex-1 text-slate-800 dark:text-white font-medium">{line.desc || '—'}</div>
                                                <div className="flex items-center gap-4 shrink-0 text-slate-600 dark:text-slate-400">
                                                    <span>Qtd: <span className="font-semibold text-slate-800 dark:text-white">{line.qty}</span></span>
                                                    <span>Preço: <span className="font-semibold text-slate-800 dark:text-white">{formatCurrency(line.price)}</span></span>
                                                    {(line.date_start || line.date_end) && (
                                                        <span className="text-xs text-slate-500">
                                                            {line.date_start ? formatDateOnly(line.date_start) : '?'}
                                                            {line.date_end ? ` → ${formatDateOnly(line.date_end)}` : ''}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                        <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
                                            <span className="text-sm font-bold text-slate-800 dark:text-white">
                                                Total: {formatCurrency(selectedContract.lines.reduce((sum, l) => sum + (l.price * l.qty), 0))}
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <LinkedObjects
                                id={selectedContract.id}
                                type="contrat"
                                onNavigate={onNavigate}
                            />
                        </>
                    )}

                    {activeTab === 'invoices' && (
                        <div className="space-y-4">
                            {contractInvoices.length === 0 ? (
                                <EmptyState icon={Receipt} title="Nenhuma fatura vinculada" description="Nenhuma fatura vinculada a este contrato." />
                            ) : (
                                contractInvoices.map(inv => (
                                    <Card
                                        key={inv.id}
                                        onClick={() => onNavigate && onNavigate('invoices', inv.id)}
                                        className="cursor-pointer"
                                    >
                                        <div className="flex justify-between items-center">
                                            <div>
                                                <div className="font-bold text-slate-800 dark:text-white text-sm flex items-center gap-2">
                                                    {inv.ref}
                                                    <StatusBadge
                                                        status={inv.statut === '2' ? 'paid' : 'unpaid'}
                                                        config={{
                                                            paid: { label: 'Pago', variant: 'emerald' },
                                                            unpaid: { label: 'Não Pago', variant: 'orange' },
                                                        }}
                                                        size="sm"
                                                    />
                                                </div>
                                                <div className="text-xs text-slate-500 mt-1">{formatDateOnly(inv.date)}</div>
                                            </div>
                                            <div className="flex items-center gap-4">
                                                <span className="font-bold text-slate-800 dark:text-white">{formatCurrency(inv.total_ttc)}</span>
                                                <ExternalLink size={14} className="text-slate-400" />
                                            </div>
                                        </div>
                                    </Card>
                                ))
                            )}
                        </div>
                    )}
                </div>
            </div>
        </>
    ) : null;

    return (
        <>
            <div className="flex flex-col h-full">
                {renderHeader}
                <MasterDetailLayout
                    list={renderList}
                    detail={renderDetail}
                    showDetail={!!selectedContract}
                    onCloseDetail={() => setSelectedContract(null)}
                />
            </div>

            <Modal
                isOpen={isCreateModalOpen}
                onClose={() => { setIsCreateModalOpen(false); setEditContractId(undefined); }}
                title={
                    <span className="flex items-center gap-2">
                        <FileSignature size={18} className="text-indigo-600" /> {isEditContract ? 'Editar Contrato' : 'Novo Contrato'}
                    </span>
                }
                footer={
                    <>
                        <Button variant="secondary" onClick={() => { setIsCreateModalOpen(false); setEditContractId(undefined); }}>Cancelar</Button>
                        <Button onClick={(e: any) => handleSubmitContract(e)} loading={isSubmitting} icon={<CheckCircle2 size={16} />}>{isEditContract ? 'Salvar' : 'Criar'}</Button>
                    </>
                }
            >
                <div className="space-y-4">
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
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Projeto (Opcional)</label>
                        <select
                            className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                            value={newContractForm.project_id}
                            onChange={e => setNewContractForm({ ...newContractForm, project_id: e.target.value })}
                        >
                            <option value="">Nenhum projeto...</option>
                            {projects.map(p => <option key={p.id} value={p.id}>{p.title || p.ref}</option>)}
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
                </div>
            </Modal>
        </>
    );
};

export default ContractList;
