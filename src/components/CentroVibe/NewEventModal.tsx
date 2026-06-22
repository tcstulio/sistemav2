import React, { useState } from 'react';
import { VenueEvent, DaySchedule, EventCluster, SpaceType } from '../../types/centrovibe';
import { CLUSTERS } from './constants';
import { Modal, Button, Input } from '../ui';

interface NewEventModalProps {
  isOpen: boolean;
  schedule: DaySchedule[];
  onClose: () => void;
  onAddEvent: (dayIndex: number, event: VenueEvent) => void;
}

const NewEventModal: React.FC<NewEventModalProps> = ({ isOpen, schedule, onClose, onAddEvent }) => {
  const [dayIndex, setDayIndex] = useState(0);
  const [title, setTitle] = useState('');
  const [startTime, setStartTime] = useState('20:00');
  const [endTime, setEndTime] = useState('00:00');
  const [space, setSpace] = useState<SpaceType>('green_area');
  const [cluster, setCluster] = useState<EventCluster>('brasil_raiz');
  const [genre, setGenre] = useState('');

  const reset = () => {
    setDayIndex(0); setTitle(''); setStartTime('20:00'); setEndTime('00:00');
    setSpace('green_area'); setCluster('brasil_raiz'); setGenre('');
  };

  const handleConfirm = () => {
    if (!title) return;
    const newEvent: VenueEvent = {
      id: Date.now().toString(),
      title,
      description: '',
      startTime,
      endTime,
      space,
      cluster,
      genre,
      lineup: [],
      tickets: [],
    };
    onAddEvent(dayIndex, newEvent);
    reset();
    onClose();
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Novo Evento na Agenda" size="md">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Dia da Semana</label>
          <select
            value={dayIndex}
            onChange={e => setDayIndex(Number(e.target.value))}
            className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
          >
            {schedule.map((day, i) => (
              <option key={day.day} value={i}>{day.day} — {day.theme}</option>
            ))}
          </select>
        </div>

        <Input
          label="Título do Evento"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Ex: Samba da Firma"
        />

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Início</label>
            <input
              type="time"
              value={startTime}
              onChange={e => setStartTime(e.target.value)}
              className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Fim</label>
            <input
              type="time"
              value={endTime}
              onChange={e => setEndTime(e.target.value)}
              className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Espaço</label>
            <select
              value={space}
              onChange={e => setSpace(e.target.value as SpaceType)}
              className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            >
              <option value="green_area">Área Verde (250)</option>
              <option value="main_hall">Main Hall (650)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Cluster (Vibe)</label>
            <select
              value={cluster}
              onChange={e => setCluster(e.target.value as EventCluster)}
              className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            >
              {(Object.keys(CLUSTERS) as EventCluster[]).map(k => (
                <option key={k} value={k}>{CLUSTERS[k].label}</option>
              ))}
            </select>
          </div>
        </div>

        <Input
          label="Gênero"
          value={genre}
          onChange={e => setGenre(e.target.value)}
          placeholder="Ex: Pagode 90, Techno"
        />

        <Button variant="primary" fullWidth onClick={handleConfirm} disabled={!title}>
          Criar Evento
        </Button>
      </div>
    </Modal>
  );
};

export default NewEventModal;
