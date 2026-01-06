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
import { ChatInterface } from './Chat/ChatInterface'; // Import direct or via index

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
                        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
                            <h3 className="font-bold text-slate-800 dark:text-white mb-4">Equipe do Projeto</h3>
                            {(() => {
                                const team = projectContacts.filter(c => String(c.project_id) === String(selectedProject.id));

                                const resolveParticipantName = (p: { user_id?: string, contact_id?: string }) => {
                                    if (p.user_id) {
                                        const u = users.find(u => String(u.id) === String(p.user_id));
                                        return u ? (u.firstname + ' ' + (u.lastname || '')).trim() : 'Usuário ' + p.user_id;
                                    }
                                    if (p.contact_id) {
                                        const c = contacts.find(c => String(c.id) === String(p.contact_id));
                                        return c ? (c.firstname + ' ' + (c.lastname || '')).trim() : 'Contato ' + p.contact_id;
                                    }
                                    return 'Desconhecido';
                                };

                                if (team.length === 0) return <p className="text-slate-400">Nenhum membro na equipe.</p>;

                                return (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                        {team.map(p => (
                                            <div key={p.id} className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700">
                                                <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold text-xs">
                                                    {(resolveParticipantName(p)[0] || '?').toUpperCase()}
                                                </div>
                                                <div>
                                                    <p className="text-sm font-medium text-slate-900 dark:text-white">{resolveParticipantName(p)}</p>
                                                    <p className="text-xs text-slate-500 capitalize">{p.type_id}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                );
                            })()}
                        </div>
                    )}
                    {activeTab === 'debug' && (
                        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-auto">
                            <h3 className="font-bold text-slate-800 dark:text-white mb-4">Raw Links Debugger</h3>
                            <div className="mb-4 p-4 bg-yellow-50 text-yellow-800 rounded border border-yellow-200 text-sm">
                                Project ID: {selectedProject.id} <br />
                                Total Links in Store: {links.length}
                            </div>
                            <table className="w-full text-xs text-left">
                                <thead className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 uppercase">
                                    <tr>
                                        <th className="p-2">Link ID</th>
                                        <th className="p-2">Source Type</th>
                                        <th className="p-2">Source ID</th>
                                        <th className="p-2">Target Type</th>
                                        <th className="p-2">Target ID</th>
                                        <th className="p-2">Match?</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {links.filter(l =>
                                        (String(l.sourceid) === String(selectedProject.id) && l.sourcetype === 'project') ||
                                        (String(l.targetid) === String(selectedProject.id) && l.targettype === 'project')
                                    ).map(link => (
                                        <tr key={link.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                                            <td className="p-2 font-mono">{link.id}</td>
                                            <td className="p-2 font-mono text-blue-600">{link.sourcetype}</td>
                                            <td className="p-2 font-mono">{link.sourceid}</td>
                                            <td className="p-2 font-mono text-green-600">{link.targettype}</td>
                                            <td className="p-2 font-mono">{link.targetid}</td>
                                            <td className="p-2">
                                                {String(link.sourceid) === String(selectedProject.id) ? 'Source' : 'Target'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {links.filter(l =>
                                (String(l.sourceid) === String(selectedProject.id) && l.sourcetype === 'project') ||
                                (String(l.targetid) === String(selectedProject.id) && l.targettype === 'project')
                            ).length === 0 && (
                                    <p className="text-center py-4 text-slate-400">No links found for this project ID in local store.</p>
                                )}
                        </div>
                    )}
                    {activeTab === 'chat' && (
                        <ChatInterface
                            elementId={selectedProject.id}
                            elementType="project"
                            title={`Chat do Projeto ${selectedProject.ref}`}
                        />
                    )}
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
                                        <span className="text-sm text-slate-800 dark:text-white">{formatDateOnly(selectedProject.date_start) || '-'}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-sm text-slate-500">Fim</span>
                                        <span className="text-sm text-slate-800 dark:text-white">{formatDateOnly(selectedProject.date_end) || '-'}</span>
                                    </div>
                                    {selectedProject.fk_user_creat && (
                                        <div className="flex justify-between border-t border-slate-100 dark:border-slate-800 pt-2 mt-2">
                                            <span className="text-xs text-slate-500">Criado por</span>
                                            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{resolveUserName(selectedProject.fk_user_creat)}</span>
                                        </div>
                                    )}
                                    {selectedProject.fk_user_modif && (
                                        <div className="flex justify-between">
                                            <span className="text-xs text-slate-500">Modificado por</span>
                                            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{resolveUserName(selectedProject.fk_user_modif)}</span>
                                        </div>
                                    )}
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
                            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm md:col-span-2">
                                <LinkedObjects
                                    id={selectedProject.id}
                                    type="project"
                                    onNavigate={onNavigate}
                                />
                            </div>
                        </div>
                    )}

                    {activeTab === 'tasks' && (
                        <div className="space-y-3">
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
                                <h3 className="font-bold text-slate-800 dark:text-white">Tarefas do Projeto</h3>
                                <div className="flex gap-2 w-full sm:w-auto">
                                    <button onClick={() => setIsWizardOpen(true)} className="flex-1 sm:flex-none justify-center flex items-center gap-2 px-3 py-1.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-lg text-xs font-medium hover:bg-indigo-200 transition-colors">
                                        <Sparkles size={16} /> Wizard
                                    </button>
                                    <button onClick={() => openTaskModal()} className="flex-1 sm:flex-none justify-center flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 transition-colors">
                                        <Plus size={16} /> Nova Tarefa
                                    </button>
                                </div>
                            </div>
                            {projectTasks.length === 0 ? <p className="text-center text-slate-400 py-10">Nenhuma tarefa encontrada.</p> : projectTasks.map(t => (
                                <div key={t.id} onClick={() => onNavigate && onNavigate('tasks', t.id)} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex justify-between items-center hover:shadow-sm transition-shadow group cursor-pointer hover:border-indigo-300">
                                    <div>
                                        <h4 className="font-bold text-slate-800 dark:text-white text-sm">{t.label}</h4>
                                        <div className="text-xs text-slate-500 mt-1">{t.ref} • {t.progress}% Concluído</div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <div className="text-right text-xs">
                                            <div className="text-slate-500">Planejado: {(t.planned_workload || 0) / 3600}h</div>
                                            <div className="text-indigo-600 dark:text-indigo-400 font-medium">Gasto: {(t.duration_effective || 0) / 3600}h</div>
                                        </div>
                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={(e) => { e.stopPropagation(); openTaskModal(t); }} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded">
                                                <Pencil size={16} />
                                            </button>
                                            <button onClick={(e) => { e.stopPropagation(); handleDeleteTask(t.id); }} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded">
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {activeTab === 'tickets' && (
                        <div className="space-y-3">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="font-bold text-slate-800 dark:text-white">Chamados Vinculados</h3>
                                <button onClick={() => openTicketModal()} className="flex items-center gap-2 px-3 py-1.5 bg-orange-600 text-white rounded-lg text-xs font-medium hover:bg-orange-700 transition-colors">
                                    <Plus size={16} /> Novo Chamado
                                </button>
                            </div>
                            {projectTickets.length === 0 ? <p className="text-center text-slate-400 py-10">Nenhum chamado encontrado.</p> : projectTickets.map(t => (
                                <div key={t.id} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex justify-between items-center hover:shadow-sm transition-shadow group">
                                    <div className="flex items-center gap-3">
                                        <div className={`p-2 rounded-lg ${t.type_code === 'ISSUE' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                                            <AlertTriangle size={20} />
                                        </div>
                                        <div>
                                            <div className="font-bold text-slate-800 dark:text-white text-sm">{t.ref} - {t.subject}</div>
                                            <div className="text-xs text-slate-500">{t.message?.substring(0, 50)}...</div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <div className="text-right text-xs">
                                            <div className="font-bold text-slate-700 dark:text-slate-300">{t.severity_code}</div>
                                            <div className="text-slate-400">{t.statut}</div>
                                        </div>
                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={() => openTicketModal(t)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded">
                                                <Pencil size={16} />
                                            </button>
                                            <button onClick={() => handleDeleteTicket(t.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded">
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
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

                    {activeTab === 'sales' && (
                        <div className="space-y-6">
                            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                                <h3 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2"><FileSignature size={18} className="text-orange-500" /> Propostas ({projectProposals.length})</h3>
                                <div className="space-y-2">
                                    {projectProposals.length === 0 ? <p className="text-sm text-slate-400">Nenhuma proposta encontrada.</p> : projectProposals.map(p => (
                                        <div key={p.id} className="flex justify-between items-center p-3 border border-slate-100 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer" onClick={() => onNavigate && onNavigate('proposals', p.id)}>
                                            <div>
                                                <div className="font-medium text-slate-800 dark:text-white text-sm">{p.ref}</div>
                                                <div className="text-xs text-slate-500">{formatDateOnly(p.date)}</div>
                                            </div>
                                            <div className="text-right font-bold text-slate-700 dark:text-slate-300 px-3 py-1 bg-slate-100 dark:bg-slate-800 rounded-full text-xs">
                                                ${p.total_ttc.toLocaleString()}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                                <h3 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2"><ShoppingCart size={18} className="text-indigo-500" /> Pedidos ({projectOrders.length})</h3>
                                <div className="space-y-2">
                                    {projectOrders.length === 0 ? <p className="text-sm text-slate-400">Nenhum pedido encontrado.</p> : projectOrders.map(o => (
                                        <div key={o.id} className="flex justify-between items-center p-3 border border-slate-100 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer" onClick={() => onNavigate && onNavigate('orders', o.id)}>
                                            <div>
                                                <div className="font-medium text-slate-800 dark:text-white text-sm">{o.ref}</div>
                                                <div className="text-xs text-slate-500">{formatDateOnly(o.date)}</div>
                                            </div>
                                            <div className="text-right font-bold text-indigo-600 dark:text-indigo-400">
                                                ${o.total_ttc.toLocaleString()}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}



                    {activeTab === 'shipments' && (
                        <div className="space-y-3">
                            {projectShipments.length === 0 ? <p className="text-center text-slate-400 py-10">Nenhum envio encontrado.</p> : projectShipments.map(s => (
                                <div key={s.id} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex justify-between items-center cursor-pointer hover:shadow-md" onClick={() => onNavigate && onNavigate('shipments', s.id)}>
                                    <div className="flex items-center gap-3">
                                        <Truck size={20} className="text-blue-500" />
                                        <div>
                                            <div className="font-bold text-slate-800 dark:text-white text-sm">{s.ref}</div>
                                            <div className="text-xs text-slate-500 flex gap-2">
                                                <span>{formatDateOnly(s.date_creation)}</span>
                                                {s.tracking_number && (
                                                    <span className="font-mono bg-slate-100 dark:bg-slate-800 px-1 rounded">TRK: {s.tracking_number}</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <span className={`px-2 py-1 rounded-full text-xs font-bold ${s.status === '1' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                                            {s.status === '1' ? 'Enviado' : 'Aberto'}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {activeTab === 'purchases' && (
                        <div className="space-y-3">
                            {projectSupplierOrders.length === 0 ? <p className="text-center text-slate-400 py-10">Nenhum pedido de compra encontrado.</p> : projectSupplierOrders.map(so => (
                                <div key={so.id} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex justify-between items-center cursor-pointer hover:shadow-md">
                                    <div className="flex items-center gap-3">
                                        <ShoppingCart size={20} className="text-orange-500" />
                                        <div>
                                            <div className="font-bold text-slate-800 dark:text-white text-sm">{so.ref}</div>
                                            <div className="text-xs text-slate-500">{formatDateOnly(so.date_creation)}</div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="font-bold text-slate-700 dark:text-slate-300">${so.total_ttc.toLocaleString()}</div>
                                        <div className="text-xs text-slate-400">{so.statut}</div>
                                    </div>
                                </div>
                            ))}
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
                                                <div className="text-xs text-slate-500">{formatDateOnly(inv.date)}</div>
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

                    {activeTab === 'events' && (
                        <div className="space-y-3">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="font-bold text-slate-800 dark:text-white">Eventos do Projeto</h3>
                            </div>
                            {projectEvents.length === 0 ? <p className="text-center text-slate-400 py-10">Nenhum evento encontrado.</p> : projectEvents.map(e => (
                                <div key={e.id} onClick={() => onNavigate && onNavigate('agenda', e.id)} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:shadow-sm transition-shadow cursor-pointer">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <Calendar size={18} className="text-indigo-500" />
                                            <span className="font-bold text-slate-800 dark:text-white text-sm">{e.label}</span>
                                        </div>
                                        <span className={`px-2 py-0.5 rounded text-xs ${e.percentage === 100 ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                                            {e.percentage}%
                                        </span>
                                    </div>
                                    <div className="text-xs text-slate-500 space-y-1">
                                        <div className="flex items-center gap-2">
                                            <Clock size={14} />
                                            <span>{formatDateOnly(e.date_start)} - {formatDateOnly(e.date_end)}</span>
                                        </div>
                                        {e.location && (
                                            <div className="flex items-center gap-2">
                                                <MapPin size={14} />
                                                <span>{e.location}</span>
                                            </div>
                                        )}
                                        {e.description && (
                                            <p className="mt-2 text-slate-600 dark:text-slate-400 line-clamp-2">{e.description}</p>
                                        )}
                                    </div>
                                </div>
                            ))}
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
                                            <div className="text-xs text-slate-500">{formatDateOnly(c.date_contrat)}</div>
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
                                    <div className="text-xs text-slate-500">{formatDateOnly(int.date)}</div>
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
            {isCreateModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md border border-slate-200 dark:border-slate-800">
                        <div className="flex justify-between items-center p-4 border-b border-slate-100 dark:border-slate-800">
                            <h3 className="font-bold text-lg dark:text-white">Novo Projeto</h3>
                            <button onClick={() => setIsCreateModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleCreateProject} className="p-4 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Referência</label>
                                <input
                                    type="text"
                                    required
                                    className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                    value={newProjectForm.ref}
                                    onChange={e => setNewProjectForm({ ...newProjectForm, ref: e.target.value.toUpperCase() })}
                                    placeholder="PROJ-2024-001"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Título</label>
                                <input
                                    type="text"
                                    required
                                    className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                    value={newProjectForm.title}
                                    onChange={e => setNewProjectForm({ ...newProjectForm, title: e.target.value })}
                                    placeholder="Nome do projeto"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Cliente (SocID)</label>
                                <select
                                    required
                                    className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                    value={newProjectForm.socid}
                                    onChange={e => setNewProjectForm({ ...newProjectForm, socid: e.target.value })}
                                >
                                    <option value="">Selecione...</option>
                                    {customers.map(c => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="pt-2 flex justify-end gap-2">
                                <button type="button" onClick={() => setIsCreateModalOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancelar</button>
                                <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50">
                                    {isSubmitting ? 'Criando...' : 'Criar Projeto'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Edit Project Modal */}
            {isEditModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md border border-slate-200 dark:border-slate-800">
                        <div className="flex justify-between items-center p-4 border-b border-slate-100 dark:border-slate-800">
                            <h3 className="font-bold text-lg dark:text-white">Editar Projeto</h3>
                            <button onClick={() => setIsEditModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleUpdateProject} className="p-4 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Título</label>
                                <input
                                    type="text"
                                    required
                                    className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                    value={editProjectForm.title}
                                    onChange={e => setEditProjectForm({ ...editProjectForm, title: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Status</label>
                                <select
                                    className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                    value={editProjectForm.status}
                                    onChange={e => setEditProjectForm({ ...editProjectForm, status: e.target.value })}
                                >
                                    <option value="0">Rascunho</option>
                                    <option value="1">Aberto</option>
                                    <option value="2">Fechado</option>
                                </select>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Data Início</label>
                                    <input
                                        type="date"
                                        className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                        value={editProjectForm.date_start}
                                        onChange={e => setEditProjectForm({ ...editProjectForm, date_start: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Data Fim</label>
                                    <input
                                        type="date"
                                        className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                        value={editProjectForm.date_end}
                                        onChange={e => setEditProjectForm({ ...editProjectForm, date_end: e.target.value })}
                                    />
                                </div>
                            </div>
                            <div className="pt-2 flex justify-end gap-2">
                                <button type="button" onClick={() => setIsEditModalOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancelar</button>
                                <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50">
                                    {isSubmitting ? 'Salvando...' : 'Salvar Alterações'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            {/* Task Modal */}
            {isTaskModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md border border-slate-200 dark:border-slate-800">
                        <div className="flex justify-between items-center p-4 border-b border-slate-100 dark:border-slate-800">
                            <h3 className="font-bold text-lg dark:text-white">{editingTaskId ? 'Editar Tarefa' : 'Nova Tarefa'}</h3>
                            <button onClick={() => setIsTaskModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleCreateOrUpdateTask} className="p-4 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Título</label>
                                <input
                                    type="text"
                                    required
                                    className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                    value={taskForm.label}
                                    onChange={e => setTaskForm({ ...taskForm, label: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Carga Horária Planejada (h)</label>
                                <input
                                    type="number"
                                    step="0.5"
                                    className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                    value={taskForm.planned_workload}
                                    onChange={e => setTaskForm({ ...taskForm, planned_workload: parseFloat(e.target.value) || 0 })}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Início</label>
                                    <input
                                        type="date"
                                        className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                        value={taskForm.date_start}
                                        onChange={e => setTaskForm({ ...taskForm, date_start: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Fim</label>
                                    <input
                                        type="date"
                                        className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                        value={taskForm.date_end}
                                        onChange={e => setTaskForm({ ...taskForm, date_end: e.target.value })}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Descrição</label>
                                <textarea
                                    className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white h-24"
                                    value={taskForm.description}
                                    onChange={e => setTaskForm({ ...taskForm, description: e.target.value })}
                                />
                            </div>
                            <div className="pt-2 flex justify-end gap-2">
                                <button type="button" onClick={() => setIsTaskModalOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancelar</button>
                                <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50">
                                    {isSubmitting ? 'Salvando...' : (editingTaskId ? 'Atualizar' : 'Criar')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            {/* Ticket Modal */}
            {isTicketModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md border border-slate-200 dark:border-slate-800">
                        <div className="flex justify-between items-center p-4 border-b border-slate-100 dark:border-slate-800">
                            <h3 className="font-bold text-lg dark:text-white">{editingTicketId ? 'Editar Chamado' : 'Novo Chamado'}</h3>
                            <button onClick={() => setIsTicketModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleCreateOrUpdateTicket} className="p-4 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Assunto</label>
                                <input
                                    type="text"
                                    required
                                    className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                    value={ticketForm.subject}
                                    onChange={e => setTicketForm({ ...ticketForm, subject: e.target.value })}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo</label>
                                    <select
                                        className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                        value={ticketForm.type_code}
                                        onChange={e => setTicketForm({ ...ticketForm, type_code: e.target.value })}
                                    >
                                        <option value="ISSUE">Incidente</option>
                                        <option value="REQUEST">Requisição</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Severidade</label>
                                    <select
                                        className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                        value={ticketForm.severity_code}
                                        onChange={e => setTicketForm({ ...ticketForm, severity_code: e.target.value })}
                                    >
                                        <option value="LOW">Baixa</option>
                                        <option value="NORMAL">Normal</option>
                                        <option value="HIGH">Alta</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Mensagem/Descrição</label>
                                <textarea
                                    className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white h-24"
                                    value={ticketForm.message}
                                    onChange={e => setTicketForm({ ...ticketForm, message: e.target.value })}
                                />
                            </div>
                            <div className="pt-2 flex justify-end gap-2">
                                <button type="button" onClick={() => setIsTicketModalOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancelar</button>
                                <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors disabled:opacity-50">
                                    {isSubmitting ? 'Salvando...' : (editingTicketId ? 'Atualizar' : 'Criar')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
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
