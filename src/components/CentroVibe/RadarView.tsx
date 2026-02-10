import React, { useState, useEffect, useCallback } from 'react';
import { CLUSTERS } from './constants';
import { ExternalEvent, EventCluster, Artist, Competitor, TicketBatch, ScraperStatus } from '../../types/centrovibe';
import { CentroVibeService } from '../../services/centrovibeService';
import { Card, Button, Input, Modal, Tabs, Tab, EmptyState } from '../ui';
import { Radar, Plus, MapPin, Calendar, Users, AlertTriangle, ArrowLeft, Edit2, Save, X, Trash2, Ticket, RefreshCw, ExternalLink, Clock } from 'lucide-react';

interface RadarViewProps {
  myArtists: Artist[];
  competitors: Competitor[];
  externalEvents: ExternalEvent[];
  onAddArtist?: (artist: Artist) => void;
  onCompetitorsChange: (competitors: Competitor[]) => void;
  onExternalEventsChange: (events: ExternalEvent[]) => void;
}

type RadarTab = 'events' | 'competitors';

const RadarView: React.FC<RadarViewProps> = ({
  myArtists, competitors, externalEvents,
  onAddArtist, onCompetitorsChange, onExternalEventsChange
}) => {
  const [activeTab, setActiveTab] = useState<RadarTab>('events');
  const [selectedCompetitor, setSelectedCompetitor] = useState<Competitor | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [filterCluster, setFilterCluster] = useState<EventCluster | 'all'>('all');

  // Event Add Form
  const [isEventFormOpen, setIsEventFormOpen] = useState(false);
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventCompetitor, setNewEventCompetitor] = useState(competitors[0]?.id || '');
  const [newEventDate, setNewEventDate] = useState('');
  const [newEventPrice, setNewEventPrice] = useState(0);
  const [newLineup, setNewLineup] = useState('');
  const [newEventCluster, setNewEventCluster] = useState<EventCluster>('urbano_hype');

  // Event Edit
  const [editEventData, setEditEventData] = useState<ExternalEvent | null>(null);
  const [artistSearchQuery, setArtistSearchQuery] = useState('');

  // Competitor Form
  const [isCompetitorFormOpen, setIsCompetitorFormOpen] = useState(false);
  const [editingCompetitorId, setEditingCompetitorId] = useState<string | null>(null);
  const [compName, setCompName] = useState('');
  const [compNeighborhood, setCompNeighborhood] = useState('');
  const [compAddress, setCompAddress] = useState('');
  const [compCapacity, setCompCapacity] = useState(0);
  const [compPrice, setCompPrice] = useState<'low' | 'mid' | 'high'>('mid');
  const [compClusters, setCompClusters] = useState<EventCluster[]>([]);

  // Scraper state
  const [scraperStatus, setScraperStatus] = useState<ScraperStatus | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const fetchScraperStatus = useCallback(async () => {
    try {
      const status = await CentroVibeService.getScraperStatus();
      setScraperStatus(status);
      setIsSyncing(status.isRunning);
    } catch { /* ignore - backend might not be running */ }
  }, []);

  useEffect(() => {
    fetchScraperStatus();
  }, [fetchScraperStatus]);

  const handleSyncRadar = async () => {
    setIsSyncing(true);
    try {
      await CentroVibeService.triggerScrape();
      // Poll status until done
      const poll = setInterval(async () => {
        try {
          const status = await CentroVibeService.getScraperStatus();
          setScraperStatus(status);
          if (!status.isRunning) {
            clearInterval(poll);
            setIsSyncing(false);
          }
        } catch { /* ignore */ }
      }, 5000);
    } catch {
      setIsSyncing(false);
    }
  };

  const formatTimeAgo = (isoDate: string | null): string => {
    if (!isoDate) return 'Nunca';
    const diff = Date.now() - new Date(isoDate).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Agora';
    if (mins < 60) return `${mins}min atrás`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h atrás`;
    return `${Math.floor(hours / 24)}d atrás`;
  };

  // --- EVENT HANDLERS ---
  const handleAddEvent = () => {
    if (!newEventTitle || !newEventDate) return;
    const newEvent: ExternalEvent = {
      id: Date.now().toString(), competitorId: newEventCompetitor, title: newEventTitle,
      date: newEventDate, cluster: newEventCluster, ticketPrice: newEventPrice,
      lineupNames: newLineup.split(',').map(s => s.trim()).filter(Boolean),
      tickets: [{ id: Date.now().toString(), name: 'Porta', price: newEventPrice, status: 'active', totalCount: 100 }]
    };
    onExternalEventsChange([...externalEvents, newEvent]);
    setIsEventFormOpen(false);
    setNewEventTitle(''); setNewLineup(''); setNewEventPrice(0);
  };

  const handleEventClick = (event: ExternalEvent) => {
    setSelectedEventId(event.id);
    setEditEventData({ ...event, tickets: event.tickets || [{ id: 'init', name: 'Porta', price: event.ticketPrice || 0, status: 'active', totalCount: 100 }] });
  };

  const handleSaveEventChanges = () => {
    if (!editEventData) return;
    const minPrice = editEventData.tickets?.length ? Math.min(...editEventData.tickets.map(t => t.price)) : (editEventData.ticketPrice || 0);
    const updated = { ...editEventData, ticketPrice: minPrice };
    onExternalEventsChange(externalEvents.map(e => e.id === updated.id ? updated : e));
    setSelectedEventId(null); setEditEventData(null);
  };

  const handleDeleteEvent = () => {
    if (!editEventData) return;
    onExternalEventsChange(externalEvents.filter(e => e.id !== editEventData.id));
    setSelectedEventId(null); setEditEventData(null);
  };

  const handleRemoveArtist = (name: string) => {
    if (!editEventData) return;
    setEditEventData({ ...editEventData, lineupNames: editEventData.lineupNames.filter(n => n !== name) });
  };

  const handleAddArtistToLineup = (name: string, shouldRegister = false) => {
    if (!editEventData || editEventData.lineupNames.includes(name)) { setArtistSearchQuery(''); return; }
    if (shouldRegister && onAddArtist) {
      onAddArtist({ id: Date.now().toString(), name, role: 'dj', cluster: editEventData.cluster, subGenre: 'Novo', rate: '$$' });
    }
    setEditEventData({ ...editEventData, lineupNames: [...editEventData.lineupNames, name] });
    setArtistSearchQuery('');
  };

  const handleAddTicket = () => {
    if (!editEventData) return;
    const nb: TicketBatch = { id: Date.now().toString(), name: `Lote ${(editEventData.tickets?.length || 0) + 1}`, price: 0, totalCount: 100, status: 'active' };
    setEditEventData({ ...editEventData, tickets: [...(editEventData.tickets || []), nb] });
  };

  const handleRemoveTicket = (id: string) => {
    if (!editEventData?.tickets) return;
    setEditEventData({ ...editEventData, tickets: editEventData.tickets.filter(t => t.id !== id) });
  };

  const handleUpdateTicket = (id: string, field: keyof TicketBatch, value: string | number) => {
    if (!editEventData?.tickets) return;
    setEditEventData({ ...editEventData, tickets: editEventData.tickets.map(t => t.id === id ? { ...t, [field]: value } : t) });
  };

  // --- COMPETITOR HANDLERS ---
  const openCompetitorForm = (comp?: Competitor) => {
    if (comp) {
      setEditingCompetitorId(comp.id); setCompName(comp.name); setCompNeighborhood(comp.neighborhood);
      setCompAddress(comp.address || ''); setCompCapacity(comp.capacity || 0);
      setCompPrice(comp.priceRange); setCompClusters(comp.mainClusters);
    } else {
      setEditingCompetitorId(null); setCompName(''); setCompNeighborhood('');
      setCompAddress(''); setCompCapacity(0); setCompPrice('mid'); setCompClusters([]);
    }
    setIsCompetitorFormOpen(true);
  };

  const handleSaveCompetitor = () => {
    if (!compName) return;
    if (editingCompetitorId) {
      onCompetitorsChange(competitors.map(c => c.id === editingCompetitorId ? { ...c, name: compName, neighborhood: compNeighborhood, address: compAddress, capacity: compCapacity, priceRange: compPrice, mainClusters: compClusters } : c));
    } else {
      onCompetitorsChange([...competitors, { id: Date.now().toString(), name: compName, neighborhood: compNeighborhood, address: compAddress, capacity: compCapacity, priceRange: compPrice, mainClusters: compClusters }]);
    }
    setIsCompetitorFormOpen(false);
  };

  const toggleCompCluster = (cluster: EventCluster) => {
    setCompClusters(prev => prev.includes(cluster) ? prev.filter(c => c !== cluster) : [...prev, cluster]);
  };

  // --- HELPERS ---
  const getCompetitor = (id: string) => competitors.find(c => c.id === id);
  const checkArtistOverlap = (lineupNames: string[]) => {
    const overlap: string[] = [];
    lineupNames.forEach(name => { const m = myArtists.find(a => a.name.toLowerCase().includes(name.toLowerCase())); if (m) overlap.push(m.name); });
    return overlap;
  };

  const filteredEvents = externalEvents.filter(evt => {
    const mc = filterCluster === 'all' || evt.cluster === filterCluster;
    const mcomp = selectedCompetitor ? evt.competitorId === selectedCompetitor.id : true;
    return mc && mcomp;
  });

  return (
    <div>
      <div className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2"><Radar className="text-indigo-500" /> Radar de Mercado</h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Inteligência competitiva: Monitore concorrentes e a agenda dos seus artistas.</p>
        </div>
        <Tabs value={activeTab} onChange={(v) => { setActiveTab(v as RadarTab); setSelectedCompetitor(null); setSelectedEventId(null); }}>
          <Tab value="events">Giro de Eventos</Tab>
          <Tab value="competitors">Concorrentes</Tab>
        </Tabs>
      </div>

      {/* EVENTS TAB */}
      {activeTab === 'events' && (
        <>
          {selectedEventId && editEventData ? (
            <div>
              <Button variant="ghost" size="sm" icon={<ArrowLeft size={16} />} onClick={() => { setSelectedEventId(null); setEditEventData(null); }} className="mb-6">
                Voltar para Lista
              </Button>
              <Card padding="none" className="overflow-hidden shadow-xl">
                <div className={`h-40 ${CLUSTERS[editEventData.cluster].color.split(' ')[0]} bg-opacity-20 p-6 flex flex-col justify-end relative`}>
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-900 to-transparent" />
                  <div className="relative z-10 w-full">
                    <input value={editEventData.title} onChange={(e) => setEditEventData({ ...editEventData, title: e.target.value })}
                      className="bg-transparent text-3xl font-bold text-white placeholder-slate-500 outline-none w-full border-b border-transparent hover:border-white/20 focus:border-indigo-500" />
                    <div className="flex gap-2 mt-2">
                      <select value={editEventData.cluster} onChange={(e) => setEditEventData({ ...editEventData, cluster: e.target.value as EventCluster })}
                        className="bg-black/30 text-white text-xs font-bold uppercase px-2 py-1 rounded border border-white/10 outline-none cursor-pointer">
                        {Object.keys(CLUSTERS).map(k => <option key={k} value={k} className="bg-slate-900">{CLUSTERS[k as EventCluster].label.split('/')[0]}</option>)}
                      </select>
                      <div className="flex items-center gap-1 bg-black/30 text-white text-xs px-2 py-1 rounded border border-white/10">
                        <Calendar size={12} />
                        <input type="date" value={editEventData.date} onChange={(e) => setEditEventData({ ...editEventData, date: e.target.value })}
                          className="bg-transparent outline-none uppercase font-mono" />
                      </div>
                    </div>
                    {(() => {
                      const comp = getCompetitor(editEventData.competitorId);
                      return comp && (
                        <div className="flex items-center gap-4 text-slate-300 text-sm mt-1">
                          <div className="flex items-center gap-1"><MapPin size={14} className="text-indigo-400" /><span className="font-bold text-white">{comp.name}</span>{comp.address && <span className="opacity-70"> - {comp.address}</span>}</div>
                          {comp.capacity > 0 && <div className="flex items-center gap-1 opacity-80 bg-black/20 px-2 py-0.5 rounded-full border border-white/10"><Users size={12} /><span className="text-xs">{comp.capacity} pax</span></div>}
                        </div>
                      );
                    })()}
                  </div>
                </div>
                <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-6">
                    <div>
                      <label className="block text-xs font-mono text-slate-500 dark:text-slate-400 mb-2">CONCORRENTE (LOCAL)</label>
                      <select value={editEventData.competitorId} onChange={(e) => setEditEventData({ ...editEventData, competitorId: e.target.value })}
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-3 text-slate-800 dark:text-white focus:border-indigo-500 outline-none">
                        {competitors.map(c => <option key={c.id} value={c.id}>{c.name} ({c.neighborhood})</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-mono text-slate-500 dark:text-slate-400 mb-2">LINEUP</label>
                      <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                        <div className="flex flex-wrap gap-2 mb-3">
                          {editEventData.lineupNames.map((name, i) => {
                            const isReg = myArtists.some(a => a.name === name);
                            return (
                              <span key={i} className={`text-sm px-2 py-1 rounded-md flex items-center gap-1 ${isReg ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-800' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600'}`}>
                                {name}<button onClick={() => handleRemoveArtist(name)} className="hover:text-red-500"><X size={12} /></button>
                              </span>
                            );
                          })}
                        </div>
                        <div className="relative">
                          <input placeholder="Adicionar artista..." value={artistSearchQuery} onChange={e => setArtistSearchQuery(e.target.value)}
                            className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-md p-2 text-sm text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500" />
                          {artistSearchQuery && (
                            <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl z-20 max-h-48 overflow-y-auto">
                              {myArtists.filter(a => a.name.toLowerCase().includes(artistSearchQuery.toLowerCase()) && !editEventData.lineupNames.includes(a.name))
                                .map(a => (<button key={a.id} onClick={() => handleAddArtistToLineup(a.name)} className="w-full text-left p-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:text-slate-900 dark:hover:text-white flex items-center gap-2"><span className="w-1 h-1 bg-indigo-500 rounded-full" /> {a.name}</button>))}
                              <button onClick={() => handleAddArtistToLineup(artistSearchQuery, true)} className="w-full text-left p-2 text-sm text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 border-t border-slate-200 dark:border-slate-700 font-bold">+ Novo: "{artistSearchQuery}" (Cadastrar)</button>
                            </div>
                          )}
                        </div>
                      </div>
                      {checkArtistOverlap(editEventData.lineupNames).length > 0 && (
                        <div className="mt-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-500/30 rounded-lg flex gap-3 items-start">
                          <AlertTriangle className="text-amber-500 dark:text-amber-400 shrink-0 mt-0.5" size={16} />
                          <div><p className="text-xs font-bold text-amber-700 dark:text-amber-300">Choque de Artistas Detectado</p><p className="text-xs text-amber-600 dark:text-amber-200/70 mt-1">Artistas do seu banco: {checkArtistOverlap(editEventData.lineupNames).join(', ')}.</p></div>
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-mono text-slate-500 dark:text-slate-400 mb-2">ANOTAÇÕES</label>
                      <textarea value={editEventData.notes || ''} onChange={(e) => setEditEventData({ ...editEventData, notes: e.target.value })}
                        placeholder="Ex: Evento open bar..." className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-slate-800 dark:text-white focus:border-indigo-500 outline-none h-24 resize-none" />
                    </div>
                  </div>
                  <div className="space-y-6">
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <label className="block text-xs font-mono text-slate-500 dark:text-slate-400">INGRESSOS / LOTES</label>
                        <button onClick={handleAddTicket} className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 flex items-center gap-1 font-medium"><Plus size={12} /> Add Lote</button>
                      </div>
                      <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                        {editEventData.tickets?.map(ticket => (
                          <div key={ticket.id} className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 p-2 rounded border border-slate-200 dark:border-slate-700">
                            <input value={ticket.name} onChange={(e) => handleUpdateTicket(ticket.id, 'name', e.target.value)}
                              className="bg-transparent border-b border-transparent focus:border-indigo-500 outline-none text-sm text-slate-800 dark:text-white w-full" placeholder="Nome do Lote" />
                            <div className="relative w-24">
                              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 text-xs">R$</span>
                              <input type="number" value={ticket.price} onChange={(e) => handleUpdateTicket(ticket.id, 'price', Number(e.target.value))}
                                className="bg-white dark:bg-slate-900 w-full rounded border border-slate-300 dark:border-slate-600 py-1 pl-6 pr-1 text-xs text-slate-800 dark:text-white focus:border-indigo-500 outline-none" />
                            </div>
                            <button onClick={() => handleRemoveTicket(ticket.id)} className="text-slate-400 hover:text-red-500 p-1"><Trash2 size={14} /></button>
                          </div>
                        ))}
                        {(!editEventData.tickets || editEventData.tickets.length === 0) && (
                          <div className="text-center py-4 border border-dashed border-slate-300 dark:border-slate-700 rounded text-slate-400 dark:text-slate-600 text-xs">Sem lotes cadastrados</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="p-6 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-800 flex justify-between">
                  <Button variant="danger" icon={<Trash2 size={16} />} onClick={handleDeleteEvent}>Excluir Evento</Button>
                  <div className="flex gap-3">
                    <Button variant="ghost" onClick={() => { setSelectedEventId(null); setEditEventData(null); }}>Cancelar</Button>
                    <Button variant="primary" icon={<Save size={16} />} onClick={handleSaveEventChanges}>Salvar</Button>
                  </div>
                </div>
              </Card>
            </div>
          ) : (
            <>
              <div className="flex flex-col md:flex-row gap-4 mb-6">
                <div className="flex-1 flex gap-2 overflow-x-auto pb-2 md:pb-0">
                  <button onClick={() => setFilterCluster('all')}
                    className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap border transition-all ${filterCluster === 'all' ? 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-white border-slate-300 dark:border-slate-600' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400'}`}>Todos</button>
                  {(Object.keys(CLUSTERS) as EventCluster[]).map(key => (
                    <button key={key} onClick={() => setFilterCluster(key)}
                      className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap border transition-all ${filterCluster === key ? `${CLUSTERS[key].color} border-transparent` : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400'}`}>
                      {CLUSTERS[key].label.split('/')[0]}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<RefreshCw size={16} className={isSyncing ? 'animate-spin' : ''} />}
                    onClick={handleSyncRadar}
                    disabled={isSyncing}
                  >
                    {isSyncing ? 'Sincronizando...' : 'Sync Radar'}
                  </Button>
                  <Button variant="outline" icon={<Plus size={16} />} onClick={() => setIsEventFormOpen(!isEventFormOpen)}>
                    Registrar Evento
                  </Button>
                </div>
              </div>

              {scraperStatus?.lastRun && (
                <div className="flex items-center gap-4 mb-4 text-xs text-slate-500 dark:text-slate-400">
                  <span className="flex items-center gap-1"><Clock size={12} /> Última sync: {formatTimeAgo(scraperStatus.lastRun)}</span>
                  {scraperStatus.totalNewEvents > 0 && <span className="text-green-600 dark:text-green-400">+{scraperStatus.totalNewEvents} novos</span>}
                  {scraperStatus.totalUpdated > 0 && <span className="text-blue-600 dark:text-blue-400">{scraperStatus.totalUpdated} atualizados</span>}
                </div>
              )}

              {isEventFormOpen && (
                <Card className="mb-6">
                  <h3 className="font-bold text-slate-800 dark:text-white mb-4 text-sm uppercase">Novo Evento Externo</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <input placeholder="Nome do Evento" value={newEventTitle} onChange={e => setNewEventTitle(e.target.value)} className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded p-2 text-sm text-slate-800 dark:text-white focus:border-indigo-500 outline-none" />
                    <select value={newEventCompetitor} onChange={e => setNewEventCompetitor(e.target.value)} className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded p-2 text-sm text-slate-800 dark:text-white">
                      {competitors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <input type="date" value={newEventDate} onChange={e => setNewEventDate(e.target.value)} className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded p-2 text-sm text-slate-800 dark:text-white" />
                    <input type="number" placeholder="Preço Porta (R$)" value={newEventPrice} onChange={e => setNewEventPrice(Number(e.target.value))} className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded p-2 text-sm text-slate-800 dark:text-white" />
                    <input placeholder="Lineup (separe por vírgula)" value={newLineup} onChange={e => setNewLineup(e.target.value)} className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded p-2 text-sm text-slate-800 dark:text-white md:col-span-2" />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => setIsEventFormOpen(false)}>Cancelar</Button>
                    <Button variant="primary" onClick={handleAddEvent}>Salvar</Button>
                  </div>
                </Card>
              )}

              <div className="space-y-4">
                {filteredEvents.map(evt => {
                  const comp = getCompetitor(evt.competitorId);
                  const overlap = checkArtistOverlap(evt.lineupNames);
                  const ci = CLUSTERS[evt.cluster];
                  return (
                    <Card key={evt.id} hoverable onClick={() => handleEventClick(evt)} padding="none" className="overflow-hidden">
                      <div className="p-4 flex flex-col md:flex-row gap-4 relative">
                        <div className="absolute right-4 top-4 opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 dark:text-slate-500"><Edit2 size={16} /></div>
                        <div className="flex flex-col items-center justify-center p-3 bg-slate-100 dark:bg-slate-800 rounded-lg min-w-[80px] border border-slate-200 dark:border-slate-700">
                          <Calendar size={20} className="text-slate-400 dark:text-slate-500 mb-1" />
                          <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">{evt.date.split('-').reverse().slice(0, 2).join('/')}</span>
                        </div>
                        <div className="flex-1">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${ci.color}`}>{ci.label.split('/')[0]}</span>
                            {evt.source && evt.source !== 'manual' && (
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase border ${
                                evt.source === 'sympla' ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-800'
                                : evt.source === 'shotgun' ? 'bg-cyan-50 dark:bg-cyan-900/20 text-cyan-600 dark:text-cyan-400 border-cyan-200 dark:border-cyan-800'
                                : 'bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 border-violet-200 dark:border-violet-800'
                              }`}>{evt.source}</span>
                            )}
                            <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1"><MapPin size={12} /> {comp?.name} ({comp?.neighborhood})</span>
                            {comp?.capacity ? <span className="text-[10px] text-slate-500 flex items-center gap-0.5 border border-slate-200 dark:border-slate-700 px-1 rounded bg-slate-50 dark:bg-slate-800"><Users size={10} /> {comp.capacity}</span> : null}
                          </div>
                          <h3 className="font-bold text-lg text-slate-800 dark:text-white mb-2 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">{evt.title}</h3>
                          <div className="text-sm text-slate-600 dark:text-slate-300 mb-2">
                            <span className="text-slate-400 dark:text-slate-500 text-xs uppercase font-bold mr-2">Lineup:</span>
                            {evt.lineupNames.map((name, i) => {
                              const isM = overlap.includes(name);
                              return <span key={i} className={isM ? "text-indigo-600 dark:text-indigo-300 font-bold bg-indigo-100 dark:bg-indigo-900/30 px-1 rounded mx-0.5" : "text-slate-600 dark:text-slate-300 mx-0.5"}>{name}{i < evt.lineupNames.length - 1 ? ',' : ''}</span>;
                            })}
                          </div>
                        </div>
                        <div className="flex flex-col items-end justify-between min-w-[100px] border-l border-slate-200 dark:border-slate-700 pl-4">
                          <div className="font-mono text-green-600 dark:text-green-400 font-bold">R$ {evt.ticketPrice}</div>
                          {overlap.length > 0 && <div className="mt-2 text-xs bg-indigo-600 text-white px-2 py-1 rounded flex items-center gap-1 shadow-lg shadow-indigo-900/50"><AlertTriangle size={12} /><span>Seu Artista</span></div>}
                          {evt.tickets && evt.tickets.length > 0 && <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-1"><Ticket size={10} /> {evt.tickets.length} Lotes</div>}
                          {evt.sourceUrl && (
                            <a href={evt.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="mt-1 text-[10px] text-indigo-500 hover:text-indigo-600 flex items-center gap-1">
                              <ExternalLink size={10} /> Ver original
                            </a>
                          )}
                        </div>
                      </div>
                    </Card>
                  );
                })}
                {filteredEvents.length === 0 && <EmptyState icon={Calendar} title="Nenhum evento externo" description="Nenhum evento externo registrado." size="sm" />}
              </div>
            </>
          )}
        </>
      )}

      {/* COMPETITORS TAB */}
      {activeTab === 'competitors' && (
        <>
          <Modal
            isOpen={isCompetitorFormOpen}
            onClose={() => setIsCompetitorFormOpen(false)}
            title={editingCompetitorId ? 'Editar Concorrente' : 'Novo Concorrente'}
            size="md"
            footer={
              <Button variant="primary" fullWidth icon={<Save size={16} />} onClick={handleSaveCompetitor}>Salvar</Button>
            }
          >
            <div className="space-y-4">
              <Input label="NOME DO ESPAÇO" value={compName} onChange={e => setCompName(e.target.value)} />
              <div className="flex gap-4">
                <div className="flex-1"><Input label="BAIRRO" value={compNeighborhood} onChange={e => setCompNeighborhood(e.target.value)} /></div>
                <div className="flex-1"><Input label="CAPACIDADE" type="number" value={String(compCapacity)} onChange={e => setCompCapacity(Number(e.target.value))} /></div>
              </div>
              <Input label="ENDEREÇO" value={compAddress} onChange={e => setCompAddress(e.target.value)} placeholder="Rua Augusta, 123" />
              <div>
                <label className="block text-xs font-mono text-slate-500 dark:text-slate-400 mb-1">FAIXA DE PREÇO</label>
                <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1 border border-slate-200 dark:border-slate-700">
                  {(['low', 'mid', 'high'] as const).map(p => (
                    <button key={p} onClick={() => setCompPrice(p)} className={`flex-1 py-1.5 text-xs font-bold rounded transition-all ${compPrice === p ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm' : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'}`}>
                      {p === 'low' ? '$' : p === 'mid' ? '$$' : '$$$'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-mono text-slate-500 dark:text-slate-400 mb-2">CLUSTERS PRINCIPAIS</label>
                <div className="flex flex-wrap gap-2">
                  {Object.keys(CLUSTERS).map(k => {
                    const key = k as EventCluster;
                    const isActive = compClusters.includes(key);
                    return (<button key={key} onClick={() => toggleCompCluster(key)} className={`px-2 py-1 rounded text-[10px] font-bold uppercase border transition-all ${isActive ? `${CLUSTERS[key].color} border-transparent` : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500'}`}>{CLUSTERS[key].label.split('/')[0]}</button>);
                  })}
                </div>
              </div>
            </div>
          </Modal>

          {selectedCompetitor ? (
            <div>
              <Button variant="ghost" size="sm" icon={<ArrowLeft size={16} />} onClick={() => setSelectedCompetitor(null)} className="mb-6">
                Voltar para Lista
              </Button>
              <Card className="mb-8" padding="lg">
                <div className="flex justify-between items-start">
                  <div>
                    <h2 className="text-3xl font-bold text-slate-800 dark:text-white mb-1">{selectedCompetitor.name}</h2>
                    <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 mb-4"><MapPin size={14} className="text-indigo-500" /><span>{selectedCompetitor.address ? `${selectedCompetitor.address} - ` : ''}{selectedCompetitor.neighborhood}</span></div>
                    <div className="flex flex-wrap gap-2">{selectedCompetitor.mainClusters.map(c => (<span key={c} className={`px-2 py-1 rounded text-xs font-bold uppercase ${CLUSTERS[c].color}`}>{CLUSTERS[c].label.split('/')[0]}</span>))}</div>
                  </div>
                  <Button variant="ghost" icon={<Edit2 size={18} />} onClick={() => openCompetitorForm(selectedCompetitor)} />
                </div>
              </Card>
              <h3 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2"><Calendar className="text-indigo-500" size={18} /> Agenda do Espaço</h3>
              <div className="space-y-4">
                {filteredEvents.length > 0 ? filteredEvents.map(evt => {
                  const ci = CLUSTERS[evt.cluster];
                  return (
                    <Card key={evt.id} padding="none" className="overflow-hidden">
                      <div className="p-4 flex flex-col md:flex-row gap-4">
                        <div className="flex flex-col items-center p-3 bg-slate-100 dark:bg-slate-800 rounded-lg min-w-[80px] border border-slate-200 dark:border-slate-700"><Calendar size={20} className="text-slate-400 dark:text-slate-500 mb-1" /><span className="text-xs text-slate-500 dark:text-slate-400 font-mono">{evt.date.split('-').reverse().slice(0, 2).join('/')}</span></div>
                        <div className="flex-1"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase mb-1 inline-block ${ci.color}`}>{ci.label.split('/')[0]}</span><h3 className="font-bold text-lg text-slate-800 dark:text-white mb-1">{evt.title}</h3><p className="text-sm text-slate-500 dark:text-slate-400">{evt.lineupNames.join(', ')}</p></div>
                        <div className="flex flex-col items-end justify-center min-w-[100px] pl-4"><div className="font-mono text-green-600 dark:text-green-400 font-bold">R$ {evt.ticketPrice}</div></div>
                      </div>
                    </Card>
                  );
                }) : <EmptyState icon={Calendar} title="Nenhum evento registrado" description="Nenhum evento registrado para este concorrente." size="sm" />}
              </div>
            </div>
          ) : (
            <div>
              <div className="flex justify-end mb-6">
                <Button variant="primary" icon={<Plus size={16} />} onClick={() => openCompetitorForm()}>Adicionar Concorrente</Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {competitors.map(comp => (
                  <Card key={comp.id} hoverable onClick={() => setSelectedCompetitor(comp)}>
                    <div className="flex justify-between items-start mb-4">
                      <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 group-hover:border-indigo-500/30"><MapPin className="text-indigo-500" /></div>
                      <div className="flex flex-col items-end gap-1">
                        <div className="text-xs font-mono px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 uppercase">{comp.priceRange === 'low' ? '$ Baixo' : comp.priceRange === 'mid' ? '$$ Médio' : '$$$ Alto'}</div>
                        {comp.capacity > 0 && <div className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-1"><Users size={10} /> {comp.capacity} pax</div>}
                      </div>
                    </div>
                    <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-1 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">{comp.name}</h3>
                    <p className="text-slate-500 dark:text-slate-400 text-sm mb-4 line-clamp-1">{comp.address || comp.neighborhood}</p>
                    <div className="space-y-2">
                      <p className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Foco Principal</p>
                      <div className="flex flex-wrap gap-2">{comp.mainClusters.map(c => (<span key={c} className="text-xs bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 px-2 py-1 rounded">{CLUSTERS[c].label.split('/')[0]}</span>))}</div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default RadarView;
