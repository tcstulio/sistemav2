import React, { useState, useMemo, useEffect, useRef } from 'react';
import { usePrefill } from '../hooks/usePrefill';
import { sanitizeHtml } from '../utils/sanitizeHtml';
import { toast } from 'sonner';
import { Ticket, ThirdParty, DolibarrUser, DolibarrConfig, AppView, AgendaEvent, Project } from '../types';
import { Ticket as TicketIcon, AlertCircle, Clock, Calendar, CheckCircle2, User, ExternalLink, MessageSquare, Send, UserCircle, Sparkles, Loader2, List, Kanban, Plus, DollarSign, Users, Info, Phone, Bot, FileText, FolderKanban, ClipboardList, Wrench, Pencil } from 'lucide-react';
import { useListControls } from '../hooks/useListControls';
import { AiService } from '../services/aiService';
import { DolibarrService } from '../services/dolibarrService';
import { useDolibarr } from '../context/DolibarrContext';
import { useTickets, useCustomers, useUsers, useEvents, useProjects, useInterventions } from '../hooks/dolibarr';
import { LinkedObjects } from './common/LinkedObjects';
import { formatDateOnly, formatDateTime } from '../utils/dateUtils';
import { logger } from '../utils/logger';

const log = logger.child('TicketList');

// Design System
import { PageHeader, Card, Button, Input, Modal, Tabs, Tab, EmptyState, MasterDetailLayout, StatusBadge, ListToolbar, ConfirmDeleteButton } from './ui';
import type { StatusConfig } from './ui/StatusBadge';

// Status Config
const ticketStatuses: Record<string, StatusConfig> = {
    '1': { label: 'Novo', variant: 'blue', icon: <AlertCircle size={12} /> },
    '5': { label: 'Em Progresso', variant: 'orange', icon: <Clock size={12} /> },
    '8': { label: 'Fechado', variant: 'emerald', icon: <CheckCircle2 size={12} /> },
    'CLOSED': { label: 'Fechado', variant: 'emerald', icon: <CheckCircle2 size={12} /> },
    'RESOLVED': { label: 'Fechado', variant: 'emerald', icon: <CheckCircle2 size={12} /> },
};

interface TicketListProps {
    onNavigate?: (view: AppView, id: string) => void;
    onRefresh?: () => void;
    initialItemId?: string;
}

const TicketList: React.FC<TicketListProps> = ({ onNavigate, onRefresh, initialItemId }) => {
    const { config } = useDolibarr();
    const { data: ticketsData, refetch: refetchTickets } = useTickets(config);
    const tickets = ticketsData || [];
    const { data: customersData } = useCustomers(config);
    const customers = customersData || [];
    const { data: usersData } = useUsers(config);
    const users = usersData || [];
    const { data: eventsData } = useEvents(config);
    const events = eventsData || [];
    const { data: projectsData } = useProjects(config);
    const projects = projectsData || [];
    const { data: interventions = [] } = useInterventions(config);

    if (!config) return <div className="p-8 text-center">Carregando configuração...</div>;

    const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'closed' | 'assigned'>('all');
    const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
    const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
    const [replyText, setReplyText] = useState('');
    const [localHistory, setLocalHistory] = useState<any[]>([]);
    const [remoteEvents, setRemoteEvents] = useState<any[]>([]);
    const [isGeneratingReply, setIsGeneratingReply] = useState(false);
    const [isSendingReply, setIsSendingReply] = useState(false);
    const [isLoadingMessages, setIsLoadingMessages] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // New Ticket State
    const [isNewTicketModalOpen, setIsNewTicketModalOpen] = useState(false);
    const [newTicketForm, setNewTicketForm] = useState({ subject: '', message: '', socid: '', severity_code: 'NORMAL', type_code: 'ISSUE' });
    const [isSubmittingTicket, setIsSubmittingTicket] = useState(false);
    const prefill = usePrefill();
    const appliedPrefillRef = useRef<typeof prefill>(null);

    // Edit Ticket State (#57/#78)
    const [isEditTicketModalOpen, setIsEditTicketModalOpen] = useState(false);
    const [editTicketId, setEditTicketId] = useState<string | undefined>(undefined);
    const [editTicketForm, setEditTicketForm] = useState({ subject: '', message: '', severity_code: 'NORMAL' });
    const [isSavingEditTicket, setIsSavingEditTicket] = useState(false);

    // Escalation State
    const [isEscalateModalOpen, setIsEscalateModalOpen] = useState(false);
    const [escalateForm, setEscalateForm] = useState({ description: '', date: new Date().toISOString().split('T')[0] });
    const [isEscalating, setIsEscalating] = useState(false);

    // Initialize Messages
    useEffect(() => {
        setLocalHistory([]);
        setReplyText('');

        if (selectedTicket) {
            setIsLoadingMessages(true);
            DolibarrService.fetchTicketEvents(config, selectedTicket.id)
                .then(evts => setRemoteEvents(evts))
                .catch(e => log.error("Failed to load ticket history", e))
                .finally(() => setIsLoadingMessages(false));
        } else {
            setRemoteEvents([]);
        }
    }, [selectedTicket, config]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [selectedTicket, localHistory, remoteEvents]);

    // Open ticket detail when navigated via route (e.g. global search → /tickets/:id)
    useEffect(() => {
        if (initialItemId && tickets.length > 0) {
            const target = tickets.find(t => String(t.id) === String(initialItemId));
            if (target) setSelectedTicket(target);
        }
    }, [initialItemId, tickets]);

    // Deeplink HITL do agente (#57 Peça 2/3): a tela é aberta via /tickets/new?prefill=<token>
    // (criar) ou /tickets/:id/edit?prefill=<token> (editar). O hook usePrefill resolve o token
    // (HMAC) e aqui pré-preenchemos o modal correspondente (aplica 1x por token).
    useEffect(() => {
        if (!prefill || appliedPrefillRef.current === prefill) return;
        if (prefill.kind === 'create_ticket') {
            appliedPrefillRef.current = prefill;
            const data = prefill.data;
            setNewTicketForm(prev => ({
                ...prev,
                subject: data.subject || '',
                message: data.message || '',
                socid: data.socid || '',
                type_code: data.type_code || 'ISSUE',
                severity_code: data.severity_code || 'NORMAL',
            }));
            setIsNewTicketModalOpen(true);
            toast.info('Revise os dados e confirme a criação do ticket.');
        } else if (prefill.kind === 'edit_ticket') {
            if (tickets.length === 0) return; // aguarda os dados p/ carregar o registro atual
            appliedPrefillRef.current = prefill;
            const current = tickets.find(t => String(t.id) === String(prefill.data.id));
            setEditTicketId(String(prefill.data.id));
            setEditTicketForm({
                subject: prefill.data.subject ?? current?.subject ?? '',
                message: prefill.data.message ?? current?.message ?? '',
                severity_code: prefill.data.severity_code ?? current?.severity_code ?? 'NORMAL',
            });
            setIsEditTicketModalOpen(true);
            toast.info('Revise as mudanças e salve o ticket.');
        }
    }, [prefill, tickets]);

    // Robust Customer Name Resolution
    const getCustomerName = (ticket: Ticket) => {
        const c = customers.find(cust => String(cust.id) === String(ticket.socid));
        if (c) return c.name;
        if (ticket.origin_email && ticket.origin_email.trim()) return ticket.origin_email;
        if (ticket.subject && ticket.subject.includes('-')) {
            const parts = ticket.subject.split('-');
            if (parts.length > 1) return parts[0].trim();
        }
        return 'Usuário Desconhecido';
    };

    const getProjectName = (projId?: string) => {
        if (!projId) return null;
        const p = projects.find(prj => String(prj.id) === String(projId));
        return p ? p.title : null;
    };

    const resolveUserName = (authorId: string) => {
        if (!authorId || authorId === 'System') return 'Sistema';
        const user = users.find(u => String(u.id) === String(authorId));
        if (user) return `${user.firstname || ''} ${user.lastname || ''}`.trim() || user.login;
        if (!isNaN(Number(authorId))) return `Usuário ${authorId}`;
        return authorId;
    };

    // Busca + ordenação padronizadas (#121). O filtro por status fica nas Tabs (lógica
    // específica de "atribuídos a mim" e do modo Kanban) e é aplicado sobre controls.result.
    const controls = useListControls(tickets, {
        searchText: (t) => `${t.ref} ${t.subject} ${t.origin_email || ''}`,
        sorts: [
            { key: 'date_c', label: 'Data', get: (t) => t.date_c || 0 },
            { key: 'ref', label: 'Referência', get: (t) => t.ref },
            { key: 'subject', label: 'Assunto', get: (t) => t.subject },
        ],
        initialSortKey: 'date_c',
        initialSortDir: 'desc',
    });

    const filteredTickets = useMemo(() => {
        return controls.result.filter(t => {
            if (viewMode === 'kanban') return true;

            const isClosed = t.statut === '8' || t.statut === 'CLOSED' || t.statut === 'RESOLVED';

            if (filterStatus === 'open') return !isClosed;
            if (filterStatus === 'closed') return isClosed;
            if (filterStatus === 'assigned') {
                return !isClosed && (String(t.fk_user_assign) === String(config?.currentUser?.id));
            }
            return true;
        });
    }, [controls.result, filterStatus, viewMode, config]);

    const ticketMessages = useMemo(() => {
        if (!selectedTicket) return [];

        let messages: any[] = [];

        messages.push({
            id: 'original',
            text: selectedTicket.message,
            date: selectedTicket.date_c,
            sender: 'customer',
            user: getCustomerName(selectedTicket),
            type: 'message'
        });

        remoteEvents.forEach(evt => {
            const isSystem = evt.type?.includes('AUTO') || (!evt.message && evt.label);
            messages.push({
                id: evt.id,
                text: evt.note_private || evt.description || evt.note || evt.message || evt.label,
                date: evt.datep || evt.date,
                sender: isSystem ? 'system' : 'agent',
                user: resolveUserName(evt.authorid || evt.author),
                type: isSystem ? 'log' : 'message'
            });
        });

        messages = [...messages, ...localHistory];

        return messages.sort((a, b) => (a.date || 0) - (b.date || 0));
    }, [selectedTicket, localHistory, remoteEvents]);

    const handleSendReply = async () => {
        if (!replyText.trim() || !selectedTicket) return;
        setIsSendingReply(true);

        try {
            const targetId = selectedTicket.track_id || selectedTicket.id;
            await DolibarrService.addTicketMessage(config, targetId, replyText);

            const newMsg = {
                id: `local-${Date.now()}`,
                text: replyText,
                date: Date.now() / 1000,
                sender: 'agent',
                user: 'Você',
                type: 'message'
            };
            setLocalHistory([...localHistory, newMsg]);
            setReplyText('');
        } catch (e) {
            log.error("Failed to send reply", e);
            toast.error("Falha ao enviar mensagem. Verifique o console.");
        } finally {
            setIsSendingReply(false);
        }
    };

    const handleGenerateSmartReply = async () => {
        if (!selectedTicket || isGeneratingReply) return;
        setIsGeneratingReply(true);
        try {
            const draft = await AiService.generateTicketReply(selectedTicket.subject, selectedTicket.message, ticketMessages.map(m => m.text));
            if (draft) setReplyText(draft);
        } catch (e) { log.error("Failed to generate smart reply", e); } finally { setIsGeneratingReply(false); }
    };

    const handleCreateTicket = async () => {
        setIsSubmittingTicket(true);
        try {
            await DolibarrService.createTicket(config, newTicketForm);
            setIsNewTicketModalOpen(false);
            setNewTicketForm({ subject: '', message: '', socid: '', severity_code: 'NORMAL', type_code: 'ISSUE' });
            if (onRefresh) onRefresh();
        } catch (e) { log.error("Failed to create ticket", e); } finally { setIsSubmittingTicket(false); }
    };

    const openEditTicket = (t: Ticket) => {
        setEditTicketId(String(t.id));
        setEditTicketForm({ subject: t.subject || '', message: t.message || '', severity_code: t.severity_code || 'NORMAL' });
        setIsEditTicketModalOpen(true);
    };

    const handleEditTicket = async () => {
        if (!editTicketId) return;
        setIsSavingEditTicket(true);
        try {
            await DolibarrService.updateTicket(config, editTicketId, editTicketForm);
            setIsEditTicketModalOpen(false);
            toast.success('Chamado atualizado.');
            if (onRefresh) onRefresh();
        } catch (e) {
            log.error("Failed to update ticket", e);
            toast.error('Falha ao atualizar o chamado.');
        } finally { setIsSavingEditTicket(false); }
    };

    const handleEscalate = () => {
        if (!selectedTicket) return;
        setEscalateForm({
            description: `[Escalada do Chamado ${selectedTicket.ref}]\nAssunto: ${selectedTicket.subject}\n\n${selectedTicket.message.substring(0, 500)}...`,
            date: new Date().toISOString().split('T')[0]
        });
        setIsEscalateModalOpen(true);
    };

    const submitEscalation = async () => {
        if (!selectedTicket) return;
        setIsEscalating(true);
        try {
            await DolibarrService.createIntervention(config, {
                socid: selectedTicket.socid,
                fk_project: selectedTicket.project_id,
                date: new Date(escalateForm.date).getTime() / 1000,
                description: escalateForm.description
            });
            toast.success("Intervenção Criada com Sucesso");
            setIsEscalateModalOpen(false);

            await DolibarrService.addTicketMessage(config, selectedTicket.track_id || selectedTicket.id, "Chamado escalado para Intervenção de Serviço de Campo.");

            if (onRefresh) onRefresh();
        } catch (e: any) {
            log.error("Failed to escalate ticket", e);
            toast.error(`Falha na escalação: ${e.message}`);
        } finally {
            setIsEscalating(false);
        }
    };

    // Helper to safely render content (handle HTML if present)
    const renderMessageContent = (text: string) => {
        if (!text) return <span className="italic text-slate-400">Sem conteúdo</span>;

        if (text.includes('<') && text.includes('>')) {
            return <div className="prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: sanitizeHtml(text) }} />;
        }
        return <p className="whitespace-pre-wrap leading-relaxed">{text}</p>;
    };

    // Kanban Columns
    const kanbanColumns = [
        { id: '1', title: 'Novo', color: 'blue' },
        { id: '5', title: 'Em Progresso', color: 'orange' },
        { id: '8', title: 'Resolvido', color: 'emerald' }
    ];

    // --- List Content ---
    const renderListContent = viewMode === 'list' ? (
        filteredTickets.length === 0 ? (
            <EmptyState
                icon={TicketIcon}
                title="Nenhum chamado encontrado"
                description="Tente ajustar os filtros ou a busca."
            />
        ) : (
            <div className="space-y-3 p-4">
                {filteredTickets.map(t => (
                    <Card
                        key={t.id}
                        onClick={() => setSelectedTicket(t)}
                        selected={selectedTicket?.id === t.id}
                        hoverable
                    >
                        <div className="flex justify-between items-start mb-2">
                            <div className="flex flex-col">
                                <div className="flex items-center gap-2">
                                    <span className="font-mono text-xs text-slate-400">{t.ref}</span>
                                    {t.category_code === 'IA_CHAT' && (
                                        <span className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded flex items-center gap-1 border border-indigo-100">
                                            <Bot size={8} /> Chat IA
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <StatusBadge status={t.statut} config={ticketStatuses} size="sm" />
                                <ConfirmDeleteButton
                                    onDelete={() => DolibarrService.deleteTicket(config, t.id)}
                                    onDeleted={() => { if (selectedTicket?.id === t.id) setSelectedTicket(null); refetchTickets(); onRefresh?.(); }}
                                    itemLabel={t.ref}
                                />
                            </div>
                        </div>
                        <h4 className="font-bold text-sm mb-1 line-clamp-1 dark:text-white">{t.subject}</h4>
                        <div className="text-xs text-slate-500 flex justify-between items-center mt-2">
                            <span
                                className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (onNavigate) onNavigate('customers', t.socid || '');
                                }}
                            >
                                {getCustomerName(t)}
                            </span>
                            <span className="text-xs text-slate-500">{formatDateTime(t.date_c)}</span>
                        </div>
                    </Card>
                ))}
            </div>
        )
    ) : (
        <div className="flex gap-4 overflow-x-auto h-full pb-4 p-4">
            {kanbanColumns.map(col => (
                <div key={col.id} className="min-w-[280px] bg-slate-100 dark:bg-slate-900/50 rounded-xl p-3 h-full overflow-y-auto border border-slate-200 dark:border-slate-800">
                    <div className="font-bold mb-3 text-slate-700 dark:text-slate-300">{col.title}</div>
                    {filteredTickets.filter(t => t.statut === col.id).map(t => (
                        <Card key={t.id} onClick={() => setSelectedTicket(t)} hoverable className="mb-2">
                            <div className="flex justify-between items-center mb-1">
                                <div className="text-xs text-slate-400">{t.ref}</div>
                                {t.category_code === 'IA_CHAT' && <Bot size={12} className="text-indigo-400" />}
                            </div>
                            <div className="font-medium text-sm text-slate-800 dark:text-white line-clamp-2">{t.subject}</div>
                        </Card>
                    ))}
                </div>
            ))}
        </div>
    );

    // --- Detail ---
    const renderDetail = selectedTicket ? (
        <>
            <PageHeader
                onBack={() => setSelectedTicket(null)}
                title={
                    <span className="flex items-center gap-2">
                        {selectedTicket.ref}
                        <StatusBadge status={selectedTicket.statut} config={ticketStatuses} />
                    </span>
                }
                subtitle={
                    <span className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <span
                            className="text-xs text-slate-500 flex items-center gap-1 cursor-pointer hover:underline hover:text-indigo-600 dark:hover:text-indigo-400"
                            onClick={() => onNavigate && onNavigate('customers', selectedTicket.socid || '')}
                        >
                            <User size={10} /> {getCustomerName(selectedTicket)}
                        </span>
                        {selectedTicket.project_id && (
                            <span
                                className="text-xs text-slate-500 flex items-center gap-1 cursor-pointer hover:underline hover:text-indigo-600 dark:hover:text-indigo-400"
                                onClick={() => onNavigate && onNavigate('projects', selectedTicket.project_id!)}
                            >
                                <FolderKanban size={10} /> {getProjectName(selectedTicket.project_id)}
                            </span>
                        )}
                        {selectedTicket.array_options?.options_cf_session_id && (
                            <span className="text-xs text-slate-400">• {selectedTicket.array_options.options_cf_session_id}</span>
                        )}
                    </span>
                }
                actions={
                    <div className="flex items-center gap-2">
                        <Button
                            variant="secondary"
                            size="sm"
                            icon={<Pencil size={14} />}
                            onClick={() => openEditTicket(selectedTicket)}
                            className="hidden lg:inline-flex"
                        >
                            Editar
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            icon={<Wrench size={14} />}
                            onClick={handleEscalate}
                            className="hidden lg:inline-flex"
                        >
                            Escalar
                        </Button>
                    </div>
                }
            />

            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50 dark:bg-slate-950/50">

                {/* Mobile Escalate Button */}
                <div className="lg:hidden">
                    <Button
                        variant="secondary"
                        fullWidth
                        icon={<Wrench size={16} />}
                        onClick={handleEscalate}
                    >
                        Escalar para Serviço de Campo
                    </Button>
                </div>

                {/* AI Context Section */}
                {selectedTicket.array_options && (selectedTicket.array_options.options_resumo_da_conversa || selectedTicket.array_options.options_resumo_vaga) && (
                    <div className="bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 border border-indigo-100 dark:border-indigo-800 p-4 rounded-xl shadow-sm">
                        <h3 className="text-sm font-bold text-indigo-900 dark:text-indigo-200 mb-3 flex items-center gap-2">
                            <Sparkles size={16} className="text-indigo-500" /> Análise de Contexto IA
                        </h3>
                        <div className="space-y-3">
                            {selectedTicket.array_options.options_resumo_da_conversa && (
                                <div>
                                    <span className="text-xs font-bold uppercase text-indigo-400 mb-1 block">Resumo da Conversa</span>
                                    <p className="text-sm text-slate-700 dark:text-slate-300 bg-white/50 dark:bg-slate-900/50 p-2 rounded border border-indigo-100 dark:border-indigo-900 whitespace-pre-wrap leading-relaxed">
                                        {selectedTicket.array_options.options_resumo_da_conversa}
                                    </p>
                                </div>
                            )}
                            {selectedTicket.array_options.options_resumo_vaga && (
                                <div>
                                    <span className="text-xs font-bold uppercase text-purple-400 mb-1 block">Resumo da Vaga</span>
                                    <p className="text-sm text-slate-700 dark:text-slate-300 bg-white/50 dark:bg-slate-900/50 p-2 rounded border border-purple-100 dark:border-purple-900 whitespace-pre-wrap leading-relaxed">
                                        {selectedTicket.array_options.options_resumo_vaga}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Additional Custom Fields */}
                {selectedTicket.array_options && (selectedTicket.array_options.options_quantidade_publico_evento || selectedTicket.array_options.options_valor_budget) && (
                    <div className="grid grid-cols-2 gap-4">
                        {selectedTicket.array_options.options_quantidade_publico_evento && (
                            <Card>
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded text-blue-600"><Users size={16} /></div>
                                    <div>
                                        <span className="text-xs text-slate-500 block">Estimativa de Público</span>
                                        <span className="font-bold text-sm dark:text-white">{selectedTicket.array_options.options_quantidade_publico_evento}</span>
                                    </div>
                                </div>
                            </Card>
                        )}
                        {selectedTicket.array_options.options_valor_budget && (
                            <Card>
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-green-50 dark:bg-green-900/30 rounded text-green-600"><DollarSign size={16} /></div>
                                    <div>
                                        <span className="text-xs text-slate-500 block">Orçamento</span>
                                        <span className="font-bold text-sm dark:text-white">{selectedTicket.array_options.options_valor_budget}</span>
                                    </div>
                                </div>
                            </Card>
                        )}
                    </div>
                )}

                {/* Chat Messages */}
                {isLoadingMessages && <div className="flex justify-center py-4"><Loader2 className="animate-spin text-slate-400" size={24} /></div>}

                {ticketMessages.map((msg, idx) => (
                    <div key={idx} className={`flex gap-3 ${msg.sender === 'agent' ? 'flex-row-reverse' : ''}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.sender === 'agent' ? 'bg-indigo-600 text-white' :
                            msg.sender === 'system' ? 'bg-slate-200 dark:bg-slate-800 text-slate-500' :
                                'bg-slate-300 dark:bg-slate-700'
                            }`}>
                            {msg.sender === 'agent' ? <UserCircle size={16} /> : msg.sender === 'system' ? <Bot size={16} /> : <User size={16} />}
                        </div>
                        <div className={`max-w-[85%] p-3 rounded-2xl text-sm whitespace-pre-wrap ${msg.sender === 'agent' ? 'bg-indigo-600 text-white rounded-tr-none' :
                            msg.sender === 'system' ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-tl-none font-mono text-xs' :
                                'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded-tl-none'
                            }`}>
                            {renderMessageContent(msg.text)}
                            <div className={`text-[10px] mt-1 opacity-70 ${msg.sender === 'agent' ? 'text-right' : ''}`}>
                                {msg.user} • {formatDateTime(msg.date)}
                            </div>
                        </div>
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>

            {/* Related Items Section */}
            {(ticketMessages.length > 0 || remoteEvents.length > 0) && (
                <div className="space-y-4 px-4 pb-2">
                    {/* Linked Events */}
                    {events.filter(e =>
                        (e.elementtype === 'ticket' && String(e.fk_element) === String(selectedTicket.id)) ||
                        (e.description && e.description.includes(selectedTicket.ref))
                    ).length > 0 && (
                            <Card>
                                <h3 className="font-bold text-slate-800 dark:text-white mb-3 flex items-center gap-2 text-sm">
                                    <Calendar size={16} className="text-blue-500" /> Eventos Agendados
                                </h3>
                                <div className="space-y-2">
                                    {events.filter(e =>
                                        (e.elementtype === 'ticket' && String(e.fk_element) === String(selectedTicket.id)) ||
                                        (e.description && e.description.includes(selectedTicket.ref))
                                    ).map(e => (
                                        <div key={e.id} className="flex justify-between items-center p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700 cursor-pointer hover:border-blue-300" onClick={() => onNavigate && onNavigate('agenda', '')}>
                                            <div>
                                                <div className="font-medium text-slate-800 dark:text-white text-xs">{e.label}</div>
                                                <div className="text-[10px] text-slate-500">{formatDateTime(e.date_start)}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </Card>
                        )}

                    {/* Linked Interventions */}
                    {interventions.filter(i =>
                        (String(i.socid) === String(selectedTicket.socid) && selectedTicket.project_id && String(i.project_id) === String(selectedTicket.project_id)) ||
                        (i.description && i.description.includes(selectedTicket.ref))
                    ).length > 0 && (
                            <Card>
                                <h3 className="font-bold text-slate-800 dark:text-white mb-3 flex items-center gap-2 text-sm">
                                    <Wrench size={16} className="text-orange-500" /> Intervenções Relacionadas
                                </h3>
                                <div className="space-y-2">
                                    {interventions.filter(i =>
                                        (String(i.socid) === String(selectedTicket.socid) && selectedTicket.project_id && String(i.project_id) === String(selectedTicket.project_id)) ||
                                        (i.description && i.description.includes(selectedTicket.ref))
                                    ).map(i => (
                                        <div key={i.id} className="flex justify-between items-center p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700 cursor-pointer hover:border-orange-300" onClick={() => onNavigate && onNavigate('interventions', i.id)}>
                                            <div>
                                                <div className="font-medium text-slate-800 dark:text-white text-xs">{i.ref}</div>
                                                <div className="text-[10px] text-slate-500">{i.description || 'Sem descrição'}</div>
                                            </div>
                                            <div className="text-[10px] text-slate-500">{formatDateOnly(i.date)}</div>
                                        </div>
                                    ))}
                                </div>
                            </Card>
                        )}
                </div>
            )}

            {/* Linked Objects */}
            <div className="px-4 pb-4">
                <LinkedObjects
                    id={selectedTicket.id}
                    type="ticket"
                    onNavigate={onNavigate}
                />
            </div>

            {/* Reply Area */}
            <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex-none">
                <div className="flex gap-2 mb-2 overflow-x-auto">
                    <button
                        onClick={handleGenerateSmartReply}
                        disabled={isGeneratingReply}
                        className="flex items-center gap-1 text-xs bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400 px-2 py-1.5 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors whitespace-nowrap border border-indigo-100 dark:border-indigo-800"
                    >
                        {isGeneratingReply ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                        Gerar Resposta IA
                    </button>
                </div>
                <div className="flex gap-2">
                    <textarea
                        className="flex-1 border rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                        placeholder="Digite sua resposta..."
                        rows={2}
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSendReply();
                            }
                        }}
                    />
                    <button
                        onClick={handleSendReply}
                        disabled={!replyText.trim() || isSendingReply}
                        className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white p-3 rounded-xl flex items-center justify-center transition-colors shadow-sm"
                    >
                        {isSendingReply ? <Loader2 className="animate-spin" size={20} /> : <Send size={20} />}
                    </button>
                </div>
            </div>
        </>
    ) : undefined;

    return (
        <>
            <div className="flex flex-col h-full">
                <div className={selectedTicket ? 'hidden lg:block' : 'block'}>
                    <PageHeader
                        title="Chamados de Suporte"
                        actions={
                            <div className="flex items-center gap-2">
                                <ListToolbar controls={controls} searchPlaceholder="Buscar chamado..." />
                                <Button onClick={() => setIsNewTicketModalOpen(true)} icon={<Plus size={18} />}>Novo</Button>
                                <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1 border border-slate-200 dark:border-slate-700">
                                    <button onClick={() => setViewMode('list')} className={`p-2 rounded ${viewMode === 'list' ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-slate-500'}`}><List size={18} /></button>
                                    <button onClick={() => setViewMode('kanban')} className={`p-2 rounded ${viewMode === 'kanban' ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-slate-500'}`}><Kanban size={18} /></button>
                                </div>
                            </div>
                        }
                        tabs={viewMode === 'list' ? (
                            <Tabs value={filterStatus} onChange={(v) => setFilterStatus(v as any)}>
                                <Tab value="all">Todos</Tab>
                                <Tab value="assigned">Atribuídos a Mim</Tab>
                                <Tab value="open">Abertos</Tab>
                                <Tab value="closed">Fechados</Tab>
                            </Tabs>
                        ) : undefined}
                    />
                </div>

                <MasterDetailLayout
                    list={renderListContent}
                    detail={renderDetail}
                    showDetail={!!selectedTicket}
                    onCloseDetail={() => setSelectedTicket(null)}
                />
            </div>

            {/* Create Ticket Modal */}
            <Modal
                isOpen={isNewTicketModalOpen}
                onClose={() => setIsNewTicketModalOpen(false)}
                title="Novo Chamado"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsNewTicketModalOpen(false)}>Cancelar</Button>
                        <Button loading={isSubmittingTicket} onClick={handleCreateTicket}>Criar</Button>
                    </>
                }
            >
                <div className="space-y-4">
                    <Input placeholder="Assunto" value={newTicketForm.subject} onChange={e => setNewTicketForm({ ...newTicketForm, subject: e.target.value })} />
                    <textarea className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" placeholder="Mensagem" value={newTicketForm.message} onChange={e => setNewTicketForm({ ...newTicketForm, message: e.target.value })} />
                </div>
            </Modal>

            {/* Edit Ticket Modal (#57/#78) */}
            <Modal
                isOpen={isEditTicketModalOpen}
                onClose={() => setIsEditTicketModalOpen(false)}
                title="Editar Chamado"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsEditTicketModalOpen(false)}>Cancelar</Button>
                        <Button loading={isSavingEditTicket} onClick={handleEditTicket}>Salvar</Button>
                    </>
                }
            >
                <div className="space-y-4">
                    <Input placeholder="Assunto" value={editTicketForm.subject} onChange={e => setEditTicketForm({ ...editTicketForm, subject: e.target.value })} />
                    <textarea className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" placeholder="Mensagem" value={editTicketForm.message} onChange={e => setEditTicketForm({ ...editTicketForm, message: e.target.value })} />
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Gravidade</label>
                        <select className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={editTicketForm.severity_code} onChange={e => setEditTicketForm({ ...editTicketForm, severity_code: e.target.value })}>
                            <option value="LOW">Baixa</option>
                            <option value="NORMAL">Normal</option>
                            <option value="HIGH">Alta</option>
                            <option value="BLOCKING">Bloqueante</option>
                        </select>
                    </div>
                </div>
            </Modal>

            {/* Escalation Modal */}
            <Modal
                isOpen={isEscalateModalOpen}
                onClose={() => setIsEscalateModalOpen(false)}
                title={<span className="flex items-center gap-2"><Wrench size={18} className="text-orange-500" /> Escalar para Intervenção</span>}
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsEscalateModalOpen(false)}>Cancelar</Button>
                        <Button loading={isEscalating} icon={<ClipboardList size={16} />} onClick={submitEscalation}>Criar Intervenção</Button>
                    </>
                }
            >
                <div className="space-y-4">
                    <p className="text-sm text-slate-500 dark:text-slate-400">Isso criará uma nova Intervenção de Serviço de Campo vinculada ao cliente deste chamado.</p>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Data</label>
                        <Input type="date" value={escalateForm.date} onChange={e => setEscalateForm({ ...escalateForm, date: e.target.value })} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Descrição do Trabalho</label>
                        <textarea className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white h-32 resize-none" value={escalateForm.description} onChange={e => setEscalateForm({ ...escalateForm, description: e.target.value })} required />
                    </div>
                </div>
            </Modal>
        </>
    );
};

export default TicketList;
