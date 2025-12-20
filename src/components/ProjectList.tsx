import React, { useState, useMemo, useEffect } from 'react';
import { Project, ThirdParty, DolibarrConfig, AppView, Task, Invoice, SupplierInvoice, Intervention, ExpenseReport, ManufacturingOrder, Contract, DolibarrDocument } from '../types';
import { FolderKanban, Search, Plus, X, Loader2, CheckCircle2, Clock, Calendar, ArrowRight, Settings, BarChart3, ArrowDown, ExternalLink, ArrowUp, Receipt, User, Factory, Package, FileSignature, Files, File, Trash2, Upload, Briefcase } from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

// Direct Hook Imports
import { useDolibarr } from '../context/DolibarrContext';
import { useProjects } from '../hooks/dolibarr/useProjects';
import { useCustomers } from '../hooks/dolibarr/useCustomers';
import { useTickets } from '../hooks/dolibarr/useTickets';
import { useEvents } from '../hooks/dolibarr/useEvents';
import { useTasks } from '../hooks/dolibarr/useTasks';
import { useInvoices } from '../hooks/dolibarr/useInvoices';
import { useSupplierInvoices } from '../hooks/dolibarr/useSupplierInvoices';
import { useInterventions } from '../hooks/dolibarr/useInterventions';
import { useExpenseReports } from '../hooks/dolibarr/useExpenseReports';
import { useManufacturingOrders } from '../hooks/dolibarr/useManufacturingOrders';
import { useContracts } from '../hooks/dolibarr/useContracts';

// Common Components
import { GenericListLayout } from './common/GenericListLayout';
import { PaginationControls } from './common/PaginationControls';
import { StatusFilterBar } from './common/StatusFilterBar';

interface ProjectListProps {
    onNavigate?: (view: AppView, id: string) => void;
    initialItemId?: string;
    // Legacy props (ignored)
    projects?: any[];
    customers?: any[];
    tasks?: any[];
    invoices?: any[];
    supplierInvoices?: any[];
    interventions?: any[];
    expenseReports?: any[];
    manufacturingOrders?: any[];
    contracts?: any[];
    config?: any;
    onRefresh?: any;
}

const ProjectList: React.FC<ProjectListProps> = ({ onNavigate, initialItemId }) => {
    const { config, refreshData } = useDolibarr();

    // Data Hooks
    const { data: projects = [] } = useProjects(config);
    const { data: customers = [] } = useCustomers(config);
    const { data: tasks = [] } = useTasks(config, !!config);
    const { data: invoices = [] } = useInvoices(config);
    const { data: supplierInvoices = [] } = useSupplierInvoices(config, !!config);
    const { data: interventions = [] } = useInterventions(config, !!config);
    const { data: expenseReports = [] } = useExpenseReports(config, !!config);
    const { data: manufacturingOrders = [] } = useManufacturingOrders(config, !!config);
    const { data: contracts = [] } = useContracts(config, !!config);
    const { data: tickets = [] } = useTickets(config, !!config);
    const { data: events = [] } = useEvents(config, !!config);

    // Pagination
    const [page, setPage] = useState(0);
    const [limit, setLimit] = useState(20);

    // Filter & Search
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'draft' | 'open' | 'closed'>('all');

    // Selection & Tabs
    const [selectedProject, setSelectedProject] = useState<Project | null>(null);
    const [activeTab, setActiveTab] = useState<'overview' | 'tasks' | 'tickets' | 'events' | 'financials' | 'interventions' | 'expenses' | 'manufacturing' | 'contracts' | 'documents'>('overview');

    // Documents State
    const [documents, setDocuments] = useState<DolibarrDocument[]>([]);
    const [isLoadingDocs, setIsLoadingDocs] = useState(false);
    const [isUploading, setIsUploading] = useState(false);

    // Creation State
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [newProjectForm, setNewProjectForm] = useState({ ref: '', title: '', socid: '' });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [processingId, setProcessingId] = useState<string | null>(null);

    // Effects
    useEffect(() => {
        if (selectedProject && activeTab === 'documents') {
            loadDocuments();
        }
    }, [selectedProject, activeTab]);

    // Deep Link Effect
    useEffect(() => {
        if (initialItemId && projects.length > 0) {
            const match = projects.find(p => String(p.id) === String(initialItemId));
            if (match) {
                setSelectedProject(match);
            }
        }
    }, [initialItemId, projects]);

    // Reset page on filter/search change
    useEffect(() => {
        setPage(0);
    }, [searchTerm, filterStatus]);


    // Helper Functions
    const getCustomerName = (socid: string) => {
        const customer = customers.find(c => String(c.id) === String(socid));
        return customer ? customer.name : 'Cliente Desconhecido';
    };

    const loadDocuments = async () => {
        if (!selectedProject || !config) return;
        setIsLoadingDocs(true);
        try {
            const docs = await DolibarrService.fetchDocuments(config, 'project', selectedProject.id, selectedProject.ref);
            setDocuments(docs as DolibarrDocument[]);
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoadingDocs(false);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !selectedProject || !config) return;

        setIsUploading(true);
        try {
            await DolibarrService.uploadDocument(config, file, 'project', selectedProject.ref);
            alert("Arquivo enviado com sucesso");
            loadDocuments();
        } catch (e) {
            console.error(e);
            alert("Falha no envio");
        } finally {
            setIsUploading(false);
        }
    };

    const handleDeleteDocument = async (filename: string) => {
        if (!selectedProject || !config || !confirm(`Excluir ${filename}?`)) return;
        try {
            await DolibarrService.deleteDocument(config, 'project', `${selectedProject.ref}/${filename}`);
            loadDocuments();
        } catch (e) {
            console.error(e);
            alert("Falha na exclusão");
        }
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case '0': return <span className="px-2 py-0.5 rounded text-xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">Rascunho</span>;
            case '1': return <span className="px-2 py-0.5 rounded text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">Aberto</span>;
            case '2': return <span className="px-2 py-0.5 rounded text-xs bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">Fechado</span>;
            default: return <span className="text-xs bg-slate-100">Desconhecido</span>;
        }
    };

    const handleCreateProject = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newProjectForm.title || !newProjectForm.socid || !config) return;
        setIsSubmitting(true);
        try {
            await DolibarrService.createProject(config, newProjectForm);
            alert("Projeto Criado com Sucesso");
            setIsCreateModalOpen(false);
            setNewProjectForm({ ref: '', title: '', socid: '' });
            if (refreshData) refreshData();
        } catch (e: any) {
            console.error(e);
            alert(`Falha: ${e.message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleValidate = async () => {
        if (!selectedProject || !config) return;
        if (!confirm("Validar este projeto?")) return;
        setProcessingId(selectedProject.id);
        try {
            await DolibarrService.updateProject(config, selectedProject.id, { statut: 1 });
            alert("Projeto Validado");
            if (refreshData) refreshData();
            setSelectedProject(prev => prev ? ({ ...prev, statut: '1' }) : null);
        } catch (e: any) {
            alert(`Erro: ${e.message}`);
        } finally {
            setProcessingId(null);
        }
    };

    // Data Filtering
    const filteredProjects = useMemo(() => {
        return projects.filter(p => {
            const customerName = getCustomerName(p.socid).toLowerCase();
            const matchesSearch =
                p.ref.toLowerCase().includes(searchTerm.toLowerCase()) ||
                p.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                customerName.includes(searchTerm.toLowerCase());

            if (filterStatus === 'draft') return matchesSearch && p.statut === '0';
            if (filterStatus === 'open') return matchesSearch && p.statut === '1';
            if (filterStatus === 'closed') return matchesSearch && p.statut === '2';

            return matchesSearch;
        });
    }, [projects, customers, searchTerm, filterStatus]);

    // Pagination Logic
    const paginatedProjects = useMemo(() => {
        const start = page * limit;
        return filteredProjects.slice(start, start + limit);
    }, [filteredProjects, page, limit]);

    // Derived Data for Details
    const projectTasks = useMemo(() => selectedProject ? tasks.filter(t => String(t.project_id) === String(selectedProject.id)) : [], [selectedProject, tasks]);
    const projectInvoices = useMemo(() => selectedProject ? invoices.filter(i => String(i.project_id) === String(selectedProject.id)) : [], [selectedProject, invoices]);
    const projectSupplierInvoices = useMemo(() => selectedProject ? supplierInvoices.filter(i => String(i.project_id) === String(selectedProject.id)) : [], [selectedProject, supplierInvoices]);
    const projectInterventions = useMemo(() => selectedProject ? interventions.filter(i => String(i.project_id) === String(selectedProject.id)) : [], [selectedProject, interventions]);
    const projectExpenses = useMemo(() => selectedProject ? expenseReports.filter(e => String(e.project_id) === String(selectedProject.id)) : [], [selectedProject, expenseReports]);
    const projectMOs = useMemo(() => selectedProject ? manufacturingOrders.filter(mo => String(mo.project_id) === String(selectedProject.id)) : [], [selectedProject, manufacturingOrders]);
    const projectContracts = useMemo(() => selectedProject ? contracts.filter(c => String(c.project_id) === String(selectedProject.id)) : [], [selectedProject, contracts]);
    const projectTickets = useMemo(() => selectedProject ? tickets.filter(t => String(t.project_id) === String(selectedProject.id)) : [], [selectedProject, tickets]);
    const projectEvents = useMemo(() => selectedProject ? events.filter(e => String(e.project_id) === String(selectedProject.id)) : [], [selectedProject, events]);

    const totalInvoiced = projectInvoices.reduce((acc, i) => acc + i.total_ttc, 0);
    const totalSupplierBills = projectSupplierInvoices.reduce((acc, i) => acc + i.total_ttc, 0);
    const totalExpenses = projectExpenses.reduce((acc, i) => acc + i.total_ttc, 0);

    if (!config) return null;

    const renderHeader = (
        <div className="p-4 md:p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex-none">
            <div className="flex justify-between items-center mb-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Projetos</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Gerencie projetos e oportunidades</p>
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

            <StatusFilterBar
                filters={[
                    { id: 'all', label: 'Todos' },
                    { id: 'open', label: 'Abertos', color: 'blue' },
                    { id: 'draft', label: 'Rascunhos', color: 'slate' },
                    { id: 'closed', label: 'Fechados', color: 'slate' }
                ]}
                activeFilter={filterStatus}
                onFilterChange={(id) => setFilterStatus(id as any)}
                themeColor={config.themeColor}
            />
        </div>
    );

    const renderListContent = filteredProjects.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
            <FolderKanban size={48} className="mx-auto mb-4 opacity-50" />
            <p>Nenhum projeto encontrado.</p>
        </div>
    ) : (
        <div className="space-y-3">
            {paginatedProjects.map(proj => (
                <div key={proj.id} onClick={() => setSelectedProject(proj)} className={`p-4 border rounded-xl cursor-pointer transition-all ${selectedProject?.id === proj.id ? `border-${config.themeColor}-500 bg-${config.themeColor}-50 dark:bg-${config.themeColor}-900/20` : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:shadow-md'}`}>
                    <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                            <h4 className="font-bold text-slate-800 dark:text-white text-sm">{proj.ref}</h4>
                            {getStatusBadge(proj.statut)}
                        </div>
                        <span className="text-xs text-slate-500 font-mono">{proj.progress}%</span>
                    </div>
                    <h3 className="font-bold text-slate-800 dark:text-white text-sm mb-1 line-clamp-1">{proj.title}</h3>
                    <div className="text-sm text-slate-600 dark:text-slate-300 font-medium mb-1 truncate">{getCustomerName(proj.socid)}</div>
                    <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full mt-2 overflow-hidden">
                        <div className={`h-full bg-${config.themeColor}-500`} style={{ width: `${proj.progress}%` }}></div>
                    </div>
                </div>
            ))}
        </div>
    );

    const renderDetail = selectedProject ? (
        <>
            <div className="flex-none bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-100 dark:border-slate-800 p-4 flex items-center justify-between z-10">
                <div className="flex items-center gap-3">
                    <button onClick={() => setSelectedProject(null)} className="lg:hidden p-2 -ml-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"><ArrowRight size={20} className="rotate-180" /></button>
                    <div>
                        <h2 className="text-lg font-bold dark:text-white leading-tight">{selectedProject.title}</h2>
                        <span className="text-xs text-slate-500">{selectedProject.ref}</span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {selectedProject.statut === '0' && (
                        <button onClick={handleValidate} disabled={!!processingId} className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium shadow-sm transition-colors disabled:opacity-50">
                            {processingId ? <Loader2 className="animate-spin" size={14} /> : <CheckCircle2 size={14} />} Validar
                        </button>
                    )}
                    <button className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><Settings size={20} /></button>
                    <button onClick={() => setSelectedProject(null)} className="hidden lg:block p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
                </div>
            </div>

            <div className="flex border-b border-slate-100 dark:border-slate-800 px-4 overflow-x-auto flex-none bg-slate-50 dark:bg-slate-800/30">
                {[
                    { id: 'overview', label: 'Visão Geral' },
                    { id: 'tasks', label: `Tarefas (${projectTasks.length})` },
                    { id: 'tickets', label: `Chamados (${projectTickets.length})` },
                    { id: 'events', label: `Eventos (${projectEvents.length})` },
                    { id: 'financials', label: 'Financeiro' },
                    { id: 'interventions', label: `Intervenções (${projectInterventions.length})` },
                    { id: 'manufacturing', label: `Produção (${projectMOs.length})` },
                    { id: 'contracts', label: `Contratos (${projectContracts.length})` },
                    { id: 'documents', label: 'Documentos' }
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as any)}
                        className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === tab.id ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
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
                                <h3 className="font-bold text-slate-800 dark:text-white mb-4">Detalhes</h3>
                                <div className="space-y-3">
                                    <div className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                                        <span className="text-sm text-slate-500">Cliente</span>
                                        <span
                                            className="text-sm font-medium text-indigo-600 dark:text-indigo-400 cursor-pointer hover:underline"
                                            onClick={() => onNavigate && onNavigate('customers', selectedProject.socid)}
                                        >
                                            {getCustomerName(selectedProject.socid)}
                                        </span>
                                    </div>
                                    <div className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                                        <span className="text-sm text-slate-500">Progresso</span>
                                        <span className="text-sm font-bold text-slate-800 dark:text-white">{selectedProject.progress}%</span>
                                    </div>
                                    <div className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                                        <span className="text-sm text-slate-500">Início</span>
                                        <span className="text-sm text-slate-800 dark:text-white">{selectedProject.date_start ? new Date(selectedProject.date_start * 1000).toLocaleDateString() : '-'}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-sm text-slate-500">Fim</span>
                                        <span className="text-sm text-slate-800 dark:text-white">{selectedProject.date_end ? new Date(selectedProject.date_end * 1000).toLocaleDateString() : '-'}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                                <h3 className="font-bold text-slate-800 dark:text-white mb-4">Resumo Financeiro</h3>
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-100 dark:border-emerald-900/30">
                                        <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                                            <ArrowDown size={18} /> <span className="text-sm font-medium">Faturado</span>
                                        </div>
                                        <span className="font-bold text-emerald-700 dark:text-emerald-400">${totalInvoiced.toLocaleString()}</span>
                                    </div>
                                    <div className="flex items-center justify-between p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-100 dark:border-red-900/30">
                                        <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                                            <ArrowUp size={18} /> <span className="text-sm font-medium">Custos</span>
                                        </div>
                                        <span className="font-bold text-red-700 dark:text-red-400">${(totalSupplierBills + totalExpenses).toLocaleString()}</span>
                                    </div>
                                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center">
                                        <span className="text-sm font-bold text-slate-500">Margem</span>
                                        <span className={`text-lg font-bold ${(totalInvoiced - totalSupplierBills - totalExpenses) >= 0 ? 'text-slate-800 dark:text-white' : 'text-red-500'}`}>
                                            ${(totalInvoiced - totalSupplierBills - totalExpenses).toLocaleString()}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'tasks' && (
                        <div className="space-y-3">
                            {projectTasks.length === 0 ? <p className="text-center text-slate-400 py-10">Nenhuma tarefa encontrada.</p> : projectTasks.map(t => (
                                <div key={t.id} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex justify-between items-center hover:shadow-sm transition-shadow">
                                    <div>
                                        <h4 className="font-bold text-slate-800 dark:text-white text-sm">{t.label}</h4>
                                        <div className="text-xs text-slate-500 mt-1">{t.ref} • {t.progress}% Concluído</div>
                                    </div>
                                    <div className="text-right text-xs">
                                        <div className="text-slate-500">Planejado: {(t.planned_workload || 0) / 3600}h</div>
                                        <div className="text-indigo-600 dark:text-indigo-400 font-medium">Gasto: {(t.duration_effective || 0) / 3600}h</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {activeTab === 'documents' && (
                        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="font-bold text-slate-800 dark:text-white">Arquivos do Projeto</h3>
                                <div className="relative">
                                    <input type="file" id="file-upload" className="hidden" onChange={handleFileUpload} disabled={isUploading} />
                                    <label htmlFor="file-upload" className={`flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium cursor-pointer hover:bg-indigo-700 transition-colors ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                        {isUploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} Upload
                                    </label>
                                </div>
                            </div>
                            {documents.length === 0 ? (
                                <div className="text-center py-10 text-slate-400 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                                    <Files size={32} className="mx-auto mb-2 opacity-50" />
                                    <p>Nenhum documento encontrado.</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                                    {documents.map((doc, idx) => (
                                        <div key={idx} className="p-3 border border-slate-200 dark:border-slate-800 rounded-lg flex items-center justify-between group hover:border-indigo-300 transition-colors">
                                            <div className="flex items-center gap-3 overflow-hidden">
                                                <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded text-slate-500">
                                                    <File size={20} />
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate" title={doc.name}>{doc.name}</p>
                                                    <p className="text-xs text-slate-400">{(doc.size ? doc.size / 1024 : 0).toFixed(1)} KB</p>
                                                </div>
                                            </div>
                                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={() => DolibarrService.downloadDocument(config, 'project', `${selectedProject.ref}/${doc.name}`)}
                                                    className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded"
                                                >
                                                    <ExternalLink size={14} />
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteDocument(doc.name)}
                                                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'financials' && (
                        <div className="space-y-6">
                            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                                <h3 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2"><Receipt size={18} className="text-emerald-500" /> Faturas de Cliente ({projectInvoices.length})</h3>
                                <div className="space-y-2">
                                    {projectInvoices.map(inv => (
                                        <div key={inv.id} className="flex justify-between items-center p-3 border border-slate-100 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer" onClick={() => onNavigate && onNavigate('invoices', inv.id)}>
                                            <div>
                                                <div className="font-medium text-slate-800 dark:text-white text-sm">{inv.ref}</div>
                                                <div className="text-xs text-slate-500">{new Date(inv.date * 1000).toLocaleDateString()}</div>
                                            </div>
                                            <div className="text-right font-bold text-emerald-600 dark:text-emerald-400">${inv.total_ttc.toLocaleString()}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                                <h3 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2"><Receipt size={18} className="text-red-500" /> Faturas de Fornecedor ({projectSupplierInvoices.length})</h3>
                                <div className="space-y-2">
                                    {projectSupplierInvoices.map(inv => (
                                        <div key={inv.id} className="flex justify-between items-center p-3 border border-slate-100 dark:border-slate-700 rounded-lg">
                                            <div>
                                                <div className="font-medium text-slate-800 dark:text-white text-sm">{inv.ref}</div>
                                                <div className="text-xs text-slate-500">{inv.label || 'Sem descrição'}</div>
                                            </div>
                                            <div className="text-right font-bold text-red-600 dark:text-red-400">-${inv.total_ttc.toLocaleString()}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'manufacturing' && (
                        <div className="space-y-3">
                            {projectMOs.length === 0 ? <p className="text-center text-slate-400 py-10">Nenhuma ordem de produção vinculada.</p> : projectMOs.map(mo => (
                                <div key={mo.id} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex justify-between items-center">
                                    <div>
                                        <div className="font-bold text-slate-800 dark:text-white text-sm">{mo.ref}</div>
                                        <div className="text-xs text-slate-500">{mo.label}</div>
                                    </div>
                                    <div className="flex items-center gap-2 text-sm">
                                        <Factory size={16} className="text-orange-500" />
                                        <span className="font-medium">Qtd: {mo.qty}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {activeTab === 'contracts' && (
                        <div className="space-y-3">
                            {projectContracts.length === 0 ? <p className="text-center text-slate-400 py-10">Nenhum contrato vinculado.</p> : projectContracts.map(c => (
                                <div key={c.id} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex justify-between items-center cursor-pointer hover:shadow-md" onClick={() => onNavigate && onNavigate('contracts', c.id)}>
                                    <div className="flex items-center gap-3">
                                        <FileSignature size={20} className="text-indigo-500" />
                                        <div>
                                            <div className="font-bold text-slate-800 dark:text-white text-sm">{c.ref}</div>
                                            <div className="text-xs text-slate-500">{new Date(c.date_contrat * 1000).toLocaleDateString()}</div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {activeTab === 'interventions' && (
                        <div className="space-y-3">
                            {projectInterventions.length === 0 ? <p className="text-center text-slate-400 py-10">Nenhuma intervenção encontrada.</p> : projectInterventions.map(int => (
                                <div key={int.id} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex justify-between items-center cursor-pointer hover:shadow-md" onClick={() => onNavigate && onNavigate('interventions', int.id)}>
                                    <div>
                                        <div className="font-bold text-slate-800 dark:text-white text-sm">{int.ref}</div>
                                        <div className="text-xs text-slate-500">{int.description}</div>
                                    </div>
                                    <div className="text-xs text-slate-500">{new Date(int.date * 1000).toLocaleDateString()}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </>
    ) : (
        <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <FolderKanban size={48} className="mb-4 opacity-50" />
            <p>Selecione um projeto para ver detalhes.</p>
        </div>
    );

    return (
        <GenericListLayout
            header={renderHeader}
            content={renderListContent}
            detail={renderDetail}
            isDetailOpen={!!selectedProject}
            pagination={
                <PaginationControls
                    page={page}
                    limit={limit}
                    onPageChange={setPage}
                    onLimitChange={setLimit}
                    hasNext={filteredProjects.length > (page + 1) * limit}
                    hasPrev={page > 0}
                />
            }
        />
    );
};

export default ProjectList;
