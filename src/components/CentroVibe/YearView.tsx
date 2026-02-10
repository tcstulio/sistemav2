import React from 'react';
import { SEASONS } from './constants';
import { Card } from '../ui';
import { Season } from '../../types/centrovibe';

interface YearViewProps {
  onMonthSelect: (monthIndex: number) => void;
}

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

const YearView: React.FC<YearViewProps> = ({ onMonthSelect }) => {
  return (
    <div className="space-y-8">
      <Card>
        <h2 className="text-2xl font-bold text-slate-800 dark:text-white mb-2">Visão Anual Estratégica</h2>
        <p className="text-slate-500 dark:text-slate-400">
          Planejamento sazonal para alinhar a "Vibe" da casa com o calendário cultural de São Paulo.
        </p>
      </Card>

      <div className="relative border-l-2 border-slate-200 dark:border-slate-800 ml-4 md:ml-8 space-y-12 py-4">
        {SEASONS.map((season: Season) => (
          <div key={season.id} className="relative pl-8 md:pl-12">
            <div className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-gradient-to-r ${season.color} shadow-lg shadow-indigo-500/20`} />

            <div className="flex flex-col md:flex-row gap-6 items-start">
              <div className="md:w-1/3">
                <h3 className={`text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r ${season.color} mb-1`}>
                  {season.label}
                </h3>
                <p className="text-slate-700 dark:text-slate-200 font-medium mb-2">{season.theme}</p>
                <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">{season.description}</p>
              </div>

              <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-3 w-full">
                {season.months.map((monthIndex) => (
                  <button
                    key={monthIndex}
                    onClick={() => onMonthSelect(monthIndex)}
                    className="group relative overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 text-left transition-all hover:border-indigo-500 hover:scale-[1.02] hover:shadow-md"
                  >
                    <div className={`absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity bg-gradient-to-bl ${season.color} rounded-bl-xl`} />
                    <span className="block text-xs text-slate-400 dark:text-slate-500 font-mono mb-1 uppercase">Mês {monthIndex + 1}</span>
                    <span className="block text-lg font-bold text-slate-800 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                      {MONTH_NAMES[monthIndex]}
                    </span>
                    <div className="mt-2 text-[10px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity">
                      Ver Calendário →
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default YearView;
