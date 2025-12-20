import React, { useMemo } from 'react';
import { RecruitmentJobPosition, Candidate, DolibarrConfig } from '../../../types';
import { Briefcase, ChevronRight, Users, Eye } from 'lucide-react';

interface RecruitmentJobsListProps {
    jobPositions: RecruitmentJobPosition[];
    candidates: Candidate[];
    searchTerm: string;
    sortConfig: { key: string, direction: 'asc' | 'desc' };
    displayLimit: number;
    viewingCandidatesId: string | null;
    config: DolibarrConfig;
    onViewCandidates: (jobId: string) => void;
    onOpenJobModal: () => void;
    setDisplayLimit: React.Dispatch<React.SetStateAction<number>>;
}

export const RecruitmentJobsList: React.FC<RecruitmentJobsListProps> = ({
    jobPositions,
    candidates,
    searchTerm,
    sortConfig,
    displayLimit,
    viewingCandidatesId,
    config,
    onViewCandidates,
    onOpenJobModal,
    setDisplayLimit
}) => {

    const getCandidateCount = (jobId: string) => {
        return candidates.filter(c => String(c.fk_job_position) === String(jobId)).length;
    };

    const filteredJobs = useMemo(() => {
        let result = jobPositions.filter(j => j.label.toLowerCase().includes(searchTerm.toLowerCase()));
        if (sortConfig.key !== 'default') {
            result.sort((a, b) => {
                let valA: any = '', valB: any = '';
                if (sortConfig.key === 'label') {
                    valA = a.label.toLowerCase();
                    valB = b.label.toLowerCase();
                } else if (sortConfig.key === 'qty') {
                    valA = a.qty;
                    valB = b.qty;
                }
                if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
                if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return result;
    }, [jobPositions, searchTerm, sortConfig]);

    const displayedJobs = filteredJobs.slice(0, displayLimit);

    if (displayedJobs.length === 0) {
        return (
            <div className="text-center py-20 text-slate-400">
                <Briefcase size={48} className="mx-auto mb-4 opacity-50" />
                <p>Nenhuma vaga encontrada.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4">
                {/* "All Candidates" special item */}
                <div
                    onClick={() => onViewCandidates('ALL')}
                    className={`p-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 cursor-pointer transition-colors flex justify-between items-center ${viewingCandidatesId === 'ALL' ? 'bg-slate-100 dark:bg-slate-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                >
                    <div className="flex items-center gap-3">
                        <div className="bg-slate-200 dark:bg-slate-700 p-2 rounded-lg text-slate-600 dark:text-slate-300">
                            <Users size={20} />
                        </div>
                        <span className="font-medium text-slate-700 dark:text-slate-300">Ver Todos os Candidatos</span>
                    </div>
                    <span className="bg-indigo-600 text-white px-2 py-1 rounded-full text-xs font-bold">{candidates.length}</span>
                </div>

                {displayedJobs.map(job => (
                    <div
                        key={job.id}
                        onClick={() => onViewCandidates(job.id)}
                        className={`p-4 rounded-xl border cursor-pointer transition-all ${viewingCandidatesId === job.id ? `bg-${config.themeColor}-50 dark:bg-${config.themeColor}-900/20 border-${config.themeColor}-200 dark:border-${config.themeColor}-800` : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:shadow-md'}`}
                    >
                        <div className="flex justify-between items-start mb-2">
                            <h4 className="font-bold text-slate-800 dark:text-white">{job.label}</h4>
                            <span className={`text-xs px-2 py-0.5 rounded ${job.status === '1' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                                {job.status === '1' ? 'Aberto' : 'Rascunho'}
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 line-clamp-2 mb-2">{job.description || "Sem descrição"}</p>
                        <div className="flex items-center gap-2 text-xs text-slate-400 justify-between">
                            <div className="flex gap-2">
                                <span className="bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">Qtd: {job.qty}</span>
                                <span className={`px-2 py-1 rounded flex items-center gap-1 ${viewingCandidatesId === job.id ? 'bg-white text-indigo-600 shadow-sm' : 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400'}`}>
                                    <Users size={10} /> {getCandidateCount(job.id)} Candidatos
                                </span>
                            </div>
                            <div className="flex items-center gap-1">
                                {viewingCandidatesId === job.id && <Eye size={12} className="text-indigo-500" />}
                                <span>Ref: {job.ref}</span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
            {filteredJobs.length > displayedJobs.length && (
                <button onClick={() => setDisplayLimit(prev => prev + 50)} className="w-full py-3 mt-4 text-sm font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 border border-dashed border-slate-300 dark:border-slate-700 rounded-lg hover:border-slate-400 transition-colors flex items-center justify-center gap-2">
                    <ChevronRight size={16} /> Carregar Mais
                </button>
            )}
        </div>
    );
};
