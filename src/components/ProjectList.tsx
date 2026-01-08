import React, { useState, useMemo, useEffect } from 'react';
import { Project, ThirdParty, DolibarrConfig, AppView, Task, Invoice, SupplierInvoice, Intervention, ExpenseReport, ManufacturingOrder, Contract, DolibarrDocument } from '../types';
import { FolderKanban, Search, Plus, X, Loader2, CheckCircle2, Clock, Calendar, ArrowRight, Settings, BarChart3, ArrowDown, ExternalLink, ArrowUp, Receipt, User, Factory, Package, FileSignature, Files, File, Trash2, Upload, Briefcase, ShoppingCart, Truck, Pencil, Save, AlertTriangle, MapPin, Sparkles } from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

// Direct Hook Imports
import { useDolibarr } from '../context/DolibarrContext';
import { useProjects, useCustomers, useTasks, useInvoices, useSupplierInvoices, useInterventions, useExpenseReports, useManufacturingOrders, useContracts, useTickets, useEvents, useLinks, useProposals, useOrders, useShipments, useSupplierOrders, useUsers, useProjectContacts, useContacts } from '../hooks/dolibarr';

// Common Components
import { GenericListLayout } from './common/GenericListLayout';
import { PaginationControls } from './common/PaginationControls';
import { StatusFilterBar } from './common/StatusFilterBar';
import { LinkedObjects } from './common/LinkedObjects';
import { formatDateOnly } from '../utils/dateUtils';
import { TaskWizard } from './Projects/TaskWizard';
import {
    ProjectTeamTab, ProjectDebugTab, ProjectDocumentsTab, ProjectOverviewTab,
    ProjectTasksTab, ProjectTicketsTab, ProjectEventsTab, ProjectFinancialsTab,
    ProjectSalesTab, ProjectShipmentsTab, ProjectPurchasesTab, ProjectManufacturingTab,
    ProjectContractsTab, ProjectInterventionsTab, ProjectChatTab
} from './Projects/tabs';
import { CreateProjectModal, EditProjectModal, TaskModal, TicketModal } from './Projects/modals';

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
    const { data: links = [] } = useLinks(config, !!config);
    const { data: proposals = [] } = useProposals(config, !!config);
    const { data: orders = [] } = useOrders(config, !!config);
    const { data: shipments = [] } = useShipments(config, !!config);
    const { data: supplierOrders = [] } = useSupplierOrders(config, !!config);
    const { data: users = [] } = useUsers(config);
    const { data: projectContacts = [] } = useProjectContacts(config);
    const { data: contacts = [] } = useContacts(config);

    // Pagination
    const [page, setPage] = useState(0);
    const [limit, setLimit] = useState(20);

    // Filter & Search
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'draft' | 'open' | 'closed'>('all');

    // Selection & Tabs
    const [selectedProject, setSelectedProject] = useState<Project | null>(null);
    const [activeTab, setActiveTab] = useState<'overview' | 'tasks' | 'tickets' | 'events' | 'financials' | 'sales' | 'shipments' | 'purchases' | 'interventions' | 'expenses' | 'manufacturing' | 'contracts' | 'documents' | 'debug' | 'team' | 'chat'>('overview');

    // Documents State
    const [documents, setDocuments] = useState<DolibarrDocument[]>([]);
    const [isLoadingDocs, setIsLoadingDocs] = useState(false);
    const [isUploading, setIsUploading] = useState(false);

    // Creation State
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [newProjectForm, setNewProjectForm] = useState({ ref: '', title: '', socid: '' });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [processingId, setProcessingId] = useState<string | null>(null);

    // Edit State
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editProjectForm, setEditProjectForm] = useState({ title: '', status: '0', date_start: '', date_end: '', description: '' });

    // Task CRUD State
    const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
    const [isWizardOpen, setIsWizardOpen] = useState(false);
    const [taskForm, setTaskForm] = useState({ label: '', description: '', planned_workload: 0, date_start: '', date_end: '' });
    const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

    // Ticket CRUD State
    const [isTicketModalOpen, setIsTicketModalOpen] = useState(false);
    const [ticketForm, setTicketForm] = useState({ subject: '', message: '', type_code: 'ISSUE', severity_code: 'NORMAL' });
    const [editingTicketId, setEditingTicketId] = useState<string | null>(null);

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

    const resolveUserName = (authorId?: string) => {
        if (!authorId || authorId === 'System') return 'Sistema';
        const user = users.find(u => String(u.id) === String(authorId));
        if (user) return `${user.firstname || ''} ${user.lastname || ''}`.trim() || user.login;
        if (!isNaN(Number(authorId))) return `Usuário ${authorId}`;
        return authorId;
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

    const handleCreateProject = async (form: { ref: string; title: string; socid: string }) => {
        if (!form.title || !form.socid || !config) return;
        setIsSubmitting(true);
        try {
            await DolibarrService.createProject(config, form);
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

    const handleDeleteProject = async () => {
        if (!selectedProject || !config || !confirm(`Tem certeza que deseja excluir o projeto "${selectedProject.title}"? Esta ação não pode ser desfeita.`)) return;
        try {
            await DolibarrService.deleteProject(config, selectedProject.id);
            alert("Projeto excluído com sucesso.");
            setSelectedProject(null);
            if (refreshData) refreshData();
        } catch (e: any) {
            console.error(e);
            alert(`Falha ao excluir: ${e.message}`);
        }
    };

    const openEditModal = () => {
        if (!selectedProject) return;
        setEditProjectForm({
            title: selectedProject.title,
            status: selectedProject.statut,
            date_start: selectedProject.date_start ? formatDateForInput(selectedProject.date_start) : '',
            date_end: selectedProject.date_end ? formatDateForInput(selectedProject.date_end) : '',
            description: '' // Description often loaded separately or extended
        });
        setIsEditModalOpen(true);
    };

    const handleUpdateProject = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedProject || !config) return;
        setIsSubmitting(true);
        try {
            // Convert dates to timestamps if needed, but SDK usually handles or expects distinct format.
            // Dolibarr API expects dates often as yyyy-mm-dd or timestamp. Check service.
            // Service uses direct mapping or raw. Let's send as is or converting.
            // Assuming Service handles update payload.
            const payload: any = {
                title: editProjectForm.title,
                statut: editProjectForm.status,
            };

            // Handle dates: parse to timestamp or standard string?
            // Dolibarr often takes UNIX timestamp for updates on 'date_start' (dateo) and 'date_end' (datee)
            if (editProjectForm.date_start) payload.dateo = Math.floor(new Date(editProjectForm.date_start).getTime() / 1000);
            if (editProjectForm.date_end) payload.datee = Math.floor(new Date(editProjectForm.date_end).getTime() / 1000);

            await DolibarrService.updateProject(config, selectedProject.id, payload);
            alert("Projeto atualizado com sucesso");
            setIsEditModalOpen(false);
            if (refreshData) refreshData();
            // Update local state optimistically or re-fetch
            const updated = { ...selectedProject, ...payload, date_start: payload.dateo ? payload.dateo * 1000 : selectedProject.date_start, date_end: payload.datee ? payload.datee * 1000 : selectedProject.date_end };
            setSelectedProject(updated as Project);
        } catch (e: any) {
            console.error(e);
            alert(`Falha ao atualizar: ${e.message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    // Helper for date input
    const formatDateForInput = (timestamp: number) => {
        if (!timestamp) return '';
        const date = new Date(timestamp);
        return date.toISOString().split('T')[0];
    };

    // Task Handlers
    const handleCreateOrUpdateTask = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedProject || !config) return;
        setIsSubmitting(true);
        try {
            const payload: any = {
                label: taskForm.label,
                description: taskForm.description,
                project_id: selectedProject.id, // Link to project
                planned_workload: taskForm.planned_workload * 3600, // Convert hours to seconds
            };
            if (taskForm.date_start) payload.date_start = Math.floor(new Date(taskForm.date_start).getTime() / 1000);
            if (taskForm.date_end) payload.date_end = Math.floor(new Date(taskForm.date_end).getTime() / 1000);

            if (editingTaskId) {
                await DolibarrService.updateTask(config, editingTaskId, payload);
                alert("Tarefa atualizada!");
            } else {
                await DolibarrService.createTask(config, payload);
                alert("Tarefa criada!");
            }
            setIsTaskModalOpen(false);
            if (refreshData) refreshData();
        } catch (e: any) {
            console.error(e);
            alert(`Erro: ${e.message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeleteTask = async (taskId: string) => {
        if (!config || !confirm("Tem certeza que deseja excluir esta tarefa?")) return;
        try {
            await DolibarrService.deleteTask(config, taskId);
            alert("Tarefa excluída.");
            if (refreshData) refreshData();
        } catch (e: any) {
            console.error(e);
            alert(`Erro ao excluir: ${e.message}`);
        }
    };

    const openTaskModal = (task?: any) => {
        if (task) {
            setEditingTaskId(task.id);
            setTaskForm({
                label: task.label,
                description: task.description || '',
                planned_workload: (task.planned_workload || 0) / 3600,
                date_start: task.date_start ? formatDateForInput(task.date_start) : '',
                date_end: task.date_end ? formatDateForInput(task.date_end) : '',
            });
        } else {
            setEditingTaskId(null);
            setTaskForm({ label: '', description: '', planned_workload: 0, date_start: '', date_end: '' });
        }
        setIsTaskModalOpen(true);
    };

    // Ticket Handlers
    const handleCreateOrUpdateTicket = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedProject || !config) return;
        setIsSubmitting(true);
        try {
            const payload: any = {
                subject: ticketForm.subject,
                message: ticketForm.message,
                type_code: ticketForm.type_code,
                severity_code: ticketForm.severity_code,
                project_id: selectedProject.id, // Link to project
                socid: selectedProject.socid // Link to customer
            };

            if (editingTicketId) {
                await DolibarrService.updateTicket(config, editingTicketId, payload);
                alert("Chamado atualizado!");
            } else {
                await DolibarrService.createTicket(config, payload);
                alert("Chamado criado!");
            }
            setIsTicketModalOpen(false);
            if (refreshData) refreshData();
        } catch (e: any) {
            console.error(e);
            alert(`Erro: ${e.message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeleteTicket = async (ticketId: string) => {
        if (!config || !confirm("Tem certeza que deseja excluir este chamado?")) return;
        try {
            await DolibarrService.deleteTicket(config, ticketId);
            alert("Chamado excluído.");
            if (refreshData) refreshData();
        } catch (e: any) {
            console.error(e);
            alert(`Erro ao excluir: ${e.message}`);
        }
    };

    const openTicketModal = (ticket?: any) => {
        if (ticket) {
            setEditingTicketId(ticket.id);
            setTicketForm({
                subject: ticket.subject || '',
                message: ticket.message || '',
                type_code: ticket.type_code || 'ISSUE',
                severity_code: ticket.severity_code || 'NORMAL',
            });
        } else {
            setEditingTicketId(null);
            setTicketForm({ subject: '', message: '', type_code: 'ISSUE', severity_code: 'NORMAL' });
        }
        setIsTicketModalOpen(true);
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

    // Helper to get linked object IDs for current project
    const getLinkedIds = (type: string) => {
        if (!selectedProject) return new Set();
        const ids = new Set<string>();
        links.forEach(link => {
            // Project is source, linked object is target
            if (link.sourcetype === 'project' && String(link.sourceid) === String(selectedProject.id) && link.targettype === type) {
                ids.add(String(link.targetid));
            }
            // Project is target, linked object is source
            if (link.targettype === 'project' && String(link.targetid) === String(selectedProject.id) && link.sourcetype === type) {
                ids.add(String(link.sourceid));
            }
        });
        return ids;
    };

    // Derived Data for Details (Combined Direct + Linked)
    const projectTasks = useMemo(() => {
        if (!selectedProject) return [];
        // Note: Tasks are usually sub-objects, not linked via element_element, but we keep existing logic
        // Project Tasks table uses fk_projet. Links table might link other tasks? Usually not.
        return tasks.filter(t => String(t.project_id) === String(selectedProject.id));
    }, [selectedProject, tasks]);

    const projectProposals = useMemo(() => {
        if (!selectedProject) return [];
        const linkedIds = getLinkedIds('propal');
        return proposals.filter(p => String(p.project_id) === String(selectedProject.id) || linkedIds.has(String(p.id)));
    }, [selectedProject, proposals, links]);

    const projectOrders = useMemo(() => {
        if (!selectedProject) return [];
        const linkedIds = getLinkedIds('commande');
        return orders.filter(o => String(o.project_id) === String(selectedProject.id) || linkedIds.has(String(o.id)));
    }, [selectedProject, orders, links]);

    const projectInvoices = useMemo(() => {
        if (!selectedProject) return [];
        const linkedIds = getLinkedIds('facture');
        return invoices.filter(i => String(i.project_id) === String(selectedProject.id) || linkedIds.has(String(i.id)));
    }, [selectedProject, invoices, links]);

    const projectSupplierInvoices = useMemo(() => {
        if (!selectedProject) return [];
        const linkedIds = getLinkedIds('facture_fourn');
        return supplierInvoices.filter(i => String(i.project_id) === String(selectedProject.id) || linkedIds.has(String(i.id)));
    }, [selectedProject, supplierInvoices, links]);

    const projectInterventions = useMemo(() => {
        if (!selectedProject) return [];
        const linkedIds = getLinkedIds('fichinter');
        return interventions.filter(i => String(i.project_id) === String(selectedProject.id) || linkedIds.has(String(i.id)));
    }, [selectedProject, interventions, links]);

    const projectExpenses = useMemo(() => {
        if (!selectedProject) return [];
        // Check for both 'expensereport' and 'deplacement' (legacy)
        const linkedIds1 = getLinkedIds('expensereport');
        const linkedIds2 = getLinkedIds('deplacement');
        return expenseReports.filter(e => String(e.project_id) === String(selectedProject.id) || linkedIds1.has(String(e.id)) || linkedIds2.has(String(e.id)));
    }, [selectedProject, expenseReports, links]);

    const projectMOs = useMemo(() => {
        if (!selectedProject) return [];
        // Check for both 'mo' and 'mrp_mo'
        const linkedIds1 = getLinkedIds('mo');
        const linkedIds2 = getLinkedIds('mrp_mo');
        return manufacturingOrders.filter(mo => String(mo.project_id) === String(selectedProject.id) || linkedIds1.has(String(mo.id)) || linkedIds2.has(String(mo.id)));
    }, [selectedProject, manufacturingOrders, links]);

    const projectContracts = useMemo(() => {
        if (!selectedProject) return [];
        const linkedIds = getLinkedIds('contrat');
        return contracts.filter(c => String(c.project_id) === String(selectedProject.id) || linkedIds.has(String(c.id)));
    }, [selectedProject, contracts, links]);

    const projectTickets = useMemo(() => {
        if (!selectedProject) return [];
        const linkedIds = getLinkedIds('ticket');
        return tickets.filter(t => String(t.project_id) === String(selectedProject.id) || linkedIds.has(String(t.id)));
    }, [selectedProject, tickets, links]);

    const projectEvents = useMemo(() => {
        if (!selectedProject) return [];
        // Events are linked via actioncomm table fields, not just element_element?
        // Actually actioncomm has fk_project. element_element links affecting events? Maybe.
        // Usually events are child of project or linked to project.
        return events.filter(e => String(e.project_id) === String(selectedProject.id));
    }, [selectedProject, events]);

    const projectShipments = useMemo(() => {
        if (!selectedProject) return [];
        const linkedIds = getLinkedIds('expedition'); // or 'shipping'
        return shipments.filter(s => String(s.project_id) === String(selectedProject.id) || linkedIds.has(String(s.id)));
    }, [selectedProject, shipments, links]);

    const projectSupplierOrders = useMemo(() => {
        if (!selectedProject) return [];
        const linkedIds = getLinkedIds('commande_fournisseur'); // or 'order_supplier'
        return supplierOrders.filter(so => String(so.project_id) === String(selectedProject.id) || linkedIds.has(String(so.id)));
    }, [selectedProject, supplierOrders, links]);

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

                    <button onClick={openEditModal} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors" title="Editar Projeto"><Pencil size={20} /></button>
                    <button onClick={handleDeleteProject} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors" title="Excluir Projeto"><Trash2 size={20} /></button>
                    <button className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><Settings size={20} /></button>
                    <button onClick={() => setSelectedProject(null)} className="hidden lg:block p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
                </div>
            </div>

            <div className="flex border-b border-slate-100 dark:border-slate-800 px-6 gap-6 overflow-x-auto flex-none bg-slate-50 dark:bg-slate-800/30 w-full no-scrollbar items-center">
                {[
                    { id: 'overview', label: 'Visão Geral' },
                    { id: 'tasks', label: `Tarefas (${projectTasks.length})` },
                    { id: 'tickets', label: `Chamados (${projectTickets.length})` },
                    { id: 'sales', label: `Comercial (${projectProposals.length + projectOrders.length})` },
                    { id: 'shipments', label: `Envios (${projectShipments.length})` },
                    { id: 'purchases', label: `Compras (${projectSupplierOrders.length})` },
                    { id: 'chat', label: 'Chat' },
                    { id: 'events', label: `Eventos (${projectEvents.length})` },
                    { id: 'financials', label: 'Financeiro' },
                    { id: 'interventions', label: `Intervenções (${projectInterventions.length})` },
                    { id: 'manufacturing', label: `Produção (${projectMOs.length})` },
                    { id: 'contracts', label: `Contratos (${projectContracts.length})` },
                    { id: 'team', label: 'Equipe' },
                    { id: 'documents', label: 'Documentos' },
                    { id: 'debug', label: '🔧 Debug' }
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as any)}
                        className={`py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === tab.id ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950/50">
                <div className="max-w-4xl mx-auto space-y-6">
                    {activeTab === 'team' && (
                        <ProjectTeamTab
                            project={selectedProject}
                            team={projectContacts.filter(c => String(c.project_id) === String(selectedProject.id))}
                            users={users}
                            contacts={contacts}
                        />
                    )}
                    {activeTab === 'debug' && (
                        <ProjectDebugTab project={selectedProject} links={links} />
                    )}
                    {activeTab === 'chat' && (
                        <ProjectChatTab project={selectedProject} />
                    )}
                    {activeTab === 'overview' && (
                        <ProjectOverviewTab
                            project={selectedProject}
                            customerName={getCustomerName(selectedProject.socid)}
                            totalInvoiced={totalInvoiced}
                            totalSupplierBills={totalSupplierBills}
                            totalExpenses={totalExpenses}
                            createdByName={selectedProject.fk_user_creat ? resolveUserName(selectedProject.fk_user_creat) : undefined}
                            modifiedByName={selectedProject.fk_user_modif ? resolveUserName(selectedProject.fk_user_modif) : undefined}
                            onNavigate={onNavigate}
                        />
                    )}

                    {activeTab === 'tasks' && (
                        <ProjectTasksTab
                            tasks={projectTasks}
                            onNavigate={onNavigate}
                            onCreateTask={() => openTaskModal()}
                            onEditTask={(t) => openTaskModal(t)}
                            onDeleteTask={handleDeleteTask}
                            onOpenWizard={() => setIsWizardOpen(true)}
                        />
                    )}

                    {activeTab === 'tickets' && (
                        <ProjectTicketsTab
                            tickets={projectTickets}
                            onCreateTicket={() => openTicketModal()}
                            onEditTicket={(t) => openTicketModal(t)}
                            onDeleteTicket={handleDeleteTicket}
                        />
                    )}

                    {activeTab === 'documents' && selectedProject && (
                        <ProjectDocumentsTab
                            project={selectedProject}
                            config={config}
                            documents={documents}
                            isLoading={isLoadingDocs}
                            isUploading={isUploading}
                            onUpload={handleFileUpload}
                            onDelete={handleDeleteDocument}
                        />
                    )}

                    {activeTab === 'sales' && (
                        <ProjectSalesTab
                            proposals={projectProposals}
                            orders={projectOrders}
                            onNavigate={onNavigate}
                        />
                    )}



                    {activeTab === 'shipments' && (
                        <ProjectShipmentsTab shipments={projectShipments} onNavigate={onNavigate} />
                    )}

                    {activeTab === 'purchases' && (
                        <ProjectPurchasesTab supplierOrders={projectSupplierOrders} />
                    )}

                    {activeTab === 'financials' && (
                        <ProjectFinancialsTab
                            invoices={projectInvoices}
                            supplierInvoices={projectSupplierInvoices}
                            onNavigate={onNavigate}
                        />
                    )}

                    {activeTab === 'events' && (
                        <ProjectEventsTab events={projectEvents} onNavigate={onNavigate} />
                    )}

                    {activeTab === 'manufacturing' && (
                        <ProjectManufacturingTab manufacturingOrders={projectMOs} />
                    )}

                    {activeTab === 'contracts' && (
                        <ProjectContractsTab contracts={projectContracts} onNavigate={onNavigate} />
                    )}

                    {activeTab === 'interventions' && (
                        <ProjectInterventionsTab interventions={projectInterventions} onNavigate={onNavigate} />
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
        <>
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

            {/* Create Project Modal */}
            <CreateProjectModal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                onSubmit={async (form) => {
                    await handleCreateProject(form);
                }}
                customers={customers}
                isSubmitting={isSubmitting}
            />

            {/* Edit Project Modal */}
            <EditProjectModal
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                onSubmit={handleUpdateProject}
                form={editProjectForm}
                setForm={setEditProjectForm}
                isSubmitting={isSubmitting}
            />
            {/* Task Modal */}
            <TaskModal
                isOpen={isTaskModalOpen}
                onClose={() => setIsTaskModalOpen(false)}
                onSubmit={handleCreateOrUpdateTask}
                form={taskForm}
                setForm={setTaskForm}
                isSubmitting={isSubmitting}
                isEditing={!!editingTaskId}
            />
            {/* Ticket Modal */}
            <TicketModal
                isOpen={isTicketModalOpen}
                onClose={() => setIsTicketModalOpen(false)}
                onSubmit={handleCreateOrUpdateTicket}
                form={ticketForm}
                setForm={setTicketForm}
                isSubmitting={isSubmitting}
                isEditing={!!editingTicketId}
            />
            {/* Task Wizard */}
            {selectedProject && (
                <TaskWizard
                    isOpen={isWizardOpen}
                    onClose={() => setIsWizardOpen(false)}
                    project={selectedProject}
                    config={config}
                    users={users}
                    allProjects={projects}
                    allTasks={tasks}
                    onSuccess={() => { refreshData && refreshData(); }}
                />
            )}
        </>
    );
};

export default ProjectList;
