import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Clock, ChevronRight, Inbox, RefreshCw, Filter } from 'lucide-react';
import { useDolibarr } from '../context/DolibarrContext';
import { useWhatsAppContext } from '../contexts/WhatsAppContext';
import { useSystemLogs, useUsers } from '../hooks/dolibarr';
import { AppView, SystemLog } from '../types';
import { formatRelativeTime } from '../utils/dateUtils';
import { DELEG_TO_ROLE, SOURCE_META, resolveActorName, resolveEventTarget, resolveToName } from '../utils/systemEventUtils';
import { getSystemEvents, getSystemEventSources, SystemEvent, SystemEventSource } from '../services/systemEventsService';
import { PageHeader, Button, Input, Card, EmptyState, PageLayout } from './ui';
import SystemEventDetailsModal from './SystemEventDetailsModal';

interface SystemEventsViewProps {
    onNavigate?: (view: AppView, id: string) => void;
}

const sevColor = (s: SystemEvent['severity']) =>
    s === 'error' ? 'text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400'
        : s === 'warn' ? 'text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400'
            : 'text-slate-600 bg-slate-50 dark:bg-slate-800 dark:text-slate-400';

const ITEMS_PER_PAGE = 50;
const BACKEND_FETCH_LIMIT = 200;

const SystemEventsView: React.FC<SystemEventsViewProps> = ({ onNavigate }) => {
    const { config } = useDolibarr();
    const { socket, isConnected } = useWhatsAppContext();
    const { data: systemLogs = [] } = useSystemLogs(config, !!config);
    const { data: users = [] } = useUsers(config, !!config);

    const [allowed, setAllowed] = useState<SystemEventSource[]>([]);
    const [active, setActive] = useState<Set<SystemEventSource>>(new Set());
    const [backendEvents, setBackendEvents] = useState<SystemEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filterActor, setFilterActor] = useState('all');
    const [dateRange, setDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' });
    const [visibleItems, setVisibleItems] = useState(ITEMS_PER_PAGE);
    const [selectedEvent, setSelectedEvent] = useState<SystemEvent | null>(null);

    const userMap = useMemo(() => {
        const map: Record<string, string> = {};
        users.forEach(u => { map[u.id] = `${u.firstname || ''} ${u.lastname || ''}`.trim() || u.login; });
        return map;
    }, [users]);

    // Chips = fontes do backend permitidas + 'dolibarr' (client-side, visível a todos).
    const chipSources = useMemo<SystemEventSource[]>(() => {
        const set = new Set<SystemEventSource>(allowed);
        set.add('dolibarr');
        return Array.from(set);
    }, [allowed]);

    useEffect(() => {
        (async () => {
            const src = await getSystemEventSources();
            setAllowed(src);
            setActive(new Set<SystemEventSource>([...src, 'dolibarr']));
        })();
    }, []);

    // Busca no backend quando muda o conjunto de fontes ativas (exceto dolibarr, que é cliente).
    const activeBackend = useMemo(() => Array.from(active).filter(s => s !== 'dolibarr'), [active]);
    const activeBackendKey = activeBackend.slice().sort().join(',');
    // silent=true: atualização em tempo real sem o spinner full (não pisca a lista).
    const refetch = async (silent = false) => {
        if (!silent) setLoading(true);
        if (activeBackend.length === 0) { setBackendEvents([]); if (!silent) setLoading(false); return; }
        try {
            const res = await getSystemEvents({ sources: activeBackend.join(','), limit: BACKEND_FETCH_LIMIT });
            setBackendEvents(res.events);
        } catch { /* mantém o que já está na tela */ }
        finally { if (!silent) setLoading(false); }
    };
    useEffect(() => { refetch(); /* eslint-disable-next-line */ }, [activeBackendKey]);

    // Sempre aponta p/ o refetch mais recente (captura activeBackend atual sem re-registrar o socket).
    const refetchRef = useRef(refetch);
    refetchRef.current = refetch;

    // Tempo real (#519): o socket é broadcast global; ao receber um evento relevante, re-busca no
    // backend (com debounce), que reaplica a visibilidade por usuário. Sem vazamento.
    useEffect(() => {
        if (!socket) return;
        const LIVE_RE = /^agent_activity$|^notification$|^scheduler_|^approval_|^delegation_event$|^task:/;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const onAnyEvent = (event: string) => {
            if (!LIVE_RE.test(event)) return;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => refetchRef.current(true), 1500);
        };
        socket.onAny(onAnyEvent);
        return () => { socket.offAny(onAnyEvent); if (timer) clearTimeout(timer); };
    }, [socket]);

    // Dolibarr (actioncomm) normalizado no cliente — sem AC_CHAT.
    const dolibarrEvents = useMemo<SystemEvent[]>(() => {
        if (!active.has('dolibarr')) return [];
        return systemLogs
            .filter((l: SystemLog) => l.type_code?.toUpperCase() !== 'AC_CHAT')
            .flatMap((l: SystemLog) => {
                const d = new Date(l.date_action);
                if (isNaN(d.getTime())) return [];
                return [{
                    id: `doli_${l.id}`, timestamp: d.toISOString(), source: 'dolibarr' as const,
                    actor: { id: l.fk_user_author || '', name: l.fk_user_author ? (userMap[l.fk_user_author] || `#${l.fk_user_author}`) : 'Sistema' },
                    type: l.type_code || 'AC_OTH', entityType: l.elementtype, entityId: l.fk_element || l.id,
                    description: l.label || l.type_code || 'Evento', severity: 'info' as const,
                }];
            });
    }, [systemLogs, active, userMap]);

    // Merge + filtros client-side (uniforme p/ backend e dolibarr) + ordenação desc.
    const filtered = useMemo(() => {
        let all = [...backendEvents, ...dolibarrEvents];
        if (filterActor !== 'all') all = all.filter(e => e.actor.id === filterActor);
        if (dateRange.start) { const s = new Date(dateRange.start).setHours(0, 0, 0, 0); all = all.filter(e => Date.parse(e.timestamp) >= s); }
        if (dateRange.end) { const en = new Date(dateRange.end).setHours(23, 59, 59, 999); all = all.filter(e => Date.parse(e.timestamp) <= en); }
        if (search) {
            const q = search.toLowerCase();
            all = all.filter(e => `${e.description} ${e.type} ${e.actor.name} ${e.entityType || ''}`.toLowerCase().includes(q));
        }
        all.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
        return all;
    }, [backendEvents, dolibarrEvents, filterActor, dateRange, search]);

    const paginated = filtered.slice(0, visibleItems);

    const toggleSource = (s: SystemEventSource) => {
        setVisibleItems(ITEMS_PER_PAGE);
        setActive(prev => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });
    };

    /** Resolves the navigation target for an event, or returns null if non-navigable. */
    const resolveTarget = (e: SystemEvent): { view: AppView; id: string } | null => resolveEventTarget(e);

    const handleClick = (e: SystemEvent) => {
        setSelectedEvent(e);
    };

    return (
        <PageLayout title="Central de Eventos" noPadding>
            <PageHeader
                title="Central de Eventos"
                subtitle={`${filtered.length} eventos${active.has('dolibarr') ? '' : ''}`}
                actions={
                    <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400" title={isConnected ? 'Atualizando em tempo real' : 'Sem conexão em tempo real'}>
                            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300 dark:bg-slate-600'}`} />
                            {isConnected ? 'Ao vivo' : 'Offline'}
                        </span>
                        <Button onClick={() => refetch()} loading={loading} variant="primary" icon={<RefreshCw size={16} />}>Atualizar</Button>
                    </div>
                }
            />

            {/* Chips de fonte */}
            <div className="px-4 md:px-6 py-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex flex-wrap gap-2">
                {chipSources.map(s => {
                    const meta = SOURCE_META[s];
                    const on = active.has(s);
                    const Icon = meta.icon;
                    return (
                        <button
                            key={s}
                            onClick={() => toggleSource(s)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${on
                                ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300'
                                : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400'}`}
                        >
                            <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
                            <Icon size={13} /> {meta.label}
                        </button>
                    );
                })}
            </div>

            {/* Filtros */}
            <div className="px-4 md:px-6 py-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex flex-col xl:flex-row gap-3">
                <div className="flex-1">
                    <Input placeholder="Buscar por descrição, tipo ou ator..." value={search} onChange={e => setSearch(e.target.value)} icon={<Filter size={16} />} fullWidth />
                </div>
                <div className="flex gap-2 flex-wrap">
                    <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 rounded-lg px-3 border border-slate-200 dark:border-slate-700 h-[42px]">
                        <span className="text-xs text-slate-500">De</span>
                        <input type="date" value={dateRange.start} onChange={e => setDateRange(p => ({ ...p, start: e.target.value }))} className="bg-transparent text-sm text-slate-700 dark:text-slate-300 border-none focus:ring-0 p-1 w-28" />
                        <span className="text-xs text-slate-500">Até</span>
                        <input type="date" value={dateRange.end} onChange={e => setDateRange(p => ({ ...p, end: e.target.value }))} className="bg-transparent text-sm text-slate-700 dark:text-slate-300 border-none focus:ring-0 p-1 w-28" />
                    </div>
                    <select value={filterActor} onChange={e => setFilterActor(e.target.value)} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-sm px-3 h-[42px] min-w-[150px]">
                        <option value="all">Todos os atores</option>
                        {users.map(u => <option key={u.id} value={u.id}>{u.firstname} {u.lastname}</option>)}
                    </select>
                </div>
            </div>

            {/* Feed */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6">
                <div className="max-w-4xl mx-auto">
                    <Card padding="none">
                        <div className="divide-y divide-slate-100 dark:divide-slate-800">
                            {loading ? (
                                <div className="p-12 text-center text-slate-400"><RefreshCw className="animate-spin mx-auto mb-2" /> Carregando eventos...</div>
                            ) : paginated.length === 0 ? (
                                <EmptyState icon={Inbox} title="Nenhum evento" description="Ajuste as fontes ou os filtros." />
                            ) : (
                                <>
                                    {paginated.map(ev => {
                                        const meta = SOURCE_META[ev.source];
                                        const Icon = meta.icon;
                                        const navigable = !!resolveTarget(ev);
                                        return (
                                            <div key={ev.id} onClick={() => handleClick(ev)} className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer group">
                                                <div className="flex items-start gap-3">
                                                    <div className={`p-2 rounded-lg ${sevColor(ev.severity)} shrink-0`}><Icon size={14} /></div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-start justify-between gap-2">
                                                            <p className="text-sm text-slate-800 dark:text-slate-200 line-clamp-2">
                                                                <span className="font-semibold text-slate-900 dark:text-white">{userMap[ev.actor.id] || (ev.actor.name && ev.actor.name !== 'unknown' && !/^\d+$/.test(ev.actor.name) ? ev.actor.name : (userMap[ev.actor.name] || 'Sistema'))}</span>{' '}
                                                                <span className="text-slate-600 dark:text-slate-300">{ev.description}</span>
                                                                {ev.metadata?.to && (
                                                                    <span className="text-slate-500 dark:text-slate-400"> → {userMap[ev.metadata.to] || `#${ev.metadata.to}`}{DELEG_TO_ROLE[ev.type] ? ` (${DELEG_TO_ROLE[ev.type]})` : ''}</span>
                                                                )}
                                                            </p>
                                                            {navigable && <ChevronRight size={14} className="text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />}
                                                        </div>
                                                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full text-white ${meta.dot}`}>{meta.label}</span>
                                                            <span className="text-xs text-slate-400 flex items-center gap-1" title={new Date(ev.timestamp).toLocaleString()}><Clock size={10} /> {formatRelativeTime(Date.parse(ev.timestamp))}</span>
                                                            <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 font-mono">{ev.type}</span>
                                                            {ev.status && <span className="text-[10px] text-slate-400">{ev.status}</span>}
                                                        </div>
                                                        {ev.metadata?.objetivo && (
                                                            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 line-clamp-1 italic" title={ev.metadata.objetivo}>🎯 {ev.metadata.objetivo}</p>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    {filtered.length > visibleItems && (
                                        <div className="p-3 text-center bg-slate-50 dark:bg-slate-800/20">
                                            <Button variant="ghost" fullWidth onClick={() => setVisibleItems(v => v + ITEMS_PER_PAGE)} className="text-xs">
                                                Carregar mais ({filtered.length - visibleItems} restantes)
                                            </Button>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </Card>
                </div>
            </div>

            <SystemEventDetailsModal
                event={selectedEvent}
                userMap={userMap}
                onClose={() => setSelectedEvent(null)}
                onNavigate={onNavigate}
            />
        </PageLayout>
    );
};

export default SystemEventsView;
