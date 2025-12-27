import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Ticket, ThirdParty, DolibarrUser, DolibarrConfig, AppView, AgendaEvent, Project } from '../types';
import { Ticket as TicketIcon, Search, AlertCircle, Clock, Calendar, CheckCircle2, User, ExternalLink, MessageSquare, Send, ArrowLeft, X, UserCircle, Sparkles, Loader2, List, Kanban, Plus, ArrowDown, ArrowUp, DollarSign, Users, Info, Phone, Bot, FileText, FolderKanban, ClipboardList, Wrench } from 'lucide-react';
import { AiService } from '../services/aiService';
import { DolibarrService } from '../services/dolibarrService';
import { useDolibarr } from '../context/DolibarrContext';
import { useTickets, useCustomers, useUsers, useEvents, useProjects, useInterventions } from '../hooks/dolibarr';
import { LinkedObjects } from './common/LinkedObjects';
import { formatDateOnly, formatDateTime } from '../utils/dateUtils';

interface TicketListProps {
    onNavigate?: (view: AppView, id: string) => void;
    onRefresh?: () => void;
}

const TicketList: React.FC<TicketListProps> = ({ onNavigate, onRefresh }) => {
    const { config } = useDolibarr();
    const { data: ticketsData } = useTickets(config);
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

    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'closed' | 'assigned'>('all');
    const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
    const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
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

    // Escalation State
    const [isEscalateModalOpen, setIsEscalateModalOpen] = useState(false);
    const [escalateForm, setEscalateForm] = useState({ description: '', date: new Date().toISOString().split('T')[0] });
    const [isEscalating, setIsEscalating] = useState(false);

    // Initialize Messages
    useEffect(() => {
        setLocalHistory([]);
        setReplyText('');

        // Load remote messages when ticket selected
        if (selectedTicket) {
            setIsLoadingMessages(true);
            DolibarrService.fetchTicketEvents(config, selectedTicket.id)
                .then(evts => setRemoteEvents(evts))
                .catch(e => console.error("Error loading ticket history", e))
                .finally(() => setIsLoadingMessages(false));
        } else {
            setRemoteEvents([]);
        }
    }, [selectedTicket, config]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [selectedTicket, localHistory, remoteEvents]);

    // Robust Customer Name Resolution
    const getCustomerName = (ticket: Ticket) => {
        // 1. Try to find customer by socid
        const c = customers.find(cust => String(cust.id) === String(ticket.socid));
        if (c) return c.name;

        // 2. Fallback to origin_email if available
        if (ticket.origin_email && ticket.origin_email.trim()) {
            return ticket.origin_email;
        }

        // 3. Fallback to Subject extraction (heuristic) if name is in subject
        // Example Subject: "Léo Fortes - 5511954982125"
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

    // Helper to resolve User ID to Name
    const resolveUserName = (authorId: string) => {
        if (!authorId || authorId === 'System') return 'Sistema';
        // Try finding in users list
        const user = users.find(u => String(u.id) === String(authorId));
        if (user) return `${user.firstname || ''} ${user.lastname || ''}`.trim() || user.login;

        // Fallback: If ID looks like a number but not found, return generic "Agent" or keep ID
        if (!isNaN(Number(authorId))) return `Usuário ${authorId}`;

        return authorId;
    };

    const filteredTickets = useMemo(() => {
        let result = tickets.filter(t => {
            const matchesSearch = t.ref.toLowerCase().includes(searchTerm.toLowerCase()) ||
                t.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (t.origin_email && t.origin_email.toLowerCase().includes(searchTerm.toLowerCase()));

            if (viewMode === 'kanban') return matchesSearch;

            // Status Logic based on JSON analysis
            // "1" = New/Unread, "5" = In Progress, "8" = Closed/Resolved
            const isClosed = t.statut === '8' || t.statut === 'CLOSED' || t.statut === 'RESOLVED';

            if (filterStatus === 'open') return matchesSearch && !isClosed;
            if (filterStatus === 'closed') return matchesSearch && isClosed;
            if (filterStatus === 'assigned') {
                // Check if ticket is assigned to current user using fk_user_assign
                // Note: The API response might maintain this in different fields, but standard is fk_user_assign
                // If it's undefined, we fallback to no match
                return matchesSearch && !isClosed && (String(t.fk_user_assign) === String(config?.currentUser?.id));
            }
            return matchesSearch;
        });

        return result.sort((a, b) => {
            return sortOrder === 'desc' ? b.date_c - a.date_c : a.date_c - b.date_c;
        });
    }, [tickets, searchTerm, filterStatus, viewMode, sortOrder, config]);

    const ticketMessages = useMemo(() => {
        if (!selectedTicket) return [];

        let messages: any[] = [];

        // Initial Message
        messages.push({
            id: 'original',
            text: selectedTicket.message,
            date: selectedTicket.date_c,
            sender: 'customer',
            user: getCustomerName(selectedTicket),
            type: 'message'
        });

        // Remote History
        remoteEvents.forEach(evt => {
            // Identify if it's a system log or actual message
            // If label exists but text is empty, or if type code indicates auto
            const isSystem = evt.type?.includes('AUTO') || (!evt.message && evt.label);

            messages.push({
                id: evt.id,
                // Detailed text is usually in note_private (for emails/chats) or description. 
                // Fallback to label if detailed text is missing.
                text: evt.note_private || evt.description || evt.note || evt.message || evt.label,
                date: evt.datep || evt.date, // API returns datep
                sender: isSystem ? 'system' : 'agent',
                user: resolveUserName(evt.authorid || evt.author), // API returns authorid
                type: isSystem ? 'log' : 'message'
            });
        });

        // Local History (Optimistic)
        messages = [...messages, ...localHistory];

        // Sort chronological
        return messages.sort((a, b) => (a.date || 0) - (b.date || 0));
    }, [selectedTicket, localHistory, remoteEvents]);

    const handleSendReply = async () => {
        if (!replyText.trim() || !selectedTicket) return;
        setIsSendingReply(true);

        try {
            // API Call (Use track_id if available, fallback to id)
            const targetId = selectedTicket.track_id || selectedTicket.id;
            await DolibarrService.addTicketMessage(config, targetId, replyText);

            // Optimistic UI update
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

            // Optional refresh logic could go here
        } catch (e) {
            console.error("Failed to send reply", e);
            alert("Falha ao enviar mensagem. Verifique o console.");
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
        } catch (e) { console.error(e); } finally { setIsGeneratingReply(false); }
    };

    const handleCreateTicket = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmittingTicket(true);
        try {
            await DolibarrService.createTicket(config, newTicketForm);
            setIsNewTicketModalOpen(false);
            setNewTicketForm({ subject: '', message: '', socid: '', severity_code: 'NORMAL', type_code: 'ISSUE' });
            if (onRefresh) onRefresh();
        } catch (e) { console.error(e); } finally { setIsSubmittingTicket(false); }
    };

    const handleEscalate = () => {
        if (!selectedTicket) return;
        setEscalateForm({
            description: `[Escalada do Chamado ${selectedTicket.ref}]\nAssunto: ${selectedTicket.subject}\n\n${selectedTicket.message.substring(0, 500)}...`,
            date: new Date().toISOString().split('T')[0]
        });
        setIsEscalateModalOpen(true);
    };

    const submitEscalation = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedTicket) return;
        setIsEscalating(true);
        try {
            await DolibarrService.createIntervention(config, {
                socid: selectedTicket.socid,
                fk_project: selectedTicket.project_id,
                date: new Date(escalateForm.date).getTime() / 1000,
                description: escalateForm.description
            });
            alert("Intervenção Criada com Sucesso");
            setIsEscalateModalOpen(false);

            // Optionally add a note to the ticket
            await DolibarrService.addTicketMessage(config, selectedTicket.track_id || selectedTicket.id, "Chamado escalado para Intervenção de Serviço de Campo.");

            if (onRefresh) onRefresh();
        } catch (e: any) {
            console.error(e);
            alert(`Falha na escalação: ${e.message}`);
        } finally {
            setIsEscalating(false);
        }
    };

    const getStatusBadge = (status: string) => {
        const s = status?.toUpperCase() || '';
        // Map API numeric codes
        if (s === '1') return <span className="flex items-center gap-1 text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200"><AlertCircle size={10} /> Novo</span>;
        if (s === '5') return <span className="flex items-center gap-1 text-[10px] font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full border border-orange-200"><Clock size={10} /> Em Progresso</span>;
        if (s === '8' || s === 'CLOSED' || s === 'RESOLVED') return <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200"><CheckCircle2 size={10} /> Fechado</span>;

        return <span className="flex items-center gap-1 text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">{s}</span>;
    };

    // Helper to safely render content (handle HTML if present)
    const renderMessageContent = (text: string) => {
        if (!text) return <span className="italic text-slate-400">Sem conteúdo</span>;

        // Simple check for HTML tags
        if (text.includes('<') && text.includes('>')) {
            // If it looks like HTML, use dangerouslySetInnerHTML but wrap in a container
            // In a real app, use a sanitizer library like DOMPurify
            return <div className="prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: text }} />;
        }
        return <p className="whitespace-pre-wrap leading-relaxed">{text}</p>;
    };

    // Kanban Columns
    const kanbanColumns = [
        { id: '1', title: 'Novo', color: 'blue' },
        { id: '5', title: 'Em Progresso', color: 'orange' },
        { id: '8', title: 'Resolvido', color: 'emerald' }
    ];

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 transition-colors">

            {/* Create Ticket Modal */}
            {isNewTicketModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl p-6 w-full max-w-md">
                        <h3 className="text-lg font-bold mb-4 dark:text-white">Novo Chamado</h3>
                        <div className="space-y-4">
                            <input className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" placeholder="Assunto" value={newTicketForm.subject} onChange={e => setNewTicketForm({ ...newTicketForm, subject: e.target.value })} />
                            <textarea className="w-full p-2 border rounded dark:bg-slate-800 dark:border-slate-700 dark:text-white" placeholder="Mensagem" value={newTicketForm.message} onChange={e => setNewTicketForm({ ...newTicketForm, message: e.target.value })} />
                            <div className="flex justify-end gap-2">
                                <button onClick={() => setIsNewTicketModalOpen(false)} className="px-4 py-2 text-slate-500 hover:text-slate-700">Cancelar</button>
                                <button onClick={handleCreateTicket} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded">Criar</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Escalation Modal */}
            {isEscalateModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg border border-slate-200 dark:border-slate-800 animate-in zoom-in-95">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 rounded-t-xl">
                            <h3 className="font-bold text-lg dark:text-white flex items-center gap-2">
                                <Wrench size={18} className="text-orange-500" /> Escalar para Intervenção
                            </h3>
                            <button onClick={() => setIsEscalateModalOpen(false)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"><X size={20} /></button>
                        </div>
                        <form onSubmit={submitEscalation} className="p-6 space-y-4">
                            <p className="text-sm text-slate-500 dark:text-slate-400">Isso criará uma nova Intervenção de Serviço de Campo vinculada ao cliente deste chamado.</p>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Data</label>
                                <input
                                    type="date"
                                    className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                    value={escalateForm.date}
                                    onChange={e => setEscalateForm({ ...escalateForm, date: e.target.value })}
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Descrição do Trabalho</label>
                                <textarea
                                    className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white h-32 resize-none"
                                    value={escalateForm.description}
                                    onChange={e => setEscalateForm({ ...escalateForm, description: e.target.value })}
                                    required
                                />
                            </div>
                            <div className="flex justify-end gap-3 pt-2">
                                <button type="button" onClick={() => setIsEscalateModalOpen(false)} className="px-4 py-2 text-slate-500 hover:text-slate-700 font-medium">Cancelar</button>
                                <button type="submit" disabled={isEscalating} className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-medium shadow-sm flex items-center gap-2">
                                    {isEscalating ? <Loader2 className="animate-spin" size={16} /> : <ClipboardList size={16} />} Criar Intervenção
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Header */}
            <div className="p-4 md:p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex-none">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                    <div><h2 className="text-2xl font-bold text-slate-800 dark:text-white">Chamados de Suporte</h2></div>
                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input className="pl-10 pr-4 py-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" placeholder="Buscar..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                        </div>

                        {/* Sort Button */}
                        <button
                            onClick={() => setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
                            className={`p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center gap-1 text-sm font-medium`}
                            title={sortOrder === 'desc' ? "Mais recentes" : "Mais antigos"}
                        >
                            {sortOrder === 'desc' ? <ArrowDown size={18} /> : <ArrowUp size={18} />}
                        </button>

                        <button onClick={() => setIsNewTicketModalOpen(true)} className={`p-2 bg-${config.themeColor}-600 hover:bg-${config.themeColor}-700 text-white rounded-lg`}><Plus size={20} /></button>
                        <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1 border border-slate-200 dark:border-slate-700">
                            <button onClick={() => setViewMode('list')} className={`p-2 rounded ${viewMode === 'list' ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-slate-500'}`}><List size={18} /></button>
                            <button onClick={() => setViewMode('kanban')} className={`p-2 rounded ${viewMode === 'kanban' ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-slate-500'}`}><Kanban size={18} /></button>
                        </div>
                    </div>
                </div>
                {viewMode === 'list' && (
                    <div className="flex gap-2 border-b border-slate-100 dark:border-slate-800">
                        <button onClick={() => setFilterStatus('all')} className={`pb-2 px-3 border-b-2 text-sm font-medium ${filterStatus === 'all' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500'}`}>Todos</button>
                        <button onClick={() => setFilterStatus('assigned')} className={`pb-2 px-3 border-b-2 text-sm font-medium ${filterStatus === 'assigned' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500'}`}>Atribuídos a Mim</button>
                        <button onClick={() => setFilterStatus('open')} className={`pb-2 px-3 border-b-2 text-sm font-medium ${filterStatus === 'open' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500'}`}>Abertos</button>
                        <button onClick={() => setFilterStatus('closed')} className={`pb-2 px-3 border-b-2 text-sm font-medium ${filterStatus === 'closed' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500'}`}>Fechados</button>
                    </div>
                )}
            </div>

            <div className="flex-1 min-h-0 flex overflow-hidden">
                {/* Ticket List */}
                <div className={`flex-1 overflow-y-auto p-4 md:p-6 ${selectedTicket ? 'hidden lg:block lg:w-1/3 xl:w-1/4 border-r border-slate-200 dark:border-slate-800' : 'w-full'}`}>
                    {viewMode === 'list' ? (
                        <div className="space-y-3">
                            {filteredTickets.map(t => (
                                <div key={t.id} onClick={() => setSelectedTicket(t)} className={`bg-white dark:bg-slate-900 p-4 rounded-xl border cursor-pointer transition-all ${selectedTicket?.id === t.id ? `border-${config.themeColor}-500 ring-1 ring-${config.themeColor}-500 shadow-sm` : 'border-slate-200 dark:border-slate-800 hover:shadow-md'}`}>
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
                                        {getStatusBadge(t.statut)}
                                    </div>
                                    <h4 className="font-bold text-sm mb-1 line-clamp-1 dark:text-white">{t.subject}</h4>
                                    <div className="text-xs text-slate-500 flex justify-between items-center mt-2">
                                        <span
                                            className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (onNavigate) onNavigate('customers', t.socid);
                                            }}
                                        >
                                            {getCustomerName(t)}
                                        </span>
                                        <span className="text-xs text-slate-500">{formatDateTime(t.date_c)}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="flex gap-4 overflow-x-auto h-full pb-4">
                            {kanbanColumns.map(col => (
                                <div key={col.id} className="min-w-[280px] bg-slate-100 dark:bg-slate-900/50 rounded-xl p-3 h-full overflow-y-auto border border-slate-200 dark:border-slate-800">
                                    <div className="font-bold mb-3 text-slate-700 dark:text-slate-300">{col.title}</div>
                                    {filteredTickets.filter(t => t.statut === col.id).map(t => (
                                        <div key={t.id} onClick={() => setSelectedTicket(t)} className="bg-white dark:bg-slate-800 p-3 rounded-lg mb-2 cursor-pointer shadow-sm border border-slate-200 dark:border-slate-700 hover:shadow-md">
                                            <div className="flex justify-between items-center mb-1">
                                                <div className="text-xs text-slate-400">{t.ref}</div>
                                                {t.category_code === 'IA_CHAT' && <Bot size={12} className="text-indigo-400" />}
                                            </div>
                                            <div className="font-medium text-sm text-slate-800 dark:text-white line-clamp-2">{t.subject}</div>
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Ticket Detail */}
                <div className={`flex-1 bg-white dark:bg-slate-900 flex flex-col ${selectedTicket ? 'block absolute inset-0 z-20 lg:static lg:inset-auto' : 'hidden lg:flex lg:items-center lg:justify-center'}`}>
                    {selectedTicket ? (
                        <>
                            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-900">
                                <div className="flex items-center gap-3">
                                    <button onClick={() => setSelectedTicket(null)} className="lg:hidden p-2 -ml-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"><ArrowLeft size={20} /></button>
                                    <div>
                                        <h2 className="text-lg font-bold dark:text-white flex items-center gap-2">
                                            {selectedTicket.ref}
                                            {getStatusBadge(selectedTicket.statut)}
                                        </h2>
                                        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mt-1">
                                            <span
                                                className="text-xs text-slate-500 flex items-center gap-1 cursor-pointer hover:underline hover:text-indigo-600 dark:hover:text-indigo-400"
                                                onClick={() => onNavigate && onNavigate('customers', selectedTicket.socid)}
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
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={handleEscalate}
                                        className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 text-xs font-medium rounded-lg hover:bg-orange-200 dark:hover:bg-orange-900/50 transition-colors"
                                        title="Criar Intervenção de Campo"
                                    >
                                        <Wrench size={14} /> Escalar
                                    </button>
                                    <button onClick={() => setSelectedTicket(null)} className="hidden lg:block p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50 dark:bg-slate-950/50">

                                {/* Mobile Escalate Button */}
                                <div className="lg:hidden">
                                    <button
                                        onClick={handleEscalate}
                                        className="w-full flex items-center justify-center gap-2 p-3 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 text-sm font-medium rounded-lg mb-2"
                                    >
                                        <Wrench size={16} /> Escalar para Serviço de Campo
                                    </button>
                                </div>

                                {/* AI Context Section - Highlights from Array Options */}
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
                                            <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center gap-3">
                                                <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded text-blue-600"><Users size={16} /></div>
                                                <div>
                                                    <span className="text-xs text-slate-500 block">Estimativa de Público</span>
                                                    <span className="font-bold text-sm dark:text-white">{selectedTicket.array_options.options_quantidade_publico_evento}</span>
                                                </div>
                                            </div>
                                        )}
                                        {selectedTicket.array_options.options_valor_budget && (
                                            <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center gap-3">
                                                <div className="p-2 bg-green-50 dark:bg-green-900/30 rounded text-green-600"><DollarSign size={16} /></div>
                                                <div>
                                                    <span className="text-xs text-slate-500 block">Orçamento</span>
                                                    <span className="font-bold text-sm dark:text-white">{selectedTicket.array_options.options_valor_budget}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Chat Messages */}
                                {isLoadingMessages && <div className="flex justify-center py-4"><Loader2 className="animate-spin text-slate-400" size={24} /></div>}

                                {ticketMessages.map((msg, idx) => (
                                    <div key={idx} className={`flex gap-3 ${msg.sender === 'agent' ? 'flex-row-reverse' : ''}`}>
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.sender === 'agent' ? `bg-${config.themeColor}-600 text-white` :
                                            msg.sender === 'system' ? 'bg-slate-200 dark:bg-slate-800 text-slate-500' :
                                                'bg-slate-300 dark:bg-slate-700'
                                            }`}>
                                            {msg.sender === 'agent' ? <UserCircle size={16} /> : msg.sender === 'system' ? <Bot size={16} /> : <User size={16} />}
                                        </div>
                                        <div className={`max-w-[85%] p-3 rounded-2xl text-sm whitespace-pre-wrap ${msg.sender === 'agent' ? `bg-${config.themeColor}-600 text-white rounded-tr-none` :
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
                                <div className="space-y-4">
                                    {/* Linked Events */}
                                    {events.filter(e =>
                                        (e.elementtype === 'ticket' && String(e.fk_element) === String(selectedTicket.id)) ||
                                        (e.description && e.description.includes(selectedTicket.ref))
                                    ).length > 0 && (
                                            <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
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
                                            </div>
                                        )}

                                    {/* Linked Interventions (By Customer + Project Heuristic or Explicit if available in future) */}
                                    {interventions.filter(i =>
                                        (String(i.socid) === String(selectedTicket.socid) && selectedTicket.project_id && String(i.project_id) === String(selectedTicket.project_id)) ||
                                        (i.description && i.description.includes(selectedTicket.ref))
                                    ).length > 0 && (
                                            <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
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
                                            </div>
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
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-slate-400">
                            <TicketIcon size={48} className="mb-4 opacity-50" />
                            <p>Selecione um chamado para ver detalhes.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default TicketList;
