import React, { useState, useMemo, useEffect } from 'react';
import { Proposal, DolibarrConfig, AppView, Product, ProposalLine } from '../types';
import { FileText, Search, ExternalLink, PenTool, CheckCircle, XCircle, Send, Archive, Kanban, List, ShoppingCart, Download, Loader2, FileSignature, Scale, AlertTriangle, ShieldCheck, X, Plus, Trash2, FolderKanban, Ban, Save, Edit, ChevronLeft } from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { AiService } from '../services/aiService';
import { LinkedObjects } from './common/LinkedObjects';
import { RichTextEditor } from './common/RichTextEditor';
import { useDolibarr } from '../context/DolibarrContext';
import { useDolibarrLink } from '../hooks/useDolibarrLink';
import { useProposals, useCustomers, useProducts, useProjects, useProposalLines, useUsers } from '../hooks/dolibarr';
import { GenericListLayout } from './common/GenericListLayout';
import { PaginationControls } from './common/PaginationControls';
import { FixedSizeList as ListWindow } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';

interface ProposalListProps {
    onNavigate?: (view: AppView, id: string) => void;
    onRefresh?: () => void;
    initialItemId?: string;
}

const ProposalList: React.FC<ProposalListProps> = ({ onNavigate, onRefresh, initialItemId }) => {
    const { config } = useDolibarr();
    const { data: proposalsData, isRefetching: isRefetchingProposals, refetch: refetchProposals } = useProposals(config);
    const proposals = proposalsData || [];
    const { data: customersData } = useCustomers(config);
    const customers = customersData || [];
    const { data: productsData } = useProducts(config);
    const products = productsData || [];
    const { data: projectsData } = useProjects(config);
    const projects = projectsData || [];
    const { data: proposalLinesData, refetch: refetchLines } = useProposalLines(config);
    const proposalLines = proposalLinesData || [];
    const { data: users = [] } = useUsers(config);

    if (!config) return <div className="p-8 text-center">Carregando configuração...</div>;

    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'signed' | 'draft' | 'declined'>('all');
    const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [auditResult, setAuditResult] = useState<{ id: string, result: any } | null>(null);
    const [auditPayload, setAuditPayload] = useState<any>(null);
    const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
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
            id?: string; // If existing line
            productId: string;
            desc: string;
            qty: number;
            price: number;
            discount: number;
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

    // Open Edit Modal
    const handleOpenEdit = (prop: Proposal) => {
        // Find existing lines
        const existingLines = proposalLines.filter(l => String(l.parent_id) === String(prop.id));

        setEditingId(prop.id);
        setFormData({
            socid: prop.socid,
            date: new Date(prop.date).toISOString().split('T')[0],
            project_id: prop.project_id || '',
            note_public: '', // API mapping might not return note_public in simple fetch, ignored for now
            lines: existingLines.map(l => ({
                id: l.id,
                productId: l.product_id || '',
                desc: l.description || l.label,
                qty: l.qty,
                price: l.subprice,
                discount: l.remise_percent || 0,
                total: l.total_ht
            }))
        });
        setIsFormOpen(true);
    };

    // Handle Delete
    const handleDelete = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (!confirm("Tem certeza que deseja EXCLUIR esta proposta? Esta ação é irreversível e excluirá todas as linhas.")) return;

        setProcessingId(id);
        try {
            await DolibarrService.deleteProposal(config, id);
            // Optimistic update or refresh
            alert("Proposta excluída com sucesso!");
            if (selectedProposal?.id === id) setSelectedProposal(null);
            refetchProposals();
        } catch (err: any) {
            console.error(err);
            alert("Erro ao excluir proposta: " + (err.message || 'Erro desconhecido'));
        } finally {
            setProcessingId(null);
        }
    };

    // Add Line to Form
    const handleAddLine = () => {
        setFormData(prev => ({
            ...prev,
            lines: [...prev.lines, { productId: '', desc: '', qty: 1, price: 0, discount: 0, total: 0 }]
        }));
    };

    // Identify deleted lines during edit
    // Logic: Original lines - Current lines (by ID) = Deleted lines

    // Save (Create or Update)
    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.socid) return alert("Selecione um cliente.");

        setIsSubmitting(true);
        try {
            // 1. CREATE FLOW
            if (!editingId) {
                const payload = {
                    socid: formData.socid,
                    project_id: formData.project_id || null,
                    date: new Date(formData.date).getTime() / 1000,
                    note_public: formData.note_public,
                    lines: formData.lines.map(l => ({
                        fk_product: l.productId || null,
                        desc: l.desc,
                        qty: l.qty,
                        subprice: l.price,
                        remise_percent: l.discount,
                        product_type: 0 // Default product
                    }))
                };

                await DolibarrService.createProposal(config, payload);
                alert("Proposta Criada!");
            }
            // 2. UPDATE FLOW
            else {
                // 2a. Update Header
                const headerPayload = {
                    socid: formData.socid,
                    project_id: formData.project_id || null,
                    date: new Date(formData.date).getTime() / 1000,
                    note_public: formData.note_public
                };
                await DolibarrService.updateProposal(config, editingId, headerPayload);

                // 2b. Sync Lines
                const originalLines = proposalLines.filter(l => String(l.parent_id) === String(editingId));
                const currentLines = formData.lines;

                // Identify Separations
                const linesToDelete = originalLines.filter(ol => !currentLines.find(cl => cl.id === ol.id));
                const linesToUpdate = currentLines.filter(cl => cl.id && originalLines.find(ol => ol.id === cl.id));
                const linesToAdd = currentLines.filter(cl => !cl.id);

                // Execute deletions
                for (const line of linesToDelete) {
                    await DolibarrService.deleteProposalLine(config, editingId, line.id);
                }

                // Execute updates
                for (const line of linesToUpdate) {
                    await DolibarrService.updateProposalLine(config, editingId, line.id!, {
                        fk_product: line.productId || null,
                        desc: line.desc,
                        qty: line.qty,
                        subprice: line.price,
                        remise_percent: line.discount
                    });
                }

                // Execute additions
                for (const line of linesToAdd) {
                    await DolibarrService.addProposalLine(config, editingId, {
                        fk_product: line.productId || null,
                        desc: line.desc,
                        qty: line.qty,
                        subprice: line.price,
                        remise_percent: line.discount,
                        product_type: 0
                    });
                }

                alert("Proposta Atualizada!");
            }

            // Success cleanup
            setIsFormOpen(false);
            if (onRefresh) onRefresh();
            refetchProposals();
            refetchLines();

            // If viewing details of the edited item, close it to avoid stale data display or fetch fresh
            if (editingId && selectedProposal?.id === editingId) {
                // Ideally refetch details, but closing is safer for MVP
                setSelectedProposal(null);
            }

        } catch (err: any) {
            console.error(err);
            alert("Erro ao salvar: " + (err.message || 'Erro desconhecido'));
        } finally {
            setIsSubmitting(false);
        }
    };

    // =================================================================================================

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

    const handleAudit = async (e: React.MouseEvent, prop: Proposal) => {
        e.stopPropagation();
        setProcessingId(prop.id);
        try {
            const payload = {
                id: prop.id,
                ref: prop.ref,
                total_ttc: prop.total_ttc,
                date: prop.date,
                statut: prop.statut,
                customer: getCustomerName(prop.socid),
                lines: proposalLines.filter(l => String(l.parent_id) === String(prop.id)).map(l => ({
                    description: l.description || l.label,
                    qty: l.qty,
                    price: l.subprice,
                    discount: l.remise_percent || 0,
                    total: l.total_ht
                }))
            };
            // Debug info
            setAuditPayload(payload);
            const resultStr = await AiService.auditProposal(payload);
            if (resultStr) {
                setAuditResult({ id: prop.id, result: JSON.parse(resultStr) });
            }
        } catch (err) { console.error(err); } finally { setProcessingId(null); }
    };

    const handleDownloadPdf = (e: React.MouseEvent | KeyboardEvent, ref: string) => {
        if (e && 'stopPropagation' in e) e.stopPropagation();
        DolibarrService.downloadDocument(config, 'proposal', ref);
    };

    const handleCloseProposal = async (status: '2' | '3') => {
        if (!selectedProposal) return;
        setProcessingId(selectedProposal.id);
        try {
            await DolibarrService.closeProposal(config, selectedProposal.id, parseInt(status) as 2 | 3);
            alert(status === '2' ? "Proposta Assinada!" : "Proposta Recusada.");
            setSelectedProposal(null);
            if (onRefresh) onRefresh();
            refetchProposals();
        } catch (e: any) {
            console.error(e);
            alert("Ação falhou: " + e.message);
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
            if (onNavigate) onNavigate('orders', '');
            refetchProposals();
        } catch (e: any) {
            console.error(e);
            alert("Falha ao criar pedido: " + e.message);
        } finally {
            setProcessingId(null);
        }
    };

    const kanbanColumns = [
        { id: '0', title: 'Rascunho', color: 'slate' },
        { id: '1', title: 'Aberto', color: 'blue' },
        { id: '2', title: 'Assinado', color: 'emerald' },
        { id: '3', title: 'Recusado', color: 'red' },
    ];

    // Reusable Searchable Select Component
    const SearchableSelect = ({
        options,
        value,
        onChange,
        placeholder = "Selecione...",
        className = ""
    }: {
        options: { value: string, label: string }[],
        value: string,
        onChange: (val: string) => void,
        placeholder?: string,
        className?: string
    }) => {
        const [isOpen, setIsOpen] = useState(false);
        const [search, setSearch] = useState("");
        const wrapperRef = React.useRef<HTMLDivElement>(null);

        const selectedLabel = options.find(o => String(o.value) === String(value))?.label;

        useEffect(() => {
            const handleClickOutside = (event: MouseEvent) => {
                if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                    setIsOpen(false);
                }
            };
            document.addEventListener("mousedown", handleClickOutside);
            return () => document.removeEventListener("mousedown", handleClickOutside);
        }, []);

        const filteredOptions = options.filter(o =>
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
                            filteredOptions.map(opt => (
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

    // Virtual List Row Renderer
    const Row = ({ index, style }: { index: number, style: React.CSSProperties }) => {
        const prop = filteredProposals[index];
        const itemStyle = {
            ...style,
            top: (parseFloat(style.top as string) + 8) + 'px',
            height: (parseFloat(style.height as string) - 8) + 'px',
            left: '8px',
            width: 'calc(100% - 16px)'
        };

        return (
            <div
                style={itemStyle}
                onClick={() => setSelectedProposal(prop)}
                className={`p-4 rounded-xl border cursor-pointer transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 group ${selectedProposal?.id === prop.id
                    ? `border-${config?.themeColor}-500 bg-${config?.themeColor}-50 dark:bg-${config?.themeColor}-900/20`
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:shadow-md'
                    }`}
            >
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

                    {/* Action Buttons */}
                    <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                            onClick={(e) => { e.stopPropagation(); handleOpenEdit(prop); }}
                            className="p-2 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-slate-100"
                            title="Editar"
                        >
                            <Edit size={18} />
                        </button>
                        <button
                            onClick={(e) => handleDelete(e, prop.id)}
                            className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-slate-100"
                            title="Excluir"
                        >
                            <Trash2 size={18} />
                        </button>
                    </div>
                    <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-1"></div>
                    <button onClick={(e) => handleAudit(e, prop)} className="p-2 rounded-lg bg-violet-50 text-violet-600 hover:bg-violet-100" title="Auditoria"><Scale size={18} /></button>
                    <button onClick={(e) => handleDownloadPdf(e, prop.ref)} className="p-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200"><Download size={18} /></button>
                </div>
            </div>
        );
    };

    // --- Sub-components (Render Logic) ---

    // Header extracted
    const renderHeader = (
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

                    <button onClick={handleOpenCreate} className={`flex items-center gap-1.5 px-3 py-2 bg-${config.themeColor}-600 text-white rounded-lg hover:bg-${config.themeColor}-700 transition-colors`}>
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
    );

    // List Content Extracted
    const renderListContent = (
        <>
            {/* LIST VIEW */}
            {viewMode === 'list' && (
                filteredProposals.length === 0 ? (
                    <div className="text-center py-20 text-slate-400">
                        <FileText size={48} className="mx-auto mb-4 opacity-50" />
                        <p>Nenhuma proposta encontrada.</p>
                    </div>
                ) : (
                    <AutoSizer>
                        {({ height, width }) => (
                            <ListWindow
                                height={height}
                                width={width}
                                itemCount={filteredProposals.length}
                                itemSize={110}
                            >
                                {Row}
                            </ListWindow>
                        )}
                    </AutoSizer>
                )
            )}

            {/* KANBAN VIEW */}
            {viewMode === 'kanban' && (
                <div className="flex overflow-x-auto gap-6 h-full pb-4 p-4">
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
                                        <div key={prop.id} onClick={() => setSelectedProposal(prop)} className="bg-white dark:bg-slate-800 p-3 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 cursor-pointer hover:shadow-md transition-shadow">
                                            <div className="flex justify-between mb-2"><span className="text-xs font-mono">{prop.ref}</span></div>
                                            <h4 className="font-medium text-sm mb-1">{getCustomerName(prop.socid)}</h4>
                                            <div className="flex justify-between items-end mt-3">
                                                <span className="font-bold text-sm">${prop.total_ttc.toLocaleString()}</span>
                                                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleOpenEdit(prop); }}
                                                        className="p-1 rounded text-slate-400 hover:bg-slate-100"
                                                    >
                                                        <Edit size={14} />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </>
    );

    // Detail Panel Extracted
    const renderDetail = selectedProposal ? (
        <div className="flex flex-col h-full">
            <div className="flex-none bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-100 dark:border-slate-800 p-4 flex items-center justify-between z-10">
                <div className="flex items-center gap-3">
                    <button onClick={() => setSelectedProposal(null)} className="lg:hidden p-2 -ml-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"><ChevronLeft size={20} /></button>
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-lg font-bold dark:text-white leading-tight">{selectedProposal.ref}</h2>
                            {getStatusBadge(selectedProposal.statut)}
                        </div>
                        <span className="text-xs text-slate-500">{getCustomerName(selectedProposal.socid)}</span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => setSelectedProposal(null)} className="hidden lg:block p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950/50">
                {/* Actions Toolbar */}
                <div className="flex flex-wrap gap-2 mb-4 justify-end border-b border-slate-100 pb-4">
                    {(selectedProposal.statut === '0' || selectedProposal.statut === '1') && (
                        <>
                            <button
                                onClick={() => handleOpenEdit(selectedProposal)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-600 hover:bg-amber-100 rounded-md text-sm font-medium transition-colors"
                            >
                                <Edit size={16} /> Editar
                            </button>
                            <button
                                onClick={(e) => handleDelete(e, selectedProposal.id)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-md text-sm font-medium transition-colors"
                            >
                                <Trash2 size={16} /> Excluir
                            </button>
                        </>
                    )}
                </div>

                {/* Action Bar for Open Proposals */}
                {selectedProposal.statut === '1' && (
                    <div className="flex items-center justify-between p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-900/30 mb-6">
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
                    <div className="flex items-center justify-between p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-100 dark:border-emerald-900/30 mb-6">
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
                        className="text-xs text-slate-400 hover:text-slate-600"
                    >
                        [DEBUG]
                    </button>
                    {showDebug && (
                        <textarea
                            readOnly
                            className="w-full h-48 text-xs font-mono p-2 border border-red-200 bg-red-50 mt-2 rounded"
                            value={JSON.stringify(selectedProposal, null, 2)}
                        />
                    )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                    <div className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm">
                        <span className="text-xs text-slate-500 uppercase font-bold">Cliente</span>
                        <div className="font-medium text-slate-800 dark:text-white mt-1">{getCustomerName(selectedProposal.socid)}</div>
                    </div>
                    <div className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm">
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
                    <div className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm">
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
                        <div className="mb-6">
                            <h4 className="font-bold text-slate-800 dark:text-white mb-3 flex items-center gap-2"><List size={18} /> Itens da Proposta</h4>
                            <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden shadow-sm">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-slate-50 dark:bg-slate-800/80 text-xs text-slate-500 uppercase font-semibold">
                                        <tr>
                                            <th className="px-4 py-3">Descrição</th>
                                            <th className="px-4 py-3 text-right">Qtd</th>
                                            <th className="px-4 py-3 text-right">Preço Unit.</th>
                                            <th className="px-4 py-3 text-right">Desc. (%)</th>
                                            <th className="px-4 py-3 text-right">Total</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900/50">
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
                                                    <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400">{line.remise_percent ? `${line.remise_percent}%` : '-'}</td>
                                                    <td className="px-4 py-3 text-right font-medium text-slate-800 dark:text-white">${line.total_ht?.toLocaleString()}</td>
                                                </tr>
                                            ))
                                        ) : (
                                            <tr>
                                                <td colSpan={5} className="px-4 py-8 text-center text-slate-400 italic">Nenhum item disponível nesta visualização.</td>
                                            </tr>
                                        )}
                                    </tbody>
                                    <tfoot className="bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-800">
                                        <tr>
                                            <td colSpan={4} className="px-4 py-3 text-right font-bold text-slate-700 dark:text-slate-300">Total (S/ Imposto)</td>
                                            <td className="px-4 py-3 text-right font-bold text-slate-800 dark:text-white text-lg">${selectedProposal.total_ht?.toLocaleString()}</td>
                                        </tr>
                                        <tr>
                                            <td colSpan={4} className="px-4 py-3 text-right font-bold text-slate-700 dark:text-slate-300">Total (C/ Imposto)</td>
                                            <td className="px-4 py-3 text-right font-bold text-indigo-600 dark:text-indigo-400 text-lg">${selectedProposal.total_ttc.toLocaleString()}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                    );
                })()}

                <div className="flex justify-end gap-2 mt-auto pt-6 border-t border-slate-200 dark:border-slate-800">
                    <LinkedObjects
                        id={selectedProposal.id}
                        type="propal"
                        onNavigate={onNavigate}
                    />
                    <div className="flex gap-2">
                        <button onClick={(e) => handleDownloadPdf(e, selectedProposal.ref)} className="px-4 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-600">Baixar PDF</button>
                    </div>
                </div>
            </div>
        </div>
    ) : (
        <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <FileText size={48} className="mb-4 opacity-50" />
            <p>Selecione uma proposta para ver detalhes.</p>
        </div>
    );

    return (
        <React.Fragment>
            <GenericListLayout
                header={renderHeader}
                content={renderListContent}
                detail={renderDetail}
                isDetailOpen={!!selectedProposal}
            />

            {/* CREATE / EDIT COMPLETION MODAL */}
            {isFormOpen && (
                <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <form onSubmit={handleSave} className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col border border-slate-200 dark:border-slate-800 animate-in zoom-in-95">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 rounded-t-xl">
                            <h3 className="font-bold text-lg dark:text-white flex items-center gap-2">
                                <FileText size={20} className="text-indigo-500" />
                                {editingId ? 'Editar Proposta' : 'Nova Proposta'}
                            </h3>
                            <button type="button" onClick={() => setIsFormOpen(false)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"><X size={20} /></button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 space-y-6">
                            {/* HEADER */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Cliente *</label>
                                    <SearchableSelect
                                        options={customers.map(c => ({ value: c.id, label: c.name }))}
                                        value={formData.socid}
                                        onChange={(val) => setFormData(prev => ({ ...prev, socid: val }))}
                                        placeholder="Selecione o Cliente..."
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
                                            onChange={(val) => setFormData(prev => ({ ...prev, project_id: val }))}
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
                                    placeholder="Observações visíveis no PDF..."
                                />
                            </div>

                            <hr className="border-slate-200 dark:border-slate-700" />

                            {/* LINES */}
                            <div>
                                <div className="flex justify-between items-center mb-2">
                                    <h4 className="font-bold text-slate-800 dark:text-white text-sm">Itens da Proposta</h4>
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
                                                            onChange={(val) => {
                                                                const prod = products.find(p => String(p.id) === String(val));
                                                                const newLines = [...formData.lines];
                                                                newLines[idx].productId = val;
                                                                if (prod) {
                                                                    newLines[idx].desc = prod.description || prod.label;
                                                                    newLines[idx].price = prod.price;
                                                                }
                                                                newLines[idx].total = calculateLineTotal(newLines[idx].qty, newLines[idx].price, newLines[idx].discount);
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
                                                        placeholder="Descrição detalhada..."
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
                                                                newLines[idx].total = calculateLineTotal(val, newLines[idx].price, newLines[idx].discount);
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
                                                                newLines[idx].total = calculateLineTotal(newLines[idx].qty, val, newLines[idx].discount);
                                                                setFormData({ ...formData, lines: newLines });
                                                            }}
                                                            className="w-full text-xs rounded border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white py-1 px-2 text-right"
                                                        />
                                                    </div>
                                                    <div className="w-20">
                                                        <span className="text-[10px] text-slate-500 block">Desc. (%)</span>
                                                        <input
                                                            type="number"
                                                            step="0.1"
                                                            value={line.discount}
                                                            onChange={e => {
                                                                const val = parseFloat(e.target.value) || 0;
                                                                const newLines = [...formData.lines];
                                                                newLines[idx].discount = val;
                                                                newLines[idx].total = calculateLineTotal(newLines[idx].qty, newLines[idx].price, val);
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
                                {editingId ? 'Salvar Alterações' : 'Criar Proposta'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Audit Modal */}
            {auditResult && (
                <div className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md p-6 max-h-[85vh] overflow-y-auto">
                        <div className="flex justify-between mb-4">
                            <h3 className="font-bold text-lg dark:text-white">Resultado da Auditoria</h3>
                            <button onClick={() => setAuditResult(null)}><X size={20} /></button>
                        </div>
                        <div className="space-y-4">
                            <div className="text-3xl font-bold text-emerald-500">{auditResult.result.score}/100</div>
                            <p className="text-sm dark:text-slate-300">{auditResult.result.summary}</p>

                            {/* DEBUG PAYLOAD VIEW */}
                            {auditPayload && (
                                <details className="mt-4 p-2 bg-slate-100 dark:bg-slate-800 rounded text-xs">
                                    <summary className="cursor-pointer font-bold text-slate-500 hover:text-slate-700">Debug: Payload Enviado</summary>
                                    <pre className="mt-2 whitespace-pre-wrap font-mono text-slate-600 dark:text-slate-400">
                                        {JSON.stringify(auditPayload, null, 2)}
                                    </pre>
                                </details>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </React.Fragment>
    );
};

export default ProposalList;
