import React, { useState, useMemo, useEffect, useRef } from 'react';
import { z } from 'zod';
import { toast } from 'sonner';
import { ThirdParty, AppView } from '../types';
import { useDolibarr } from '../context/DolibarrContext';
import { useCustomers, useInvoices, useProposals, useOrders, useProjects, useEvents, useTickets, useShipments, useContacts } from '../hooks/dolibarr';
import { Mail, MapPin, Building2, Phone, Sparkles, Loader2, X, ArrowLeft, Search, UserPlus, CheckCircle2, UserCircle, Pencil, ChevronLeft, ChevronRight, MessageSquare, Send } from 'lucide-react';
import { AiService } from '../services/aiService';
import { DolibarrService } from '../services/dolibarrService';
import { useCustomerMutations } from '../hooks/useMutations';
import { usePrefill, PrefillResult } from '../hooks/usePrefill';
import { useListControls } from '../hooks/useListControls';
import { FixedSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';

import { formatDateOnly } from '../utils/dateUtils';
import { formatCurrency } from '../utils/formatUtils';
import { logger } from '../utils/logger';

const log = logger.child('CustomerList');

// Common Components
import { LinkedObjects } from './common/LinkedObjects';
import { ThirdPartyContacts } from './common/ThirdPartyContacts';

// ============================================
// Sub-components
// ============================================

/** Customer row item in the list */
const CustomerRow: React.FC<{
    customer: ThirdParty;
    isSelected: boolean;
    onSelect: () => void;
    onDelete: () => Promise<any>;
    onDeleted: () => void;
}> = ({ customer, isSelected, onSelect, onDelete, onDeleted }) => {
    return (
        <Card
            onClick={onSelect}
            selected={isSelected}
            hoverable
            padding="md"
            className="mb-2"
        >
            <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                    <UserCircle size={16} className="text-indigo-400 shrink-0" />
                    <h4 className="font-bold text-slate-800 dark:text-white truncate text-sm">{customer.name}</h4>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${customer.client === '1' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                        {customer.client === '1' ? 'Cliente' : 'Prospecto'}
                    </span>
                    <ConfirmDeleteButton onDelete={onDelete} onDeleted={onDeleted} itemLabel={customer.name} />
                </div>
            </div>
            <div className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-2 mb-1 ml-6">
                <Mail size={12} className="opacity-50" /> {customer.email || 'Sem email'}
            </div>
            {customer.town && (
                <div className="text-[11px] text-slate-500 flex items-center gap-2 ml-6">
                    <MapPin size={12} className="opacity-50" /> {customer.town}
                </div>
            )}
        </Card>
    );
};

// Design System
import { PageHeader, Card, Button, Input, Modal, Tabs, Tab, EmptyState, MasterDetailLayout, ListToolbar, ConfirmDeleteButton } from './ui';

interface CustomerListProps {
    onNavigate?: (view: AppView, id: string) => void;
    initialItemId?: string;
}

export const CustomerList: React.FC<CustomerListProps> = ({ onNavigate, initialItemId }) => {
    const { config, refreshData } = useDolibarr();

    // Data Fetching
    const { data: customers = [], refetch: refetchCustomers } = useCustomers(config);
    const { data: invoices = [] } = useInvoices(config);
    const { data: proposals = [] } = useProposals(config, !!config);
    const { data: orders = [] } = useOrders(config, !!config);
    const { data: projects = [] } = useProjects(config);
    const { data: events = [] } = useEvents(config, !!config);
    const { data: tickets = [] } = useTickets(config, !!config);
    const { data: shipments = [] } = useShipments(config, !!config);
    const { data: contacts = [] } = useContacts(config, !!config);


    // Selection
    const [selectedCustomer, setSelectedCustomer] = useState<ThirdParty | null>(null);

    // Status filter via Tabs (cliente "3" = ambos, mantido fora do toolbar)
    const [filterType, setFilterType] = useState<'all' | 'customer' | 'prospect'>('all');

    // Tab State — valid tabs currently rendered in the detail panel
    const VALID_TABS = ['overview', 'contacts', 'projects', 'invoices', 'orders', 'proposals'] as const;
    type ValidTab = typeof VALID_TABS[number];
    const [activeTab, setActiveTabState] = useState<ValidTab>(() => {
        const stored = localStorage.getItem('coolgroove_customer_tab');
        return (VALID_TABS as readonly string[]).includes(stored ?? '') ? (stored as ValidTab) : 'overview';
    });

    const setActiveTab = (tab: ValidTab) => {
        setActiveTabState(tab);
        localStorage.setItem('coolgroove_customer_tab', tab);
    };

    // UI States (Modals, AI)
    const [generatedEmail, setGeneratedEmail] = useState<{ subject: string, body: string } | null>(null); // Kept for backward compat or just reuse logic
    const [generatedMessage, setGeneratedMessage] = useState<{ email?: { subject: string, body: string }, whatsapp?: { text: string } } | null>(null);
    const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);

    // Wizard State
    const [wizardStep, setWizardStep] = useState<'topic' | 'data' | 'channels'>('topic');
    const [messageConfig, setMessageConfig] = useState<{
        topic: string,
        channels: ('email' | 'whatsapp')[],
        selectedData: {
            invoices: string[],
            projects: string[],
            proposals: string[]
        }
    }>({
        topic: '',
        channels: ['email'],
        selectedData: { invoices: [], projects: [], proposals: [] }
    });
    const [activeResultTab, setActiveResultTab] = useState<'email' | 'whatsapp'>('email');

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

    // Deeplink HITL do agente (#57 Peça 2/3) — aplica o prefill UMA vez por token.
    const prefill = usePrefill();
    const appliedPrefillRef = useRef<PrefillResult | null>(null);

    useEffect(() => {
        if (initialItemId && customers.length > 0) {
            const target = customers.find(c => String(c.id) === String(initialItemId));
            if (target) {
                setSelectedCustomer(target);
                setActiveTab('overview');
            }
        }
    }, [initialItemId, customers]);

    // Deeplink HITL do agente (#57 Peça 2/3):
    //  - create_customer → abre o modal de cadastro pré-preenchido.
    //  - edit_customer → carrega os valores ATUAIS (do hook) e sobrepõe as mudanças no modal de edição.
    useEffect(() => {
        if (!prefill || appliedPrefillRef.current === prefill) return;
        if (prefill.kind === 'create_customer') {
            appliedPrefillRef.current = prefill;
            setCreateForm(prev => ({ ...prev, ...prefill.data }));
            setIsCreateModalOpen(true);
            toast.info('Revise os dados e confirme o cadastro do cliente.');
        } else if (prefill.kind === 'edit_customer') {
            if (customers.length === 0) return; // aguarda os clientes carregarem
            appliedPrefillRef.current = prefill;
            const { id, ...changes } = prefill.data;
            const current = customers.find(c => String(c.id) === String(id));
            if (!current) {
                toast.error('Cliente não encontrado para edição.');
                return;
            }
            setSelectedCustomer(current);
            setEditForm({ ...current, ...changes });
            setIsEditModalOpen(true);
            toast.info('Revise as mudanças sugeridas e salve.');
        }
    }, [prefill, customers]);

    // Filtro de status (cliente "3" = ambos) aplicado antes de busca/ordenação.
    const statusFilteredCustomers = useMemo(() => {
        return customers.filter(c => {
            const isProspect = c.client === '2' || c.client === '3';
            const isCustomer = c.client === '1' || c.client === '3';
            if (filterType === 'customer') return isCustomer;
            if (filterType === 'prospect') return isProspect;
            return true;
        });
    }, [customers, filterType]);

    // Busca + ordenação padronizadas (#121).
    const controls = useListControls(statusFilteredCustomers, {
        searchText: (c) => `${c.name || ''} ${c.email || ''} ${c.town || ''}`,
        sorts: [
            { key: 'name', label: 'Nome', get: (c) => c.name },
            { key: 'town', label: 'Cidade', get: (c) => c.town },
            { key: 'date', label: 'Atualizado', get: (c) => c.date_modification ?? 0 },
        ],
        initialSortKey: 'name',
    });
    const filteredCustomers = controls.result;

    const customerInvoices = useMemo(() => selectedCustomer ? invoices.filter(i => String(i.socid) === String(selectedCustomer.id)) : [], [selectedCustomer, invoices]);
    const customerProjects = useMemo(() => selectedCustomer ? projects.filter(p => String(p.socid) === String(selectedCustomer.id)) : [], [selectedCustomer, projects]);
    const customerProposals = useMemo(() => selectedCustomer ? proposals.filter(p => String(p.socid) === String(selectedCustomer.id)) : [], [selectedCustomer, proposals]);
    const customerOrders = useMemo(() => selectedCustomer ? orders.filter(o => String(o.socid) === String(selectedCustomer.id)) : [], [selectedCustomer, orders]);
    const customerContacts = useMemo(() => selectedCustomer ? contacts.filter(c => String(c.socid) === String(selectedCustomer.id)) : [], [selectedCustomer, contacts]);


    // Handlers
    const handleOpenMessageConfig = (customer: ThirdParty) => {
        setSelectedCustomer(customer);
        setWizardStep('topic');
        setMessageConfig({
            topic: (customer.outstanding_balance || 0) > 0 ? "Cobrança de fatura em atraso" : "Boas vindas e apresentação de serviços",
            channels: ['email'],
            selectedData: { invoices: [], projects: [], proposals: [] }
        });
        setIsConfigModalOpen(true);
    };

    const handleGenerateMessage = async () => {
        if (!selectedCustomer) return;
        setIsGenerating(true);
        setGeneratedMessage(null);
        try {
            const resultStr = await AiService.draftMessage(
                selectedCustomer,
                messageConfig.topic,
                messageConfig.channels,
                {
                    selectedInvoices: customerInvoices.filter(i => messageConfig.selectedData.invoices.includes(String(i.id))),
                    selectedProjects: customerProjects.filter(p => messageConfig.selectedData.projects.includes(String(p.id))),
                    selectedProposals: customerProposals.filter(p => messageConfig.selectedData.proposals.includes(String(p.id)))
                }
            );

            if (resultStr) {
                // Try to parse JSON from the response text
                // Sometimes models wrap json in backticks
                let jsonStr = resultStr.replace(/```json/g, '').replace(/```/g, '');
                try {
                    const result = JSON.parse(jsonStr);
                    setGeneratedMessage(result);
                    setActiveResultTab(messageConfig.channels[0]); // Select first available
                    setIsConfigModalOpen(false);
                } catch (e) {
                    log.error("JSON parse error for AI response", e);
                    // Fallback logic could go here
                    toast.error("Erro ao processar resposta da IA.");
                }
            }
        } catch (e) {
            log.error("Failed to generate message", e);
            toast.error("Erro na geração da mensagem.");
        } finally {
            setIsGenerating(false);
        }
    };

    // Deprecated single-purpose handler (can remove later)
    const handleGenerateEmail = async (customer: ThirdParty, type: 'collection' | 'welcome') => {
        handleOpenMessageConfig(customer);
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
            log.error("Failed to analyze sentiment", e);
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleEditClick = () => {
        if (!selectedCustomer) return;
        setEditForm({
            name: selectedCustomer.name,
            name_alias: selectedCustomer.name_alias,
            address: selectedCustomer.address,
            zip: selectedCustomer.zip,
            town: selectedCustomer.town,
            phone: selectedCustomer.phone,
            phone_mobile: selectedCustomer.phone_mobile,
            fax: selectedCustomer.fax,
            email: selectedCustomer.email,
            url: selectedCustomer.url,
            idprof1: selectedCustomer.idprof1,
            typent_id: selectedCustomer.typent_id,
            socialnetworks: selectedCustomer.socialnetworks,
            array_options: selectedCustomer.array_options,
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
            log.error("Failed to update customer", err);
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
            log.error("Failed to extract customer data via AI", e);
            toast.error("Falha ao extrair dados.");
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
            log.error("Failed to create customer", err);
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
            paddingLeft: '8px',
            paddingRight: '8px'
        };

        return (
            <div style={itemStyle}>
                <CustomerRow
                    customer={customer}
                    isSelected={selectedCustomer?.id === customer.id}
                    onSelect={() => setSelectedCustomer(customer)}
                    onDelete={() => DolibarrService.deleteThirdParty(config!, customer.id)}
                    onDeleted={() => {
                        if (selectedCustomer?.id === customer.id) setSelectedCustomer(null);
                        refetchCustomers();
                    }}
                />
            </div>
        );
    };

    // --- Sub-components --

    const renderHeader = (
        <PageHeader
            title="Clientes & Prospectos"
            subtitle="Gerencie seu relacionamento comercial"
            actions={
                <div className="flex items-center flex-wrap gap-2">
                    <ListToolbar controls={controls} searchPlaceholder="Buscar cliente..." />
                    <Button icon={<UserPlus size={18} />} onClick={() => setIsCreateModalOpen(true)}>
                        Novo
                    </Button>
                </div>
            }
            tabs={
                <Tabs value={filterType} onChange={(v) => setFilterType(v as any)}>
                    <Tab value="all">Todos</Tab>
                    <Tab value="customer">Clientes</Tab>
                    <Tab value="prospect">Prospecto</Tab>
                </Tabs>
            }
        />
    );

    const renderListContent = filteredCustomers.length === 0 ? (
        <EmptyState
            icon={UserCircle}
            title="Nenhum cliente encontrado"
            description="Tente ajustar os filtros ou adicione um novo cliente."
            action={<Button onClick={() => setIsCreateModalOpen(true)}>Adicionar Cliente</Button>}
        />
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
        <div className="flex flex-col h-full">
            <PageHeader
                title={selectedCustomer.name}
                subtitle={selectedCustomer.email || 'Sem email'}
                onBack={() => setSelectedCustomer(null)}
                actions={
                    <div className="flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="sm"
                            icon={<Sparkles size={18} className="text-purple-500" />}
                            onClick={() => handleOpenMessageConfig(selectedCustomer)}
                            title="Gerar Mensagem IA"
                        />
                        <Button
                            variant="ghost"
                            size="sm"
                            icon={<Pencil size={18} />}
                            onClick={handleEditClick}
                        />
                    </div>
                }
            />

            <div className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4">
                <Tabs value={activeTab} onChange={(v) => setActiveTab(v as any)}>
                    <Tab value="overview">Visão Geral</Tab>
                    <Tab value="contacts" badge={customerContacts.length}>Responsáveis</Tab>
                    <Tab value="projects" badge={customerProjects.length}>Projetos</Tab>
                    <Tab value="invoices" badge={customerInvoices.length}>Faturas</Tab>
                    <Tab value="orders" badge={customerOrders.length}>Pedidos</Tab>
                    <Tab value="proposals" badge={customerProposals.length}>Propostas</Tab>
                </Tabs>
            </div>

            {activeTab === 'overview' && (
                <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950/50">
                    <div className="max-w-4xl mx-auto space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <Card padding="lg">
                                <h3 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                                    <Building2 size={18} className="text-indigo-500" />
                                    Informações
                                </h3>
                                <div className="space-y-3">
                                    {selectedCustomer.address && (
                                        <div className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
                                            <MapPin size={16} className="mt-0.5 text-slate-400" />
                                            {selectedCustomer.address}, {selectedCustomer.zip} {selectedCustomer.town}
                                        </div>
                                    )}
                                    {selectedCustomer.phone && (
                                        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                                            <Phone size={16} className="text-slate-400" />
                                            {selectedCustomer.phone}
                                        </div>
                                    )}
                                    {selectedCustomer.email && (
                                        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                                            <Mail size={16} className="text-slate-400" />
                                            {selectedCustomer.email}
                                        </div>
                                    )}
                                </div>
                            </Card>

                            <Card padding="lg" className="border-purple-100 dark:border-purple-900/30">
                                <h3 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                                    <Sparkles size={18} className="text-purple-500" />
                                    Saúde do Cliente
                                </h3>
                                {!sentimentAnalysis ? (
                                    <div className="text-center py-4">
                                        <p className="text-sm text-slate-500 mb-4">Análise preditiva baseada no histórico.</p>
                                        <Button
                                            size="sm"
                                            className="!bg-purple-600 hover:!bg-purple-700"
                                            onClick={() => handleAnalyzeSentiment(selectedCustomer)}
                                            loading={isAnalyzing}
                                            icon={!isAnalyzing && <Sparkles size={14} />}
                                        >
                                            Gerar Insights
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="flex justify-between items-center">
                                            <span className="text-sm text-slate-500 font-medium">Score de Fidelidade</span>
                                            <span className="font-bold text-slate-800 dark:text-white text-lg">{sentimentAnalysis.score}/100</span>
                                        </div>
                                        <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-gradient-to-r from-red-500 via-yellow-400 to-green-500 transition-all duration-1000"
                                                style={{ width: `${sentimentAnalysis.score}%` }}
                                            ></div>
                                        </div>
                                        <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-xl border border-purple-100 dark:border-purple-800 text-sm">
                                            <p className="font-bold text-purple-900 dark:text-purple-200 mb-1">{sentimentAnalysis.label}</p>
                                            <p className="text-purple-800/80 dark:text-purple-300/80 text-xs leading-relaxed">{sentimentAnalysis.insight}</p>
                                        </div>
                                    </div>
                                )}
                            </Card>

                            <div className="md:col-span-2">
                                <LinkedObjects
                                    id={selectedCustomer.id}
                                    type="societe"
                                    onNavigate={onNavigate}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'contacts' && config && (
                <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950/50">
                    <div className="max-w-2xl mx-auto">
                        <ThirdPartyContacts socid={selectedCustomer.id} config={config} />
                    </div>
                </div>
            )}

            {(activeTab === 'projects' || activeTab === 'invoices' || activeTab === 'orders' || activeTab === 'proposals') && (
                <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950/50">
                    <div className="max-w-4xl mx-auto space-y-3">
                        {activeTab === 'projects' && (
                            customerProjects.length === 0 ? <EmptyState title="Nenhum projeto encontrado" /> :
                                customerProjects.map(proj => (
                                    <Card key={proj.id} onClick={() => onNavigate && onNavigate('projects', proj.id)} hoverable className="flex justify-between items-center p-4">
                                        <div>
                                            <div className="font-bold text-slate-800 dark:text-white text-sm flex items-center gap-2">
                                                {proj.ref}
                                                <span className={`text-[10px] px-2 py-0.5 rounded uppercase font-bold ${proj.statut === '1' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-700'}`}>
                                                    {proj.statut === '1' ? 'Aberto' : 'Fechado'}
                                                </span>
                                            </div>
                                            <div className="text-xs text-slate-500 mt-1">{proj.title}</div>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <div className="w-24 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                                <div className="h-full bg-indigo-500" style={{ width: `${proj.progress}%` }}></div>
                                            </div>
                                            <span className="text-xs font-mono text-slate-600 dark:text-slate-400">{proj.progress}%</span>
                                        </div>
                                    </Card>
                                ))
                        )}

                        {activeTab === 'invoices' && (
                            customerInvoices.length === 0 ? <EmptyState title="Nenhuma fatura encontrada" /> :
                                customerInvoices.map(inv => (
                                    <Card key={inv.id} onClick={() => onNavigate && onNavigate('invoices', inv.id)} hoverable className="flex justify-between items-center p-4">
                                        <div>
                                            <div className="font-bold text-slate-800 dark:text-white text-sm flex items-center gap-2">
                                                {inv.ref}
                                                {inv.statut === '2' ? <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded font-bold uppercase">Pago</span> : <span className="text-[10px] bg-orange-100 text-orange-700 px-2 py-0.5 rounded font-bold uppercase">Aberto</span>}
                                            </div>
                                            <div className="text-xs text-slate-500 mt-1">{formatDateOnly(inv.date)}</div>
                                        </div>
                                        <div className="font-bold text-slate-900 dark:text-white">{formatCurrency(inv.total_ttc)}</div>
                                    </Card>
                                ))
                        )}

                        {activeTab === 'orders' && (
                            customerOrders.length === 0 ? <EmptyState title="Nenhum pedido encontrado" /> :
                                customerOrders.map(ord => (
                                    <Card key={ord.id} onClick={() => onNavigate && onNavigate('orders', ord.id)} hoverable className="flex justify-between items-center p-4">
                                        <div>
                                            <div className="font-bold text-slate-800 dark:text-white text-sm flex items-center gap-2">
                                                {ord.ref}
                                                <span className={`text-[10px] px-2 py-0.5 rounded uppercase font-bold ${ord.statut === '3' ? 'bg-emerald-100 text-emerald-700' : ord.statut === '0' ? 'bg-slate-100 text-slate-700' : 'bg-blue-100 text-blue-700'}`}>
                                                    {ord.statut === '3' ? 'Entregue' : ord.statut === '0' ? 'Rascunho' : 'Em Processo'}
                                                </span>
                                            </div>
                                            <div className="text-xs text-slate-500 mt-1">{formatDateOnly(ord.date)}</div>
                                        </div>
                                        <div className="font-bold text-slate-900 dark:text-white">{formatCurrency(ord.total_ttc)}</div>
                                    </Card>
                                ))
                        )}

                        {activeTab === 'proposals' && (
                            customerProposals.length === 0 ? <EmptyState title="Nenhuma proposta encontrada" /> :
                                customerProposals.map(prop => (
                                    <Card key={prop.id} onClick={() => onNavigate && onNavigate('proposals', prop.id)} hoverable className="flex justify-between items-center p-4">
                                        <div>
                                            <div className="font-bold text-slate-800 dark:text-white text-sm flex items-center gap-2">
                                                {prop.ref}
                                                <span className={`text-[10px] px-2 py-0.5 rounded uppercase font-bold ${prop.statut === '2' ? 'bg-emerald-100 text-emerald-700' : prop.statut === '3' ? 'bg-red-100 text-red-700' : 'bg-purple-100 text-purple-700'}`}>
                                                    {prop.statut === '2' ? 'Assinada' : prop.statut === '3' ? 'Recusada' : 'Aberta'}
                                                </span>
                                            </div>
                                            <div className="text-xs text-slate-500 mt-1">{formatDateOnly(prop.date)}</div>
                                        </div>
                                        <div className="font-bold text-slate-900 dark:text-white">{formatCurrency(prop.total_ttc)}</div>
                                    </Card>
                                ))
                        )}
                    </div>
                </div>
            )}
        </div>
    ) : (
        <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <UserCircle size={48} className="mb-4 opacity-50" />
            <p>Selecione um cliente para ver detalhes.</p>
        </div>
    );

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 transition-colors">
            {/* Header shown only if no item or on desktop */}
            <div className={selectedCustomer ? 'hidden lg:block' : 'block'}>
                {renderHeader}
            </div>

            <MasterDetailLayout
                showDetail={!!selectedCustomer}
                onCloseDetail={() => setSelectedCustomer(null)}
                listWidth="1/3"
                list={
                    <div className="flex flex-col h-full">
                        <div className="flex-1 min-h-0">
                            {renderListContent}
                        </div>
                    </div>
                }
                detail={renderDetail}
            />


            {/* Create Modal */}
            <Modal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                title={
                    <span className="flex items-center gap-2">
                        <UserPlus size={18} className="text-indigo-600" /> Novo Cliente
                    </span>
                }
                size="md"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsCreateModalOpen(false)}>Cancelar</Button>
                        <Button
                            loading={isCreating}
                            icon={<CheckCircle2 size={16} />}
                            onClick={handleCreateCustomer}
                        >
                            Criar Cliente
                        </Button>
                    </>
                }
            >
                {/* AI Magic Fill Section */}
                {showMagicInput && (
                    <Card padding="md" className="mb-4 bg-indigo-50 dark:bg-indigo-900/20 border-indigo-100 dark:border-indigo-900/30">
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
                                    <Button
                                        size="sm"
                                        onClick={handleMagicFill}
                                        disabled={isMagicFilling || !magicText}
                                        loading={isMagicFilling}
                                        icon={<Sparkles size={12} />}
                                    >
                                        Extrair Dados
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </Card>
                )}

                {/* AI Trigger Button */}
                {!showMagicInput && (
                    <button
                        type="button"
                        onClick={() => setShowMagicInput(true)}
                        className="w-full py-2 mb-4 border-2 border-dashed border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 rounded-lg text-sm font-medium hover:bg-indigo-50 dark:hover:bg-indigo-900/20 flex items-center justify-center gap-2"
                    >
                        <Sparkles size={16} /> Usar IA para Preencher
                    </button>
                )}

                {/* Form Fields */}
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo de Pessoa</label>
                            <select
                                className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                value={createForm.typent_id || ''}
                                onChange={e => setCreateForm({ ...createForm, typent_id: e.target.value || undefined })}
                            >
                                <option value="">Não definido</option>
                                <option value="8">Pessoa Física</option>
                                <option value="5">Empresa (PJ)</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo</label>
                            <select
                                className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                value={createForm.client}
                                onChange={e => setCreateForm({ ...createForm, client: e.target.value as any })}
                            >
                                <option value="1">Cliente</option>
                                <option value="2">Prospecto</option>
                                <option value="3">Ambos</option>
                            </select>
                        </div>
                    </div>
                    <Input
                        label="Nome da Empresa / Pessoa"
                        required
                        value={createForm.name || ''}
                        onChange={e => setCreateForm({ ...createForm, name: e.target.value })}
                        placeholder="Ex: Acme Corp"
                    />
                    <div className="grid grid-cols-2 gap-4">
                        <Input
                            label="Nome Fantasia / Complemento"
                            value={createForm.name_alias || ''}
                            onChange={e => setCreateForm({ ...createForm, name_alias: e.target.value })}
                        />
                        <Input
                            label="CNPJ / CPF"
                            value={createForm.idprof1 || ''}
                            onChange={e => setCreateForm({ ...createForm, idprof1: e.target.value })}
                            placeholder="00.000.000/0001-00"
                        />
                    </div>
                    {createForm.typent_id !== '8' && (
                        <Input
                            label="Responsável Legal (Assinante de Contrato)"
                            value={createForm.array_options?.options_assinante || ''}
                            onChange={e => setCreateForm({
                                ...createForm,
                                array_options: { ...createForm.array_options, options_assinante: e.target.value }
                            })}
                            placeholder="Nome de quem assina os contratos"
                        />
                    )}
                    <div className="grid grid-cols-2 gap-4">
                        <Input
                            label="Email"
                            type="email"
                            value={createForm.email || ''}
                            onChange={e => setCreateForm({ ...createForm, email: e.target.value })}
                        />
                        <Input
                            label="Telefone"
                            value={createForm.phone || ''}
                            onChange={e => setCreateForm({ ...createForm, phone: e.target.value })}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <Input
                            label="WhatsApp / Celular"
                            value={createForm.phone_mobile || ''}
                            onChange={e => setCreateForm({ ...createForm, phone_mobile: e.target.value })}
                            placeholder="+55 11 99999-9999"
                        />
                        <Input
                            label="Outro Telefone / Fax"
                            value={createForm.fax || ''}
                            onChange={e => setCreateForm({ ...createForm, fax: e.target.value })}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <Input
                            label="Site"
                            value={createForm.url || ''}
                            onChange={e => setCreateForm({ ...createForm, url: e.target.value })}
                            placeholder="https://..."
                        />
                        <Input
                            label="LinkedIn / Rede Social"
                            value={createForm.socialnetworks?.linkedin || ''}
                            onChange={e => setCreateForm({
                                ...createForm,
                                socialnetworks: { ...createForm.socialnetworks, linkedin: e.target.value }
                            })}
                            placeholder="URL do perfil"
                        />
                    </div>
                    <Input
                        label="Endereço"
                        value={createForm.address || ''}
                        onChange={e => setCreateForm({ ...createForm, address: e.target.value })}
                        placeholder="Rua, Número..."
                    />
                    <div className="grid grid-cols-2 gap-4">
                        <Input
                            label="Cidade"
                            value={createForm.town || ''}
                            onChange={e => setCreateForm({ ...createForm, town: e.target.value })}
                        />
                        <Input
                            label="CEP"
                            value={createForm.zip || ''}
                            onChange={e => setCreateForm({ ...createForm, zip: e.target.value })}
                        />
                    </div>
                </div>
            </Modal>

            {/* Wizard Configuration Modal */}
            <Modal
                isOpen={isConfigModalOpen}
                onClose={() => setIsConfigModalOpen(false)}
                title={
                    <span className="flex items-center gap-2">
                        <Sparkles size={18} className="text-purple-600" />
                        {wizardStep === 'topic' && "Passo 1: Objetivo"}
                        {wizardStep === 'data' && "Passo 2: Seleção de Dados"}
                        {wizardStep === 'channels' && "Passo 3: Canais"}
                    </span>
                }
                size="md"
                footer={
                    <div className="flex justify-between w-full">
                        <Button
                            variant="secondary"
                            onClick={() => {
                                if (wizardStep === 'topic') setIsConfigModalOpen(false);
                                if (wizardStep === 'data') setWizardStep('topic');
                                if (wizardStep === 'channels') setWizardStep('data');
                            }}
                        >
                            {wizardStep === 'topic' ? 'Cancelar' : 'Voltar'}
                        </Button>
                        <Button
                            className="!bg-purple-600 hover:!bg-purple-700"
                            icon={wizardStep === 'channels'
                                ? <Sparkles size={16} />
                                : <ChevronRight size={16} />
                            }
                            loading={wizardStep === 'channels' && isGenerating}
                            disabled={wizardStep === 'topic' && !messageConfig.topic.trim()}
                            onClick={() => {
                                if (wizardStep === 'topic') setWizardStep('data');
                                else if (wizardStep === 'data') setWizardStep('channels');
                                else if (wizardStep === 'channels') handleGenerateMessage();
                            }}
                        >
                            {wizardStep === 'channels' ? 'Gerar' : 'Próximo'}
                        </Button>
                    </div>
                }
            >
                {/* Step 1: Topic */}
                {wizardStep === 'topic' && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-200">
                        <div>
                            <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Qual o motivo do contato?</label>
                            <textarea
                                className="w-full p-3 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-sm resize-none focus:ring-2 focus:ring-purple-500 outline-none transition-all h-32"
                                placeholder="Ex: Cobrar fatura atrasada com educação..."
                                value={messageConfig.topic}
                                onChange={e => setMessageConfig({ ...messageConfig, topic: e.target.value })}
                                autoFocus
                            />
                            <p className="text-xs text-slate-500 mt-2">Dica: Seja específico sobre o tom de voz desejado (formal, amigável, urgente).</p>
                        </div>
                    </div>
                )}

                {/* Step 2: Data Selection */}
                {wizardStep === 'data' && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-200">
                        <p className="text-sm text-slate-500 mb-2">Selecione os dados que a IA deve mencionar na mensagem:</p>

                        {/* Invoices Selection */}
                        <Card padding="md">
                            <h4 className="text-xs font-bold uppercase text-slate-400 mb-2 flex items-center gap-1"><Building2 size={12} /> Faturas em Aberto</h4>
                            {customerInvoices.length > 0 ? (
                                <div className="space-y-2 max-h-32 overflow-y-auto">
                                    {customerInvoices.filter(i => i.statut !== '2').map(inv => (
                                        <label key={inv.id} className="flex items-center gap-2 p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded cursor-pointer text-sm">
                                            <input
                                                type="checkbox"
                                                checked={messageConfig.selectedData.invoices.includes(String(inv.id))}
                                                onChange={(e) => {
                                                    const current = messageConfig.selectedData.invoices;
                                                    const newVal = e.target.checked ? [...current, String(inv.id)] : current.filter(id => id !== String(inv.id));
                                                    setMessageConfig({ ...messageConfig, selectedData: { ...messageConfig.selectedData, invoices: newVal } });
                                                }}
                                                className="rounded text-purple-600 focus:ring-purple-500"
                                            />
                                            <span className="flex-1 font-medium">{inv.ref}</span>
                                            <span className="text-slate-500">{formatCurrency(inv.total_ttc)}</span>
                                        </label>
                                    ))}
                                    {customerInvoices.filter(i => i.statut !== '2').length === 0 && <p className="text-xs text-slate-400 p-2">Nenhuma fatura em aberto.</p>}
                                </div>
                            ) : <p className="text-xs text-slate-400 italic">Nenhuma fatura encontrada.</p>}
                        </Card>

                        {/* Projects Selection */}
                        <Card padding="md">
                            <h4 className="text-xs font-bold uppercase text-slate-400 mb-2 flex items-center gap-1"><Building2 size={12} /> Projetos Ativos</h4>
                            {customerProjects.length > 0 ? (
                                <div className="space-y-2 max-h-32 overflow-y-auto">
                                    {customerProjects.map(proj => (
                                        <label key={proj.id} className="flex items-center gap-2 p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded cursor-pointer text-sm">
                                            <input
                                                type="checkbox"
                                                checked={messageConfig.selectedData.projects.includes(String(proj.id))}
                                                onChange={(e) => {
                                                    const current = messageConfig.selectedData.projects;
                                                    const newVal = e.target.checked ? [...current, String(proj.id)] : current.filter(id => id !== String(proj.id));
                                                    setMessageConfig({ ...messageConfig, selectedData: { ...messageConfig.selectedData, projects: newVal } });
                                                }}
                                                className="rounded text-purple-600 focus:ring-purple-500"
                                            />
                                            <span className="flex-1 font-medium truncate">{proj.title}</span>
                                            <span className="text-xs text-slate-500">{proj.progress}%</span>
                                        </label>
                                    ))}
                                </div>
                            ) : <p className="text-xs text-slate-400 italic">Nenhum projeto encontrado.</p>}
                        </Card>
                    </div>
                )}

                {/* Step 3: Channels */}
                {wizardStep === 'channels' && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-200">
                        <div>
                            <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Onde você quer enviar?</label>
                            <div className="grid grid-cols-2 gap-4">
                                <label className={`flex flex-col items-center justify-center gap-3 p-6 rounded-xl border-2 cursor-pointer transition-all ${messageConfig.channels.includes('email') ? 'bg-indigo-50 border-indigo-500 text-indigo-700 dark:bg-indigo-900/20 dark:border-indigo-500' : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300 dark:bg-slate-900 dark:border-slate-700'}`}>
                                    <input
                                        type="checkbox"
                                        className="hidden"
                                        checked={messageConfig.channels.includes('email')}
                                        onChange={(e) => {
                                            if (e.target.checked) setMessageConfig({ ...messageConfig, channels: [...messageConfig.channels, 'email'] });
                                            else setMessageConfig({ ...messageConfig, channels: messageConfig.channels.filter(c => c !== 'email') });
                                        }}
                                    />
                                    <Mail size={32} />
                                    <span className="font-bold">Email</span>
                                </label>
                                <label className={`flex flex-col items-center justify-center gap-3 p-6 rounded-xl border-2 cursor-pointer transition-all ${messageConfig.channels.includes('whatsapp') ? 'bg-emerald-50 border-emerald-500 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-500' : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300 dark:bg-slate-900 dark:border-slate-700'}`}>
                                    <input
                                        type="checkbox"
                                        className="hidden"
                                        checked={messageConfig.channels.includes('whatsapp')}
                                        onChange={(e) => {
                                            if (e.target.checked) setMessageConfig({ ...messageConfig, channels: [...messageConfig.channels, 'whatsapp'] });
                                            else setMessageConfig({ ...messageConfig, channels: messageConfig.channels.filter(c => c !== 'whatsapp') });
                                        }}
                                    />
                                    <MessageSquare size={32} />
                                    <span className="font-bold">WhatsApp</span>
                                </label>
                            </div>
                        </div>
                    </div>
                )}
            </Modal>

            {/* Generated Message Result Modal */}
            <Modal
                isOpen={!!generatedMessage}
                onClose={() => setGeneratedMessage(null)}
                title={
                    <div className="flex items-center gap-4">
                        <span className="flex items-center gap-2">
                            <Sparkles size={18} className="text-purple-600" /> Resultado
                        </span>
                        <Tabs value={activeResultTab} onChange={(v) => setActiveResultTab(v as any)}>
                            {generatedMessage?.email && <Tab value="email">Email</Tab>}
                            {generatedMessage?.whatsapp && <Tab value="whatsapp">WhatsApp</Tab>}
                        </Tabs>
                    </div>
                }
                size="lg"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setGeneratedMessage(null)}>Fechar</Button>
                        <Button
                            icon={<CheckCircle2 size={16} />}
                            onClick={() => {
                                const content = activeResultTab === 'email'
                                    ? `${generatedMessage?.email?.subject}\n\n${generatedMessage?.email?.body}`
                                    : generatedMessage?.whatsapp?.text;
                                navigator.clipboard.writeText(content || '');
                                toast.success("Copiado para a área de transferência!");
                            }}
                        >
                            Copiar Conteúdo
                        </Button>
                        {activeResultTab === 'whatsapp' && (
                            <Button
                                variant="primary"
                                icon={<Send size={16} />}
                                className="!bg-emerald-600 hover:!bg-emerald-700"
                                onClick={() => {
                                    window.open(`https://wa.me/${selectedCustomer?.phone?.replace(/\D/g, '')}?text=${encodeURIComponent(generatedMessage?.whatsapp?.text || '')}`, '_blank');
                                }}
                            >
                                Enviar
                            </Button>
                        )}
                    </>
                }
            >
                {activeResultTab === 'email' && generatedMessage?.email && (
                    <div className="space-y-4">
                        <Card padding="md">
                            <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Assunto</label>
                            <div className="text-slate-800 dark:text-slate-200 text-sm font-medium">
                                {generatedMessage.email.subject}
                            </div>
                        </Card>
                        <Card padding="md">
                            <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Corpo</label>
                            <div className="text-slate-800 dark:text-slate-200 text-sm whitespace-pre-wrap max-h-64 overflow-y-auto">
                                {generatedMessage.email.body}
                            </div>
                        </Card>
                    </div>
                )}

                {activeResultTab === 'whatsapp' && generatedMessage?.whatsapp && (
                    <div className="space-y-4">
                        <Card padding="md">
                            <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Mensagem</label>
                            <div className="relative p-4 bg-[#e5ddd5] dark:bg-[#0b141a] rounded-lg min-h-[300px]">
                                <div className="bg-white dark:bg-[#202c33] p-3 rounded-lg shadow-sm text-sm text-slate-800 dark:text-slate-200 inline-block max-w-[90%] whitespace-pre-wrap relative">
                                    {generatedMessage.whatsapp.text}
                                    <div className="absolute top-0 right-0 -mr-2 -mt-0 w-4 h-4 bg-white dark:bg-[#202c33] transform rotate-45"></div>
                                </div>
                            </div>
                        </Card>
                    </div>
                )}
            </Modal>

            {/* Edit Modal */}
            <Modal
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                title="Editar Cliente"
                size="md"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsEditModalOpen(false)}>Cancelar</Button>
                        <Button loading={isSaving} onClick={handleSaveCustomer}>Salvar Alterações</Button>
                    </>
                }
            >
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo de Pessoa</label>
                        <select
                            className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                            value={editForm.typent_id || ''}
                            onChange={e => setEditForm({ ...editForm, typent_id: e.target.value || undefined })}
                        >
                            <option value="">Não definido</option>
                            <option value="8">Pessoa Física</option>
                            <option value="5">Empresa (PJ)</option>
                        </select>
                    </div>
                    <Input label="Nome" required value={editForm.name || ''} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
                    <div className="grid grid-cols-2 gap-4">
                        <Input label="Nome Fantasia / Complemento" value={editForm.name_alias || ''} onChange={e => setEditForm({ ...editForm, name_alias: e.target.value })} />
                        <Input label="CNPJ / CPF" value={editForm.idprof1 || ''} onChange={e => setEditForm({ ...editForm, idprof1: e.target.value })} placeholder="00.000.000/0001-00" />
                    </div>
                    {editForm.typent_id !== '8' && (
                        <Input
                            label="Responsável Legal (Assinante de Contrato)"
                            value={editForm.array_options?.options_assinante || ''}
                            onChange={e => setEditForm({
                                ...editForm,
                                array_options: { ...editForm.array_options, options_assinante: e.target.value }
                            })}
                            placeholder="Nome de quem assina os contratos"
                        />
                    )}
                    <div className="grid grid-cols-2 gap-4">
                        <Input label="Email" type="email" value={editForm.email || ''} onChange={e => setEditForm({ ...editForm, email: e.target.value })} />
                        <Input label="Telefone" value={editForm.phone || ''} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <Input label="WhatsApp / Celular" value={editForm.phone_mobile || ''} onChange={e => setEditForm({ ...editForm, phone_mobile: e.target.value })} placeholder="+55 11 99999-9999" />
                        <Input label="Outro Telefone / Fax" value={editForm.fax || ''} onChange={e => setEditForm({ ...editForm, fax: e.target.value })} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <Input label="Site" value={editForm.url || ''} onChange={e => setEditForm({ ...editForm, url: e.target.value })} placeholder="https://..." />
                        <Input
                            label="LinkedIn / Rede Social"
                            value={editForm.socialnetworks?.linkedin || ''}
                            onChange={e => setEditForm({
                                ...editForm,
                                socialnetworks: { ...editForm.socialnetworks, linkedin: e.target.value }
                            })}
                            placeholder="URL do perfil"
                        />
                    </div>
                    <Input label="Endereço" value={editForm.address || ''} onChange={e => setEditForm({ ...editForm, address: e.target.value })} />
                    <div className="grid grid-cols-2 gap-4">
                        <Input label="Cidade" value={editForm.town || ''} onChange={e => setEditForm({ ...editForm, town: e.target.value })} />
                        <Input label="CEP" value={editForm.zip || ''} onChange={e => setEditForm({ ...editForm, zip: e.target.value })} />
                    </div>
                </div>
            </Modal>
        </div>
    );
};
