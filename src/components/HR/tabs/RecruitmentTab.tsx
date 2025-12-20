import React, { useMemo, useState } from 'react';
import { RecruitmentJobPosition, Candidate } from '../../../types';
import { Briefcase, UserPlus, ChevronRight, User, Mail, ArrowLeft } from 'lucide-react';

interface RecruitmentTabProps {
    jobPositions: RecruitmentJobPosition[];
    candidates: Candidate[];
    searchTerm: string;
    sortConfig: { key: string, direction: 'asc' | 'desc' };
    onHireCandidate: (candidate: Candidate) => void;
    onOpenJobModal: () => void;
}

export const RecruitmentTab: React.FC<RecruitmentTabProps> = ({
    jobPositions,
    candidates,
    searchTerm,
    sortConfig,
    onHireCandidate,
    onOpenJobModal
}) => {
    const [viewingCandidates, setViewingCandidates] = useState<string | null>(null);

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

    const currentCandidates = useMemo(() => {
        if (!viewingCandidates) return [];
        if (viewingCandidates === 'ALL') return candidates;
        return candidates.filter(c => String(c.fk_job_position) === String(viewingCandidates));
    }, [candidates, viewingCandidates]);

    const getCandidateCount = (jobId: string) => {
        return candidates.filter(c => String(c.fk_job_position) === String(jobId)).length;
    };

    const getJobTitle = (jobId: string) => {
        if (!jobId || jobId === '0') return 'Sem Posição / Espontâneo';
        const j = jobPositions.find(p => String(p.id) === String(jobId));
        return j ? j.label : `Posição Desconhecida (ID: "${jobId}")`;
    };

    if (viewingCandidates) {
        return (
            <div className="space-y-4 animate-in slide-in-from-right-4">
                <div className="flex items-center gap-3 mb-4">
                    <button onClick={() => setViewingCandidates(null)} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full transition-colors">
                        <ArrowLeft size={20} className="text-slate-500 dark:text-slate-400" />
                    </button>
                    <h3 className="font-bold text-lg dark:text-white">Candidatos: {viewingCandidates === 'ALL' ? 'Todos' : getJobTitle(viewingCandidates)}</h3>
                </div>

                {currentCandidates.length === 0 ? (
                    <div className="text-center py-20 text-slate-400">
                        <User size={48} className="mx-auto mb-4 opacity-50" />
                        <p>Nenhum candidato encontrado para esta posição.</p>
                    </div>
                ) : (
                    <div className="grid gap-3">
                        {currentCandidates.map(candidate => (
                            <div key={candidate.id} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                                <div className="flex items-start gap-3">
                                    <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-lg">
                                        <User size={24} />
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-slate-900 dark:text-white">{candidate.firstname} {candidate.lastname}</h4>
                                        <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
                                            <Mail size={12} /> {candidate.email}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button onClick={() => onHireCandidate(candidate)} className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors">
                                        <UserPlus size={16} /> Contratar
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-lg text-slate-800 dark:text-white">Vagas Abertas</h3>
                <button
                    onClick={onOpenJobModal}
                    className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors"
                >
                    <Briefcase size={16} /> Nova Vaga
                </button>
            </div>

            <div className="grid gap-4">
                <div onClick={() => setViewingCandidates('ALL')} className="bg-slate-100 dark:bg-slate-800/50 p-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors flex justify-between items-center">
                    <span className="font-medium text-slate-600 dark:text-slate-300">Ver Todos os Candidatos</span>
                    <span className="bg-slate-200 dark:bg-slate-700 px-2 py-1 rounded-full text-xs font-bold text-slate-600 dark:text-slate-300">{candidates.length}</span>
                </div>

                {filteredJobs.map(job => (
                    <div key={job.id} onClick={() => setViewingCandidates(job.id)} className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-all cursor-pointer group">
                        <div className="flex justify-between items-start">
                            <div>
                                <h4 className="font-bold text-slate-800 dark:text-white text-lg group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">{job.label}</h4>
                                <p className="text-sm text-slate-500 mt-1 line-clamp-2">{job.description || "Sem descrição."}</p>
                            </div>
                            <div className="bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 px-3 py-1 rounded-full text-xs font-bold">
                                {job.qty} Vagas
                            </div>
                        </div>
                        <div className="mt-4 flex justify-between items-center pt-4 border-t border-slate-100 dark:border-slate-800">
                            <span className="text-xs text-slate-500 font-medium">{getCandidateCount(job.id)} Candidatos</span>
                            <ChevronRight size={16} className="text-slate-400 group-hover:translate-x-1 transition-transform" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
