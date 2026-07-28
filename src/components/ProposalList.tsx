import React, { useState, useMemo, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { sanitizeHtml } from '../utils/sanitizeHtml';
import { usePrefill, PrefillResult } from '../hooks/usePrefill';
import { Proposal, AppView } from '../types';
import { FileText, Search, PenTool, CheckCircle, XCircle, Send, Archive, Kanban, List, ShoppingCart, Download, Loader2, FileSignature, Scale, Plus, Trash2, FolderKanban, Ban, Save, Edit, Copy, Eye } from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { AiService } from '../services/aiService';
import { LinkedObjects } from './common/LinkedObjects';
import { PdfPreviewModal } from './common/PdfPreviewModal';
import { RichTextEditor } from './common/RichTextEditor';
import { useDolibarr } from '../context/DolibarrContext';
import { useDolibarrLink } from '../hooks/useDolibarrLink';
import { useConfirm } from '../hooks/useConfirm';
import { useProposals, useCustomers, useProducts, useProjects, useProposalLines, useUsers } from '../hooks/dolibarr';
import { useListControls } from '../hooks/useListControls';
import { logger } from '../utils/logger';
import { notifyError } from '../utils/notifyError';
import { formatCurrency } from '../utils/formatUtils';

const log = logger.child('ProposalList');
import { MasterDetailLayout } from './ui/MasterDetailLayout';
import { PageHeader } from './ui/PageHeader';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { Tabs, Tab } from './ui/Tabs';
import { EmptyState } from './ui/EmptyState';
import { StatusBadge } from './ui/StatusBadge';
import { ListToolbar } from './ui/ListToolbar';
import { ListTotalBar } from './ui/ListTotalBar';
import { ConfirmDeleteButton } from './ui/ConfirmDeleteButton';
import { FixedSizeList as ListWindow } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';

const proposalStatuses = {
    '0': { label: 'Rascunho', variant: 'slate' as const, icon: <PenTool size={12} /> },
    '1': { label: 'Aberta', variant: 'blue' as const, icon: <Send size={12} /> },
    '2': { label: 'Assinada', variant: 'emerald' as const, icon: <CheckCircle size={12} /> },
    '3': { label: 'Recusada', variant: 'red' as const, icon: <XCircle size={12} /> },
    '4': { label: 'Faturada', variant: 'indigo' as const, icon: <Archive size={12} /> },
};

interface ProposalListProps {
    onNavigate?: (view: AppView, id: string) => void;
    onRefresh?: () => void;
    initialItemId?: string;
}

const ProposalList: React.FC<ProposalListProps> = ({ onNavigate, onRefresh, initialItemId }) => {
    const { config, canDo } = useDolibarr();
    const { data: proposalsData, refetch: refetchProposals } = useProposals(config);
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

    // Detect narrow viewport for responsive row height in the virtualised list.
    // The card stacks vertically on mobile (< md = 768px) and needs more height.
    const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
    useEffect(() => {
        const mq = window.matchMedia('(max-width: 767px)');
        const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);
    // Row height: desktop row fits in 110px; mobile stacked layout needs ~185px.
    const rowItemSize = isMobile ? 185 : 110;

    const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'signed' | 'draft' | 'declined'>('all');
    const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [auditResult, setAuditResult] = useState<{ id: string, result: any } | null>(null);
    const [auditPayload, setAuditPayload] = useState<any>(null);
    const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
    const [showDebug, setShowDebug] = useState(false);
    const [previewProposal, setPreviewProposal] = useState<{ id: string | number; ref: string } | null>(null);

    // Deep Link Effect
    useEffect(() => {
        if (initialItemId && proposals.length > 0) {
            const match = proposals.find(p => String(p.id) === String(initialItemId));
            if (match) setSelectedProposal(match);
        }
    }, [initialItemId, proposals]);

    // =================================================================================================
    // CRUD STATE & LOGIC
    // =================================================================================================
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);

    const [formData, setFormData] = useState({
        socid: '',
        date: new Date().toISOString().split('T')[0],
        project_id: '',
        note_public: '',
        lines: [] as {
            id?: string;
            _rowId?: string;
            productId: string;
            desc: string;
            qty: number;
            price: number;
            discount: number;
            total: number;
        }[]
    });

    const calculateLineTotal = (qty: number, price: number, discount: number) => {
        const subtotal = qty * price;
        return subtotal - (subtotal * discount) / 100;
    };

    const handleOpenCreate = () => {
        setEditingId(null);
        setFormData({ socid: '', date: new Date().toISOString().split('T')[0], project_id: '', note_public: '', lines: [] });
        setIsFormOpen(true);
    };

    // Deeplink HITL do agente (#57/#78): create_proposal abre o formulário pré-preenchido,
    // incluindo as LINHAS de itens, p/ o usuário revisar e confirmar.
    const prefill = usePrefill();
    const appliedPrefillRef = useRef<PrefillResult | null>(null);
    useEffect(() => {
        if (!prefill || appliedPrefillRef.current === prefill) return;
        if (prefill.kind === 'create_proposal') {
            appliedPrefillRef.current = prefill;
            const lines = Array.isArray(prefill.data.lines) ? prefill.data.lines : [];
            setEditingId(null);
            setFormData({
                socid: prefill.data.socid || '',
                date: prefill.data.date || new Date().toISOString().split('T')[0],
                project_id: prefill.data.project_id || '',
                note_public: prefill.data.note_public || '',
                lines: lines.map((l: any) => {
                    const qty = Number(l.qty) || 1;
                    const price = Number(l.subprice) || 0;
                    const discount = Number(l.remise_percent) || 0;
                    return { _rowId: crypto.randomUUID(), productId: l.fk_product ? String(l.fk_product) : '', desc: l.desc || '', qty, price, discount, total: calculateLineTotal(qty, price, discount) };
                }),
            });
            setIsFormOpen(true);
            toast.info('Revise os itens e confirme a criação da proposta.');
        } else if (prefill.kind === 'edit_proposal') {
            const prop = proposals.find(p => String(p.id) === String(prefill.data.id));
            if (!prop) return; // aguarda os dados
            appliedPrefillRef.current = prefill;
            handleOpenEdit(prop); // carrega dados + linhas + abre o formulário
            const extra = Array.isArray(prefill.data.lines) ? prefill.data.lines : [];
            setFormData(prev => ({
                ...prev,
                date: prefill.data.date || prev.date,
                note_public: prefill.data.note_public ?? prev.note_public,
                project_id: prefill.data.project_id ?? prev.project_id,
                lines: [...prev.lines, ...extra.map((l: any) => {
                    const qty = Number(l.qty) || 1;
                    const price = Number(l.subprice) || 0;
                    const discount = Number(l.remise_percent) || 0;
                    return { _rowId: crypto.randomUUID(), productId: l.fk_product ? String(l.fk_product) : '', desc: l.desc || '', qty, price, discount, total: calculateLineTotal(qty, price, discount) };
                })],
            }));
            toast.info('Revise as mudanças e salve a proposta.');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [prefill, proposals, proposalLines]);

    const handleOpenEdit = (prop: Proposal) => {
        const existingLines = proposalLines.filter(l => String(l.parent_id) === String(prop.id));
        setEditingId(prop.id);
        setFormData({
            socid: prop.socid,
            date: new Date(prop.date * 1000).toISOString().split('T')[0],
            project_id: prop.project_id || '',
            note_public: '',
            lines: existingLines.map(l => ({
                id: l.id,
                _rowId: crypto.randomUUID(),
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

    const handleAddLine = () => {
        setFormData(prev => ({
            ...prev,
            lines: [...prev.lines, { _rowId: crypto.randomUUID(), productId: '', desc: '', qty: 1, price: 0, discount: 0, total: 0 }]
        }));
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.socid) return toast.error("Selecione um cliente.");
        setIsSubmitting(true);
        try {
            if (!editingId) {
                await DolibarrService.createProposal(config, {
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
                        product_type: 0
                    }))
                });
                toast.success("Proposta Criada!");
            } else {
                await DolibarrService.updateProposal(config, editingId, {
                    socid: formData.socid,
                    project_id: formData.project_id || null,
                    date: new Date(formData.date).getTime() / 1000,
                    note_public: formData.note_public
                });

                const originalLines = proposalLines.filter(l => String(l.parent_id) === String(editingId));
                const currentLines = formData.lines;
                const linesToDelete = originalLines.filter(ol => !currentLines.find(cl => cl.id === ol.id));
                const linesToUpdate = currentLines.filter(cl => cl.id && originalLines.find(ol => ol.id === cl.id));
                const linesToAdd = currentLines.filter(cl => !cl.id);

                for (const line of linesToDelete) {
                    await DolibarrService.deleteProposalLine(config, editingId, line.id);
                }
                for (const line of linesToUpdate) {
                    await DolibarrService.updateProposalLine(config, editingId, line.id!, {
                        fk_product: line.productId || null,
                        desc: line.desc,
                        qty: line.qty,
                        subprice: line.price,
                        remise_percent: line.discount
                    });
                }
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
                toast.success("Proposta Atualizada!");
            }

            setIsFormOpen(false);
            if (onRefresh) onRefresh();
            refetchProposals();
            refetchLines();
            if (editingId && selectedProposal?.id === editingId) setSelectedProposal(null);
        } catch (err: any) {
            log.error("Failed to save proposal", err);
            toast.error("Erro ao salvar: " + (err.message || 'Erro desconhecido'));
        } finally {
            setIsSubmitting(false);
        }
    };

    // =================================================================================================
    // HELPERS
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

    // Filtro de status (Tabs) como pré-filtro; no kanban as colunas mostram todos os status (#121).
    const statusFilteredProposals = useMemo(() => {
        return proposals.filter(p => {
            if (viewMode === 'kanban') return true;
            if (filterStatus === 'open') return p.statut === '1';
            if (filterStatus === 'signed') return p.statut === '2' || p.statut === '4';
            if (filterStatus === 'draft') return p.statut === '0';
            if (filterStatus === 'declined') return p.statut === '3';
            return true;
        });
    }, [proposals, filterStatus, viewMode]);

    // Busca + ordenação padronizadas (#121). Busca por ref ou nome do cliente.
    const controls = useListControls(statusFilteredProposals, {
        searchText: (p) => `${p.ref || ''} ${getCustomerName(p.socid)}`,
        sorts: [
            { key: 'date', label: 'Data', get: (p) => p.date ?? 0 },
            { key: 'ref', label: 'Referência', get: (p) => p.ref },
            { key: 'total', label: 'Valor', get: (p) => p.total_ttc ?? 0 },
            { key: 'customer', label: 'Cliente', get: (p) => getCustomerName(p.socid) },
        ],
        initialSortKey: 'date',
        initialSortDir: 'desc',
    });
    const filteredProposals = controls.result;

    const { openLink } = useDolibarrLink(config);
    const confirm = useConfirm();

    const handleDuplicate = async (proposalId: string) => {
        const ok = await confirm({ message: 'Duplicar esta proposta como rascunho?' });
        if (!ok) return;
        setProcessingId(proposalId);
        try {
            await DolibarrService.cloneProposal(config, proposalId);
            toast.success('Proposta duplicada com sucesso');
            refetchProposals();
        } catch (e: any) {
            notifyError('Duplicar proposta', e);
        } finally {
            setProcessingId(null);
        }
    };

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
            setAuditPayload(payload);
            const resultStr = await AiService.auditProposal(payload);
            if (resultStr) setAuditResult({ id: prop.id, result: JSON.parse(resultStr) });
        } catch (err) { log.error("Failed to audit proposal", err); } finally { setProcessingId(null); }
    };

    const handleDownloadPdf = async (e: React.MouseEvent | KeyboardEvent, id: string | number) => {
        if (e && 'stopPropagation' in e) e.stopPropagation();
        try {
            await DolibarrService.downloadDocument('proposal', id);
        } catch {
            toast.error('Erro ao baixar PDF da proposta');
        }
    };

    const handleCloseProposal = async (status: '2' | '3') => {
        if (!selectedProposal) return;
        setProcessingId(selectedProposal.id);
        try {
            await DolibarrService.closeProposal(config, selectedProposal.id, parseInt(status) as 2 | 3);
            toast.success(status === '2' ? "Proposta Assinada!" : "Proposta Recusada.");
            setSelectedProposal(null);
            if (onRefresh) onRefresh();
            refetchProposals();
        } catch (e: any) {
            log.error("Failed to close proposal", e);
            toast.error("Ação falhou: " + e.message);
        } finally {
            setProcessingId(null);
        }
    };

    // #993: ação destrutiva (recusar proposta) exige confirmação via Dialog (useConfirm),
    // não confirm() nativo. Assinar (status 2) não é destrutivo e segue direto.
    const handleRefuseProposal = async () => {
        if (!selectedProposal) return;
        const ok = await confirm({
            title: 'Recusar proposta?',
            message: 'A proposta será marcada como recusada. Esta ação não pode ser desfeita.',
            confirmText: 'Sim, recusar',
            danger: true,
        });
        if (!ok) return;
        handleCloseProposal('3');
    };

    const handleCreateOrder = async () => {
        if (!selectedProposal) return;
        setProcessingId(selectedProposal.id);
        try {
            await DolibarrService.createOrderFromProposal(config, selectedProposal.id);
            toast.success("Pedido de Venda Criado!");
            setSelectedProposal(null);
            if (onNavigate) onNavigate('orders', '');
            refetchProposals();
        } catch (e: any) {
            log.error("Failed to create order from proposal", e);
            toast.error("Falha ao criar pedido: " + e.message);
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

    // =================================================================================================
    // SEARCHABLE SELECT (inline component)
    // =================================================================================================
    const SearchableSelect = ({
        options, value, onChange, placeholder = "Selecione...", className = ""
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
                if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setIsOpen(false);
            };
            document.addEventListener("mousedown", handleClickOutside);
            return () => document.removeEventListener("mousedown", handleClickOutside);
        }, []);

        const filteredOptions = options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()));

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
                                    data-value={String(opt.value)}
                                    className={`px-3 py-2 text-sm cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 ${String(opt.value) === String(value) ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600' : ''}`}
                                    onClick={() => { onChange(opt.value); setIsOpen(false); }}
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

    // =================================================================================================
    // VIRTUAL LIST ROW
    // =================================================================================================
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
            <div style={itemStyle} data-testid="proposal-row" data-ref={prop.ref}>
                <Card
                    selected={selectedProposal?.id === prop.id}
                    onClick={() => setSelectedProposal(prop)}
                    hoverable
                    className="h-full flex flex-col md:flex-row md:items-center justify-between gap-2 md:gap-4 group"
                >
                    <div className="flex items-start gap-3 md:gap-4 min-w-0 flex-1">
                        <div className="p-2 md:p-3 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 shrink-0">
                            <FileText size={20} className="md:hidden" />
                            <FileText size={24} className="hidden md:block" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="font-bold text-slate-800 dark:text-white">{prop.ref}</span>
                                <StatusBadge status={prop.statut} config={proposalStatuses} />
                            </div>
                            <div className="text-slate-600 dark:text-slate-300 font-medium truncate">{getCustomerName(prop.socid)}</div>
                            {prop.project_id && (
                                <div className="text-xs text-indigo-500 mt-1 flex items-center gap-1">
                                    <FolderKanban size={10} /> {getProjectName(prop.project_id)}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-2 md:gap-3 shrink-0">
                        <div className="text-right mr-1 md:mr-3">
                            <div className="text-xs text-slate-500">Total</div>
                            <div className="text-base md:text-lg font-bold text-slate-800 dark:text-white">
                                {formatCurrency(prop.total_ttc)}
                            </div>
                        </div>
                        {/* Actions: always visible on touch/mobile, hover-only on md+ */}
                        <div className="flex items-center md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                            {canDo('edit', 'proposals') && (
                            <Button variant="ghost" size="sm" icon={<Edit size={18} />} onClick={(e) => { e.stopPropagation(); handleOpenEdit(prop); }} />
                            )}
                            <Button variant="ghost" size="sm" icon={<Copy size={18} />} onClick={(e) => { e.stopPropagation(); handleDuplicate(prop.id); }} title="Duplicar" aria-label="Duplicar" loading={processingId === prop.id} disabled={!!processingId} />
                            {canDo('delete', 'proposals') && (
                            <ConfirmDeleteButton
                                onDelete={() => DolibarrService.deleteProposal(config, prop.id)}
                                onDeleted={() => {
                                    if (selectedProposal?.id === prop.id) setSelectedProposal(null);
                                    refetchProposals();
                                }}
                                itemLabel={prop.ref}
                                iconSize={18}
                            />
                            )}
                        </div>
                        <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-1" />
                        <Button variant="ghost" size="sm" icon={<Scale size={18} />} onClick={(e) => handleAudit(e, prop)} className="!text-violet-600" />
                        <Button variant="ghost" size="sm" icon={<Eye size={18} />} onClick={(e) => { e.stopPropagation(); setPreviewProposal({ id: prop.id, ref: prop.ref }); }} title="Visualizar PDF" />
                        <Button variant="ghost" size="sm" icon={<Download size={18} />} onClick={(e) => handleDownloadPdf(e, prop.id)} title="Baixar PDF" />
                    </div>
                </Card>
            </div>
        );
    };

    // =================================================================================================
    // RENDER SECTIONS
    // =================================================================================================

    const renderHeader = (
        <div className={selectedProposal ? 'hidden lg:block' : 'block'}>
            <PageHeader
                title="Propostas Comerciais"
                subtitle={`${filteredProposals.length} proposta${filteredProposals.length !== 1 ? 's' : ''}`}
                actions={
                    <div className="flex flex-wrap items-center gap-2">
                        <ListToolbar controls={controls} searchPlaceholder="Buscar ref ou cliente..." />
                        <div className="flex items-center gap-2">
                            {canDo('create', 'proposals') && (
                            <Button variant="primary" icon={<Plus size={18} />} onClick={handleOpenCreate} data-testid="new-proposal">
                                Nova
                            </Button>
                            )}
                            <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1 shrink-0">
                                <button
                                    onClick={() => setViewMode('list')}
                                    className={`p-2 rounded-md ${viewMode === 'list' ? 'bg-white dark:bg-slate-700 shadow-sm' : ''}`}
                                    title="Vista de lista"
                                >
                                    <List size={18} />
                                </button>
                                <button
                                    onClick={() => setViewMode('kanban')}
                                    className={`p-2 rounded-md ${viewMode === 'kanban' ? 'bg-white dark:bg-slate-700 shadow-sm' : ''}`}
                                    title="Vista Kanban"
                                >
                                    <Kanban size={18} />
                                </button>
                            </div>
                        </div>
                    </div>
                }
                tabs={viewMode === 'list' ? (
                    <Tabs value={filterStatus} onChange={(v) => setFilterStatus(v as any)}>
                        <Tab value="all">Todas</Tab>
                        <Tab value="open">Abertas</Tab>
                        <Tab value="signed">Assinadas</Tab>
                        <Tab value="draft">Rascunhos</Tab>
                    </Tabs>
                ) : undefined}
            />
        </div>
    );

    const renderListContent = (
        <>
            {/* LIST VIEW */}
            {viewMode === 'list' && (
                filteredProposals.length === 0 ? (
                    <EmptyState
                        icon={FileText}
                        title="Nenhuma proposta encontrada"
                        description="Crie uma nova proposta para começar."
                    />
                ) : (
                    <AutoSizer>
                        {({ height, width }) => (
                            <ListWindow
                                height={height}
                                width={width}
                                itemCount={filteredProposals.length}
                                itemSize={rowItemSize}
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
                                <div className="p-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-t-xl font-bold">
                                    {col.title} ({colProposals.length})
                                </div>
                                <div className="flex-1 overflow-y-auto p-3 space-y-3">
                                    {colProposals.map(prop => (
                                        <Card key={prop.id} onClick={() => setSelectedProposal(prop)} hoverable padding="sm">
                                            <div className="flex justify-between mb-2">
                                                <span className="text-xs font-mono">{prop.ref}</span>
                                            </div>
                                            <h4 className="font-medium text-sm mb-1">{getCustomerName(prop.socid)}</h4>
                                            <div className="flex justify-between items-end mt-3">
                                                <span className="font-bold text-sm">{formatCurrency(prop.total_ttc)}</span>
                                                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                                                    {canDo('edit', 'proposals') && (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        icon={<Edit size={14} />}
                                                        onClick={(e) => { e.stopPropagation(); handleOpenEdit(prop); }}
                                                    />
                                                    )}
                                                </div>
                                            </div>
                                        </Card>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
            <ListTotalBar total={filteredProposals.reduce((sum, prop) => sum + (prop.total_ttc ?? 0), 0)} />
        </>
    );

    const renderDetail = selectedProposal ? (
        <div className="flex flex-col h-full">
            <PageHeader
                onBack={() => setSelectedProposal(null)}
                title={
                    <span className="flex items-center gap-2">
                        {selectedProposal.ref}
                        <StatusBadge status={selectedProposal.statut} config={proposalStatuses} />
                    </span>
                }
                subtitle={getCustomerName(selectedProposal.socid)}
                actions={
                    <div className="flex items-center gap-2">
                        {(selectedProposal.statut === '0' || selectedProposal.statut === '1') && (
                            <>
                                {canDo('edit', 'proposals') && (
                                <Button variant="secondary" size="sm" icon={<Edit size={16} />} onClick={() => handleOpenEdit(selectedProposal)}>
                                    Editar
                                </Button>
                                )}
                                <Button variant="secondary" size="sm" icon={<Copy size={16} />} onClick={() => handleDuplicate(selectedProposal.id)} title="Duplicar" aria-label="Duplicar" loading={processingId === selectedProposal.id} disabled={!!processingId}>
                                    Duplicar
                                </Button>
                                {canDo('delete', 'proposals') && (
                                <ConfirmDeleteButton
                                    withLabel
                                    onDelete={() => DolibarrService.deleteProposal(config, selectedProposal.id)}
                                    onDeleted={() => { setSelectedProposal(null); refetchProposals(); }}
                                    itemLabel={selectedProposal.ref}
                                    className="px-2 py-1"
                                />
                                )}
                            </>
                        )}
                    </div>
                }
            />

            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950/50">
                {/* Action Bar for Open Proposals */}
                {selectedProposal.statut === '1' && (
                    <div className="flex items-center justify-between p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-900/30 mb-6">
                        <span className="text-sm font-medium text-blue-800 dark:text-blue-300">Ação de Resposta do Cliente:</span>
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                icon={<Ban size={16} />}
                                onClick={handleRefuseProposal}
                                loading={processingId === selectedProposal.id}
                                disabled={!!processingId}
                                className="!text-red-600 !border-red-200 dark:!border-red-900"
                            >
                                Recusar
                            </Button>
                            {canDo('validate', 'proposals') && (
                            <Button
                                variant="primary"
                                size="sm"
                                icon={<FileSignature size={16} />}
                                onClick={() => handleCloseProposal('2')}
                                loading={processingId === selectedProposal.id}
                                disabled={!!processingId}
                                className="!bg-emerald-600 hover:!bg-emerald-700"
                            >
                                Assinar / Aceitar
                            </Button>
                            )}
                        </div>
                    </div>
                )}

                {/* Create Order Button for Signed Proposals */}
                {selectedProposal.statut === '2' && (
                    <div className="flex items-center justify-between p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-100 dark:border-emerald-900/30 mb-6">
                    <div className="flex items-center gap-2 flex-wrap">
                            <CheckCircle size={18} className="text-emerald-600 dark:text-emerald-400" />
                            <span className="text-sm font-medium text-emerald-800 dark:text-emerald-300">Proposta Assinada. Pronta para processamento.</span>
                        </div>
                        <Button
                            variant="primary"
                            size="sm"
                            icon={<ShoppingCart size={16} />}
                            onClick={handleCreateOrder}
                            loading={processingId === selectedProposal.id}
                            disabled={!!processingId}
                            data-testid="convert-to-order"
                            data-ref={selectedProposal.ref}
                        >
                            Criar Pedido
                        </Button>
                    </div>
                )}

                {/* Debug */}
                <div className="flex flex-col items-end mb-2">
                    <button onClick={() => setShowDebug(!showDebug)} className="text-xs text-slate-400 hover:text-slate-600">[DEBUG]</button>
                    {showDebug && (
                        <textarea
                            readOnly
                            className="w-full h-48 text-xs font-mono p-2 border border-red-200 bg-red-50 mt-2 rounded"
                            value={JSON.stringify(selectedProposal, null, 2)}
                        />
                    )}
                </div>

                {/* Header Info */}
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
                                <span className="text-slate-500">Criado:</span>
                                <span className="font-medium text-slate-800 dark:text-white">{getUserName(selectedProposal.fk_user_author)}</span>
                            </div>
                            {selectedProposal.fk_user_valid && (
                                <div className="text-sm flex justify-between">
                                    <span className="text-slate-500">Validado:</span>
                                    <span className="font-medium text-slate-800 dark:text-white">{getUserName(selectedProposal.fk_user_valid)}</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Lines Table */}
                {(() => {
                    const selectedProposalLines = proposalLines
                        .filter(l => String(l.parent_id) === String(selectedProposal.id))
                        .sort((a, b) => (a.rang || 0) - (b.rang || 0));

                    return (
                        <div className="mb-6">
                            <h4 className="font-bold text-slate-800 dark:text-white mb-3 flex items-center gap-2">
                                <List size={18} /> Itens da Proposta
                            </h4>
                            <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden shadow-sm overflow-x-auto">
                                <table className="w-full text-sm text-left min-w-[500px]">
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
                                                <tr key={line.id ?? `pl-${idx}`}>
                                                    <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                                                        <div className="font-medium">{line.label}</div>
                                                        <div className="text-xs text-slate-500 mt-0.5" dangerouslySetInnerHTML={{ __html: sanitizeHtml(line.description) }} />
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400">{line.qty}</td>
                                                    <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400">{formatCurrency(line.subprice)}</td>
                                                    <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400">{line.remise_percent ? `${line.remise_percent}%` : '-'}</td>
                                                    <td className="px-4 py-3 text-right font-medium text-slate-800 dark:text-white">{formatCurrency(line.total_ht)}</td>
                                                </tr>
                                            ))
                                        ) : (
                                            <tr>
                                                <td colSpan={5} className="px-4 py-8 text-center text-slate-400 italic">Nenhum item disponível.</td>
                                            </tr>
                                        )}
                                    </tbody>
                                    <tfoot className="bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-800">
                                        <tr>
                                            <td colSpan={4} className="px-4 py-3 text-right font-bold text-slate-700 dark:text-slate-300">Total (S/ Imposto)</td>
                                            <td className="px-4 py-3 text-right font-bold text-slate-800 dark:text-white text-lg">{formatCurrency(selectedProposal.total_ht)}</td>
                                        </tr>
                                        <tr>
                                            <td colSpan={4} className="px-4 py-3 text-right font-bold text-slate-700 dark:text-slate-300">Total (C/ Imposto)</td>
                                            <td className="px-4 py-3 text-right font-bold text-indigo-600 dark:text-indigo-400 text-lg">{formatCurrency(selectedProposal.total_ttc)}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                    );
                })()}

                {/* Footer */}
                <div className="flex justify-end gap-2 mt-auto pt-6 border-t border-slate-200 dark:border-slate-800">
                    <LinkedObjects id={selectedProposal.id} type="propal" onNavigate={onNavigate} />
                    <Button variant="secondary" icon={<Eye size={16} />} onClick={() => setPreviewProposal({ id: selectedProposal.id, ref: selectedProposal.ref })}>
                        Visualizar PDF
                    </Button>
                    <Button variant="secondary" icon={<Download size={16} />} onClick={(e) => handleDownloadPdf(e, selectedProposal.id)}>
                        Baixar PDF
                    </Button>
                </div>
            </div>
        </div>
    ) : undefined;

    // =================================================================================================
    // MAIN RETURN
    // =================================================================================================
    return (
        <>
            <div className="flex flex-col h-full">
                {renderHeader}
                <MasterDetailLayout
                    list={renderListContent}
                    detail={renderDetail}
                    showDetail={!!selectedProposal}
                    onCloseDetail={() => setSelectedProposal(null)}
                />
            </div>

            {/* PDF Preview Modal */}
            <PdfPreviewModal
                entityType="proposal"
                entityId={previewProposal?.id ?? ''}
                title={previewProposal?.ref}
                isOpen={!!previewProposal}
                onClose={() => setPreviewProposal(null)}
            />

            {/* Create/Edit Modal */}
            <Modal
                isOpen={isFormOpen}
                onClose={() => setIsFormOpen(false)}
                title={editingId ? 'Editar Proposta' : 'Nova Proposta'}
                size="xl"
            >
                <form onSubmit={handleSave} className="space-y-6">
                    {/* Header Fields */}
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

                    {/* Lines */}
                    <div>
                        <div className="flex justify-between items-center mb-2">
                            <h4 className="font-bold text-slate-800 dark:text-white text-sm">Itens da Proposta</h4>
                            <Button type="button" variant="ghost" size="sm" icon={<Plus size={14} />} onClick={handleAddLine}>
                                Adicionar Item
                            </Button>
                        </div>
                        <div className="space-y-3">
                            {formData.lines.map((line, idx) => (
                                <div key={line._rowId ?? line.id ?? `fl-${idx}`} className="flex gap-2 items-start bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-100 dark:border-slate-800">
                                    <div className="flex-1 space-y-2">
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
                                                    {formatCurrency(line.total)}
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
                                    {formatCurrency(formData.lines.reduce((acc, curr) => acc + curr.total, 0))}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Form Footer */}
                    <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                        <Button type="button" variant="secondary" onClick={() => setIsFormOpen(false)}>
                            Cancelar
                        </Button>
                        <Button type="submit" variant="primary" loading={isSubmitting} icon={<Save size={18} />}>
                            {editingId ? 'Salvar Alterações' : 'Criar Proposta'}
                        </Button>
                    </div>
                </form>
            </Modal>

            {/* Audit Modal */}
            <Modal
                isOpen={!!auditResult}
                onClose={() => setAuditResult(null)}
                title="Resultado da Auditoria"
                size="sm"
            >
                {auditResult && (
                    <div className="space-y-4">
                        <div className="text-3xl font-bold text-emerald-500">{auditResult.result.score}/100</div>
                        <p className="text-sm dark:text-slate-300">{auditResult.result.summary}</p>
                        {auditPayload && (
                            <details className="mt-4 p-2 bg-slate-100 dark:bg-slate-800 rounded text-xs">
                                <summary className="cursor-pointer font-bold text-slate-500 hover:text-slate-700">Debug: Payload Enviado</summary>
                                <pre className="mt-2 whitespace-pre-wrap font-mono text-slate-600 dark:text-slate-400">
                                    {JSON.stringify(auditPayload, null, 2)}
                                </pre>
                            </details>
                        )}
                    </div>
                )}
            </Modal>
        </>
    );
};

export default ProposalList;
