import React from 'react';
import { VenueEvent } from '../../types/centrovibe';
import { CLUSTERS } from './constants';
import { Card } from '../ui';
import { Clock, MapPin } from 'lucide-react';

interface AgendaCardProps {
  event: VenueEvent;
  onClick?: (event: VenueEvent) => void;
}

const AgendaCard: React.FC<AgendaCardProps> = ({ event, onClick }) => {
  const clusterInfo = CLUSTERS[event.cluster] || CLUSTERS.eclectic;
  const Icon = clusterInfo.icon;
  const isGreenArea = event.space === 'green_area';

  return (
    <Card
      hoverable
      onClick={() => onClick?.(event)}
      padding="none"
      className="relative overflow-hidden group"
    >
      <div className={`absolute top-0 left-0 h-full w-1 ${clusterInfo.color.split(' ')[0]}`} />

      <div className="p-4">
        <div className="flex justify-between items-start mb-2">
          <div className="flex items-center gap-2">
            <span className={`p-1.5 rounded-md text-xs font-bold ${clusterInfo.color}`}>
              <Icon size={14} />
            </span>
            <span className="text-xs font-mono text-slate-500 dark:text-slate-400 uppercase tracking-wider">{event.genre}</span>
          </div>
          <div className={`text-xs px-2 py-1 rounded-full border ${isGreenArea ? 'border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30' : 'border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30'}`}>
            {isGreenArea ? 'Área Verde (250p)' : 'Main Hall (650p)'}
          </div>
        </div>

        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-1 leading-tight group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">{event.title}</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-3 line-clamp-2">{event.description}</p>

        <div className="flex items-center gap-4 text-xs text-slate-400 dark:text-slate-500 font-mono mt-auto">
          <div className="flex items-center gap-1">
            <Clock size={12} />
            {event.startTime} - {event.endTime}
          </div>
          <div className="flex items-center gap-1">
            <MapPin size={12} />
            {isGreenArea ? 'Externo' : 'Interno'}
          </div>
        </div>
      </div>
    </Card>
  );
};

export default AgendaCard;
