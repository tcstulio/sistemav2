import React, { useState, useMemo, useEffect } from 'react';
import { Invoice, ThirdParty, DolibarrConfig, AppView, Project, Product, Shipment } from '../types';
import { FileText, Search, CheckCircle2, Clock, FileEdit, ExternalLink, Download, FolderKanban, Plus, X, Trash2, Loader2, CheckCircle, CreditCard, ArrowDown, ArrowUp, Lock, ShoppingCart, ArrowLeft, Truck, RefreshCcw } from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { useInvoiceMutations } from '../hooks/useMutations';
import { GenericListLayout } from './common/GenericListLayout';
import { LinkedObjects } from './common/LinkedObjects';
import { PaginationControls } from './common/PaginationControls';
import { StatusFilterBar } from './common/StatusFilterBar';
import { useDolibarr } from '../context/DolibarrContext';
import { useInvoices, useCustomers, useProjects, useProducts, useShipments } from '../hooks/dolibarr';

// Direct Hook Imports
import { useDolibarrLink } from '../hooks/useDolibarrLink';

interface InvoiceListProps {
    onNavigate?: (view: AppView, id: string) => void;
    // Optional legacy props to prevent crashes if parent passes them, but ignored
    invoices?: any[];
    customers?: any[];
    projects?: any[];
    products?: any[];
    shipments?: any[];
    config?: any;
}

const InvoiceList: React.FC<InvoiceListProps> = ({ onNavigate }) => {
    const { config, refreshData } = useDolibarr();

    // Data Hooks
    const { data: invoices = [] } = useInvoices(config);
    const { data: customers = [] } = useCustomers(config);
    const { data: projects = [] } = useProjects(config);
    const { data: products = [] } = useProducts(config, !!config);
    const { data: shipments = [] } = useShipments(config, !!config);

    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'unpaid' | 'paid' | 'draft'>('all');
    const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
    const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
    const [processingId, setProcessingId] = useState<string | null>(null);

    // --- Mutations ---
    const { createInvoice } = useInvoiceMutations(config);

    // Pagination State
    const [page, setPage] = useState(0);
    const [limit, setLimit] = useState(20);

    // Pagination & Search Effect
    useEffect(() => {
        const timer = setTimeout(() => {
            if (refreshData) refreshData({ page, limit, query: searchTerm });
        }, 600);
        return () => clearTimeout(timer);
    }, [page, limit, searchTerm, refreshData]);

    // Reset page on search
    useEffect(() => {
        setPage(0);
    }, [searchTerm]);

    // Creation State
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [newInvoice, setNewInvoice] = useState({
        socid: '',
        date: new Date().toISOString().split('T')[0],
        items: [] as { productId: string, desc: string, qty: number, price: number }[]
    });

    // Payment State
    const [isPayModalOpen, setIsPayModalOpen] = useState(false);
    const [selectedInvoiceForPay, setSelectedInvoiceForPay] = useState<Invoice | null>(null);
    const [payForm, setPayForm] = useState({
        amount: 0,
        date: new Date().toISOString().split('T')[0],
        mode: 'WIRE'
    });
    const [isSubmittingPay, setIsSubmittingPay] = useState(false);

    // Helper to find customer name
    const getCustomerName = (socid: string) => {
        const customer = customers.find(c => c.id === socid);
        return customer ? customer.name : 'Cliente Desconhecido';
    };

    const getProjectName = (projId?: string) => {
        if (!projId) return null;
        const p = projects.find(proj => String(proj.id) === String(projId));
        return p ? p.title : null;
    };

    const filteredInvoices = useMemo(() => {
        let result = invoices.filter(inv => {
            const customerName = getCustomerName(inv.socid).toLowerCase();
            const matchesSearch =
                inv.ref.toLowerCase().includes(searchTerm.toLowerCase()) ||
                customerName.includes(searchTerm.toLowerCase());

            if (filterStatus === 'paid') return matchesSearch && inv.statut === '2';
            if (filterStatus === 'unpaid') return matchesSearch && inv.statut === '1';
            if (filterStatus === 'draft') return matchesSearch && inv.statut === '0';

            return matchesSearch;
        });

        // Client-side Sort
        return result.sort((a, b) => {
            return sortOrder === 'desc' ? b.date - a.date : a.date - b.date;
        });
    }, [invoices, customers, searchTerm, filterStatus, sortOrder]);

    const linkedShipments = useMemo(() => {
        if (!selectedInvoice || !selectedInvoice.order_id) return [];
        return shipments.filter(s => s.fk_commande && String(s.fk_commande) === String(selectedInvoice.order_id));
    }, [selectedInvoice, shipments]);

    const getStatusBadge = (invoice: Invoice) => {
        if (invoice.type === '2') {
            return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800"><RefreshCcw size={12} /> Nota de Crédito</span>;
        }
        if (invoice.statut === '0') {
            return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700"><FileEdit size={12} /> Rascunho</span>;
        }
        if (invoice.statut === '2') {
            return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"><CheckCircle2 size={12} /> Pago</span>;
        }
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800"><Clock size={12} /> A Pagar</span>;
    };

    const { openLink } = useDolibarrLink(config);

    const openInDolibarr = (id: string) => {
        openLink('invoice', id);
    };

    const handleDownloadPdf = (e: React.MouseEvent, ref: string) => {
        e.stopPropagation();
        if (!config) return;
        DolibarrService.downloadDocument(config, 'invoice', ref);
    };

    const handleValidate = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (!config) return;
        if (!confirm("Tem certeza que deseja validar esta fatura?")) return;
        setProcessingId(id);
        try {
            await DolibarrService.validateInvoice(config, id);
            alert("Fatura Validada!");
            if (refreshData) refreshData();
        } catch (err) {
            console.error(err);
            alert("Falha ao validar fatura.");
        } finally {
            setProcessingId(null);
        }
    };

    const handleCreateCreditNote = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (!config) return;
        if (!confirm("Criar uma Nota de Crédito (Correção) para esta fatura?")) return;
        setProcessingId(id);
        try {
            await DolibarrService.createCreditNote(config, id);
            alert("Nota de Crédito criada com sucesso!");
            if (refreshData) refreshData();
        } catch (err: any) {
            console.error(err);
            alert(`Falha ao criar Nota de Crédito: ${err.message} `);
        } finally {
            setProcessingId(null);
        }
    };

    // Creation Logic (Remains similar)
    const handleAddItem = () => {
        setNewInvoice({
            ...newInvoice,
            items: [...newInvoice.items, { productId: '', desc: '', qty: 1, price: 0 }]
        });
    };

    const handleUpdateItem = (index: number, field: string, value: any) => {
        const updatedItems = [...newInvoice.items];
        updatedItems[index] = { ...updatedItems[index], [field]: value };
        if (field === 'productId') {
            const prod = products.find(p => p.id === value);
            if (prod) {
                updatedItems[index].price = prod.price;
                updatedItems[index].desc = prod.label;
            }
        }
        setNewInvoice({ ...newInvoice, items: updatedItems });
    };

    const handleRemoveItem = (index: number) => {
        const updatedItems = newInvoice.items.filter((_, i) => i !== index);
        setNewInvoice({ ...newInvoice, items: updatedItems });
    };

    const calculateTotal = () => {
        return newInvoice.items.reduce((acc, item) => acc + (item.price * item.qty), 0);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newInvoice.socid) return alert("Selecione um cliente");

        setIsSubmitting(true);
        try {
            const apiPayload = {
                socid: newInvoice.socid,
                date: new Date(newInvoice.date).getTime() / 1000,
                type: "0",
                lines: newInvoice.items.map(item => ({
                    fk_product: item.productId || undefined,
                    desc: item.desc,
                    qty: item.qty,
                    subprice: item.price,
                    tva_tx: 0
                }))
            };

            await createInvoice.mutateAsync(apiPayload);
            alert("Fatura Criada com Sucesso");
            setIsCreateModalOpen(false);
            setNewInvoice({ socid: '', date: new Date().toISOString().split('T')[0], items: [] });
        } catch (e: any) {
            console.error(e);
            alert(`Falha ao criar fatura: ${e.message} `);
        } finally {
            setIsSubmitting(false);
        }
    };

    // Payment Logic
    const handlePayClick = (e: React.MouseEvent, invoice: Invoice) => {
        e.stopPropagation();
        setSelectedInvoiceForPay(invoice);
        setPayForm({
            amount: invoice.total_ttc,
            date: new Date().toISOString().split('T')[0],
            mode: 'WIRE'
        });
        setIsPayModalOpen(true);
    };

    const handleRegisterPayment = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedInvoiceForPay || !config) return;

        setIsSubmittingPay(true);
        try {
            await DolibarrService.setPayment(config, selectedInvoiceForPay.id, {
                amount: payForm.amount,
                date: payForm.date,
                payment_mode_id: payForm.mode
            });
            alert("Pagamento Registrado com Sucesso");
            selectedInvoiceForPay.statut = '2';
            selectedInvoiceForPay.paye = '1';
            setIsPayModalOpen(false);
            if (refreshData) refreshData();
        } catch (err) {
            console.error(err);
            alert("Falha ao registrar pagamento");
        } finally {
            setIsSubmittingPay(false);
        }
    };

    if (!config) return null;

    // --- Sub-Components (Render props for generic layout) ---

    // 1. Header
    const renderHeader = (
        <div className="p-4 md:p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex-none">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Faturas</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Acompanhe pagamentos e receita</p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar ref ou cliente..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className={`pl-10 pr-4 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white rounded-lg focus:ring-2 focus:ring-${config.themeColor}-500 focus:border-${config.themeColor}-500 outline-none w-full md:w-64 text-sm transition-all`}
                        />
                    </div>
                    <button
                        onClick={() => setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
                        className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center gap-1 text-sm font-medium"
                        title={sortOrder === 'desc' ? "Mais recentes" : "Mais antigos"}
                    >
                        {sortOrder === 'desc' ? <ArrowDown size={18} /> : <ArrowUp size={18} />}
                    </button>
                    <button
                        onClick={() => setIsCreateModalOpen(true)}
                        className={`flex items-center gap-1.5 px-3 py-2 bg-${config.themeColor}-600 hover:bg-${config.themeColor}-700 text-white rounded-lg text-sm font-medium shadow-sm transition-colors`}
                    >
                        <Plus size={18} /> Novo
                    </button>
                </div>
            </div>

            <StatusFilterBar
                filters={[
                    { id: 'all', label: 'Todas' },
                    { id: 'unpaid', label: 'A Pagar / Vencidas', color: 'orange' },
                    { id: 'paid', label: 'Pagas', color: 'emerald' },
                    { id: 'draft', label: 'Rascunhos', color: 'slate' }
                ]}
                activeFilter={filterStatus}
                onFilterChange={(id) => setFilterStatus(id as any)}
                themeColor={config.themeColor}
            />
        </div>
    );

    // 2. List Content
    const renderListContent = (
        <>
            {filteredInvoices.length === 0 ? (
                <div className="text-center py-20 text-slate-400">
                    <FileText size={48} className="mx-auto mb-4 opacity-50" />
                    <p>Nenhuma fatura encontrada com estes critérios.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-3">
                    {filteredInvoices.map((inv) => {
                        const projectName = getProjectName(inv.project_id);
                        return (
                            <div
                                key={inv.id}
                                onClick={() => setSelectedInvoice(inv)}
                                className={`p-4 rounded-xl border transition-all cursor-pointer ${selectedInvoice?.id === inv.id ? `border-${config.themeColor}-500 ring-1 ring-${config.themeColor}-500 shadow-sm dark:bg-slate-800` : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm hover:border-slate-300 dark:hover:border-slate-700'} `}
                            >
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono text-xs text-slate-400">{inv.ref}</span>
                                        {getStatusBadge(inv)}
                                    </div>
                                </div>
                                <h3
                                    className="font-bold text-slate-800 dark:text-white text-sm mb-1 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (onNavigate) onNavigate('customers', inv.socid);
                                    }}
                                >
                                    {getCustomerName(inv.socid)}
                                </h3>
                                {projectName && (
                                    <div className="text-xs text-indigo-500 mb-2 flex items-center gap-1">
                                        <FolderKanban size={10} /> {projectName}
                                    </div>
                                )}
                                <div className="flex justify-between items-end">
                                    <span className="text-xs text-slate-500">{new Date(inv.date < 100000000000 ? inv.date * 1000 : inv.date).toLocaleDateString()}</span>
                                    <span className="font-bold text-slate-800 dark:text-white">${inv.total_ttc.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </>
    );

    // 3. Detail Content
    const renderDetailContent = selectedInvoice ? (
        <>
            <div className="flex-none bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-100 dark:border-slate-800 p-4 flex items-center justify-between z-10 w-full">
                <div className="flex items-center gap-3">
                    <button onClick={() => setSelectedInvoice(null)} className="lg:hidden p-2 -ml-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"><ArrowLeft size={20} /></button>
                    <div>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white leading-tight flex items-center gap-2">
                            {selectedInvoice.ref}
                            {getStatusBadge(selectedInvoice)}
                        </h2>
                        <span
                            className="text-xs text-slate-400 cursor-pointer hover:underline hover:text-indigo-500"
                            onClick={() => onNavigate && onNavigate('customers', selectedInvoice.socid)}
                        >
                            Cliente: {getCustomerName(selectedInvoice.socid)}
                        </span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {selectedInvoice.statut === '0' && (
                        <button
                            onClick={(e) => handleValidate(e, selectedInvoice.id)}
                            disabled={!!processingId}
                            className="p-2 rounded-lg text-blue-600 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors text-sm font-medium flex items-center gap-1"
                            title="Validar Fatura"
                        >
                            {processingId === selectedInvoice.id ? <Loader2 size={18} className="animate-spin" /> : <Lock size={18} />}
                            <span className="hidden xl:inline">Validar</span>
                        </button>
                    )}
                    {selectedInvoice.statut === '1' && selectedInvoice.type !== '2' && (
                        <>
                            <button
                                onClick={(e) => handlePayClick(e, selectedInvoice)}
                                className="p-2 rounded-lg text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors text-sm font-medium flex items-center gap-1"
                                title="Pagar Fatura"
                            >
                                <CreditCard size={18} />
                                <span className="hidden xl:inline">Pagar</span>
                            </button>
                            <button
                                onClick={(e) => handleCreateCreditNote(e, selectedInvoice.id)}
                                className="p-2 rounded-lg text-red-600 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors text-sm font-medium flex items-center gap-1"
                                title="Criar Nota de Crédito (Correção)"
                                disabled={!!processingId}
                            >
                                {processingId === selectedInvoice.id ? <Loader2 size={18} className="animate-spin" /> : <RefreshCcw size={18} />}
                                <span className="hidden xl:inline">Nota Crédito</span>
                            </button>
                        </>
                    )}
                    <button onClick={(e) => handleDownloadPdf(e, selectedInvoice.ref)} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><Download size={20} /></button>
                    <button onClick={() => openInDolibarr(selectedInvoice.id)} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><ExternalLink size={20} /></button>
                    <button onClick={() => setSelectedInvoice(null)} className="hidden lg:block p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-50 dark:bg-slate-950/50 w-full">
                <div className="max-w-3xl mx-auto space-y-6">
                    <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
                        <div className="flex justify-between items-start mb-6">
                            <div>
                                <p className="text-sm text-slate-500 uppercase font-bold mb-1">Valor da Fatura</p>
                                <p className="text-3xl font-bold text-slate-900 dark:text-white">${selectedInvoice.total_ttc.toLocaleString()}</p>
                            </div>
                            <div className="text-right">
                                <p className="text-sm text-slate-500 uppercase font-bold mb-1">Data</p>
                                <p className="text-lg font-medium text-slate-800 dark:text-white">{new Date(selectedInvoice.date < 100000000000 ? selectedInvoice.date * 1000 : selectedInvoice.date).toLocaleDateString()}</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-slate-100 dark:border-slate-800">
                            <div>
                                <p className="text-xs text-slate-500 uppercase font-bold mb-2">Projeto Vinculado</p>
                                {selectedInvoice.project_id ? (
                                    <div
                                        className="flex items-center gap-2 p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer hover:border-indigo-300 transition-colors"
                                        onClick={() => onNavigate && onNavigate('projects', selectedInvoice.project_id!)}
                                    >
                                        <FolderKanban size={16} className="text-indigo-500" />
                                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{getProjectName(selectedInvoice.project_id)}</span>
                                        <ExternalLink size={12} className="ml-auto text-slate-400" />
                                    </div>
                                ) : (
                                    <span className="text-sm text-slate-400 italic">Nenhum vinculado</span>
                                )}
                            </div>

                            <div>
                                <p className="text-xs text-slate-500 uppercase font-bold mb-2">Pedido de Origem</p>
                                {selectedInvoice.order_id ? (
                                    <div
                                        className="flex items-center gap-2 p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer hover:border-indigo-300 transition-colors"
                                        onClick={() => onNavigate && onNavigate('orders', selectedInvoice.order_id!)}
                                    >
                                        <ShoppingCart size={16} className="text-orange-500" />
                                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Ver Pedido de Venda</span>
                                        <ExternalLink size={12} className="ml-auto text-slate-400" />
                                    </div>
                                ) : (
                                    <span className="text-sm text-slate-400 italic">Fatura Direta</span>
                                )}
                            </div>
                        </div>
                    </div>

                    {linkedShipments.length > 0 && (
                        <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm animate-in fade-in slide-in-from-bottom-2">
                            <h4 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                                <Truck size={18} className="text-indigo-500" /> Envios Vinculados (Comprovante)
                            </h4>
                            <div className="space-y-2">
                                {linkedShipments.map(ship => (
                                    <div
                                        key={ship.id}
                                        className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700 cursor-pointer hover:border-indigo-300 transition-colors"
                                        onClick={() => onNavigate && onNavigate('shipments', ship.id)}
                                    >
                                        <div>
                                            <div className="text-sm font-medium text-slate-800 dark:text-white">{ship.ref}</div>
                                            <div className="text-xs text-slate-500">Enviado: {new Date(ship.date_creation < 100000000000 ? ship.date_creation * 1000 : ship.date_creation).toLocaleDateString()}</div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {ship.tracking_number && (
                                                <span className="text-xs font-mono bg-slate-200 dark:bg-slate-700 px-2 py-0.5 rounded text-slate-600 dark:text-slate-300">
                                                    {ship.tracking_number}
                                                </span>
                                            )}
                                            <ExternalLink size={14} className="text-slate-400" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
                        <h4 className="font-bold text-slate-800 dark:text-white mb-4">Itens da Fatura</h4>
                        <div className="text-center py-8 text-slate-400 italic bg-slate-50 dark:bg-slate-800/30 rounded-lg border border-dashed border-slate-200 dark:border-slate-700">
                            Itens detalhados não carregados nesta visualização.
                            <br />
                            <button
                                onClick={() => openInDolibarr(selectedInvoice.id)}
                                className="text-indigo-600 dark:text-indigo-400 hover:underline mt-2 text-sm"
                            >
                                Ver detalhes completos no Dolibarr
                            </button>
                        </div>
                    </div>

                    {/* Linked Objects */}
                    <LinkedObjects
                        id={selectedInvoice.id}
                        type="facture"
                        onNavigate={onNavigate}
                    />
                </div>
            </div>
        </>
    ) : (
        <div className="text-center p-8 max-w-sm mx-auto">
            <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300 dark:text-slate-600"><FileText size={32} /></div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-1">Selecione uma Fatura</h3>
            <p className="text-slate-500 dark:text-slate-400 text-sm">Ver detalhes, validar ou registrar pagamentos.</p>
        </div>
    );

    return (
        <>
            {/* Main Generic Layout */}
            <GenericListLayout
                header={renderHeader}
                content={renderListContent}
                detail={renderDetailContent}
                isDetailOpen={!!selectedInvoice}
                pagination={
                    <PaginationControls
                        page={page}
                        limit={limit}
                        onPageChange={setPage}
                        onLimitChange={setLimit}
                        hasNext={filteredInvoices.length >= limit}
                        hasPrev={page > 0}
                    />
                }
            />

            {/* Create Modal */}
            {isCreateModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-2xl border border-slate-200 dark:border-slate-800 animate-in zoom-in-95 flex flex-col max-h-[90vh]">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 rounded-t-xl">
                            <h3 className="font-bold text-lg dark:text-white flex items-center gap-2">
                                <FileText size={18} className="text-indigo-600" /> Nova Fatura (Rascunho)
                            </h3>
                            <button onClick={() => setIsCreateModalOpen(false)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"><X size={20} /></button>
                        </div>

                        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
                            <div className="p-6 space-y-4 overflow-y-auto">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Cliente</label>
                                        <select
                                            className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                            value={newInvoice.socid}
                                            onChange={e => setNewInvoice({ ...newInvoice, socid: e.target.value })}
                                            required
                                        >
                                            <option value="">Selecione o Cliente...</option>
                                            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Data</label>
                                        <input
                                            type="date"
                                            className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                            value={newInvoice.date}
                                            onChange={e => setNewInvoice({ ...newInvoice, date: e.target.value })}
                                            required
                                        />
                                    </div>
                                </div>

                                <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
                                    <div className="flex justify-between items-center mb-2">
                                        <h4 className="font-bold text-sm text-slate-700 dark:text-slate-300">Itens</h4>
                                        <button type="button" onClick={handleAddItem} className="text-xs flex items-center gap-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 px-2 py-1 rounded">
                                            <Plus size={12} /> Adicionar Item
                                        </button>
                                    </div>

                                    <div className="space-y-2">
                                        {newInvoice.items.length === 0 && <p className="text-sm text-slate-400 italic text-center py-4">Nenhum item adicionado.</p>}
                                        {newInvoice.items.map((item, idx) => (
                                            <div key={idx} className="flex gap-2 items-start bg-slate-50 dark:bg-slate-800/50 p-2 rounded-lg">
                                                <div className="flex-1">
                                                    <select
                                                        className="w-full p-1 text-sm border rounded mb-1 dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                                        value={item.productId}
                                                        onChange={e => handleUpdateItem(idx, 'productId', e.target.value)}
                                                    >
                                                        <option value="">Item Personalizado</option>
                                                        {products.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                                                    </select>
                                                    <input
                                                        type="text"
                                                        className="w-full p-1 text-xs border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                                        placeholder="Descrição"
                                                        value={item.desc}
                                                        onChange={e => handleUpdateItem(idx, 'desc', e.target.value)}
                                                    />
                                                </div>
                                                <div className="w-20">
                                                    <input
                                                        type="number"
                                                        className="w-full p-1 text-sm border rounded mb-1 dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                                        placeholder="Qtd"
                                                        value={item.qty}
                                                        onChange={e => handleUpdateItem(idx, 'qty', parseInt(e.target.value))}
                                                        min="1"
                                                    />
                                                </div>
                                                <div className="w-24">
                                                    <input
                                                        type="number"
                                                        className="w-full p-1 text-sm border rounded mb-1 dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                                        placeholder="Preço"
                                                        value={item.price}
                                                        onChange={e => handleUpdateItem(idx, 'price', parseFloat(e.target.value))}
                                                    />
                                                </div>
                                                <button type="button" onClick={() => handleRemoveItem(idx)} className="p-1 text-red-400 hover:text-red-600">
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>

                                    <div className="flex justify-end mt-4 pt-2 border-t border-slate-100 dark:border-slate-800">
                                        <div className="text-right">
                                            <span className="text-xs text-slate-500 uppercase font-bold mr-2">Total (S/ Imposto)</span>
                                            <span className="text-xl font-bold text-slate-800 dark:text-white">${calculateTotal().toFixed(2)}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3 bg-slate-50 dark:bg-slate-800/50 rounded-b-xl">
                                <button type="button" onClick={() => setIsCreateModalOpen(false)} className="px-4 py-2 text-slate-500 hover:text-slate-700 font-medium">Cancelar</button>
                                <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium shadow-sm flex items-center gap-2">
                                    {isSubmitting ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle size={16} />} Criar Fatura
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Pay Modal */}
            {isPayModalOpen && selectedInvoiceForPay && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-sm border border-slate-200 dark:border-slate-800 animate-in zoom-in-95">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-emerald-50 dark:bg-emerald-900/30 rounded-t-xl">
                            <h3 className="font-bold text-lg dark:text-white flex items-center gap-2">
                                <CreditCard size={18} className="text-emerald-600" /> Registrar Pagamento
                            </h3>
                            <button onClick={() => setIsPayModalOpen(false)} className="p-1 hover:bg-white/50 rounded"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleRegisterPayment} className="p-6 space-y-4">
                            <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-100 dark:border-slate-700 mb-2">
                                <p className="text-xs text-slate-500">Ref da Fatura</p>
                                <p className="font-bold text-slate-800 dark:text-white">{selectedInvoiceForPay.ref}</p>
                                <p className="text-xs text-slate-500 mt-1">Total Devido</p>
                                <p className="font-bold text-red-500">${selectedInvoiceForPay.total_ttc.toFixed(2)}</p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Data do Pagamento</label>
                                <input type="date" className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={payForm.date} onChange={e => setPayForm({ ...payForm, date: e.target.value })} required />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo de Pagamento</label>
                                <select className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={payForm.mode} onChange={e => setPayForm({ ...payForm, mode: e.target.value })}>
                                    <option value="WIRE">Transferência</option>
                                    <option value="CB">Cartão de Crédito</option>
                                    <option value="CASH">Dinheiro</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Valor</label>
                                <input type="number" step="0.01" className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white font-bold" value={payForm.amount} onChange={e => setPayForm({ ...payForm, amount: parseFloat(e.target.value) })} required />
                            </div>

                            <div className="flex justify-end gap-3 pt-2">
                                <button type="button" onClick={() => setIsPayModalOpen(false)} className="px-4 py-2 text-slate-500 hover:text-slate-700 font-medium">Cancelar</button>
                                <button type="submit" disabled={isSubmittingPay} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium shadow-sm flex items-center gap-2">
                                    {isSubmittingPay ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle size={16} />} Pagar Agora
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </>
    );
};

export default InvoiceList;
