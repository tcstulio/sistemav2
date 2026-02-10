import React, { useState, useEffect, useCallback } from 'react';
import { CentroVibeService } from '../../services/centrovibeService';
import { INITIAL_SCHEDULE, INITIAL_ARTISTS, INITIAL_COMPETITORS, INITIAL_EXTERNAL_EVENTS } from './constants';
import { CentroVibeViewMode, VenueEvent, DaySchedule, Artist, Competitor, ExternalEvent, CentroVibeData } from '../../types/centrovibe';
import AgendaCard from './AgendaCard';
import EventDetailsModal from './EventDetailsModal';
import MonthView from './MonthView';
import YearView from './YearView';
import ArtistList from './ArtistList';
import ClusterList from './ClusterList';
import RadarView from './RadarView';
import AssistantModal from './AssistantModal';
import VibeCheck from './VibeCheck';
import { PageLayout, PageHeader, Tabs, Tab, Button, Card, Spinner } from '../ui';
import { Sparkles, Users, Calendar, LayoutGrid, CalendarDays, BarChart3, Mic2, Radar } from 'lucide-react';
import { toast } from 'sonner';

interface CentroVibeManagerProps {
  config?: unknown;
  onNavigate?: (view: string, id?: string) => void;
  initialItemId?: string;
  onRefresh?: (options?: { forceFull?: boolean }) => Promise<void>;
}

const CentroVibeManager: React.FC<CentroVibeManagerProps> = () => {
  const [schedule, setSchedule] = useState<DaySchedule[]>(INITIAL_SCHEDULE);
  const [artists, setArtists] = useState<Artist[]>(INITIAL_ARTISTS);
  const [competitors, setCompetitors] = useState<Competitor[]>(INITIAL_COMPETITORS);
  const [externalEvents, setExternalEvents] = useState<ExternalEvent[]>(INITIAL_EXTERNAL_EVENTS);

  const [selectedEvent, setSelectedEvent] = useState<VenueEvent | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'green_area' | 'main_hall'>('all');
  const [viewMode, setViewMode] = useState<CentroVibeViewMode>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const data = await CentroVibeService.fetchData();
        if (data.schedule?.length) setSchedule(data.schedule);
        if (data.artists?.length) setArtists(data.artists);
        if (data.competitors?.length) setCompetitors(data.competitors);
        if (data.externalEvents?.length) setExternalEvents(data.externalEvents);
      } catch {
        try {
          await CentroVibeService.saveData({
            schedule: INITIAL_SCHEDULE,
            artists: INITIAL_ARTISTS,
            competitors: INITIAL_COMPETITORS,
            externalEvents: INITIAL_EXTERNAL_EVENTS
          });
        } catch { /* backend might be down */ }
      }
      setLoading(false);
    };
    loadData();
  }, []);

  const saveAll = useCallback(async (data: Partial<CentroVibeData>) => {
    try {
      await CentroVibeService.saveData({
        schedule: data.schedule ?? schedule,
        artists: data.artists ?? artists,
        competitors: data.competitors ?? competitors,
        externalEvents: data.externalEvents ?? externalEvents,
      });
    } catch {
      toast.error('Erro ao salvar dados');
    }
  }, [schedule, artists, competitors, externalEvents]);

  const handleMonthSelect = (monthIndex: number) => {
    setCurrentDate(new Date(currentDate.getFullYear(), monthIndex, 1));
    setViewMode('month');
  };

  const handleEventClick = (event: VenueEvent) => setSelectedEvent(event);

  const handleEventUpdate = (updatedEvent: VenueEvent) => {
    const newSchedule = schedule.map(day => ({
      ...day,
      events: day.events.map(ev => ev.id === updatedEvent.id ? updatedEvent : ev)
    }));
    setSchedule(newSchedule);
    setSelectedEvent(updatedEvent);
    saveAll({ schedule: newSchedule });
  };

  const handleAddArtist = (newArtist: Artist) => {
    const updated = [...artists, newArtist];
    setArtists(updated);
    saveAll({ artists: updated });
  };

  const handleCompetitorsChange = (updated: Competitor[]) => {
    setCompetitors(updated);
    saveAll({ competitors: updated });
  };

  const handleExternalEventsChange = (updated: ExternalEvent[]) => {
    setExternalEvents(updated);
    saveAll({ externalEvents: updated });
  };

  if (loading) {
    return (
      <PageLayout title="CentroVibe">
        <div className="flex items-center justify-center h-64">
          <Spinner />
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="CentroVibe">
      <PageHeader
        title="CentroVibe"
        subtitle="Gestão de Agenda & Eventos"
        actions={
          <div className="flex items-center gap-3">
            <span className="hidden md:flex items-center gap-2 text-xs font-mono text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 py-1.5 px-3 rounded-full border border-slate-200 dark:border-slate-700">
              <Users size={12} />
              <span>Cap: 800 (250+650)</span>
            </span>
            <Button variant="primary" icon={<Sparkles size={16} />} onClick={() => setIsAssistantOpen(true)}>
              Advisor IA
            </Button>
          </div>
        }
        tabs={
          <Tabs value={viewMode} onChange={(v) => setViewMode(v as CentroVibeViewMode)}>
            <Tab value="week"><LayoutGrid size={14} className="inline mr-1.5 -mt-0.5" />Estratégia</Tab>
            <Tab value="month"><CalendarDays size={14} className="inline mr-1.5 -mt-0.5" />Mês</Tab>
            <Tab value="year"><BarChart3 size={14} className="inline mr-1.5 -mt-0.5" />Ano</Tab>
            <Tab value="artists"><Mic2 size={14} className="inline mr-1.5 -mt-0.5" />Artistas</Tab>
            <Tab value="vibes"><Sparkles size={14} className="inline mr-1.5 -mt-0.5" />Vibes & Clusters</Tab>
            <Tab value="radar"><Radar size={14} className="inline mr-1.5 -mt-0.5" />Radar</Tab>
          </Tabs>
        }
      />

      <div className="mt-6 space-y-6">
        {viewMode === 'week' && (
          <div className="space-y-6">
            {/* Filter bar */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="text-indigo-500" size={20} />
                <h2 className="text-xl font-bold text-slate-800 dark:text-white">Agenda Modelo (Semanal)</h2>
              </div>
              <div className="flex p-1 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                {[
                  { value: 'all' as const, label: 'Tudo', active: '' },
                  { value: 'green_area' as const, label: 'Área Verde', active: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' },
                  { value: 'main_hall' as const, label: 'Main Hall', active: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300' },
                ].map(f => (
                  <button
                    key={f.value}
                    onClick={() => setSelectedFilter(f.value)}
                    className={`px-3 py-1 text-xs rounded-md transition-all ${selectedFilter === f.value ? (f.active || 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm') : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Agenda Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {schedule.map((daySchedule) => {
                const visibleEvents = daySchedule.events.filter(e =>
                  selectedFilter === 'all' || e.space === selectedFilter
                );
                if (selectedFilter !== 'all' && visibleEvents.length === 0) return null;
                return (
                  <div key={daySchedule.day} className="flex flex-col gap-3">
                    <div className="flex items-baseline justify-between px-1">
                      <h3 className="font-bold text-slate-700 dark:text-slate-200">{daySchedule.day}</h3>
                      <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-mono uppercase border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/10 px-1.5 py-0.5 rounded">{daySchedule.theme}</span>
                    </div>
                    {visibleEvents.map(event => (
                      <AgendaCard key={event.id} event={event} onClick={handleEventClick} />
                    ))}
                    {visibleEvents.length === 0 && (
                      <div className="h-24 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl flex items-center justify-center text-xs text-slate-400 dark:text-slate-600">Sem eventos neste setor</div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Week strategy + Vibe Check */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <h3 className="font-bold text-slate-700 dark:text-slate-200 mb-3 text-sm uppercase tracking-wide">Lógica da Semana</h3>
                <ul className="space-y-3">
                  <li className="flex gap-3 text-sm text-slate-500 dark:text-slate-400">
                    <span className="w-1.5 h-1.5 mt-1.5 rounded-full bg-amber-500 shrink-0" />
                    <span><strong className="text-slate-700 dark:text-slate-300">Seg-Qui:</strong> Foco em nichos e fidelização (Happy Hour estendido).</span>
                  </li>
                  <li className="flex gap-3 text-sm text-slate-500 dark:text-slate-400">
                    <span className="w-1.5 h-1.5 mt-1.5 rounded-full bg-indigo-500 shrink-0" />
                    <span><strong className="text-slate-700 dark:text-slate-300">Sexta:</strong> Open Format (Caos Organizado).</span>
                  </li>
                  <li className="flex gap-3 text-sm text-slate-500 dark:text-slate-400">
                    <span className="w-1.5 h-1.5 mt-1.5 rounded-full bg-green-500 shrink-0" />
                    <span><strong className="text-slate-700 dark:text-slate-300">Sábado:</strong> Maratona (Feijoada → Sunset → Balada).</span>
                  </li>
                </ul>
              </Card>
              <VibeCheck />
            </div>
          </div>
        )}

        {viewMode === 'month' && (
          <MonthView schedule={schedule} currentDate={currentDate} onDateChange={setCurrentDate} onEventClick={handleEventClick} />
        )}

        {viewMode === 'year' && (
          <YearView onMonthSelect={handleMonthSelect} />
        )}

        {viewMode === 'artists' && (
          <ArtistList artists={artists} onAddArtist={handleAddArtist} />
        )}

        {viewMode === 'vibes' && (
          <ClusterList artists={artists} competitors={competitors} />
        )}

        {viewMode === 'radar' && (
          <RadarView
            myArtists={artists}
            competitors={competitors}
            externalEvents={externalEvents}
            onAddArtist={handleAddArtist}
            onCompetitorsChange={handleCompetitorsChange}
            onExternalEventsChange={handleExternalEventsChange}
          />
        )}
      </div>

      {/* Modals */}
      <EventDetailsModal
        event={selectedEvent}
        onClose={() => setSelectedEvent(null)}
        onUpdateEvent={handleEventUpdate}
        allArtists={artists}
      />
      <AssistantModal isOpen={isAssistantOpen} onClose={() => setIsAssistantOpen(false)} />
    </PageLayout>
  );
};

export default CentroVibeManager;
