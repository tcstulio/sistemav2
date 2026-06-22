import React, { useState, useMemo, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { AgendaEvent, AppView } from '../types';
import { CalendarDays, Clock, FolderKanban, ClipboardList, ChevronRight, CheckCircle2, Circle, Bot, List, Calendar as CalendarIcon, ChevronLeft, Plus, Loader2, X, Phone, Mail, Users, ShoppingCart, FileSignature, Ticket as TicketIcon, ArrowUp, ArrowDown } from 'lucide-react';
import { formatDateOnly, formatDateTime, formatDateLong } from '../utils/dateUtils';
import { DolibarrService } from '../services/dolibarrService';
import { useDolibarr } from '../context/DolibarrContext';
import { useEvents, useTasks, useInterventions, useProjects, useCustomers } from '../hooks/dolibarr';
import AgendaEntryDetail from './AgendaEntryDetail';
import { logger } from '../utils/logger';
import { usePrefill, PrefillResult } from '../hooks/usePrefill';

const log = logger.child('AgendaView');

// Design System
import {
    PageHeader,
    Button,
    Input,
    Modal,
    Tabs,
    Tab,
    EmptyState,
    Card,
    MasterDetailLayout
} from './ui';

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

interface EncapsulatedGroup {
    dateStr: string;
    dateTs: number;
    items: AgendaItem[];
}

const AgendaView: React.FC<AgendaViewProps> = ({ onNavigate }) => {
    const { config, refreshData } = useDolibarr();

    const { data: events = [], isLoading: isLoadingEvents } = useEvents(config || null, !!config);
    const { data: tasks = [], isLoading: isLoadingTasks } = useTasks(config || null, !!config);
    const { data: interventions = [], isLoading: isLoadingInterventions } = useInterventions(config || null, !!config);
    const { data: projects = [], isLoading: isLoadingProjects } = useProjects(config || null, !!config);
    const { data: customers = [] } = useCustomers(config || null, !!config);

    const isLoading = isLoadingEvents || isLoadingTasks || isLoadingInterventions || isLoadingProjects;

    const [filterType, setFilterType] = useState<'all' | 'event' | 'task' | 'deadline'>('all');
    const [showSystemEvents, setShowSystemEvents] = useState(false);

    // Default to 'list' on small screens
    const [viewMode, setViewMode] = useState<'list' | 'calendar'>(window.innerWidth < 768 ? 'list' : 'calendar');
    const [currentDate, setCurrentDate] = useState(new Date());

    // Selection State for MasterDetail
    const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

    // Pagination / Windowing State
    // We store indices relative to the 'groupedList'
    const [visibleRange, setVisibleRange] = useState({ start: 0, end: 10 });
    const [hasInitializedScroll, setHasInitializedScroll] = useState(false);

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

    // Deeplink HITL do agente (#57): create_event abre o modal de novo evento; edit_event
    // abre o evento no AgendaEntryDetail em modo edição com as mudanças sugeridas.
    const prefill = usePrefill();
    const appliedPrefillRef = useRef<PrefillResult | null>(null);
    const [editEventPrefill, setEditEventPrefill] = useState<Record<string, string> | undefined>(undefined);
    useEffect(() => {
        if (!prefill || appliedPrefillRef.current === prefill) return;
        if (prefill.kind === 'create_event') {
            appliedPrefillRef.current = prefill;
            setNewEventForm({
                label: prefill.data.label || '',
                date_start: prefill.data.date_start || '',
                date_end: prefill.data.date_end || '',
                type_code: prefill.data.type_code || 'AC_RDV',
                description: prefill.data.description || '',
            });
            setIsEventModalOpen(true);
            toast.info('Revise os dados e confirme a criação do evento.');
        } else if (prefill.kind === 'edit_event') {
            appliedPrefillRef.current = prefill;
            setEditEventPrefill(prefill.data);
            setViewMode('list'); // garante o MasterDetailLayout (detalhe só aparece em lista)
            setSelectedItemId(`evt-${prefill.data.id}`); // prefixo evt- p/ o AgendaEntryDetail
            toast.info('Revise as mudanças e salve o evento.');
        }
    }, [prefill]);

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

    // Lookup helpers — resolve IDs to human-readable names
    const projectById = useMemo(() => {
        const map = new Map<string, string>();
        projects.forEach(p => map.set(p.id, p.title || p.ref));
        return map;
    }, [projects]);

    const customerById = useMemo(() => {
        const map = new Map<string, string>();
        customers.forEach(c => map.set(c.id, c.name));
        return map;
    }, [customers]);

    /**
     * Build a compact "Projeto / Cliente" label for an item.
     * Returns undefined when no meaningful context can be resolved
     * (avoids rendering "undefined" or raw numeric IDs).
     */
    const resolveParentRef = (projectId?: string, socId?: string): string | undefined => {
        const parts: string[] = [];
        if (projectId) {
            const name = projectById.get(projectId);
            if (name) parts.push(name);
        }
        if (socId) {
            const name = customerById.get(socId);
            if (name) parts.push(name);
        }
        return parts.length > 0 ? parts.join(' · ') : undefined;
    };

    // Consolidate all time-based items into a single list
    const consolidatedItems = useMemo(() => {
        const items: AgendaItem[] = [];

        // 1. Events
        events.forEach(e => {
            // Chat messages are stored as agendaevents (type AC_CHAT) but are conversations,
            // not calendar items — never surface them in the agenda.
            if (e.type_code?.toUpperCase() === 'AC_CHAT') return;
            // Eventos de delegação (cobrança/escalada/lembrete) são trilha de sistema, não
            // compromissos — escondidos da agenda. Novos usam AC_DELEG; o legado é AC_OTH
            // com label "[Delegação] …" (pega os ~383 antigos sem migração destrutiva).
            if (e.type_code?.toUpperCase() === 'AC_DELEG') return;
            if (typeof e.label === 'string' && e.label.startsWith('[Delegação]')) return;
            const isLog = isSystemLog(e);
            if (isLog && !showSystemEvents) return;
            const context = getContextLink(e);
            // Prefer resolved project/customer names; fall back to location (venue/address).
            const resolvedRef = resolveParentRef(e.project_id, e.socid);
            items.push({
                id: `evt-${e.id}`,
                type: isLog ? 'system_log' : 'event',
                subType: e.type_code,
                title: e.label,
                date: e.date_start,
                endDate: e.date_end ? e.date_end : undefined,
                description: e.description,
                status: e.percentage === 100 ? 'done' : 'todo',
                ref: e.id,
                parentRef: resolvedRef ?? (e.location || undefined),
                contextId: context?.id,
                contextView: context?.view
            });
        });

        // 2. Tasks
        tasks.forEach(t => {
            if (t.date_start) {
                const projectName = t.project_id ? projectById.get(t.project_id) : undefined;
                items.push({
                    id: `tsk-${t.id}`,
                    type: 'task',
                    title: t.label,
                    date: t.date_start,
                    endDate: t.date_end ? t.date_end : undefined,
                    description: t.description,
                    status: t.progress === 100 ? 'done' : 'todo',
                    ref: t.ref,
                    parentRef: projectName, // resolved name or undefined (never raw ID)
                    contextId: t.project_id,
                    contextView: 'projects'
                });
            }
        });

        // 3. Interventions
        interventions.forEach(i => {
            const projectName = i.project_id ? projectById.get(i.project_id) : undefined;
            items.push({
                id: `int-${i.id}`,
                type: 'intervention',
                title: `Intervenção ${i.ref}`,
                date: i.date,
                description: i.description,
                status: i.statut === '2' ? 'done' : 'todo',
                ref: i.ref,
                parentRef: projectName,
                contextId: i.project_id,
                contextView: 'interventions'
            });
        });

        // 4. Projects
        projects.forEach(p => {
            if (p.date_end) {
                items.push({
                    id: `prj-${p.id}`,
                    type: 'project_deadline',
                    title: `Prazo: ${p.title}`,
                    date: p.date_end,
                    status: p.statut === '2' ? 'done' : 'todo',
                    ref: p.ref,
                    contextId: p.id,
                    contextView: 'projects'
                });
            }
        });

        return items.sort((a, b) => a.date - b.date);
    }, [events, tasks, interventions, projects, customers, showSystemEvents, projectById, customerById]);

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

    // Group by Date String for List View - RETURNS ARRAY NOW
    const groupedList = useMemo(() => {
        const list: EncapsulatedGroup[] = [];

        filteredItems.forEach(item => {
            const dateKey = formatDateLong(item.date);
            let lastGroup = list[list.length - 1];

            // Check if matches last group
            if (!lastGroup || lastGroup.dateStr !== dateKey) {
                list.push({
                    dateStr: dateKey,
                    dateTs: item.date, // Approximate ts for group
                    items: []
                });
                lastGroup = list[list.length - 1];
            }
            lastGroup.items.push(item);
        });

        return list;
    }, [filteredItems]);

    // Initialize Window on Data Load / View Change
    useEffect(() => {
        if (groupedList.length > 0 && viewMode === 'list') {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayTs = today.getTime();

            // Find index of first group >= today
            const todayIndex = groupedList.findIndex(g => g.dateTs >= todayTs);

            if (todayIndex !== -1) {
                // Show 5 days back, 15 days forward initially
                const start = Math.max(0, todayIndex - 5);
                const end = Math.min(groupedList.length, todayIndex + 15);
                setVisibleRange({ start, end });
                setHasInitializedScroll(false); // Trigger scroll
            } else {
                // If all dates are in past, show last 20
                if (groupedList.length > 0 && groupedList[groupedList.length - 1].dateTs < todayTs) {
                    setVisibleRange({ start: Math.max(0, groupedList.length - 20), end: groupedList.length });
                } else {
                    // All in future? Show first 20
                    setVisibleRange({ start: 0, end: Math.min(20, groupedList.length) });
                }
            }
        }
    }, [groupedList.length, viewMode, filterType]); // Re-calc on data/filter change

    // Auto-scroll to today AFTER window runs
    const itemRefs = React.useRef<Record<string, HTMLDivElement | null>>({});

    useEffect(() => {
        if (viewMode === 'list' && groupedList.length > 0 && !hasInitializedScroll && !selectedItemId) {
            // Wait for render
            setTimeout(() => {
                // Find Today element in DOM
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                // We need to look in the VISIBLE entries
                const firstFutureGroup = groupedList.slice(visibleRange.start, visibleRange.end)
                    .find(g => g.dateTs >= today.getTime());

                if (firstFutureGroup) {
                    const el = itemRefs.current[firstFutureGroup.dateStr];
                    if (el) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        setHasInitializedScroll(true);
                    }
                }
            }, 300);
        }
    }, [visibleRange, viewMode, groupedList]);


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
            // Normalize time for comparison
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
        setEditEventPrefill(undefined); // seleção manual não carrega o prefill de edição do agente
        if (viewMode === 'list') {
            setSelectedItemId(item.id);
        } else {
            setViewMode('list');
            setSelectedItemId(item.id);
        }
    };

    const handleCreateEvent = async () => {
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
            toast.success("Evento criado com sucesso");
            setIsEventModalOpen(false);
            setNewEventForm({ label: '', date_start: '', date_end: '', type_code: 'AC_RDV', description: '' });
            refreshData();
        } catch (e) {
            log.error(e);
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
                <Loader2 className="animate-spin mr-2" />
                <p>Carregando configurações...</p>
            </div>
        )
    }

    // Render the List Content (The 'Left' side of MasterDetail)
    const renderListContent = () => {
        if (groupedList.length === 0) {
            return (
                <EmptyState
                    icon={CalendarDays}
                    title="Nenhum item na agenda"
                    description="Tente alterar os filtros ou crie um novo evento."
                    action={
                        <Button onClick={() => setIsEventModalOpen(true)}>
                            Criar Evento
                        </Button>
                    }
                />
            );
        }

        const visibleItems = groupedList.slice(visibleRange.start, visibleRange.end);
        const hasOlder = visibleRange.start > 0;
        const hasNewer = visibleRange.end < groupedList.length;

        const loadOlder = () => setVisibleRange(prev => ({ ...prev, start: Math.max(0, prev.start - 10) }));
        const loadNewer = () => setVisibleRange(prev => ({ ...prev, end: Math.min(groupedList.length, prev.end + 10) }));

        return (
            <div className="space-y-6 max-w-4xl mx-auto pb-20 pt-4 px-2">

                {/* LOAD OLDER BUTTON */}
                {hasOlder && (
                    <div className="flex justify-center mb-4">
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={loadOlder}
                            icon={<ArrowUp size={16} />}
                        >
                            Carregar Anteriores ({visibleRange.start} ocultos)
                        </Button>
                    </div>
                )}

                {visibleItems.map((group) => {
                    const { dateStr, items } = group;
                    return (
                        <div key={dateStr} ref={el => { itemRefs.current[dateStr] = el; }} className="animate-in slide-in-from-bottom-2 fade-in">
                            <h3 className="sticky top-0 bg-slate-50/95 dark:bg-slate-950/95 backdrop-blur py-2 px-1 text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 z-10 flex items-center gap-2">
                                <CalendarDays size={14} /> {dateStr}
                            </h3>
                            <Card padding="none" className="overflow-hidden">
                                {items.map((item, idx) => (
                                    <div
                                        key={item.id}
                                        className={`p-4 flex items-start gap-4 transition-colors cursor-pointer border-l-4
                                            ${idx !== items.length - 1 ? 'border-b border-slate-100 dark:border-slate-800' : ''} 
                                            ${selectedItemId === item.id
                                                ? 'bg-indigo-50/50 dark:bg-indigo-900/10 border-l-indigo-500'
                                                : 'border-l-transparent hover:bg-slate-50 dark:hover:bg-slate-800'
                                            }
                                            ${item.type === 'system_log' ? 'opacity-75' : ''}
                                        `}
                                        onClick={() => handleItemClick(item)}
                                    >
                                        <div className="mt-1">{getIcon(item)}</div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex justify-between items-start">
                                                <h4 className={`font-bold ${item.type === 'system_log' ? 'text-slate-600 dark:text-slate-400 font-normal italic' : 'text-slate-800 dark:text-white'} ${item.status === 'done' ? 'line-through opacity-60' : ''}`}>
                                                    {item.title}
                                                </h4>
                                                <span className="text-xs font-mono text-slate-400 ml-2 whitespace-nowrap">{formatDateTime(item.date).split(' ')[1]}</span>
                                            </div>

                                            {item.description && typeof item.description === 'string' && (
                                                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 line-clamp-1">{item.description}</p>
                                            )}

                                            <div className="flex gap-2 mt-2 flex-wrap">
                                                {item.ref && <span className="text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-500 border border-slate-200 dark:border-slate-700">{item.ref}</span>}
                                                {item.type === 'task' && <span className="text-xs bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 px-1.5 py-0.5 rounded border border-orange-100 dark:border-orange-900/30">Tarefa</span>}
                                                {item.type === 'project_deadline' && <span className="text-xs bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded border border-red-100 dark:border-red-900/30">Prazo</span>}
                                                {item.contextView === 'orders' && <span className="text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded border border-indigo-100">Pedido</span>}
                                                {item.contextView === 'proposals' && <span className="text-xs bg-cyan-50 text-cyan-600 px-1.5 py-0.5 rounded border border-cyan-100">Proposta</span>}
                                                {item.contextView === 'contracts' && <span className="text-xs bg-teal-50 text-teal-600 px-1.5 py-0.5 rounded border border-teal-100">Contrato</span>}
                                                {item.contextView === 'invoices' && <span className="text-xs bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded border border-emerald-100">Fatura</span>}
                                                {item.contextView === 'tickets' && <span className="text-xs bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded border border-purple-100">Chamado</span>}
                                                {item.parentRef && (
                                                    <span className="text-xs bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 px-1.5 py-0.5 rounded border border-violet-100 dark:border-violet-900/30 flex items-center gap-1 max-w-[200px] truncate" title={item.parentRef}>
                                                        <FolderKanban size={10} className="flex-none" />
                                                        <span className="truncate">{item.parentRef}</span>
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </Card>
                        </div>
                    )
                })}

                {/* LOAD NEWER BUTTON */}
                {hasNewer && (
                    <div className="flex justify-center mt-4">
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={loadNewer}
                            icon={<ArrowDown size={16} />}
                        >
                            Carregar Próximos (+{groupedList.length - visibleRange.end})
                        </Button>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 transition-colors relative">

            {/* Create Event Modal */}
            <Modal
                isOpen={isEventModalOpen}
                onClose={() => setIsEventModalOpen(false)}
                title={
                    <span className="flex items-center gap-2">
                        <CalendarDays size={18} className="text-indigo-600" /> Novo Evento na Agenda
                    </span>
                }
                size="md"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsEventModalOpen(false)}>Cancelar</Button>
                        <Button
                            onClick={handleCreateEvent}
                            loading={isSubmittingEvent}
                            icon={<CheckCircle2 size={16} />}
                        >
                            Criar Evento
                        </Button>
                    </>
                }
            >
                <div className="space-y-4">
                    <Input
                        label="Assunto"
                        required
                        value={newEventForm.label}
                        onChange={e => setNewEventForm({ ...newEventForm, label: e.target.value })}
                        placeholder="Título da reunião"
                    />
                    <div className="grid grid-cols-2 gap-4">
                        <Input
                            label="Início"
                            type="datetime-local"
                            required
                            value={newEventForm.date_start}
                            onChange={e => setNewEventForm({ ...newEventForm, date_start: e.target.value })}
                        />
                        <Input
                            label="Fim"
                            type="datetime-local"
                            value={newEventForm.date_end}
                            onChange={e => setNewEventForm({ ...newEventForm, date_end: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo</label>
                        <select
                            className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                            value={newEventForm.type_code}
                            onChange={e => setNewEventForm({ ...newEventForm, type_code: e.target.value })}
                        >
                            <option value="AC_RDV">Reunião (Rendez-vous)</option>
                            <option value="AC_TEL">Chamada Telefônica</option>
                            <option value="AC_EMAIL">Email</option>
                            <option value="AC_OTH">Outro</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Descrição</label>
                        <textarea
                            className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white h-24 resize-none"
                            value={newEventForm.description}
                            onChange={e => setNewEventForm({ ...newEventForm, description: e.target.value })}
                            placeholder="Notas..."
                        />
                    </div>
                </div>
            </Modal>

            {/* Page Header */}
            <PageHeader
                title="Agenda Global"
                subtitle="Cronograma mestre de eventos, tarefas e prazos"
                actions={
                    <div className="flex items-center gap-3">
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

                        <Button
                            icon={<Plus size={16} />}
                            onClick={() => setIsEventModalOpen(true)}
                        >
                            <span className="hidden sm:inline">Novo Evento</span>
                            <span className="sm:hidden">Novo</span>
                        </Button>
                    </div>
                }
                tabs={
                    <Tabs value={filterType} onChange={(v) => setFilterType(v as any)}>
                        <Tab value="all">Todos</Tab>
                        <Tab value="event">Eventos</Tab>
                        <Tab value="task">Tarefas</Tab>
                        <Tab value="deadline">Prazos</Tab>
                    </Tabs>
                }
            />

            {/* Main Content Area */}
            {viewMode === 'list' ? (
                // VIEW: LIST with MasterDetail
                <div className="flex-1 overflow-hidden">
                    <MasterDetailLayout
                        showDetail={!!selectedItemId}
                        onCloseDetail={() => { setSelectedItemId(null); setEditEventPrefill(undefined); }}
                        list={renderListContent()}
                        detail={
                            selectedItemId ? (
                                <AgendaEntryDetail
                                    config={config}
                                    initialItemId={selectedItemId}
                                    editPrefill={editEventPrefill}
                                    onNavigate={onNavigate || (() => { })}
                                />
                            ) : undefined
                        }
                    />
                </div>
            ) : (
                // VIEW: CALENDAR (Independent Scroll)
                <div className="flex-1 overflow-y-auto p-4 md:p-6 relative">
                    <div className="flex flex-col h-full bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                        {/* Calendar Nav */}
                        <div className="p-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                            <div className="flex items-center gap-4">
                                <h3 className="text-xl font-bold text-slate-800 dark:text-white">
                                    {currentDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                                </h3>
                                <div className="flex items-center gap-1">
                                    <Button variant="ghost" size="sm" onClick={prevMonth} icon={<ChevronLeft size={20} />} />
                                    <Button variant="ghost" size="sm" onClick={nextMonth} icon={<ChevronRight size={20} />} />
                                </div>
                            </div>
                            <Button variant="ghost" size="sm" onClick={today}>Hoje</Button>
                        </div>

                        {/* Responsive Scroll Wrapper */}
                        <div className="flex-1 overflow-x-auto overflow-y-auto">
                            <div className="min-w-[800px] h-full flex flex-col">
                                {/* Grid Header */}
                                <div className="grid grid-cols-7 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex-none">
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
                                                                title={item.parentRef ? `${item.title} — ${item.parentRef}` : item.title}
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
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AgendaView;
