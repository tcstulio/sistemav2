import React, { useState, useMemo, useEffect } from 'react';
import { z } from 'zod';
import { toast } from 'sonner';
import { ThirdParty, AppView } from '../types';
import { useDolibarr } from '../context/DolibarrContext';
import { Mail, MapPin, Building2, Phone, Sparkles, Loader2, X, ArrowLeft, Search, UserPlus, CheckCircle2, UserCircle, Pencil, ChevronLeft, ChevronRight } from 'lucide-react';
import { AiService } from '../services/aiService';
import { DolibarrService } from '../services/dolibarrService';
import { useCustomerMutations } from '../hooks/useMutations';
import { FixedSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';

// Hooks
import { useCustomers } from '../hooks/dolibarr/useCustomers';
import { useInvoices } from '../hooks/dolibarr/useInvoices';
import { useProposals } from '../hooks/dolibarr/useProposals';
import { useOrders } from '../hooks/dolibarr/useOrders';
import { useProjects } from '../hooks/dolibarr/useProjects';
import { useEvents } from '../hooks/dolibarr/useEvents';
import { useTickets } from '../hooks/dolibarr/useTickets';
import { useShipments } from '../hooks/dolibarr/useShipments';
import { useContacts } from '../hooks/dolibarr/useContacts';

// Common Components
import { GenericListLayout } from './common/GenericListLayout';
import { PaginationControls } from './common/PaginationControls';
import { StatusFilterBar } from './common/StatusFilterBar';

interface CustomerListProps {
    onNavigate?: (view: AppView, id: string) => void;
    initialItemId?: string;
}

export const CustomerList: React.FC<CustomerListProps> = ({ onNavigate, initialItemId }) => {
    const { config, refreshData } = useDolibarr();

    // Data Fetching
    const { data: customers = [] } = useCustomers(config);
    const { data: invoices = [] } = useInvoices(config);
    const { data: proposals = [] } = useProposals(config, !!config);
    const { data: orders = [] } = useOrders(config, !!config);
    const { data: projects = [] } = useProjects(config);
    const { data: events = [] } = useEvents(config, !!config);
    const { data: tickets = [] } = useTickets(config, !!config);
    const { data: shipments = [] } = useShipments(config, !!config);
    const { data: contacts = [] } = useContacts(config, !!config);


    // Pagination
    const [page, setPage] = useState(0);
    const [limit, setLimit] = useState(20);

    // Selection
    const [selectedCustomer, setSelectedCustomer] = useState<ThirdParty | null>(null);

    // Search & Filter
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState<'all' | 'customer' | 'prospect'>('all');

    // Tab State
    const [activeTab, setActiveTabState] = useState<'overview' | 'timeline' | 'contacts' | 'invoices' | 'proposals' | 'orders' | 'shipments' | 'projects' | 'tickets'>(() => {
        return (localStorage.getItem('doligen_customer_tab') as any) || 'overview';
    });

    const setActiveTab = (tab: typeof activeTab) => {
        setActiveTabState(tab);
        localStorage.setItem('doligen_customer_tab', tab);
    };

    // UI States (Modals, AI)
    const [generatedEmail, setGeneratedEmail] = useState<{ subject: string, body: string } | null>(null);
    const [sentimentAnalysis, setSentimentAnalysis] = useState<{ score: number, label: string, insight: string, logId?: string } | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);

    // Create/Edit States
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [editForm, setEditForm] = useState<Partial<ThirdParty>>({});

    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [createForm, setCreateForm] = useState<Partial<ThirdParty>>({ name: '', email: '', client: '1' });
    const [isCreating, setIsCreating] = useState(false);

    // AI Fill State
    const [showMagicInput, setShowMagicInput] = useState(false);
    const [magicText, setMagicText] = useState('');
    const [isMagicFilling, setIsMagicFilling] = useState(false);
    const [aiDraftId, setAiDraftId] = useState<string | null>(null);

    // Mutations
    const { createCustomer, updateCustomer } = useCustomerMutations(config);

    // Effects
    useEffect(() => {
        const timer = setTimeout(() => {
            refreshData({ page, limit, query: searchTerm });
        }, 600);
        return () => clearTimeout(timer);
    }, [page, limit, searchTerm, refreshData]);

    useEffect(() => {
        setPage(0);
    }, [searchTerm]);

    useEffect(() => {
        if (initialItemId && customers.length > 0) {
            const target = customers.find(c => String(c.id) === String(initialItemId));
            if (target) {
                setSelectedCustomer(target);
                setActiveTab('overview');
            }
        }
    }, [initialItemId, customers]);

    // Derived Data
    const filteredCustomers = useMemo(() => {
        return customers.filter(c => {
            const matchesSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                c.email?.toLowerCase().includes(searchTerm.toLowerCase());

            const isProspect = c.client === '2' || c.client === '3';
            const isCustomer = c.client === '1' || c.client === '3';

            if (filterType === 'customer') return matchesSearch && isCustomer;
            if (filterType === 'prospect') return matchesSearch && isProspect;
            return matchesSearch;
        });
    }, [customers, searchTerm, filterType]);

    const customerInvoices = useMemo(() => selectedCustomer ? invoices.filter(i => String(i.socid) === String(selectedCustomer.id)) : [], [selectedCustomer, invoices]);
    const customerProjects = useMemo(() => selectedCustomer ? projects.filter(p => String(p.socid) === String(selectedCustomer.id)) : [], [selectedCustomer, projects]);
    const customerProposals = useMemo(() => selectedCustomer ? proposals.filter(p => String(p.socid) === String(selectedCustomer.id)) : [], [selectedCustomer, proposals]);
    const customerOrders = useMemo(() => selectedCustomer ? orders.filter(o => String(o.socid) === String(selectedCustomer.id)) : [], [selectedCustomer, orders]);


    // Handlers
    const handleGenerateEmail = async (customer: ThirdParty, type: 'collection' | 'welcome') => {
        setIsGenerating(true);
        setGeneratedEmail(null);
        try {
            const result = await AiService.draftCollectionEmail(
                customer,
                type === 'collection' ? (customer.outstanding_balance || 0) : 0
            );
            if (result) {
                setGeneratedEmail(JSON.parse(result));
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleAnalyzeSentiment = async (customer: ThirdParty) => {
        setIsAnalyzing(true);
        setSentimentAnalysis(null);
        try {
            const result = await AiService.analyzeCustomerSentiment(customer, customerInvoices);
            if (result && result.text) {
                const parsed = JSON.parse(result.text);
                setSentimentAnalysis({ ...parsed, logId: result.logId });
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleEditClick = () => {
        if (!selectedCustomer) return;
        setEditForm({
            name: selectedCustomer.name,
            address: selectedCustomer.address,
            zip: selectedCustomer.zip,
            town: selectedCustomer.town,
            phone: selectedCustomer.phone,
            email: selectedCustomer.email
        });
        setIsEditModalOpen(true);
    };

    const handleSaveCustomer = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedCustomer || !config) return;
        setIsSaving(true);
        try {
            await updateCustomer.mutateAsync({ id: selectedCustomer.id, data: editForm });
            Object.assign(selectedCustomer, editForm);
            toast.success("Cliente atualizado com sucesso");
            setIsEditModalOpen(false);
        } catch (err: any) {
            console.error(err);
            toast.error("Falha ao atualizar", { description: err.message });
        } finally {
            setIsSaving(false);
        }
    };

    const handleMagicFill = async () => {
        if (!magicText.trim()) return;
        setIsMagicFilling(true);
        try {
            const result = await AiService.extractCustomerInfo(magicText);
            if (result && result.data) {
                setCreateForm(prev => ({ ...prev, ...result.data }));
                setAiDraftId(result.logId);
                setShowMagicInput(false);
            }
        } catch (e) {
            console.error(e);
            alert("Falha ao extrair dados.");
        } finally {
            setIsMagicFilling(false);
        }
    };

    const handleCreateCustomer = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!config) return;

        const CreateCustomerSchema = z.object({
            name: z.string().min(1, "Nome é obrigatório"),
            client: z.enum(['1', '2', '3']),
            email: z.string().email().optional().or(z.literal('')),
            phone: z.string().optional(),
            address: z.string().optional(),
            town: z.string().optional(),
            zip: z.string().optional()
        });

        const validation = CreateCustomerSchema.safeParse(createForm);
        if (!validation.success) {
            toast.error("Erro de validação", { description: validation.error.issues.map(i => i.message).join(', ') });
            return;
        }

        setIsCreating(true);
        try {
            await createCustomer.mutateAsync(createForm);
            if (aiDraftId) {
                await AiService.logCorrection(aiDraftId, JSON.stringify(createForm));
            }
            toast.success("Cliente criado com sucesso!");
            setIsCreateModalOpen(false);
            setCreateForm({ name: '', email: '', client: '1' });
            setAiDraftId(null);
        } catch (err: any) {
            console.error(err);
            toast.error("Falha ao criar cliente", { description: err.message || "Erro desconhecido" });
        } finally {
            setIsCreating(false);
        }
    };

    // Virtual List Row Renderer
    const Row = ({ index, style }: { index: number, style: React.CSSProperties }) => {
        const customer = filteredCustomers[index];
        const itemStyle = {
            ...style,
            top: (parseFloat(style.top as string) + 8) + 'px',
            height: (parseFloat(style.height as string) - 8) + 'px',
            left: '8px',
            width: 'calc(100% - 16px)'
        };

        return (
            <div style={itemStyle} onClick={() => setSelectedCustomer(customer)} className={`p-4 rounded-xl border cursor-pointer transition-all ${selectedCustomer?.id === customer.id ? `border-${config?.themeColor}-500 bg-${config?.themeColor}-50 dark:bg-${config?.themeColor}-900/20` : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:shadow-md'}`}>
                <div className="flex justify-between items-start mb-2">
                    <h4 className="font-bold text-slate-800 dark:text-white truncate">{customer.name}</h4>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${customer.client === '1' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                        {customer.client === '1' ? 'Cliente' : 'Prospect'}
                    </span>
                </div>
                <div className="text-sm text-slate-600 dark:text-slate-400 flex items-center gap-2 mb-1">
                    <Mail size={12} /> {customer.email || 'Sem email'}
                </div>
                {customer.town && <div className="text-xs text-slate-500 flex items-center gap-2"><MapPin size={12} /> {customer.town}</div>}
            </div>
        );
    };

    // --- Sub-components --

    const renderHeader = (
        <div className="p-4 md:p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex-none">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Clientes & Prospects</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Gerencie seu relacionamento comercial</p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar cliente..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className={`pl-10 pr-4 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white rounded-lg focus:ring-2 focus:ring-${config?.themeColor}-500 focus:border-${config?.themeColor}-500 outline-none w-full md:w-64 text-sm transition-all`}
                        />
                    </div>
                    <button
                        onClick={() => setIsCreateModalOpen(true)}
                        className={`flex items-center gap-1.5 px-3 py-2 bg-${config?.themeColor}-600 hover:bg-${config?.themeColor}-700 text-white rounded-lg text-sm font-medium shadow-sm transition-colors`}
                    >
                        <UserPlus size={18} /> Novo
                    </button>
                </div>
            </div>

            <StatusFilterBar
                filters={[
                    { id: 'all', label: 'Todos' },
                    { id: 'customer', label: 'Clientes', color: 'emerald' },
                    { id: 'prospect', label: 'Prospects', color: 'blue' }
                ]}
                activeFilter={filterType}
                onFilterChange={(id) => setFilterType(id as any)}
                themeColor={config?.themeColor}
            />
        </div>
    );

    const renderListContent = filteredCustomers.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
            <UserCircle size={48} className="mx-auto mb-4 opacity-50" />
            <p>Nenhum cliente encontrado.</p>
        </div>
    ) : (
        <AutoSizer>
            {({ height, width }) => (
                <List
                    height={height}
                    width={width}
                    itemCount={filteredCustomers.length}
                    itemSize={120}
                >
                    {Row}
                </List>
            )}
        </AutoSizer>
    );

    const renderDetail = selectedCustomer ? (
        <>
            <div className="flex-none bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-100 dark:border-slate-800 p-4 flex items-center justify-between z-10">
                <div className="flex items-center gap-3">
                    <button onClick={() => setSelectedCustomer(null)} className="lg:hidden p-2 -ml-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"><ArrowLeft size={20} /></button>
                    <div>
                        <h2 className="text-lg font-bold dark:text-white leading-tight">{selectedCustomer.name}</h2>
                        <span className="text-xs text-slate-500">{selectedCustomer.email}</span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => handleGenerateEmail(selectedCustomer, 'welcome')} className="p-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400" title="Gerar Email"><Sparkles size={20} /></button>
                    <button onClick={handleEditClick} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" title="Editar"><Pencil size={20} /></button>
                    <button onClick={() => setSelectedCustomer(null)} className="hidden lg:block p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-slate-100 dark:border-slate-800 px-4 overflow-x-auto flex-none bg-slate-50 dark:bg-slate-800/30">
                {[
                    { id: 'overview', label: 'Visão Geral' },
                    { id: 'projects', label: `Projetos (${customerProjects.length})` },
                    { id: 'invoices', label: `Faturas (${customerInvoices.length})` },
                    { id: 'orders', label: `Pedidos (${customerOrders.length})` },
                    { id: 'proposals', label: `Propostas (${customerProposals.length})` }
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as any)}
                        className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === tab.id ? `border-${config?.themeColor}-600 text-${config?.themeColor}-600 dark:text-${config?.themeColor}-400 dark:border-${config?.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950/50">
                <div className="max-w-4xl mx-auto space-y-6">
                    {activeTab === 'overview' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                                <h3 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2"><Building2 size={18} className="text-indigo-500" /> Detalhes</h3>
                                <div className="space-y-3">
                                    {selectedCustomer.address && <div className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300"><MapPin size={16} className="mt-0.5 text-slate-400" /> {selectedCustomer.address}, {selectedCustomer.zip} {selectedCustomer.town}</div>}
                                    {selectedCustomer.phone && <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300"><Phone size={16} className="text-slate-400" /> {selectedCustomer.phone}</div>}
                                    {selectedCustomer.email && <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300"><Mail size={16} className="text-slate-400" /> {selectedCustomer.email}</div>}
                                </div>
                            </div>

                            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                                <h3 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2"><Sparkles size={18} className="text-purple-500" /> Insights IA</h3>
                                {!sentimentAnalysis ? (
                                    <div className="text-center py-4">
                                        <p className="text-sm text-slate-500 mb-2">Analise o perfil e histórico deste cliente.</p>
                                        <button onClick={() => handleAnalyzeSentiment(selectedCustomer)} disabled={isAnalyzing} className="text-xs bg-purple-600 text-white px-3 py-1.5 rounded flex items-center justify-center gap-1 mx-auto hover:bg-purple-700">
                                            {isAnalyzing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Analisar
                                        </button>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        <div className="flex justify-between items-center">
                                            <span className="text-sm text-slate-500">Saúde do Cliente</span>
                                            <div className="flex items-center gap-2">
                                                <div className="w-24 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                                    <div className="h-full bg-gradient-to-r from-red-500 to-green-500" style={{ width: `${sentimentAnalysis.score}%` }}></div>
                                                </div>
                                                <span className="font-bold text-slate-800 dark:text-white">{sentimentAnalysis.score}/100</span>
                                            </div>
                                        </div>
                                        <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-100 dark:border-purple-800 text-sm text-purple-800 dark:text-purple-200">
                                            <p className="font-medium mb-1">{sentimentAnalysis.label}</p>
                                            <p className="opacity-90 text-xs">{sentimentAnalysis.insight}</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {activeTab === 'projects' && (
                        <div className="space-y-3">
                            {customerProjects.length === 0 ? <p className="text-center text-slate-400 py-10">Nenhum projeto encontrado.</p> :
                                customerProjects.map(proj => (
                                    <div key={proj.id} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex justify-between items-center hover:shadow-sm cursor-pointer" onClick={() => onNavigate && onNavigate('projects', proj.id)}>
                                        <div>
                                            <div className="font-bold text-slate-800 dark:text-white text-sm flex items-center gap-2">
                                                {proj.ref}
                                                <span className={`text-xs px-2 py-0.5 rounded ${proj.statut === '1' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-700'}`}>
                                                    {proj.statut === '1' ? 'Aberto' : 'Fechado'}
                                                </span>
                                            </div>
                                            <div className="text-xs text-slate-500 mt-1">{proj.title}</div>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <div className="w-24 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                                <div className="h-full bg-blue-500" style={{ width: `${proj.progress}%` }}></div>
                                            </div>
                                            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{proj.progress}%</span>
                                        </div>
                                    </div>
                                ))}
                        </div>
                    )}

                    {activeTab === 'invoices' && (
                        <div className="space-y-3">
                            {customerInvoices.length === 0 ? <p className="text-center text-slate-400 py-10">Nenhuma fatura encontrada.</p> :
                                customerInvoices.map(inv => (
                                    <div key={inv.id} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex justify-between items-center hover:shadow-sm cursor-pointer" onClick={() => onNavigate && onNavigate('invoices', inv.id)}>
                                        <div>
                                            <div className="font-bold text-slate-800 dark:text-white text-sm flex items-center gap-2">
                                                {inv.ref}
                                                {inv.statut === '2' ? <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">Pago</span> : <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded">Aberto</span>}
                                            </div>
                                            <div className="text-xs text-slate-500 mt-1">{new Date(inv.date * 1000).toLocaleDateString()}</div>
                                        </div>
                                        <div className="font-bold text-slate-800 dark:text-white">${inv.total_ttc.toLocaleString()}</div>
                                    </div>
                                ))}
                        </div>
                    )}

                    {activeTab === 'orders' && (
                        <div className="space-y-3">
                            {customerOrders.length === 0 ? <p className="text-center text-slate-400 py-10">Nenhum pedido encontrado.</p> :
                                customerOrders.map(ord => (
                                    <div key={ord.id} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex justify-between items-center hover:shadow-sm cursor-pointer" onClick={() => onNavigate && onNavigate('orders', ord.id)}>
                                        <div>
                                            <div className="font-bold text-slate-800 dark:text-white text-sm flex items-center gap-2">
                                                {ord.ref}
                                                <span className={`text-xs px-2 py-0.5 rounded ${ord.statut === '3' ? 'bg-emerald-100 text-emerald-700' : ord.statut === '0' ? 'bg-slate-100 text-slate-700' : 'bg-blue-100 text-blue-700'}`}>
                                                    {ord.statut === '3' ? 'Entregue' : ord.statut === '0' ? 'Rascunho' : 'Em Processo'}
                                                </span>
                                            </div>
                                            <div className="text-xs text-slate-500 mt-1">{new Date(ord.date * 1000).toLocaleDateString()}</div>
                                        </div>
                                        <div className="font-bold text-slate-800 dark:text-white">${ord.total_ttc.toLocaleString()}</div>
                                    </div>
                                ))}
                        </div>
                    )}

                    {activeTab === 'proposals' && (
                        <div className="space-y-3">
                            {customerProposals.length === 0 ? <p className="text-center text-slate-400 py-10">Nenhuma proposta encontrada.</p> :
                                customerProposals.map(prop => (
                                    <div key={prop.id} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex justify-between items-center hover:shadow-sm cursor-pointer" onClick={() => onNavigate && onNavigate('proposals', prop.id)}>
                                        <div>
                                            <div className="font-bold text-slate-800 dark:text-white text-sm flex items-center gap-2">
                                                {prop.ref}
                                                <span className={`text-xs px-2 py-0.5 rounded ${prop.statut === '2' ? 'bg-emerald-100 text-emerald-700' : prop.statut === '3' ? 'bg-red-100 text-red-700' : 'bg-purple-100 text-purple-700'}`}>
                                                    {prop.statut === '2' ? 'Assinada' : prop.statut === '3' ? 'Recusada' : 'Aberta'}
                                                </span>
                                            </div>
                                            <div className="text-xs text-slate-500 mt-1">{new Date(prop.date * 1000).toLocaleDateString()}</div>
                                        </div>
                                        <div className="font-bold text-slate-800 dark:text-white">${prop.total_ttc.toLocaleString()}</div>
                                    </div>
                                ))}
                        </div>
                    )}
                </div>
            </div>
        </>
    ) : (
        <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <UserCircle size={48} className="mb-4 opacity-50" />
            <p>Selecione um cliente para ver detalhes.</p>
        </div>
    );

    return (
        <React.Fragment>
            <GenericListLayout
                header={renderHeader}
                content={renderListContent}
                detail={renderDetail}
                isDetailOpen={!!selectedCustomer}
                pagination={
                    <PaginationControls
                        page={page}
                        limit={limit}
                        onPageChange={setPage}
                        onLimitChange={setLimit}
                        hasNext={customers.length >= limit}
                        hasPrev={page > 0}
                    />
                }
            />

            {/* Create Modal */}
            {isCreateModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg border border-slate-200 dark:border-slate-800 animate-in zoom-in-95 flex flex-col max-h-[90vh]">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 rounded-t-xl">
                            <h3 className="font-bold text-lg dark:text-white flex items-center gap-2">
                                <UserPlus size={18} className="text-indigo-600" /> Novo Cliente
                            </h3>
                            <button onClick={() => setIsCreateModalOpen(false)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"><X size={20} /></button>
                        </div>
                        {/* Magic Input ... */}
                        {showMagicInput && (
                            <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 border-b border-indigo-100 dark:border-indigo-900/30">
                                <div className="flex items-start gap-3">
                                    <Sparkles size={18} className="text-indigo-600 mt-1" />
                                    <div className="flex-1">
                                        <label className="block text-sm font-bold text-indigo-900 dark:text-indigo-200 mb-1">Preenchimento Mágico IA</label>
                                        <textarea
                                            className="w-full p-2 border border-indigo-200 dark:border-indigo-800 rounded bg-white dark:bg-slate-950 text-sm resize-none"
                                            rows={3}
                                            placeholder="Cole texto de email, assinatura ou site aqui..."
                                            value={magicText}
                                            onChange={e => setMagicText(e.target.value)}
                                        />
                                        <div className="flex justify-end mt-2">
                                            <button
                                                onClick={handleMagicFill}
                                                disabled={isMagicFilling || !magicText}
                                                className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded flex items-center gap-1 hover:bg-indigo-700 disabled:opacity-50"
                                            >
                                                {isMagicFilling ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Extrair Dados
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        <form onSubmit={handleCreateCustomer} className="p-6 space-y-4 overflow-y-auto">
                            {!showMagicInput && (
                                <button type="button" onClick={() => setShowMagicInput(true)} className="w-full py-2 border-2 border-dashed border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 rounded-lg text-sm font-medium hover:bg-indigo-50 dark:hover:bg-indigo-900/20 flex items-center justify-center gap-2">
                                    <Sparkles size={16} /> Usar IA para Preencher
                                </button>
                            )}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="col-span-2">
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nome da Empresa / Pessoa</label>
                                    <input className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" required value={createForm.name} onChange={e => setCreateForm({ ...createForm, name: e.target.value })} placeholder="Ex: Acme Corp" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Email</label>
                                    <input type="email" className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={createForm.email} onChange={e => setCreateForm({ ...createForm, email: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Telefone</label>
                                    <input type="text" className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={createForm.phone} onChange={e => setCreateForm({ ...createForm, phone: e.target.value })} />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Endereço</label>
                                    <input className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={createForm.address} onChange={e => setCreateForm({ ...createForm, address: e.target.value })} placeholder="Rua, Número..." />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Cidade</label>
                                    <input className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={createForm.town} onChange={e => setCreateForm({ ...createForm, town: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">CEP</label>
                                    <input className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={createForm.zip} onChange={e => setCreateForm({ ...createForm, zip: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo</label>
                                    <select className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={createForm.client} onChange={e => setCreateForm({ ...createForm, client: e.target.value as any })}>
                                        <option value="1">Cliente</option>
                                        <option value="2">Prospect</option>
                                        <option value="3">Ambos</option>
                                    </select>
                                </div>
                            </div>
                            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                                <button type="button" onClick={() => setIsCreateModalOpen(false)} className="px-4 py-2 text-slate-500 hover:text-slate-700 font-medium">Cancelar</button>
                                <button type="submit" disabled={isCreating} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium shadow-sm flex items-center gap-2">
                                    {isCreating ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />} Criar Cliente
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Edit Modal (Implied/Simplified for brevity, similar structure to create) */}
            {isEditModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg border border-slate-200 dark:border-slate-800 animate-in zoom-in-95 flex flex-col max-h-[90vh]">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 rounded-t-xl">
                            <h3 className="font-bold text-lg dark:text-white flex items-center gap-2">
                                <Pencil size={18} className="text-indigo-600" /> Editar Cliente
                            </h3>
                            <button onClick={() => setIsEditModalOpen(false)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleSaveCustomer} className="p-6 space-y-4 overflow-y-auto">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="col-span-2">
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nome</label>
                                    <input className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" required value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Email</label>
                                    <input type="email" className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Telefone</label>
                                    <input type="text" className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={editForm.phone} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Endereço</label>
                                    <input className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={editForm.address} onChange={e => setEditForm({ ...editForm, address: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Cidade</label>
                                    <input className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={editForm.town} onChange={e => setEditForm({ ...editForm, town: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">CEP</label>
                                    <input className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={editForm.zip} onChange={e => setEditForm({ ...editForm, zip: e.target.value })} />
                                </div>
                            </div>
                            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                                <button type="button" onClick={() => setIsEditModalOpen(false)} className="px-4 py-2 text-slate-500 hover:text-slate-700 font-medium">Cancelar</button>
                                <button type="submit" disabled={isSaving} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium shadow-sm flex items-center gap-2">
                                    {isSaving ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />} Salvar Alterações
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </React.Fragment>
    );
};
