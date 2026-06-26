import React, { useState, useEffect } from 'react';
import { VenueEvent, Artist, TicketBatch, EventCluster } from '../../types/centrovibe';
import { CLUSTERS } from './constants';
import { Modal, Button, Input } from '../ui';
import { Clock, MapPin, Ticket, User, Instagram, Users, Mic2, Plus, Trash2, Search, Edit2, X, AlertTriangle } from 'lucide-react';
import { formatCurrency } from '../../utils/formatUtils';
import { useDolibarr } from '../../context/DolibarrContext';
import { useConfirm } from '../../hooks/useConfirm';

interface EventDetailsModalProps {
  event: VenueEvent | null;
  onClose: () => void;
  onUpdateEvent: (event: VenueEvent) => void;
  onDeleteEvent?: (eventId: string) => void;
  allArtists: Artist[];
}

const DiscIcon = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="3" />
  </svg>
);

const EventDetailsModal: React.FC<EventDetailsModalProps> = ({ event, onClose, onUpdateEvent, onDeleteEvent, allArtists }) => {
  const { canDo } = useDolibarr();
  const confirm = useConfirm();
  const [localTickets, setLocalTickets] = useState<TicketBatch[]>([]);
  const [isAddingArtist, setIsAddingArtist] = useState(false);
  const [artistSearch, setArtistSearch] = useState('');

  useEffect(() => {
    if (event) setLocalTickets(event.tickets || []);
  }, [event]);

  if (!event) return null;

  const cluster = CLUSTERS[event.cluster];
  const Icon = cluster.icon;

  const lineupArtists = event.lineup
    ? event.lineup.map(id => allArtists.find(a => a.id === id)).filter((a): a is Artist => !!a)
    : [];

  const availableArtists = allArtists
    .filter(a => !event.lineup?.includes(a.id))
    .filter(a => a.name.toLowerCase().includes(artistSearch.toLowerCase()));

  const handleAddToLineup = (artistId: string) => {
    onUpdateEvent({ ...event, lineup: [...(event.lineup || []), artistId] });
    setIsAddingArtist(false);
    setArtistSearch('');
  };

  const handleRemoveFromLineup = (artistId: string) => {
    onUpdateEvent({ ...event, lineup: (event.lineup || []).filter(id => id !== artistId) });
  };

  const handleAddTicket = () => {
    const newBatch: TicketBatch = { id: Date.now().toString(), name: `Lote ${localTickets.length + 1}`, price: 0, totalCount: 100, status: 'active' };
    const updated = [...localTickets, newBatch];
    setLocalTickets(updated);
    onUpdateEvent({ ...event, tickets: updated });
  };

  const handleDeleteTicket = (ticketId: string) => {
    const updated = localTickets.filter(t => t.id !== ticketId);
    setLocalTickets(updated);
    onUpdateEvent({ ...event, tickets: updated });
  };

  const handleUpdateTicket = (ticketId: string, field: keyof TicketBatch, value: string | number) => {
    const updated = localTickets.map(t => t.id === ticketId ? { ...t, [field]: value } : t);
    setLocalTickets(updated);
    onUpdateEvent({ ...event, tickets: updated });
  };

  return (
    <Modal isOpen={!!event} onClose={onClose} size="xl" showCloseButton={false}>
      {/* Header Banner */}
      <div className={`relative -mx-6 -mt-6 mb-6 h-40 ${cluster.color.split(' ')[0]} bg-opacity-20 flex items-end p-6 overflow-hidden transition-colors duration-500`}>
        <div className="absolute inset-0 bg-gradient-to-t from-white dark:from-slate-900 via-white/40 dark:via-slate-900/40 to-transparent" />
        <div className="absolute -right-10 -top-10 text-slate-300 dark:text-white opacity-5"><Icon size={200} /></div>

        <div className="relative z-10 w-full flex justify-between items-end gap-4">
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <div className="relative group">
                <input value={event.genre} onChange={(e) => onUpdateEvent({ ...event, genre: e.target.value })}
                  className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-black/10 dark:bg-white/10 text-slate-700 dark:text-white border border-slate-300 dark:border-white/20 outline-none focus:bg-black/20 dark:focus:bg-white/20 w-24 sm:w-auto transition-all" placeholder="GÊNERO" />
                <Edit2 size={8} className="absolute right-1 top-1/2 -translate-y-1/2 text-slate-400 dark:text-white/30 opacity-0 group-hover:opacity-100 pointer-events-none" />
              </div>
              <select value={event.cluster} onChange={(e) => onUpdateEvent({ ...event, cluster: e.target.value as EventCluster })}
                className="appearance-none pl-2 pr-6 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-black/10 dark:bg-white/10 text-slate-700 dark:text-white border border-slate-300 dark:border-white/20 outline-none focus:bg-black/20 dark:focus:bg-white/20 cursor-pointer hover:bg-black/20 dark:hover:bg-white/20 transition-all">
                {Object.keys(CLUSTERS).map((key) => (
                  <option key={key} value={key} className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300">{CLUSTERS[key as EventCluster].label.split('/')[0]}</option>
                ))}
              </select>
              <button onClick={() => onUpdateEvent({ ...event, space: event.space === 'green_area' ? 'main_hall' : 'green_area' })}
                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border cursor-pointer hover:opacity-80 transition-all ${event.space === 'green_area' ? 'bg-green-500/20 text-green-700 dark:text-green-300 border-green-500/30' : 'bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border-indigo-500/30'}`}>
                {event.space === 'green_area' ? 'Área Verde' : 'Main Hall'}
              </button>
            </div>
            <input value={event.title} onChange={(e) => onUpdateEvent({ ...event, title: e.target.value })}
              className="text-3xl font-bold text-slate-800 dark:text-white leading-none bg-transparent outline-none border-b border-transparent hover:border-slate-300 dark:hover:border-white/20 focus:border-indigo-500 transition-all w-full placeholder-slate-400 dark:placeholder-white/50" placeholder="Nome do Evento" />
          </div>
          <div className="flex items-center gap-2 mb-1">
            {canDo('delete', 'centrovibe') && onDeleteEvent && (
              <button
                onClick={async () => {
                  if (!(await confirm({ message: 'Excluir este evento da agenda?', confirmText: 'Excluir', danger: true }))) return;
                  onDeleteEvent(event.id);
                  onClose();
                }}
                className="bg-red-500/20 hover:bg-red-500/40 text-red-600 dark:text-red-300 p-2 rounded-full backdrop-blur-md transition-colors border border-red-400/30 shrink-0"
                title="Excluir evento"
              >
                <AlertTriangle size={18} />
              </button>
            )}
            <button onClick={onClose} className="bg-black/20 dark:bg-black/40 hover:bg-black/30 dark:hover:bg-black/60 text-slate-600 dark:text-white p-2 rounded-full backdrop-blur-md transition-colors border border-slate-300 dark:border-white/10 shrink-0">
              <X size={20} />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          {/* Info */}
          <div className="flex flex-wrap gap-4 sm:gap-6 text-sm text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-indigo-500" />
              <div className="flex items-center gap-1 bg-white dark:bg-slate-900 rounded px-2 border border-slate-200 dark:border-slate-700/50">
                <input type="time" value={event.startTime} onChange={(e) => onUpdateEvent({ ...event, startTime: e.target.value })}
                  className="bg-transparent outline-none w-full text-center p-0.5 text-xs font-mono text-slate-700 dark:text-white" />
                <span>-</span>
                <input type="time" value={event.endTime} onChange={(e) => onUpdateEvent({ ...event, endTime: e.target.value })}
                  className="bg-transparent outline-none w-full text-center p-0.5 text-xs font-mono text-slate-700 dark:text-white" />
              </div>
            </div>
            <div className="flex items-center gap-2"><MapPin size={16} className="text-indigo-500" /><span>Centro Histórico, SP</span></div>
            <div className="flex items-center gap-2"><Users size={16} className="text-indigo-500" /><span>Cap: {event.space === 'green_area' ? '250' : '650'}</span></div>
          </div>

          {/* Lineup */}
          <div>
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2"><User className="text-indigo-500" size={20} /> Lineup</h3>
              {canDo('edit', 'centrovibe') && (
              <Button variant="outline" size="sm" icon={isAddingArtist ? <X size={12} /> : <Plus size={12} />} onClick={() => setIsAddingArtist(!isAddingArtist)}>
                {isAddingArtist ? 'Cancelar' : 'Add Atração'}
              </Button>
              )}
            </div>

            {isAddingArtist && (
              <div className="mb-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                <div className="mb-3">
                  <Input icon={<Search size={14} />} placeholder="Buscar artista..." value={artistSearch} onChange={e => setArtistSearch(e.target.value)} />
                </div>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {availableArtists.length > 0 ? availableArtists.map(artist => (
                    <button key={artist.id} onClick={() => handleAddToLineup(artist.id)}
                      className="w-full text-left flex items-center justify-between p-2 rounded hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:text-indigo-700 dark:hover:text-indigo-200 text-slate-600 dark:text-slate-300 text-sm transition-colors">
                      <span>{artist.name} <span className="text-xs text-slate-400 dark:text-slate-500 ml-1">({artist.subGenre})</span></span>
                      <Plus size={14} />
                    </button>
                  )) : <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-2">Nenhum artista encontrado.</p>}
                </div>
              </div>
            )}

            {lineupArtists.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {lineupArtists.map(artist => (
                  <div key={artist.id} className="group flex items-center gap-3 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors relative">
                    <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center shrink-0 text-slate-500 dark:text-slate-400">
                      {artist.role === 'dj' ? <DiscIcon size={16} /> : <Mic2 size={16} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-slate-800 dark:text-white text-sm truncate">{artist.name}</p>
                      <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{artist.subGenre}</p>
                    </div>
                    {canDo('delete', 'centrovibe') && (
                    <button onClick={() => handleRemoveFromLineup(artist.id)}
                      className="absolute -top-1 -right-1 bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-200 p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-200 dark:hover:bg-red-700" title="Remover do lineup">
                      <X size={12} />
                    </button>
                    )}
                    {artist.instagram && <span className="text-slate-400 dark:text-slate-500 hover:text-pink-500 transition-colors"><Instagram size={16} /></span>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-slate-400 dark:text-slate-500 text-sm border border-dashed border-slate-200 dark:border-slate-700 rounded-lg">Lineup em definição...</div>
            )}
          </div>

          {/* Description */}
          <div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-2">Sobre o evento</h3>
            <textarea value={event.description} onChange={(e) => onUpdateEvent({ ...event, description: e.target.value })}
              className="w-full h-32 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-slate-700 dark:text-slate-300 text-sm leading-relaxed focus:outline-none focus:border-indigo-500 resize-none" placeholder="Descrição do evento..." />
          </div>
        </div>

        {/* Tickets */}
        <div className="lg:col-span-1">
          <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 sticky top-0">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2"><Ticket className="text-green-500" size={20} /> Ingressos</h3>
              {canDo('edit', 'centrovibe') && (
              <Button variant="outline" size="sm" icon={<Plus size={12} />} onClick={handleAddTicket}>
                Add Lote
              </Button>
              )}
            </div>

            <div className="space-y-3">
              {localTickets.length > 0 ? localTickets.map(ticket => (
                <div key={ticket.id} className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-3 group hover:border-slate-300 dark:hover:border-slate-600 transition-colors">
                  <div className="flex flex-col gap-2">
                    <input type="text" value={ticket.name} onChange={(e) => handleUpdateTicket(ticket.id, 'name', e.target.value)}
                      className="bg-transparent text-sm font-medium text-slate-800 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 outline-none w-full border-b border-transparent focus:border-indigo-500" placeholder="Nome do Lote" />
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 text-xs">R$</span>
                        <input type="number" value={ticket.price} onChange={(e) => handleUpdateTicket(ticket.id, 'price', Number(e.target.value))}
                          className="bg-slate-50 dark:bg-slate-800 w-full rounded border border-slate-200 dark:border-slate-700 py-1 pl-6 pr-2 text-xs text-slate-800 dark:text-white focus:border-indigo-500 outline-none" />
                      </div>
                      <div className="relative flex-1">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 text-xs">Qtd</span>
                        <input type="number" value={ticket.totalCount || 0} onChange={(e) => handleUpdateTicket(ticket.id, 'totalCount', Number(e.target.value))}
                          className="bg-slate-50 dark:bg-slate-800 w-full rounded border border-slate-200 dark:border-slate-700 py-1 pl-8 pr-2 text-xs text-slate-800 dark:text-white focus:border-indigo-500 outline-none" />
                      </div>
                      {canDo('delete', 'centrovibe') && (
                      <button onClick={() => handleDeleteTicket(ticket.id)}
                        className="p-1.5 text-slate-400 dark:text-slate-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded transition-colors" title="Excluir lote">
                        <Trash2 size={14} />
                      </button>
                      )}
                    </div>
                  </div>
                </div>
              )) : (
                <div className="text-center py-6 text-slate-400 dark:text-slate-500 text-sm border border-dashed border-slate-200 dark:border-slate-700 rounded-lg">Defina os lotes de ingresso.</div>
              )}
            </div>

            <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center text-xs text-slate-500 dark:text-slate-400">
              <span>Estimativa de Receita:</span>
              <span className="font-mono font-bold text-green-600 dark:text-green-400 text-sm">
                {formatCurrency(localTickets.reduce((acc, t) => acc + (t.price * (t.totalCount || 0)), 0))}
              </span>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default EventDetailsModal;
