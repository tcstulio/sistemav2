import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Project, AppView, DolibarrDocument } from '../types';
import { usePrefill, PrefillResult } from '../hooks/usePrefill';
import { Search, Plus, Loader2, CheckCircle2, Settings, Pencil, Trash2, FolderKanban } from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { logger } from '../utils/logger';
import { toast } from 'sonner';

const log = logger.child('ProjectList');

// Direct Hook Imports
import { useDolibarr } from '../context/DolibarrContext';
import {
    useProjects, useCustomers, useTasks, useInvoices, useSupplierInvoices,
    useInterventions, useExpenseReports, useManufacturingOrders, useContracts,
    useTickets, useEvents, useLinks, useProposals, useOrders, useShipments,
    useSupplierOrders, useUsers, useProjectContacts, useContacts
} from '../hooks/dolibarr';

// Design System
import { PageHeader, Card, Button, Input, Tabs, Tab, EmptyState, MasterDetailLayout, StatusBadge } from './ui';
import type { StatusConfig } from './ui/StatusBadge';
import { PaginationControls } from './common/PaginationControls';

// Tabs Components
import {
    ProjectTeamTab, ProjectDebugTab, ProjectDocumentsTab, ProjectOverviewTab,
    ProjectTasksTab, ProjectTicketsTab, ProjectEventsTab, ProjectFinancialsTab,
    ProjectSalesTab, ProjectShipmentsTab, ProjectPurchasesTab, ProjectManufacturingTab,
    ProjectContractsTab, ProjectInterventionsTab, ProjectChatTab
} from './Projects/tabs';
import { CreateProjectModal, EditProjectModal, TaskModal, TicketModal } from './Projects/modals';
import { TaskWizard } from './Projects/TaskWizard';

// Status Config
const projectStatuses: Record<string, StatusConfig> = {
    '0': { label: 'Rascunho', variant: 'slate' },
    '1': { label: 'Aberto', variant: 'blue' },
    '2': { label: 'Fechado', variant: 'purple' },
};

const formatDateForInput = (timestamp: number) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toISOString().split('T')[0];
};

const resolveUserName = (authorId?: string, users: any[] = []) => {
    if (!authorId || authorId === 'System') return 'Sistema';
    const user = users.find(u => String(u.id) === String(authorId));
    if (user) return `${user.firstname || ''} ${user.lastname || ''}`.trim() || user.login;
    if (!isNaN(Number(authorId))) return `Usuário ${authorId}`;
    return authorId;
};

// ============================================
// ProjectDetail Sub-component
// ============================================

const ProjectDetail: React.FC<{
    project: Project;
    onClose: () => void;
    onValidate: () => void;
    onDelete: () => void;
    onEdit: () => void;
    processingId: string | null;
    onNavigate?: (view: AppView, id: string) => void;
    config: any;
    // Data Props
    customers: any[];
    users: any[];
    contacts: any[];
    tasks: any[];
    invoices: any[];
    supplierInvoices: any[];
    interventions: any[];
    expenseReports: any[];
    manufacturingOrders: any[];
    contracts: any[];
    tickets: any[];
    events: any[];
    links: any[];
    proposals: any[];
    orders: any[];
    shipments: any[];
    supplierOrders: any[];
    projectContacts: any[];
    // Modals Triggers
    onCreateTask: () => void;
    onEditTask: (t: any) => void;
    onDeleteTask: (id: string) => void;
    onOpenWizard: () => void;
    onCreateTicket: () => void;
    onEditTicket: (t: any) => void;
    onDeleteTicket: (id: string) => void;
    refreshData: () => void;
}> = ({
    project, onClose, onValidate, onDelete, onEdit, processingId, onNavigate, config,
    customers, users, contacts, tasks, invoices, supplierInvoices, interventions,
    expenseReports, manufacturingOrders, contracts, tickets, events, links, proposals,
    orders, shipments, supplierOrders, projectContacts,
    onCreateTask, onEditTask, onDeleteTask, onOpenWizard,
    onCreateTicket, onEditTicket, onDeleteTicket, refreshData
}) => {
        const [activeTab, setActiveTab] = useState<'overview' | 'tasks' | 'tickets' | 'events' | 'financials' | 'sales' | 'shipments' | 'purchases' | 'interventions' | 'expenses' | 'manufacturing' | 'contracts' | 'documents' | 'debug' | 'team' | 'chat'>('overview');
        const [documents, setDocuments] = useState<DolibarrDocument[]>([]);
        const [isLoadingDocs, setIsLoadingDocs] = useState(false);
        const [isUploading, setIsUploading] = useState(false);

        // Document Logic
        const loadDocuments = async () => {
            if (!project || !config) return;
            setIsLoadingDocs(true);
            try {
                const docs = await DolibarrService.fetchDocuments(config, 'project', project.id, project.ref);
                setDocuments(docs as DolibarrDocument[]);
            } catch (e) {
                log.error("Failed to load documents", e);
            } finally {
                setIsLoadingDocs(false);
            }
        };

        useEffect(() => {
            if (activeTab === 'documents') {
                loadDocuments();
            }
        }, [project.id, activeTab]);

        const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (!file || !project || !config) return;
            setIsUploading(true);
            try {
                await DolibarrService.uploadDocument(config, file, 'project', project.ref);
                toast.success("Arquivo enviado com sucesso");
                loadDocuments();
            } catch (e) {
                log.error("Failed to upload document", e);
                toast.error("Falha no envio");
            } finally {
                setIsUploading(false);
            }
        };

        const handleDeleteDocument = async (filename: string) => {
            if (!project || !config) return;
            try {
                await DolibarrService.deleteDocument(config, 'project', `${project.ref}/${filename}`);
                loadDocuments();
            } catch (e) {
                log.error("Failed to delete document", e);
                toast.error("Falha na exclusão");
            }
        };

        // Derived Data
        const getLinkedIds = (type: string) => {
            if (!project) return new Set();
            const ids = new Set<string>();
            links.forEach(link => {
                if (link.sourcetype === 'project' && String(link.sourceid) === String(project.id) && link.targettype === type) {
                    ids.add(String(link.targetid));
                }
                if (link.targettype === 'project' && String(link.targetid) === String(project.id) && link.sourcetype === type) {
                    ids.add(String(link.sourceid));
                }
            });
            return ids;
        };

        const projectTasks = useMemo(() => tasks.filter(t => String(t.project_id) === String(project.id)), [project, tasks]);

        const projectProposals = useMemo(() => {
            const linkedIds = getLinkedIds('propal');
            return proposals.filter(p => String(p.project_id) === String(project.id) || linkedIds.has(String(p.id)));
        }, [project, proposals, links]);

        const projectOrders = useMemo(() => {
            const linkedIds = getLinkedIds('commande');
            return orders.filter(o => String(o.project_id) === String(project.id) || linkedIds.has(String(o.id)));
        }, [project, orders, links]);

        const projectInvoices = useMemo(() => {
            const linkedIds = getLinkedIds('facture');
            return invoices.filter(i => String(i.project_id) === String(project.id) || linkedIds.has(String(i.id)));
        }, [project, invoices, links]);

        const projectSupplierInvoices = useMemo(() => {
            const linkedIds = getLinkedIds('facture_fourn');
            return supplierInvoices.filter(i => String(i.project_id) === String(project.id) || linkedIds.has(String(i.id)));
        }, [project, supplierInvoices, links]);

        const projectInterventions = useMemo(() => {
            const linkedIds = getLinkedIds('fichinter');
            return interventions.filter(i => String(i.project_id) === String(project.id) || linkedIds.has(String(i.id)));
        }, [project, interventions, links]);

        const projectExpenses = useMemo(() => {
            const linkedIds1 = getLinkedIds('expensereport');
            const linkedIds2 = getLinkedIds('deplacement');
            return expenseReports.filter(e => String(e.project_id) === String(project.id) || linkedIds1.has(String(e.id)) || linkedIds2.has(String(e.id)));
        }, [project, expenseReports, links]);

        const projectMOs = useMemo(() => {
            const linkedIds1 = getLinkedIds('mo');
            const linkedIds2 = getLinkedIds('mrp_mo');
            return manufacturingOrders.filter(mo => String(mo.project_id) === String(project.id) || linkedIds1.has(String(mo.id)) || linkedIds2.has(String(mo.id)));
        }, [project, manufacturingOrders, links]);

        const projectContracts = useMemo(() => {
            const linkedIds = getLinkedIds('contrat');
            return contracts.filter(c => String(c.project_id) === String(project.id) || linkedIds.has(String(c.id)));
        }, [project, contracts, links]);

        const projectTickets = useMemo(() => {
            const linkedIds = getLinkedIds('ticket');
            return tickets.filter(t => String(t.project_id) === String(project.id) || linkedIds.has(String(t.id)));
        }, [project, tickets, links]);

        const projectEvents = useMemo(() => {
            return events.filter(e => String(e.project_id) === String(project.id));
        }, [project, events]);

        const projectShipments = useMemo(() => {
            const linkedIds = getLinkedIds('expedition');
            return shipments.filter(s => String(s.project_id) === String(project.id) || linkedIds.has(String(s.id)));
        }, [project, shipments, links]);

        const projectSupplierOrders = useMemo(() => {
            const linkedIds = getLinkedIds('commande_fournisseur');
            return supplierOrders.filter(so => String(so.project_id) === String(project.id) || linkedIds.has(String(so.id)));
        }, [project, supplierOrders, links]);

        const getCustomerName = (socid: string) => {
            const customer = customers.find(c => String(c.id) === String(socid));
            return customer ? customer.name : 'Cliente Desconhecido';
        };

        return (
            <>
                <PageHeader
                    onBack={onClose}
                    title={project.title}
                    subtitle={
                        <span className="flex items-center gap-2">
                            {project.ref} | {getCustomerName(project.socid)}
                        </span>
                    }
                    actions={
                        <div className="flex items-center gap-2">
                            {project.statut === '0' && (
                                <Button
                                    onClick={onValidate}
                                    disabled={!!processingId}
                                    loading={processingId === project.id}
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                                    icon={<CheckCircle2 size={16} />}
                                >
                                    Validar
                                </Button>
                            )}
                            <Button variant="ghost" icon={<Pencil size={20} />} onClick={onEdit} title="Editar" />
                            <Button variant="ghost" icon={<Trash2 size={20} />} onClick={onDelete} className="text-red-500 hover:text-red-600 hover:bg-red-50" title="Excluir" />
                            <Button variant="ghost" icon={<Settings size={20} />} />
                        </div>
                    }
                    tabs={
                        <Tabs value={activeTab} onChange={(v) => setActiveTab(v as any)} className="w-full">
                            <Tab value="overview">Visão Geral</Tab>
                            <Tab value="tasks">Tarefas ({projectTasks.length})</Tab>
                            <Tab value="tickets">Chamados ({projectTickets.length})</Tab>
                            <Tab value="sales">Comercial ({projectProposals.length + projectOrders.length})</Tab>
                            <Tab value="financials">Financeiro</Tab>
                            <Tab value="shipments">Envios ({projectShipments.length})</Tab>
                            <Tab value="purchases">Compras ({projectSupplierOrders.length})</Tab>
                            <Tab value="manufacturing">Produção ({projectMOs.length})</Tab>
                            <Tab value="contracts">Contratos ({projectContracts.length})</Tab>
                            <Tab value="interventions">Interv. ({projectInterventions.length})</Tab>
                            <Tab value="events">Eventos ({projectEvents.length})</Tab>
                            <Tab value="team">Equipe</Tab>
                            <Tab value="documents">Docs</Tab>
                            <Tab value="chat">Chat</Tab>
                            <Tab value="debug">🔧</Tab>
                        </Tabs>
                    }
                />

                <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-50 dark:bg-slate-950/50">
                    <div className="max-w-4xl mx-auto space-y-6">
                        {activeTab === 'team' && (
                            <ProjectTeamTab
                                project={project}
                                team={projectContacts.filter(c => String(c.project_id) === String(project.id))}
                                users={users}
                                contacts={contacts}
                            />
                        )}
                        {activeTab === 'debug' && <ProjectDebugTab project={project} links={links} />}
                        {activeTab === 'chat' && <ProjectChatTab project={project} />}
                        {activeTab === 'overview' && (
                            <ProjectOverviewTab
                                project={project}
                                customerName={getCustomerName(project.socid)}
                                totalInvoiced={projectInvoices.reduce((acc, i) => acc + i.total_ttc, 0)}
                                totalSupplierBills={projectSupplierInvoices.reduce((acc, i) => acc + i.total_ttc, 0)}
                                totalExpenses={projectExpenses.reduce((acc, i) => acc + i.total_ttc, 0)}
                                createdByName={resolveUserName(project.fk_user_creat, users)}
                                modifiedByName={resolveUserName(project.fk_user_modif, users)}
                                onNavigate={onNavigate}
                            />
                        )}
                        {activeTab === 'tasks' && (
                            <ProjectTasksTab
                                tasks={projectTasks}
                                onNavigate={onNavigate}
                                onCreateTask={onCreateTask}
                                onEditTask={onEditTask}
                                onDeleteTask={onDeleteTask}
                                onOpenWizard={onOpenWizard}
                            />
                        )}
                        {activeTab === 'tickets' && (
                            <ProjectTicketsTab
                                tickets={projectTickets}
                                onCreateTicket={onCreateTicket}
                                onEditTicket={onEditTicket}
                                onDeleteTicket={onDeleteTicket}
                            />
                        )}
                        {activeTab === 'documents' && (
                            <ProjectDocumentsTab
                                project={project}
                                config={config}
                                documents={documents}
                                isLoading={isLoadingDocs}
                                isUploading={isUploading}
                                onUpload={handleFileUpload}
                                onDelete={handleDeleteDocument}
                            />
                        )}
                        {activeTab === 'sales' && (
                            <ProjectSalesTab proposals={projectProposals} orders={projectOrders} onNavigate={onNavigate} />
                        )}
                        {activeTab === 'shipments' && (
                            <ProjectShipmentsTab shipments={projectShipments} onNavigate={onNavigate} />
                        )}
                        {activeTab === 'purchases' && (
                            <ProjectPurchasesTab supplierOrders={projectSupplierOrders} />
                        )}
                        {activeTab === 'financials' && (
                            <ProjectFinancialsTab invoices={projectInvoices} supplierInvoices={projectSupplierInvoices} onNavigate={onNavigate} />
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
        );
    };

// ============================================
// Main Component
// ============================================

const ProjectList: React.FC<{
    onNavigate?: (view: AppView, id: string) => void;
    initialItemId?: string;
}> = ({ onNavigate, initialItemId }) => {
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

    if (!config) return <div className="p-8 text-center"><Loader2 className="animate-spin mx-auto" /></div>;

    // Pagination
    const [page, setPage] = useState(0);
    const [limit, setLimit] = useState(20);

    // Filter & Search
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'draft' | 'open' | 'closed'>('all');

    // Selection
    const [selectedProject, setSelectedProject] = useState<Project | null>(null);

    // State
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
    const [isWizardOpen, setIsWizardOpen] = useState(false);
    const [isTicketModalOpen, setIsTicketModalOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [processingId, setProcessingId] = useState<string | null>(null);

    // Forms
    const [newProjectForm] = useState({ ref: '', title: '', socid: '' }); // Unused for now as Modal handles it? No, passed to modal. 
    // Actually CreateProjectModal likely handles its own state or we pass it?
    // Checking original code: CreateProjectModal took onSubmit(form).

    // Check original EditProjectModal form
    const [editProjectForm, setEditProjectForm] = useState({ title: '', status: '0', date_start: '', date_end: '', description: '' });

    // Deeplink HITL do agente (#57): aplica o prefill UMA vez por token.
    const prefill = usePrefill();
    const appliedPrefillRef = useRef<PrefillResult | null>(null);
    const [createPrefill, setCreatePrefill] = useState<Record<string, string> | undefined>(undefined);

    const [taskForm, setTaskForm] = useState({ label: '', description: '', planned_workload: 0, date_start: '', date_end: '' });
    const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

    const [ticketForm, setTicketForm] = useState({ subject: '', message: '', type_code: 'ISSUE', severity_code: 'NORMAL' });
    const [editingTicketId, setEditingTicketId] = useState<string | null>(null);

    // Deep Link
    useEffect(() => {
        if (initialItemId && projects.length > 0) {
            const match = projects.find(p => String(p.id) === String(initialItemId));
            if (match) setSelectedProject(match);
        }
    }, [initialItemId, projects]);

    // Deeplink HITL do agente (#57): create_project abre o modal de novo projeto pré-preenchido;
    // edit_project carrega os valores atuais e sobrepõe as mudanças no modal de edição.
    useEffect(() => {
        if (!prefill || appliedPrefillRef.current === prefill) return;
        if (prefill.kind === 'create_project') {
            appliedPrefillRef.current = prefill;
            setCreatePrefill(prefill.data);
            setIsCreateModalOpen(true);
            toast.info('Revise os dados e confirme a criação do projeto.');
        } else if (prefill.kind === 'edit_project') {
            if (projects.length === 0) return; // aguarda os projetos carregarem
            appliedPrefillRef.current = prefill;
            const { id, ...changes } = prefill.data;
            const current = projects.find(p => String(p.id) === String(id));
            if (!current) { toast.error('Projeto não encontrado para edição.'); return; }
            setSelectedProject(current);
            setEditProjectForm({
                title: changes.title ?? current.title,
                status: current.statut,
                date_start: current.date_start ? formatDateForInput(current.date_start) : '',
                date_end: current.date_end ? formatDateForInput(current.date_end) : '',
                description: '',
            });
            setIsEditModalOpen(true);
            toast.info('Revise as mudanças sugeridas e salve.');
        } else if (prefill.kind === 'create_task') {
            if (projects.length === 0) return; // aguarda os projetos carregarem
            const project = projects.find(p => String(p.id) === String(prefill.data.project_id));
            if (!project) { toast.error('Projeto não encontrado para a tarefa.'); return; }
            appliedPrefillRef.current = prefill;
            setSelectedProject(project);
            setEditingTaskId(null);
            setTaskForm({
                label: prefill.data.label || '',
                description: prefill.data.description || '',
                planned_workload: Number(prefill.data.planned_workload) || 0,
                date_start: prefill.data.date_start || '',
                date_end: prefill.data.date_end || '',
            });
            setIsTaskModalOpen(true);
            toast.info('Revise os dados e confirme a criação da tarefa.');
        } else if (prefill.kind === 'edit_task') {
            if (tasks.length === 0) return; // aguarda as tarefas carregarem
            const { id, ...changes } = prefill.data;
            const current = tasks.find(t => String(t.id) === String(id));
            if (!current) { toast.error('Tarefa não encontrada para edição.'); return; }
            appliedPrefillRef.current = prefill;
            const parent = projects.find(p => String(p.id) === String(current.project_id));
            if (parent) setSelectedProject(parent);
            setEditingTaskId(String(id));
            setTaskForm({
                label: changes.label ?? current.label,
                description: changes.description ?? (current.description || ''),
                planned_workload: changes.planned_workload !== undefined ? Number(changes.planned_workload) : (current.planned_workload || 0) / 3600,
                date_start: changes.date_start ?? (current.date_start ? formatDateForInput(current.date_start) : ''),
                date_end: changes.date_end ?? (current.date_end ? formatDateForInput(current.date_end) : ''),
            });
            setIsTaskModalOpen(true);
            toast.info('Revise as mudanças sugeridas e salve.');
        }
    }, [prefill, projects, tasks]);

    useEffect(() => { setPage(0); }, [searchTerm, filterStatus]);

    const getCustomerName = (socid: string) => {
        const customer = customers.find(c => String(c.id) === String(socid));
        return customer ? customer.name : 'Desc.';
    };

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

    const paginatedProjects = useMemo(() => {
        const start = page * limit;
        return filteredProjects.slice(start, start + limit);
    }, [filteredProjects, page, limit]);

    // Actions
    const handleCreateProject = async (form: { ref: string; title: string; socid: string }) => {
        if (!form.title || !form.socid || !config) return;
        setIsSubmitting(true);
        try {
            await DolibarrService.createProject(config, form);
            toast.success("Projeto Criado");
            setIsCreateModalOpen(false);
            if (refreshData) refreshData();
        } catch (e: any) {
            log.error("Failed to create project", e);
            toast.error(`Falha: ${e.message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleValidate = async () => {
        if (!selectedProject || !config) return;
        setProcessingId(selectedProject.id);
        try {
            await DolibarrService.updateProject(config, selectedProject.id, { statut: 1 });
            toast.success("Validado");
            if (refreshData) refreshData();
            setSelectedProject(prev => prev ? ({ ...prev, statut: '1' }) : null);
        } catch (e: any) {
            toast.error(`Erro: ${e.message}`);
        } finally {
            setProcessingId(null);
        }
    };

    const handleDeleteProject = async () => {
        if (!selectedProject || !config) return;
        try {
            await DolibarrService.deleteProject(config, selectedProject.id);
            toast.success("Excluído");
            setSelectedProject(null);
            if (refreshData) refreshData();
        } catch (e: any) {
            toast.error(`Falha: ${e.message}`);
        }
    };

    const openEditModal = () => {
        if (!selectedProject) return;
        setEditProjectForm({
            title: selectedProject.title,
            status: selectedProject.statut,
            date_start: selectedProject.date_start ? formatDateForInput(selectedProject.date_start) : '',
            date_end: selectedProject.date_end ? formatDateForInput(selectedProject.date_end) : '',
            description: ''
        });
        setIsEditModalOpen(true);
    };

    const handleUpdateProject = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedProject || !config) return;
        setIsSubmitting(true);
        try {
            const payload: any = {
                title: editProjectForm.title,
                statut: editProjectForm.status,
            };
            if (editProjectForm.date_start) payload.dateo = Math.floor(new Date(editProjectForm.date_start).getTime() / 1000);
            if (editProjectForm.date_end) payload.datee = Math.floor(new Date(editProjectForm.date_end).getTime() / 1000);

            await DolibarrService.updateProject(config, selectedProject.id, payload);
            toast.success("Atualizado");
            setIsEditModalOpen(false);
            if (refreshData) refreshData();

            // Optimistic update
            const updated = {
                ...selectedProject,
                ...payload,
                date_start: payload.dateo ? payload.dateo * 1000 : selectedProject.date_start,
                date_end: payload.datee ? payload.datee * 1000 : selectedProject.date_end
            };
            setSelectedProject(updated as Project);

        } catch (e: any) {
            toast.error(`Falha: ${e.message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    // Task & Ticket Handlers
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

    const handleCreateOrUpdateTask = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedProject || !config) return;
        setIsSubmitting(true);
        try {
            const payload: any = {
                label: taskForm.label,
                description: taskForm.description,
                project_id: selectedProject.id,
                planned_workload: taskForm.planned_workload * 3600,
            };
            if (taskForm.date_start) payload.date_start = Math.floor(new Date(taskForm.date_start).getTime() / 1000);
            if (taskForm.date_end) payload.date_end = Math.floor(new Date(taskForm.date_end).getTime() / 1000);

            if (editingTaskId) {
                await DolibarrService.updateTask(config, editingTaskId, payload);
                toast.success("Tarefa atualizada");
            } else {
                await DolibarrService.createTask(config, payload);
                toast.success("Tarefa criada");
            }
            setIsTaskModalOpen(false);
            if (refreshData) refreshData();
        } catch (e: any) {
            toast.error(`Erro: ${e.message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeleteTask = async (taskId: string) => {
        if (!config) return;
        await DolibarrService.deleteTask(config, taskId);
        if (refreshData) refreshData();
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
                project_id: selectedProject.id,
                socid: selectedProject.socid
            };
            if (editingTicketId) {
                await DolibarrService.updateTicket(config, editingTicketId, payload);
                toast.success("Chamado atualizado");
            } else {
                await DolibarrService.createTicket(config, payload);
                toast.success("Chamado criado");
            }
            setIsTicketModalOpen(false);
            if (refreshData) refreshData();
        } catch (e: any) {
            toast.error(`Erro: ${e.message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeleteTicket = async (ticketId: string) => {
        if (!config) return;
        await DolibarrService.deleteTicket(config, ticketId);
        if (refreshData) refreshData();
    };

    return (
        <div className="h-full bg-slate-50 dark:bg-slate-950 transition-colors">
            <div className={selectedProject ? 'hidden lg:block' : 'block'}>
                <PageHeader
                    title="Projetos"
                    subtitle="Gerencie seus projetos e oportunidades"
                    actions={
                        <div className="flex items-center gap-2">
                            <Input
                                placeholder="Buscar..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                icon={<Search size={16} />}
                                className="w-64"
                                fullWidth={false}
                            />
                            <Button icon={<Plus size={18} />} onClick={() => setIsCreateModalOpen(true)}>Novo</Button>
                        </div>
                    }
                    tabs={
                        <Tabs value={filterStatus} onChange={(v) => setFilterStatus(v as any)}>
                            <Tab value="all">Todos</Tab>
                            <Tab value="open">Abertos</Tab>
                            <Tab value="draft">Rascunhos</Tab>
                            <Tab value="closed">Fechados</Tab>
                        </Tabs>
                    }
                />
            </div>

            <MasterDetailLayout
                showDetail={!!selectedProject}
                onCloseDetail={() => setSelectedProject(null)}
                listWidth="1/3"
                list={
                    filteredProjects.length === 0 ? (
                        <EmptyState
                            icon={FolderKanban}
                            title="Nenhum projeto encontrado"
                            description="Tente ajustar os filtros."
                            action={<Button onClick={() => setIsCreateModalOpen(true)}>Novo Projeto</Button>}
                        />
                    ) : (
                        <div className="space-y-3 p-4 pb-8">
                            {paginatedProjects.map(proj => (
                                <Card
                                    key={proj.id}
                                    onClick={() => setSelectedProject(proj)}
                                    selected={selectedProject?.id === proj.id}
                                    hoverable
                                >
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="flex items-center gap-2">
                                            <h4 className="font-bold text-slate-800 dark:text-white text-sm">{proj.ref}</h4>
                                            <StatusBadge status={proj.statut} config={projectStatuses} size="sm" />
                                        </div>
                                        <span className="text-xs text-slate-500 font-mono">{proj.progress}%</span>
                                    </div>
                                    <h3 className="font-bold text-slate-800 dark:text-white text-sm mb-1 line-clamp-1">{proj.title}</h3>
                                    <div className="text-sm text-slate-600 dark:text-slate-300 font-medium mb-1 truncate">{getCustomerName(proj.socid)}</div>
                                    <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full mt-2 overflow-hidden">
                                        <div className="h-full bg-indigo-500" style={{ width: `${proj.progress}%` }}></div>
                                    </div>
                                </Card>
                            ))}
                            <PaginationControls
                                page={page}
                                limit={limit}
                                onPageChange={setPage}
                                onLimitChange={setLimit}
                                hasNext={filteredProjects.length > (page + 1) * limit}
                                hasPrev={page > 0}
                            />
                        </div>
                    )
                }
                detail={
                    selectedProject && (
                        <ProjectDetail
                            project={selectedProject}
                            onClose={() => setSelectedProject(null)}
                            onValidate={handleValidate}
                            onDelete={handleDeleteProject}
                            onEdit={openEditModal}
                            processingId={processingId}
                            onNavigate={onNavigate}
                            config={config}
                            // Data
                            customers={customers}
                            users={users}
                            contacts={contacts}
                            tasks={tasks}
                            invoices={invoices}
                            supplierInvoices={supplierInvoices}
                            interventions={interventions}
                            expenseReports={expenseReports}
                            manufacturingOrders={manufacturingOrders}
                            contracts={contracts}
                            tickets={tickets}
                            events={events}
                            links={links}
                            proposals={proposals}
                            orders={orders}
                            shipments={shipments}
                            supplierOrders={supplierOrders}
                            projectContacts={projectContacts}
                            // Handlers
                            onCreateTask={() => openTaskModal()}
                            onEditTask={(t) => openTaskModal(t)}
                            onDeleteTask={handleDeleteTask}
                            onOpenWizard={() => setIsWizardOpen(true)}
                            onCreateTicket={() => openTicketModal()}
                            onEditTicket={(t) => openTicketModal(t)}
                            onDeleteTicket={handleDeleteTicket}
                            refreshData={refreshData}
                        />
                    )
                }
            />

            <CreateProjectModal
                isOpen={isCreateModalOpen}
                onClose={() => { setIsCreateModalOpen(false); setCreatePrefill(undefined); }}
                onSubmit={handleCreateProject}
                customers={customers}
                isSubmitting={isSubmitting}
                initialForm={createPrefill}
            />

            <EditProjectModal
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                onSubmit={handleUpdateProject}
                form={editProjectForm}
                setForm={setEditProjectForm}
                isSubmitting={isSubmitting}
            />

            <TaskModal
                isOpen={isTaskModalOpen}
                onClose={() => setIsTaskModalOpen(false)}
                onSubmit={handleCreateOrUpdateTask}
                form={taskForm}
                setForm={setTaskForm}
                isSubmitting={isSubmitting}
                isEditing={!!editingTaskId}
            />

            <TicketModal
                isOpen={isTicketModalOpen}
                onClose={() => setIsTicketModalOpen(false)}
                onSubmit={handleCreateOrUpdateTicket}
                form={ticketForm}
                setForm={setTicketForm}
                isSubmitting={isSubmitting}
                isEditing={!!editingTicketId}
            />

            {selectedProject && (
                <TaskWizard
                    isOpen={isWizardOpen}
                    onClose={() => setIsWizardOpen(false)}
                    project={selectedProject}
                    config={config}
                    users={users}
                    allProjects={projects}
                    allTasks={tasks}
                    onSuccess={() => { if (refreshData) refreshData(); }}
                />
            )}
        </div>
    );
};

export default ProjectList;
