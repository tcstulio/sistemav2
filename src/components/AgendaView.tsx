import React, { useState, useMemo } from 'react';
import { AgendaEvent, AppView } from '../types';
import { CalendarDays, Clock, FolderKanban, ClipboardList, ChevronRight, CheckCircle2, Circle, Settings2, Bot, List, Calendar as CalendarIcon, ChevronLeft, Plus, Loader2, X, Phone, Mail, Users, ShoppingCart, FileSignature, Ticket as TicketIcon } from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { useDolibarr } from '../context/DolibarrContext';
import { useEvents } from '../hooks/dolibarr/useEvents';
import { useTasks } from '../hooks/dolibarr/useTasks';
import { useInterventions } from '../hooks/dolibarr/useInterventions';
import { useProjects } from '../hooks/dolibarr/useProjects';

interface AgendaViewProps {
    onNavigate?: (view: AppView, id: string) => void;
}

interface AgendaItem {
    id: string;
    type: 'event' | 'task' | 'intervention' | 'project_deadline' | 'system_log';
    subType?: string; // AC_TEL, AC_RDV, etc.
    title: string;
    date: number; // Timestamp for sorting
    endDate?: number;
    description?: string;
    status?: string;
    ref?: string;
    parentRef?: string; // Project Ref or Customer Name
    contextId?: string; // ID to navigate to
    contextView?: AppView; // View to navigate to
}

const AgendaView: React.FC<AgendaViewProps> = ({ onNavigate }) => {
    const { config, refreshData } = useDolibarr();

    const { data: events = [], isLoading: isLoadingEvents } = useEvents(config || null, !!config);
    const { data: tasks = [], isLoading: isLoadingTasks } = useTasks(config || null, !!config);
    const { data: interventions = [], isLoading: isLoadingInterventions } = useInterventions(config || null, !!config);
    const { data: projects = [], isLoading: isLoadingProjects } = useProjects(config || null, !!config);

    const isLoading = isLoadingEvents || isLoadingTasks || isLoadingInterventions || isLoadingProjects;

    const [filterType, setFilterType] = useState<'all' | 'event' | 'task' | 'deadline'>('all');
    const [showSystemEvents, setShowSystemEvents] = useState(false);
    const [viewMode, setViewMode] = useState<'list' | 'calendar'>('calendar');
    const [currentDate, setCurrentDate] = useState(new Date());

    // Event Creation State
    const [isEventModalOpen, setIsEventModalOpen] = useState(false);
    const [newEventForm, setNewEventForm] = useState({
        label: '',
        date_start: '',
        date_end: '',
        type_code: 'AC_RDV',
        description: ''
    });
    const [isSubmittingEvent, setIsSubmittingEvent] = useState(false);

    // Helper to detect if an event is a system log
    const isSystemLog = (event: AgendaEvent): boolean => {
        const code = event.type_code?.toUpperCase() || '';
        // Common manual codes
        if (['AC_RDV', 'AC_TEL', 'AC_EMAIL', 'AC_MEETING', 'AC_OTH'].includes(code)) return false;

        // System modification/creation patterns
        if (code.includes('_MODIFY') || code.includes('_CREATE') || code.includes('_DELETE') || code.includes('_VALIDATE')) return true;

        // Common system codes (Proposal, Invoice, Order, etc creation)
        if (code.startsWith('AC_PROP') || code.startsWith('AC_FAC') || code.startsWith('AC_COM') || code.startsWith('AC_OTH')) return true;

        // Fallback: If description contains "Auto-generated"
        if (event.description?.toLowerCase().includes('auto-generated')) return true;
        return false;
    };

    // Determine context link from event properties
    const getContextLink = (event: AgendaEvent): { view: AppView, id: string } | null => {
        if (event.project_id) return { view: 'projects', id: event.project_id };
        if (event.elementtype === 'ticket' && event.fk_element) return { view: 'tickets', id: event.fk_element };
        if (event.elementtype === 'propal' && event.fk_element) return { view: 'proposals', id: event.fk_element };
        if (event.elementtype === 'commande' && event.fk_element) return { view: 'orders', id: event.fk_element };
        if (event.elementtype === 'facture' && event.fk_element) return { view: 'invoices', id: event.fk_element };
        if (event.elementtype === 'contrat' && event.fk_element) return { view: 'contracts', id: event.fk_element };
        if (event.socid) return { view: 'customers', id: event.socid };
        return null;
    };

    // Consolidate all time-based items into a single list
    const consolidatedItems = useMemo(() => {
        const items: AgendaItem[] = [];

        // 1. Events
        events.forEach(e => {
            const isLog = isSystemLog(e);

            if (isLog && !showSystemEvents) return; // Skip logs if hidden

            const context = getContextLink(e);

            items.push({
                id: `evt-${e.id}`,
                type: isLog ? 'system_log' : 'event',
                subType: e.type_code,
                title: e.label,
                date: e.date_start, // Hooks already return MS
                endDate: e.date_end ? e.date_end : undefined,
                description: e.description,
                status: e.percentage === 100 ? 'done' : 'todo',
                ref: e.id,
                parentRef: e.location,
                contextId: context?.id,
                contextView: context?.view
            });
        });

        // 2. Tasks (Start Dates)
        tasks.forEach(t => {
            if (t.date_start) {
                items.push({
                    id: `tsk-${t.id}`,
                    type: 'task',
                    title: t.label,
                    date: t.date_start, // Hooks already return MS
                    endDate: t.date_end ? t.date_end : undefined,
                    description: t.description,
                    status: t.progress === 100 ? 'done' : 'todo',
                    ref: t.ref,
                    parentRef: `Projeto ${t.project_id}`,
                    contextId: t.project_id,
                    contextView: 'projects'
                });
            }
        });

        // 3. Interventions
        interventions.forEach(i => {
            items.push({
                id: `int-${i.id}`,
                type: 'intervention',
                title: `Intervenção ${i.ref}`,
                date: i.date, // Hooks already return MS
                description: i.description,
                status: i.statut === '2' ? 'done' : 'todo',
                ref: i.ref,
                contextId: i.project_id,
                contextView: 'interventions'
            });
        });

        // 4. Projects (End Dates/Deadlines)
        projects.forEach(p => {
            if (p.date_end) {
                items.push({
                    id: `prj-${p.id}`,
                    type: 'project_deadline',
                    title: `Prazo: ${p.title}`,
                    date: p.date_end, // Hooks already return MS
                    status: p.statut === '2' ? 'done' : 'todo',
                    ref: p.ref,
                    contextId: p.id,
                    contextView: 'projects'
                });
            }
        });

        // Sort by Date
        return items.sort((a, b) => a.date - b.date);
    }, [events, tasks, interventions, projects, showSystemEvents]);

    // Apply Filter Type
    const filteredItems = useMemo(() => {
        return consolidatedItems.filter(item => {
            if (filterType === 'all') return true;
            if (filterType === 'event') return item.type === 'event' || item.type === 'system_log';
            if (filterType === 'task') return item.type === 'task';
            if (filterType === 'deadline') return item.type === 'project_deadline' || item.type === 'intervention';
            return true;
        });
    }, [consolidatedItems, filterType]);

    // Group by Date String for List View
    const groupedItems = useMemo(() => {
        const groups: Record<string, AgendaItem[]> = {};
        const now = new Date();
        now.setHours(0, 0, 0, 0);

        filteredItems.forEach(item => {
            const dateObj = new Date(item.date);
            const dateKey = dateObj.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

            if (!groups[dateKey]) groups[dateKey] = [];
            groups[dateKey].push(item);
        });
        return groups;
    }, [filteredItems]);

    // Calendar Logic
    const calendarDays = useMemo(() => {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();

        const firstDayOfMonth = new Date(year, month, 1);
        const lastDayOfMonth = new Date(year, month + 1, 0);

        const daysInMonth = lastDayOfMonth.getDate();
        const startingDayOfWeek = firstDayOfMonth.getDay(); // 0 = Sunday

        const days: { day: number | null, items: AgendaItem[], dateStr: string }[] = [];

        // Previous month filler
        for (let i = 0; i < startingDayOfWeek; i++) {
            days.push({ day: null, items: [], dateStr: '' });
        }

        // Current month days
        for (let i = 1; i <= daysInMonth; i++) {
            const currentDayDate = new Date(year, month, i);
            // Normalize time for comparison (optional but safer)
            const itemsForDay = filteredItems.filter(item => {
                const d = new Date(item.date);
                return d.getDate() === i && d.getMonth() === month && d.getFullYear() === year;
            });

            days.push({
                day: i,
                items: itemsForDay,
                dateStr: currentDayDate.toISOString()
            });
        }

        return days;
    }, [currentDate, filteredItems]);

    const getIcon = (item: AgendaItem) => {
        if (item.type === 'event') {
            if (item.subType === 'AC_TEL') return <Phone size={16} className="text-blue-500" />;
            if (item.subType === 'AC_EMAIL') return <Mail size={16} className="text-sky-500" />;
            if (item.subType === 'AC_RDV' || item.subType === 'AC_MEETING') return <Users size={16} className="text-indigo-500" />;
            if (item.contextView === 'orders') return <ShoppingCart size={16} className="text-orange-500" />;
            if (item.contextView === 'proposals') return <FileSignature size={16} className="text-blue-500" />;
            if (item.contextView === 'tickets') return <TicketIcon size={16} className="text-purple-500" />;
            return <CalendarDays size={16} className="text-blue-500" />;
        }
        if (item.type === 'task') return <Clock size={16} className="text-orange-500" />;
        if (item.type === 'intervention') return <ClipboardList size={16} className="text-purple-500" />;
        if (item.type === 'project_deadline') return <FolderKanban size={16} className="text-red-500" />;
        if (item.type === 'system_log') return <Bot size={16} className="text-slate-400" />;
        return <Circle size={16} />;
    };

    const handleItemClick = (item: AgendaItem) => {
        // Navigate to dedicated Agenda Entry Panel for ALL items
        if (onNavigate) {
            onNavigate('agenda', item.id);
        }
    };

    const handleCreateEvent = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newEventForm.label || !newEventForm.date_start || !config) return;

        setIsSubmittingEvent(true);
        try {
            await DolibarrService.createEvent(config, {
                label: newEventForm.label,
                date_start: new Date(newEventForm.date_start).getTime(),
                date_end: newEventForm.date_end ? new Date(newEventForm.date_end).getTime() : undefined,
                type_code: newEventForm.type_code,
                description: newEventForm.description,
                percentage: 0
            });
            alert("Evento criado com sucesso (Mock)");
            setIsEventModalOpen(false);
            setNewEventForm({ label: '', date_start: '', date_end: '', type_code: 'AC_RDV', description: '' });
            refreshData();
        } catch (e) {
            console.error(e);
        } finally {
            setIsSubmittingEvent(false);
        }
    };

    const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
    const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
    const today = () => setCurrentDate(new Date());

    if (!config) {
        return (
            <div className="flex items-center justify-center p-20 text-slate-400">
                <p>Carregando configurações...</p>
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 transition-colors relative">

            {/* Create Event Modal */}
            {isEventModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md border border-slate-200 dark:border-slate-800 animate-in zoom-in-95">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 rounded-t-xl">
                            <h3 className="font-bold text-lg dark:text-white flex items-center gap-2">
                                <CalendarDays size={18} className="text-indigo-600" /> Novo Evento na Agenda
                            </h3>
                            <button onClick={() => setIsEventModalOpen(false)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleCreateEvent} className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Assunto</label>
                                <input type="text" className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" required value={newEventForm.label} onChange={e => setNewEventForm({ ...newEventForm, label: e.target.value })} placeholder="Título da reunião" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Início</label>
                                    <input type="datetime-local" className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" required value={newEventForm.date_start} onChange={e => setNewEventForm({ ...newEventForm, date_start: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Fim</label>
                                    <input type="datetime-local" className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={newEventForm.date_end} onChange={e => setNewEventForm({ ...newEventForm, date_end: e.target.value })} />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo</label>
                                <select className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={newEventForm.type_code} onChange={e => setNewEventForm({ ...newEventForm, type_code: e.target.value })}>
                                    <option value="AC_RDV">Reunião (Rendez-vous)</option>
                                    <option value="AC_TEL">Chamada Telefônica</option>
                                    <option value="AC_EMAIL">Email</option>
                                    <option value="AC_OTH">Outro</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Descrição</label>
                                <textarea className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white h-24 resize-none" value={newEventForm.description} onChange={e => setNewEventForm({ ...newEventForm, description: e.target.value })} placeholder="Notas..." />
                            </div>
                            <div className="flex justify-end gap-3 pt-4">
                                <button type="button" onClick={() => setIsEventModalOpen(false)} className="px-4 py-2 text-slate-500 hover:text-slate-700 font-medium">Cancelar</button>
                                <button type="submit" disabled={isSubmittingEvent} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium shadow-sm flex items-center gap-2">
                                    {isSubmittingEvent ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />} Criar Evento
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Header */}
            <div className="p-4 md:p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex-none">
                <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 mb-2">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Agenda Global</h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400">Cronograma mestre de eventos, tarefas e prazos</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        {/* Filters */}
                        <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1 border border-slate-200 dark:border-slate-700 overflow-x-auto">
                            <button onClick={() => setFilterType('all')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${filterType === 'all' ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>
                                Todos
                            </button>
                            <button onClick={() => setFilterType('event')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${filterType === 'event' ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>
                                <span className="w-2 h-2 rounded-full bg-blue-500"></span> Eventos
                            </button>
                            <button onClick={() => setFilterType('task')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${filterType === 'task' ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>
                                <span className="w-2 h-2 rounded-full bg-orange-500"></span> Tarefas
                            </button>
                            <button onClick={() => setFilterType('deadline')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${filterType === 'deadline' ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>
                                <span className="w-2 h-2 rounded-full bg-red-500"></span> Prazos
                            </button>
                        </div>

                        <label className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400 cursor-pointer bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
                            <input
                                type="checkbox"
                                checked={showSystemEvents}
                                onChange={(e) => setShowSystemEvents(e.target.checked)}
                                className="rounded text-indigo-600 focus:ring-indigo-500"
                            />
                            <Settings2 size={14} />
                            Logs
                        </label>

                        <div className="h-6 w-px bg-slate-200 dark:bg-slate-700 mx-1 hidden sm:block"></div>

                        <button
                            onClick={() => setIsEventModalOpen(true)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 bg-${config.themeColor}-600 hover:bg-${config.themeColor}-700 text-white rounded-lg text-sm font-medium shadow-sm transition-colors`}
                        >
                            <Plus size={16} /> <span className="hidden sm:inline">Novo Evento</span>
                        </button>

                        {/* View Toggle */}
                        <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1 border border-slate-200 dark:border-slate-700">
                            <button
                                onClick={() => setViewMode('list')}
                                className={`p-1.5 rounded-md transition-all ${viewMode === 'list' ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'}`}
                                title="Visualização em Lista"
                            >
                                <List size={18} />
                            </button>
                            <button
                                onClick={() => setViewMode('calendar')}
                                className={`p-1.5 rounded-md transition-all ${viewMode === 'calendar' ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'}`}
                                title="Visualização em Calendário"
                            >
                                <CalendarIcon size={18} />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6">

                {/* VIEW: LIST */}
                {viewMode === 'list' && (
                    <div className="space-y-6 max-w-4xl mx-auto">
                        {Object.entries(groupedItems).length === 0 ? (
                            <div className="text-center py-20 text-slate-400">
                                <CalendarDays size={48} className="mx-auto mb-4 opacity-50" />
                                <p>Nenhum item na agenda encontrado.</p>
                            </div>
                        ) : (
                            Object.entries(groupedItems).map(([date, rawItems]) => {
                                const items = rawItems as AgendaItem[];
                                return (
                                    <div key={date} className="animate-in slide-in-from-bottom-2 fade-in">
                                        <h3 className="sticky top-0 bg-slate-50/95 dark:bg-slate-950/95 backdrop-blur py-2 px-1 text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 z-10 flex items-center gap-2">
                                            <CalendarDays size={14} /> {date}
                                        </h3>
                                        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                                            {items.map((item, idx) => (
                                                <div
                                                    key={item.id}
                                                    className={`p-4 flex items-start gap-4 transition-colors ${idx !== items.length - 1 ? 'border-b border-slate-100 dark:border-slate-800' : ''} ${item.type === 'system_log' ? 'bg-slate-50/50 dark:bg-slate-900/50 opacity-75' : 'hover:bg-slate-50 dark:hover:bg-slate-800'} ${item.contextId ? 'cursor-pointer' : ''}`}
                                                    onClick={() => handleItemClick(item)}
                                                >
                                                    <div className="mt-1">{getIcon(item)}</div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex justify-between items-start">
                                                            <h4 className={`font-bold ${item.type === 'system_log' ? 'text-slate-600 dark:text-slate-400 font-normal italic' : 'text-slate-800 dark:text-white'} ${item.status === 'done' ? 'line-through opacity-60' : ''}`}>
                                                                {item.title}
                                                            </h4>
                                                            <span className="text-xs font-mono text-slate-400 ml-2 whitespace-nowrap">{new Date(item.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                        </div>

                                                        {item.description && typeof item.description === 'string' && (
                                                            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 line-clamp-1">{item.description}</p>
                                                        )}

                                                        <div className="flex gap-2 mt-2">
                                                            {item.ref && <span className="text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-500 border border-slate-200 dark:border-slate-700">{item.ref}</span>}
                                                            {item.type === 'task' && <span className="text-xs bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 px-1.5 py-0.5 rounded border border-orange-100 dark:border-orange-900/30">Tarefa</span>}
                                                            {item.type === 'project_deadline' && <span className="text-xs bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded border border-red-100 dark:border-red-900/30">Prazo</span>}
                                                            {item.contextView === 'orders' && <span className="text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded border border-indigo-100">Pedido</span>}
                                                            {item.contextView === 'proposals' && <span className="text-xs bg-cyan-50 text-cyan-600 px-1.5 py-0.5 rounded border border-cyan-100">Proposta</span>}
                                                            {item.contextView === 'contracts' && <span className="text-xs bg-teal-50 text-teal-600 px-1.5 py-0.5 rounded border border-teal-100">Contrato</span>}
                                                            {item.contextView === 'invoices' && <span className="text-xs bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded border border-emerald-100">Fatura</span>}
                                                            {item.contextView === 'tickets' && <span className="text-xs bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded border border-purple-100">Chamado</span>}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )
                            })
                        )}
                    </div>
                )}

                {/* VIEW: CALENDAR */}
                {viewMode === 'calendar' && (
                    <div className="flex flex-col h-full bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                        {/* Calendar Nav */}
                        <div className="p-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                            <div className="flex items-center gap-4">
                                <h3 className="text-xl font-bold text-slate-800 dark:text-white">
                                    {currentDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                                </h3>
                                <div className="flex items-center gap-1">
                                    <button onClick={prevMonth} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full"><ChevronLeft size={20} /></button>
                                    <button onClick={nextMonth} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full"><ChevronRight size={20} /></button>
                                </div>
                            </div>
                            <button onClick={today} className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline">Hoje</button>
                        </div>

                        {/* Grid Header */}
                        <div className="grid grid-cols-7 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                            {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(day => (
                                <div key={day} className="py-2 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                    {day}
                                </div>
                            ))}
                        </div>

                        {/* Grid Body */}
                        <div className="flex-1 grid grid-cols-7 auto-rows-fr">
                            {calendarDays.map((cell, idx) => (
                                <div
                                    key={idx}
                                    className={`min-h-[100px] border-b border-r border-slate-100 dark:border-slate-800 p-2 relative ${!cell.day ? 'bg-slate-50/50 dark:bg-slate-950/50' : 'bg-white dark:bg-slate-900'}`}
                                >
                                    {cell.day && (
                                        <>
                                            <span className={`text-sm font-semibold mb-1 block ${new Date().toDateString() === new Date(cell.dateStr).toDateString() ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-700 dark:text-slate-300'}`}>
                                                {cell.day}
                                            </span>
                                            <div className="space-y-1 overflow-y-auto max-h-[120px] custom-scrollbar">
                                                {cell.items.map(item => (
                                                    <div
                                                        key={item.id}
                                                        onClick={() => handleItemClick(item)}
                                                        className={`text-[10px] px-1.5 py-0.5 rounded border truncate cursor-pointer transition-all hover:scale-105 flex items-center gap-1 ${item.type === 'event' ? 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-900/30 dark:text-blue-200 dark:border-blue-800' :
                                                            item.type === 'task' ? 'bg-orange-50 text-orange-700 border-orange-100 dark:bg-orange-900/30 dark:text-orange-200 dark:border-orange-800' :
                                                                item.type === 'project_deadline' ? 'bg-red-50 text-red-700 border-red-100 dark:bg-red-900/20 dark:text-red-300 dark:border-red-900/30' :
                                                                    'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
                                                            }`}
                                                        title={item.title}
                                                    >
                                                        {/* Mini Icons for Calendar */}
                                                        {item.type === 'event' && (
                                                            item.subType === 'AC_TEL' ? <Phone size={8} /> :
                                                                item.subType === 'AC_EMAIL' ? <Mail size={8} /> :
                                                                    item.subType === 'AC_RDV' ? <Users size={8} /> :
                                                                        <CalendarIcon size={8} />
                                                        )}
                                                        {item.type === 'project_deadline' && <FolderKanban size={8} />}
                                                        {item.type === 'task' && <Clock size={8} />}
                                                        {item.type === 'intervention' && <ClipboardList size={8} />}
                                                        {item.type === 'system_log' && <Bot size={8} />}

                                                        <span className="truncate">{item.title}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
};

export default AgendaView;
