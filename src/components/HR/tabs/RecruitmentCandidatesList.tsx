import React, { useMemo } from 'react';
import { Candidate, RecruitmentJobPosition } from '../../../types';
import { Mail, Phone, Briefcase, UserPlus, ArrowLeft, X, User } from 'lucide-react';

interface RecruitmentCandidatesListProps {
    candidates: Candidate[];
    viewingCandidatesId: string; // Not null here because this component is only rendered if active
    jobPositions: RecruitmentJobPosition[];
    onHireCandidate: (c: Candidate) => void;
    onClose: () => void;
}

export const RecruitmentCandidatesList: React.FC<RecruitmentCandidatesListProps> = ({
    candidates,
    viewingCandidatesId,
    jobPositions,
    onHireCandidate,
    onClose
}) => {

    const currentCandidates = useMemo(() => {
        if (viewingCandidatesId === 'ALL') return candidates;
        return candidates.filter(c => String(c.fk_job_position) === String(viewingCandidatesId));
    }, [candidates, viewingCandidatesId]);

    const getJobTitle = (jobId: string) => {
        if (!jobId || jobId === '0') return 'Sem Posição / Espontâneo';
        const j = jobPositions.find(p => String(p.id) === String(jobId));
        return j ? j.label : `Posição Desconhecida (ID: "${jobId}")`;
    };

    return (
        <div className="flex flex-col h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800">
            {/* Header */}
            <div className="flex-none bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-100 dark:border-slate-800 p-4 flex items-center justify-between z-10">
                <div className="flex items-center gap-3">
                    <button onClick={onClose} className="lg:hidden p-2 -ml-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white">
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white leading-tight">Candidatos</h2>
                        <span className="text-xs text-slate-400">
                            {viewingCandidatesId === 'ALL' ? 'Todos os Candidatos' : getJobTitle(viewingCandidatesId)} ({currentCandidates.length})
                        </span>
                    </div>
                </div>
                <button onClick={onClose} className="hidden lg:block p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                    <X size={20} />
                </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950/50">
                <div className="max-w-3xl mx-auto space-y-4">
                    {currentCandidates.length === 0 ? (
                        <div className="text-center text-slate-400 py-10 flex flex-col items-center">
                            <User size={48} className="mb-4 opacity-50" />
                            <p>Nenhum candidato encontrado nesta categoria.</p>
                        </div>
                    ) : (
                        currentCandidates.map(cand => (
                            <div key={cand.id} className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4 animate-in slide-in-from-right-4 transition-all hover:shadow-md">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <h4 className="font-bold text-slate-800 dark:text-white text-lg">{cand.firstname} {cand.lastname}</h4>
                                        <span className={`text-xs px-2 py-0.5 rounded font-bold uppercase ${cand.status === 'OFFER' ? 'bg-emerald-100 text-emerald-700' : cand.status === 'INTERVIEW' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                                            {cand.status}
                                        </span>
                                    </div>
                                    <div className="text-sm text-slate-500 dark:text-slate-400 space-y-1">
                                        <div className="flex items-center gap-2"><Mail size={14} /> {cand.email}</div>
                                        {cand.phone && <div className="flex items-center gap-2"><Phone size={14} /> {cand.phone}</div>}
                                        <div className="flex items-center gap-2"><Briefcase size={14} /> {getJobTitle(cand.fk_job_position)}</div>
                                    </div>
                                    {cand.note_public && (
                                        <div className="mt-2 text-xs text-slate-500 bg-slate-50 dark:bg-slate-800 p-2 rounded italic border border-slate-100 dark:border-slate-700">
                                            "{cand.note_public}"
                                        </div>
                                    )}
                                </div>
                                <div className="flex gap-2 w-full md:w-auto">
                                    <button onClick={() => onHireCandidate(cand)} className="flex-1 md:flex-none px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm font-medium flex items-center justify-center gap-2 shadow-sm transition-colors">
                                        <UserPlus size={16} /> Contratar
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};
