
import React from 'react';
import { CheckCircle2, Circle, AlertTriangle, AlertOctagon } from 'lucide-react';
import { API_COVERAGE_MATRIX, CoverageStatus } from '../../config/apiCoverage';

export const CoverageTab: React.FC = () => {

    const getStatusIcon = (status: CoverageStatus) => {
        switch (status) {
            case 'implemented': return <CheckCircle2 size={16} className="text-emerald-500" />;
            case 'mocked': return <Circle size={16} className="text-amber-500" />;
            case 'gap': return <AlertTriangle size={16} className="text-red-500" />;
            case 'limitation': return <AlertOctagon size={16} className="text-purple-500" />;
        }
    };

    return (
        <div className="p-6 h-full overflow-y-auto bg-slate-50 dark:bg-slate-950/50">
            <div className="max-w-6xl mx-auto grid grid-cols-1 gap-8">
                {API_COVERAGE_MATRIX.map(domain => (
                    <div key={domain.id} className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
                        <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 flex items-center gap-3">
                            <div className="p-2 bg-slate-200 dark:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300">
                                <domain.icon size={20} />
                            </div>
                            <div>
                                <h3 className="font-bold text-slate-800 dark:text-white">{domain.title}</h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400">{domain.description}</p>
                            </div>
                        </div>
                        <div className="divide-y divide-slate-100 dark:divide-slate-800">
                            {domain.functions.map((fn, idx) => (
                                <div key={idx} className="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                    <div className="flex items-center gap-4">
                                        <div className="flex items-center gap-2 w-32">
                                            {getStatusIcon(fn.status)}
                                            <span className="text-xs font-semibold uppercase text-slate-500">{fn.status}</span>
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${fn.method === 'GET' ? 'bg-blue-100 text-blue-700' : fn.method === 'POST' ? 'bg-green-100 text-green-700' : fn.method === 'PUT' ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'}`}>
                                                    {fn.method}
                                                </span>
                                                <span className="font-mono text-sm text-slate-700 dark:text-slate-300">{fn.endpoint}</span>
                                            </div>
                                            <div className="text-sm font-medium text-slate-800 dark:text-white">{fn.name}</div>
                                        </div>
                                    </div>
                                    {fn.bodyTemplate && (
                                        <div className="hidden md:block">
                                            <span className="text-[10px] px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded text-slate-500 font-mono">
                                                Body Template Available
                                            </span>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
