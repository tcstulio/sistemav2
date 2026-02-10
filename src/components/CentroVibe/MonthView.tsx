import React from 'react';
import { SEASONS } from './constants';
import { Card, Button } from '../ui';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';
import { Season, VenueEvent, DaySchedule } from '../../types/centrovibe';

interface MonthViewProps {
  schedule: DaySchedule[];
  currentDate: Date;
  onDateChange: (date: Date) => void;
  onEventClick: (event: VenueEvent) => void;
}

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const MONTH_NAMES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

const MonthView: React.FC<MonthViewProps> = ({ schedule, currentDate, onDateChange, onEventClick }) => {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const currentSeason: Season | undefined = SEASONS.find(s => s.months.includes(month));

  const handlePrevMonth = () => onDateChange(new Date(year, month - 1, 1));
  const handleNextMonth = () => onDateChange(new Date(year, month + 1, 1));

  const renderDays = () => {
    const days = [];

    for (let i = 0; i < firstDayOfMonth; i++) {
      days.push(<div key={`empty-${i}`} className="h-32 bg-slate-50 dark:bg-slate-900/50 border-r border-b border-slate-200 dark:border-slate-800" />);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const dayOfWeek = date.getDay();
      const weekdayName = WEEKDAYS[dayOfWeek];
      const template = schedule.find(s => s.day === weekdayName);
      const eventsToDisplay = template?.events || [];
      let themeDisplay = template?.theme;
      let isSeasonalHighlight = false;

      if ((dayOfWeek === 5 || dayOfWeek === 6) && currentSeason) {
        isSeasonalHighlight = true;
        themeDisplay = dayOfWeek === 6 ? currentSeason.label : template?.theme;
      }

      days.push(
        <div key={day} className={`min-h-[140px] p-2 border-r border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/30 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 flex flex-col group ${isSeasonalHighlight ? 'bg-indigo-50/50 dark:bg-indigo-900/5' : ''}`}>
          <div className="flex justify-between items-start mb-2">
            <span className={`text-sm font-bold w-7 h-7 flex items-center justify-center rounded-full ${day === new Date().getDate() && month === new Date().getMonth() ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-400'}`}>
              {day}
            </span>
            {themeDisplay && (
              <span className={`text-[9px] uppercase font-mono px-1.5 py-0.5 rounded border max-w-[70%] truncate ${isSeasonalHighlight ? 'border-indigo-300 dark:border-indigo-500/30 text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/10' : 'border-slate-200 dark:border-slate-700 text-slate-500'}`}>
                {themeDisplay}
              </span>
            )}
          </div>
          <div className="flex-1 space-y-1.5 overflow-hidden">
            {eventsToDisplay.map((evt, idx) => (
              <button
                key={idx}
                onClick={(e) => { e.stopPropagation(); onEventClick(evt); }}
                className="w-full text-left flex flex-col bg-slate-50 dark:bg-slate-950/80 rounded p-1.5 border-l-2 border-slate-300 dark:border-slate-700 hover:border-indigo-500 hover:bg-indigo-50 dark:hover:bg-slate-800 transition-colors group/evt"
              >
                <span className="text-[10px] font-bold text-slate-700 dark:text-slate-200 truncate group-hover/evt:text-indigo-600 dark:group-hover/evt:text-indigo-400">{evt.title}</span>
                <span className="text-[9px] text-slate-400 dark:text-slate-500 truncate">{evt.genre}</span>
              </button>
            ))}
            {isSeasonalHighlight && dayOfWeek === 6 && currentSeason && (
              <div className="mt-1 text-[9px] text-center text-indigo-600 dark:text-indigo-400 font-mono bg-indigo-50 dark:bg-indigo-900/20 rounded py-1 pointer-events-none">
                ★ {currentSeason.theme}
              </div>
            )}
          </div>
        </div>
      );
    }
    return days;
  };

  return (
    <div>
      <Card className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg text-indigo-500">
              <CalendarIcon size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-800 dark:text-white capitalize">{MONTH_NAMES[month]} {year}</h2>
              {currentSeason && (
                <div className={`text-xs font-bold inline-flex items-center gap-1.5 bg-gradient-to-r ${currentSeason.color} bg-clip-text text-transparent`}>
                  <span>✦ {currentSeason.label}</span>
                  <span className="text-slate-400 dark:text-slate-500 font-normal">({currentSeason.theme})</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" icon={<ChevronLeft size={18} />} onClick={handlePrevMonth} />
            <Button variant="ghost" size="sm" icon={<ChevronRight size={18} />} onClick={handleNextMonth} />
          </div>
        </div>
      </Card>

      <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-sm">
        <div className="grid grid-cols-7 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-800">
          {WEEKDAYS.map(d => (
            <div key={d} className="py-3 text-center text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{d.slice(0, 3)}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">{renderDays()}</div>
      </div>
    </div>
  );
};

export default MonthView;
