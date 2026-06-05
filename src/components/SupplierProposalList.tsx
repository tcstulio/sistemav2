import React, { useState, useMemo, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { sanitizeHtml } from '../utils/sanitizeHtml';
import { usePrefill, PrefillResult } from '../hooks/usePrefill';
import { SupplierProposal, DolibarrConfig, AppView, Product, SupplierProposalLine } from '../types';
import { FileText, Search, Plus, Trash2, Save, X, Edit, Loader2, CheckCircle, XCircle, Send, Archive, Ban, FileSignature, FolderKanban, Sparkles } from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { useNavigate } from 'react-router-dom';
import { useDolibarr } from '../context/DolibarrContext';
import { useSupplierProposals, useSuppliers, useProducts, useProjects, useSupplierProposalLines, useUsers } from '../hooks/dolibarr';
import { RichTextEditor } from './common/RichTextEditor';
import { FixedSizeList as ListWindow } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { useListControls } from '../hooks/useListControls';
import { logger } from '../utils/logger';

const log = logger.child('SupplierProposalList');

// Design System
import { PageHeader, MasterDetailLayout, Card, Button, Tabs, Tab, EmptyState, StatusBadge, ListToolbar, ConfirmDeleteButton } from './ui';
import type { StatusConfig } from './ui';

const supplierProposalStatuses: Record<string, StatusConfig> = {
    '0': { label: 'Rascunho', variant: 'slate' },
    '1': { label: 'Aberta', variant: 'blue', icon: <Send size={12} /> },
    '2': { label: 'Assinada', variant: 'emerald', icon: <CheckCircle size={12} /> },
    '3': { label: 'Recusada', variant: 'red', icon: <XCircle size={12} /> },
    '4': { label: 'Pedido', variant: 'indigo', icon: <Archive size={12} /> },
};

interface SupplierProposalListProps {
    onNavigate?: (view: AppView, id: string) => void;
    onRefresh?: () => void;
    initialItemId?: string;
}

const SupplierProposalList: React.FC<SupplierProposalListProps> = ({ onNavigate, onRefresh, initialItemId }) => {
    const navigate = useNavigate();
    const { config } = useDolibarr();
    const { data: proposalsData, isRefetching: isRefetchingProposals, refetch: refetchProposals } = useSupplierProposals(config);
    const proposals = proposalsData || [];
    const { data: suppliersData } = useSuppliers(config);
    const suppliers = suppliersData || [];
    const { data: productsData } = useProducts(config);
    const products = productsData || [];
    const { data: projectsData } = useProjects(config);
    const projects = projectsData || [];
    const { data: proposalLinesData, refetch: refetchLines } = useSupplierProposalLines(config);
    const proposalLines = proposalLinesData || [];
    const { data: users = [] } = useUsers(config);

    if (!config) return <div className="p-8 text-center flex items-center justify-center gap-2 text-slate-500"><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-slate-500"></div> Carregando...</div>;

    const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'signed' | 'draft' | 'declined'>('all');
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [selectedProposal, setSelectedProposal] = useState<SupplierProposal | null>(null);
    const [showDebug, setShowDebug] = useState(false);

    // Deep Link Effect
    useEffect(() => {
        if (initialItemId && proposals.length > 0) {
            const match = proposals.find(p => String(p.id) === String(initialItemId));
            if (match) {
                setSelectedProposal(match);
            }
        }
    }, [initialItemId, proposals]);

    // =================================================================================================
    // CRUD STATE & LOGIC
    // =================================================================================================
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);

    // Form State
    const [formData, setFormData] = useState({
        socid: '',
        date: new Date().toISOString().split('T')[0],
        project_id: '',
        note_public: '',
        lines: [] as {
            id?: string;
            productId: string;
            desc: string;
            qty: number;
            price: number;
            distrib: number;
            total: number;
        }[]
    });

    // Helper to calculate line total
    const calculateLineTotal = (qty: number, price: number, discount: number) => {
        const subtotal = qty * price;
        const discAmount = (subtotal * discount) / 100;
        return subtotal - discAmount;
    };

    // Open Create Modal
    const handleOpenCreate = () => {
        setEditingId(null);
        setFormData({
            socid: '',
            date: new Date().toISOString().split('T')[0],
            project_id: '',
            note_public: '',
            lines: []
        });
        setIsFormOpen(true);
    };

    // Deeplink HITL do agente (#57/#78): create_supplier_proposal abre o formulário
    // pré-preenchido (incl. linhas) p/ o usuário revisar e confirmar.
    const prefill = usePrefill();
    const appliedPrefillRef = useRef<PrefillResult | null>(null);
    useEffect(() => {
        if (!prefill || appliedPrefillRef.current === prefill) return;
        if (prefill.kind === 'create_supplier_proposal') {
            appliedPrefillRef.current = prefill;
            const lines = Array.isArray(prefill.data.lines) ? prefill.data.lines : [];
            setEditingId(null);
            setFormData({
                socid: prefill.data.socid || '',
                date: prefill.data.date || new Date().toISOString().split('T')[0],
                project_id: prefill.data.project_id || '',
                note_public: '',
                lines: lines.map((l: any) => {
                    const qty = Number(l.qty) || 1;
                    const price = Number(l.subprice) || 0;
                    const distrib = Number(l.remise_percent) || 0;
                    return { productId: l.fk_product ? String(l.fk_product) : '', desc: l.desc || '', qty, price, distrib, total: calculateLineTotal(qty, price, distrib) };
                }),
            });
            setIsFormOpen(true);
            toast.info('Revise os itens e confirme a criação da solicitação de preço.');
        } else if (prefill.kind === 'edit_supplier_proposal') {
            const prop = proposals.find(p => String(p.id) === String(prefill.data.id));
            if (!prop) return; // aguarda os dados
            appliedPrefillRef.current = prefill;
            handleOpenEdit(prop); // carrega dados + linhas + abre o formulário
            const extra = Array.isArray(prefill.data.lines) ? prefill.data.lines : [];
            setFormData(prev => ({
                ...prev,
                date: prefill.data.date || prev.date,
                project_id: prefill.data.project_id ?? prev.project_id,
                lines: [...prev.lines, ...extra.map((l: any) => {
                    const qty = Number(l.qty) || 1;
                    const price = Number(l.subprice) || 0;
                    const distrib = Number(l.remise_percent) || 0;
                    return { productId: l.fk_product ? String(l.fk_product) : '', desc: l.desc || '', qty, price, distrib, total: calculateLineTotal(qty, price, distrib) };
                })],
            }));
            toast.info('Revise as mudanças e salve a solicitação de preço.');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [prefill, proposals, proposalLines]);

    // Open Edit Modal
    const handleOpenEdit = (prop: SupplierProposal) => {
        const existingLines = proposalLines.filter(l => String(l.parent_id) === String(prop.id));

        setEditingId(prop.id);
        setFormData({
            socid: prop.socid,
            date: new Date(prop.datec * 1000).toISOString().split('T')[0],
            project_id: prop.project_id || '',
            note_public: '',
            lines: existingLines.map(l => ({
                id: l.id,
                productId: l.product_id || '',
                desc: l.description,
                qty: l.qty,
                price: l.subprice,
                distrib: 0,
                total: l.total_ht
            }))
        });
        setIsFormOpen(true);
    };

    // Add Line to Form
    const handleAddLine = () => {
        setFormData(prev => ({
            ...prev,
            lines: [...prev.lines, { productId: '', desc: '', qty: 1, price: 0, distrib: 0, total: 0 }]
        }));
    };

    // Save (Create or Update)
    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.socid) return alert("Selecione um fornecedor.");

        setIsSubmitting(true);
        try {
            // 1. CREATE FLOW
            if (!editingId) {
                const payload = {
                    socid: formData.socid,
                    project_id: formData.project_id || null,
                    date: new Date(formData.date).getTime() / 1000,
                    lines: formData.lines.map(l => ({
                        fk_product: l.productId || null,
                        desc: l.desc,
                        qty: l.qty,
                        subprice: l.price,
                        remise_percent: l.distrib,
                        product_type: 0
                    }))
                };

                await DolibarrService.createSupplierProposal(config, payload);
                alert("Solicitação Criada!");
            }
            // 2. UPDATE FLOW
            else {
                // Update Header
                const headerPayload = {
                    socid: formData.socid,
                    project_id: formData.project_id || null,
                    date: new Date(formData.date).getTime() / 1000,
                };
                await DolibarrService.updateSupplierProposal(config, editingId, headerPayload);

                // Sync Lines
                const originalLines = proposalLines.filter(l => String(l.parent_id) === String(editingId));
                const currentLines = formData.lines;

                const linesToDelete = originalLines.filter(ol => !currentLines.find(cl => cl.id === ol.id));
                const linesToUpdate = currentLines.filter(cl => cl.id && originalLines.find(ol => ol.id === cl.id));
                const linesToAdd = currentLines.filter(cl => !cl.id);

                for (const line of linesToDelete) {
                    await DolibarrService.deleteSupplierProposalLine(config, editingId, line.id);
                }

                for (const line of linesToUpdate) {
                    await DolibarrService.updateSupplierProposalLine(config, editingId, line.id!, {
                        fk_product: line.productId || null,
                        desc: line.desc,
                        qty: line.qty,
                        subprice: line.price,
                        remise_percent: line.distrib
                    });
                }

                for (const line of linesToAdd) {
                    await DolibarrService.addSupplierProposalLine(config, editingId, {
                        fk_product: line.productId || null,
                        desc: line.desc,
                        qty: line.qty,
                        subprice: line.price,
                        remise_percent: line.distrib,
                        product_type: 0
                    });
                }

                alert("Solicitação Atualizada!");
            }

            setIsFormOpen(false);
            if (onRefresh) onRefresh();
            refetchProposals();
            refetchLines();

            if (editingId && selectedProposal?.id === editingId) {
                setSelectedProposal(null);
            }

        } catch (err: any) {
            log.error("Failed to save supplier proposal", err);
            alert("Erro ao salvar: " + (err.message || 'Erro desconhecido'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const getSupplierName = (socid: string) => {
        const supplier = suppliers.find(c => String(c.id) === String(socid));
        return supplier ? supplier.name : (socid ? `Desconhecido (${socid})` : 'Desconhecido');
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

    // Filtro de status (Tabs) aplicado antes de busca/ordenação (#121).
    const statusFilteredProposals = useMemo(() => {
        return proposals.filter(p => {
            if (filterStatus === 'open') return p.statut === '1';
            if (filterStatus === 'signed') return p.statut === '2' || p.statut === '4';
            if (filterStatus === 'draft') return p.statut === '0';
            if (filterStatus === 'declined') return p.statut === '3';
            return true;
        });
    }, [proposals, filterStatus]);

    // Busca + ordenação padronizadas (#121). Busca por ref/fornecedor; ordena por data (desc por padrão).
    const controls = useListControls(statusFilteredProposals, {
        searchText: (p) => `${p.ref || ''} ${getSupplierName(p.socid) || ''}`,
        sorts: [
            { key: 'date', label: 'Data', get: (p) => p.datec ?? 0 },
            { key: 'ref', label: 'Referência', get: (p) => p.ref },
            { key: 'total', label: 'Valor', get: (p) => p.total_ht ?? 0 },
        ],
        initialSortKey: 'date',
        initialSortDir: 'desc',
    });
    const filteredProposals = controls.result;

    const getStatusBadge = (status: string) => <StatusBadge status={status} config={supplierProposalStatuses} />;

    const handleCloseProposal = async (status: '2' | '3') => {
        if (!selectedProposal) return;
        setProcessingId(selectedProposal.id);
        try {
            await DolibarrService.closeSupplierProposal(config, selectedProposal.id, parseInt(status) as 2 | 3);
            alert(status === '2' ? "Solicitação Assinada!" : "Solicitação Recusada.");
            setSelectedProposal(null);
            if (onRefresh) onRefresh();
            refetchProposals();
        } catch (e: any) {
            log.error("Failed to close supplier proposal", e);
            alert("Ação falhou: " + e.message);
        } finally {
            setProcessingId(null);
        }
    };

    const SearchableSelect = ({ options, value, onChange, placeholder = "Selecione...", className = "" }: any) => {
        const [isOpen, setIsOpen] = useState(false);
        const [search, setSearch] = useState("");
        const wrapperRef = React.useRef<HTMLDivElement>(null);
        const selectedLabel = options.find((o: any) => String(o.value) === String(value))?.label;

        useEffect(() => {
            const handleClickOutside = (event: MouseEvent) => {
                if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                    setIsOpen(false);
                }
            };
            document.addEventListener("mousedown", handleClickOutside);
            return () => document.removeEventListener("mousedown", handleClickOutside);
        }, []);

        const filteredOptions = options.filter((o: any) =>
            o.label.toLowerCase().includes(search.toLowerCase())
        );

        return (
            <div className={`relative ${className}`} ref={wrapperRef}>
                <div
                    className="w-full rounded-md border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white py-2 px-3 text-sm cursor-pointer flex justify-between items-center"
                    onClick={() => { setIsOpen(!isOpen); setSearch(""); }}
                >
                    <span className={!value ? "text-slate-500" : ""}>{selectedLabel || placeholder}</span>
                    <Search size={14} className="text-slate-400" />
                </div>

                {isOpen && (
                    <div className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg max-h-60 overflow-y-auto">
                        <div className="p-2 sticky top-0 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700">
                            <input
                                autoFocus
                                type="text"
                                className="w-full text-xs p-1.5 border rounded dark:bg-slate-900 dark:border-slate-700"
                                placeholder="Filtrar..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                            />
                        </div>
                        {filteredOptions.length > 0 ? (
                            filteredOptions.map((opt: any) => (
                                <div
                                    key={opt.value}
                                    className={`px-3 py-2 text-sm cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 ${String(opt.value) === String(value) ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600' : ''}`}
                                    onClick={() => {
                                        onChange(opt.value);
                                        setIsOpen(false);
                                    }}
                                >
                                    {opt.label}
                                </div>
                            ))
                        ) : (
                            <div className="p-3 text-xs text-slate-500 text-center">Nenhum resultado.</div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    // --- RENDER SUB-COMPONENTS ---

    const renderHeader = (
        <div className={selectedProposal ? 'hidden lg:block' : 'block'}>
            <PageHeader
                title="Solicitações de Preço"
                subtitle="Demande de prix"
                actions={
                    <div className="flex items-center gap-2">
                        <ListToolbar controls={controls} searchPlaceholder="Buscar ref ou fornecedor..." />
                        <Button
                            variant="secondary"
                            icon={<Sparkles size={16} />}
                            onClick={() => navigate('/smart_quotation')}
                            className="hidden md:flex !bg-gradient-to-r !from-purple-600 !to-indigo-600 hover:!from-purple-700 hover:!to-indigo-700 !text-white"
                        >
                            Assistente IA
                        </Button>
                        <Button icon={<Plus size={16} />} onClick={handleOpenCreate}>
                            Nova Solicitação
                        </Button>
                    </div>
                }
                tabs={
                    <Tabs value={filterStatus} onChange={(v) => setFilterStatus(v as any)}>
                        <Tab value="all">Todos</Tab>
                        <Tab value="open">Abertas</Tab>
                        <Tab value="signed">Assinadas</Tab>
                        <Tab value="draft">Rascunhos</Tab>
                        <Tab value="declined">Recusadas</Tab>
                    </Tabs>
                }
            />
        </div>
    );

    const Row = ({ index, style }: { index: number, style: React.CSSProperties }) => {
        const proposal = filteredProposals[index];

        return (
            <div style={{ ...style, paddingLeft: 8, paddingRight: 8, paddingBottom: 8 }}>
                <Card
                    onClick={() => setSelectedProposal(proposal)}
                    selected={selectedProposal?.id === proposal.id}
                    hoverable
                    padding="md"
                >
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-slate-800 dark:text-white truncate">
                                {proposal.ref}
                            </span>
                            {getStatusBadge(proposal.statut)}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <span className="text-sm font-bold text-slate-900 dark:text-white">
                                ${proposal.total_ht.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </span>
                            {(proposal.statut === '0' || proposal.statut === '1') && (
                                <ConfirmDeleteButton
                                    onDelete={() => DolibarrService.deleteSupplierProposal(config, proposal.id)}
                                    onDeleted={() => { if (selectedProposal?.id === proposal.id) setSelectedProposal(null); refetchProposals(); }}
                                    itemLabel={proposal.ref}
                                />
                            )}
                        </div>
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                        <div className="flex items-center gap-2 truncate">
                            <span className="truncate max-w-[150px]">{getSupplierName(proposal.socid)}</span>
                            {proposal.project_id && (
                                <span className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-[10px]">
                                    <FolderKanban size={10} />
                                    <span className="truncate max-w-[100px]">{getProjectName(proposal.project_id)}</span>
                                </span>
                            )}
                        </div>
                        <span>{new Date(proposal.datec * 1000).toLocaleDateString()}</span>
                    </div>
                </Card>
            </div>
        );
    };

    const renderListContent = filteredProposals.length === 0 ? (
        <div className="p-6">
            <EmptyState
                icon={FileText}
                title="Nenhuma solicitação encontrada"
                description="Tente ajustar os filtros ou crie uma nova solicitação."
                action={<Button onClick={handleOpenCreate} icon={<Plus size={16} />}>Nova Solicitação</Button>}
            />
        </div>
    ) : (
        <AutoSizer>
            {({ height, width }) => (
                <ListWindow
                    height={height}
                    width={width}
                    itemCount={filteredProposals.length}
                    itemSize={100}
                >
                    {Row}
                </ListWindow>
            )}
        </AutoSizer>
    );

    const renderDetail = selectedProposal ? (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950/50">
            {/* Detail Header */}
            <PageHeader
                title={
                    <span className="flex items-center gap-2">
                        {selectedProposal.ref}
                        {getStatusBadge(selectedProposal.statut)}
                    </span>
                }
                subtitle={`${getSupplierName(selectedProposal.socid)} • ${new Date(selectedProposal.datec * 1000).toLocaleDateString()}`}
                onBack={() => setSelectedProposal(null)}
                actions={
                    <button onClick={() => setSelectedProposal(null)} className="hidden lg:block p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
                }
            />

            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">

                {/* Actions Toolbar */}
                <div className="flex flex-wrap gap-2 justify-end">
                    {(selectedProposal.statut === '0' || selectedProposal.statut === '1') && (
                        <>
                            <button
                                onClick={() => handleOpenEdit(selectedProposal)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-600 hover:bg-amber-100 rounded-lg text-sm font-medium transition-colors border border-amber-200"
                            >
                                <Edit size={16} /> Editar
                            </button>
                            <div className="flex items-center px-3 py-1.5 bg-red-50 hover:bg-red-100 rounded-lg text-red-600 transition-colors border border-red-200">
                                <ConfirmDeleteButton
                                    onDelete={() => DolibarrService.deleteSupplierProposal(config, selectedProposal.id)}
                                    onDeleted={() => { setSelectedProposal(null); refetchProposals(); }}
                                    itemLabel={selectedProposal.ref}
                                    withLabel
                                    className="!text-red-600"
                                />
                            </div>
                        </>
                    )}
                </div>

                {/* Approval Action Bar */}
                {selectedProposal.statut === '1' && (
                    <div className="flex items-center justify-between p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-100 dark:border-blue-900/30">
                        <span className="text-sm font-medium text-blue-800 dark:text-blue-300">Ação de Resposta:</span>
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

                {/* Main Info Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                        <span className="text-xs text-slate-500 uppercase font-bold">Fornecedor</span>
                        <div className="font-medium text-slate-800 dark:text-white mt-1 text-base">{getSupplierName(selectedProposal.socid)}</div>
                    </div>
                    <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                        <span className="text-xs text-slate-500 uppercase font-bold">Projeto</span>
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
                                <span className="text-slate-400 italic text-sm">Não vinculado</span>
                            )}
                        </div>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                    <span className="text-xs text-slate-500 uppercase font-bold">Responsáveis</span>
                    <div className="mt-2 space-y-2">
                        <div className="text-sm flex justify-between border-b border-slate-50 dark:border-slate-800 pb-2">
                            <span className="text-slate-500">Autor:</span> <span className="font-medium text-slate-800 dark:text-white">{getUserName(selectedProposal.fk_user_author)}</span>
                        </div>
                        {showDebug && (
                            <div className="pt-2">
                                <button
                                    onClick={() => setShowDebug(!showDebug)}
                                    className="text-xs text-red-400 hover:text-red-500 mb-1"
                                >
                                    Hide Debug
                                </button>
                                <textarea
                                    readOnly
                                    className="w-full h-24 text-[10px] font-mono p-1 border border-slate-200 bg-slate-50 rounded"
                                    value={JSON.stringify(selectedProposal, null, 2)}
                                />
                            </div>
                        )}
                        {!showDebug && (
                            <button
                                onClick={() => setShowDebug(true)}
                                className="text-[10px] text-slate-300 hover:text-slate-500"
                            >
                                SHOW DEBUG
                            </button>
                        )}
                    </div>
                </div>

                {/* Lines Table */}
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
                    <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
                        <h4 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                            <FileText size={16} className="text-slate-400" />
                            Itens
                        </h4>
                        <span className="text-xs bg-slate-200 dark:bg-slate-700 px-2 py-0.5 rounded-full text-slate-600 dark:text-slate-300">
                            {proposalLines.filter(l => String(l.parent_id) === String(selectedProposal.id)).length}
                        </span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500">
                                <tr>
                                    <th className="px-4 py-2 text-left font-medium">Descrição</th>
                                    <th className="px-4 py-2 text-right font-medium w-20">Qtd</th>
                                    <th className="px-4 py-2 text-right font-medium w-24">Preço</th>
                                    <th className="px-4 py-2 text-right font-medium w-24">Total</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {(proposalLines.filter(l => String(l.parent_id) === String(selectedProposal.id))).map((line) => (
                                    <tr key={line.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                                        <td className="px-4 py-3 text-slate-800 dark:text-slate-200">
                                            <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(line.description || '') }} className="prose dark:prose-invert text-sm max-w-none line-clamp-2" />
                                        </td>
                                        <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400">{line.qty}</td>
                                        <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400">${line.subprice?.toLocaleString()}</td>
                                        <td className="px-4 py-3 text-right font-medium text-slate-800 dark:text-white">${line.total_ht.toLocaleString()}</td>
                                    </tr>
                                ))}
                                {(proposalLines.filter(l => String(l.parent_id) === String(selectedProposal.id))).length === 0 && (
                                    <tr>
                                        <td colSpan={4} className="px-4 py-8 text-center text-slate-400 italic">
                                            Nenhum item nesta solicitação.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                            <tfoot className="bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-800">
                                <tr>
                                    <td colSpan={3} className="px-4 py-3 text-right font-bold text-slate-600 dark:text-slate-400 uppercase text-xs tracking-wider">Total (HT)</td>
                                    <td className="px-4 py-3 text-right font-bold text-indigo-600 dark:text-indigo-400 text-base">${selectedProposal.total_ht.toLocaleString()}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    ) : (
        <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <FileText size={48} className="mb-4 opacity-50" />
            <p>Selecione uma solicitação para ver detalhes.</p>
        </div>
    );

    return (
        <>
            <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 transition-colors">
                {renderHeader}
                <MasterDetailLayout
                    showDetail={!!selectedProposal}
                    onCloseDetail={() => setSelectedProposal(null)}
                    listWidth="1/3"
                    list={<div className="h-full">{renderListContent}</div>}
                    detail={renderDetail}
                />
            </div>

            {/* CREATE / EDIT COMPLETION MODAL */}
            {isFormOpen && (
                <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <form onSubmit={handleSave} className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col border border-slate-200 dark:border-slate-800 animate-in zoom-in-95">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 rounded-t-xl">
                            <h3 className="font-bold text-lg dark:text-white flex items-center gap-2">
                                <FileText size={20} className="text-indigo-500" />
                                {editingId ? 'Editar Solicitação' : 'Nova Solicitação'}
                            </h3>
                            <button type="button" onClick={() => setIsFormOpen(false)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"><X size={20} /></button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 space-y-6">
                            {/* HEADER */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Fornecedor *</label>
                                    <SearchableSelect
                                        options={suppliers.map(c => ({ value: c.id, label: c.name }))}
                                        value={formData.socid}
                                        onChange={(val: string) => setFormData(prev => ({ ...prev, socid: val }))}
                                        placeholder="Selecione o Fornecedor..."
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Data *</label>
                                        <input
                                            type="date"
                                            required
                                            value={formData.date}
                                            onChange={e => setFormData({ ...formData, date: e.target.value })}
                                            className="w-full rounded-md border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white py-2 px-3 text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Projeto</label>
                                        <SearchableSelect
                                            options={[{ value: '', label: 'Nenhum' }, ...projects.map(p => ({ value: p.id, label: `${p.ref} - ${p.title}` }))]}
                                            value={formData.project_id}
                                            onChange={(val: string) => setFormData(prev => ({ ...prev, project_id: val }))}
                                            placeholder="Selecione..."
                                        />
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nota Pública</label>
                                <textarea
                                    value={formData.note_public}
                                    onChange={e => setFormData({ ...formData, note_public: e.target.value })}
                                    rows={2}
                                    className="w-full rounded-md border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white py-2 px-3 text-sm"
                                    placeholder="Observações..."
                                />
                            </div>

                            <hr className="border-slate-200 dark:border-slate-700" />

                            {/* LINES */}
                            <div>
                                <div className="flex justify-between items-center mb-2">
                                    <h4 className="font-bold text-slate-800 dark:text-white text-sm">Itens</h4>
                                    <button
                                        type="button"
                                        onClick={handleAddLine}
                                        className="text-xs flex items-center gap-1 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 px-2 py-1 rounded font-medium transition-colors"
                                    >
                                        <Plus size={14} /> Adicionar Item
                                    </button>
                                </div>
                                <div className="space-y-3">
                                    {formData.lines.map((line, idx) => (
                                        <div key={idx} className="flex gap-2 items-start bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-100 dark:border-slate-800">
                                            <div className="flex-1 space-y-2">
                                                <div className="flex flex-col gap-2">

                                                    <div>
                                                        <SearchableSelect
                                                            options={[{ value: '', label: '(Produto Livre)' }, ...products.map(p => ({ value: p.id, label: `${p.ref} - ${p.label}` }))]}
                                                            value={line.productId}
                                                            onChange={(val: string) => {
                                                                const prod = products.find(p => String(p.id) === String(val));
                                                                const newLines = [...formData.lines];
                                                                newLines[idx].productId = val;
                                                                if (prod) {
                                                                    newLines[idx].desc = prod.description || prod.label;
                                                                    newLines[idx].price = prod.price;
                                                                }
                                                                newLines[idx].total = calculateLineTotal(newLines[idx].qty, newLines[idx].price, newLines[idx].distrib);
                                                                setFormData({ ...formData, lines: newLines });
                                                            }}
                                                            placeholder="Buscar Produto..."
                                                            className="text-sm"
                                                        />
                                                    </div>
                                                    <RichTextEditor
                                                        value={line.desc}
                                                        onChange={(val) => {
                                                            const newLines = [...formData.lines];
                                                            newLines[idx].desc = val;
                                                            setFormData({ ...formData, lines: newLines });
                                                        }}
                                                        placeholder="Descrição..."
                                                        className="w-full"
                                                    />
                                                </div>
                                                <div className="flex gap-2 items-center">
                                                    <div className="w-20">
                                                        <span className="text-[10px] text-slate-500 block">Qtd</span>
                                                        <input
                                                            type="number"
                                                            step="0.1"
                                                            value={line.qty}
                                                            onChange={e => {
                                                                const val = parseFloat(e.target.value) || 0;
                                                                const newLines = [...formData.lines];
                                                                newLines[idx].qty = val;
                                                                newLines[idx].total = calculateLineTotal(val, newLines[idx].price, newLines[idx].distrib);
                                                                setFormData({ ...formData, lines: newLines });
                                                            }}
                                                            className="w-full text-xs rounded border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white py-1 px-2 text-right"
                                                        />
                                                    </div>
                                                    <div className="w-24">
                                                        <span className="text-[10px] text-slate-500 block">Preço Unit.</span>
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            value={line.price}
                                                            onChange={e => {
                                                                const val = parseFloat(e.target.value) || 0;
                                                                const newLines = [...formData.lines];
                                                                newLines[idx].price = val;
                                                                newLines[idx].total = calculateLineTotal(newLines[idx].qty, val, newLines[idx].distrib);
                                                                setFormData({ ...formData, lines: newLines });
                                                            }}
                                                            className="w-full text-xs rounded border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white py-1 px-2 text-right"
                                                        />
                                                    </div>
                                                    <div className="flex-1 text-right">
                                                        <span className="text-[10px] text-slate-500 block">Total</span>
                                                        <div className="text-sm font-bold text-slate-700 dark:text-slate-300 py-1">
                                                            ${line.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const newLines = [...formData.lines];
                                                    newLines.splice(idx, 1);
                                                    setFormData({ ...formData, lines: newLines });
                                                }}
                                                className="mt-1 p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    ))}
                                    {formData.lines.length === 0 && (
                                        <div className="text-center py-6 text-slate-400 text-sm border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-lg">
                                            Nenhum item adicionado.
                                        </div>
                                    )}
                                </div>
                                <div className="mt-4 flex justify-end gap-4 items-center border-t border-slate-200 p-2">
                                    <div className="text-right">
                                        <span className="text-xs text-slate-500 uppercase font-bold">Total Estimado</span>
                                        <div className="text-xl font-bold text-indigo-600 dark:text-indigo-400">
                                            ${formData.lines.reduce((acc, curr) => acc + curr.total, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3 bg-slate-50 dark:bg-slate-800/50 rounded-b-xl">
                            <button
                                type="button"
                                onClick={() => setIsFormOpen(false)}
                                className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700"
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="flex items-center gap-2 px-6 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 shadow-sm disabled:opacity-50"
                            >
                                {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                                {editingId ? 'Salvar Alterações' : 'Criar Solicitação'}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </>
    );
};

export default SupplierProposalList;
