import React from 'react';
import { Calendar, Clock, MapPin } from 'lucide-react';
import { AgendaEvent } from '../../../types/projects';
import { AppView } from '../../../types/common';
import { formatDateOnly } from '../../../utils/dateUtils';

interface ProjectEventsTabProps {
    events: AgendaEvent[];
    onNavigate?: (view: AppView, id: string) => void;
}

export const ProjectEventsTab: React.FC<ProjectEventsTabProps> = ({
    events,
    onNavigate
}) => {
    return (
        <div className="space-y-3">
            <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-slate-800 dark:text-white">Eventos do Projeto</h3>
            </div>

            {events.length === 0 ? (
                <p className="text-center text-slate-400 py-10">Nenhum evento encontrado.</p>
            ) : (
                events.map(e => (
                    <div
                        key={e.id}
                        onClick={() => onNavigate && onNavigate('agenda', e.id)}
                        className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:shadow-sm transition-shadow cursor-pointer"
                    >
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <Calendar size={18} className="text-indigo-500" />
                                <span className="font-bold text-slate-800 dark:text-white text-sm">{e.label}</span>
                            </div>
                            <span className={`px-2 py-0.5 rounded text-xs ${e.percentage === 100 ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                                {e.percentage}%
                            </span>
                        </div>
                        <div className="text-xs text-slate-500 space-y-1">
                            <div className="flex items-center gap-2">
                                <Clock size={14} />
                                <span>{formatDateOnly(e.date_start)} - {formatDateOnly(e.date_end)}</span>
                            </div>
                            {e.location && (
                                <div className="flex items-center gap-2">
                                    <MapPin size={14} />
                                    <span>{e.location}</span>
                                </div>
                            )}
                            {e.description && (
                                <p className="mt-2 text-slate-600 dark:text-slate-400 line-clamp-2">{e.description}</p>
                            )}
                        </div>
                    </div>
                ))
            )}
        </div>
    );
};

export default ProjectEventsTab;
