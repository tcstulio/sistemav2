import React from 'react';
import { Project } from '../../../types/projects';
import { DolibarrUser } from '../../../types/common';

interface TeamMember {
    id: string;
    user_id?: string;
    contact_id?: string;
    type_id?: string;
}

interface Contact {
    id: string;
    firstname?: string;
    lastname?: string;
}

interface ProjectTeamTabProps {
    project: Project;
    team: TeamMember[];
    users: DolibarrUser[];
    contacts: Contact[];
}

export const ProjectTeamTab: React.FC<ProjectTeamTabProps> = ({ project, team, users, contacts }) => {
    const resolveParticipantName = (p: { user_id?: string; contact_id?: string }): string => {
        if (p.user_id) {
            const u = users.find(u => String(u.id) === String(p.user_id));
            return u ? (u.firstname + ' ' + (u.lastname || '')).trim() : 'Usuário ' + p.user_id;
        }
        if (p.contact_id) {
            const c = contacts.find(c => String(c.id) === String(p.contact_id));
            return c ? ((c.firstname || '') + ' ' + (c.lastname || '')).trim() : 'Contato ' + p.contact_id;
        }
        return 'Desconhecido';
    };

    return (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
            <h3 className="font-bold text-slate-800 dark:text-white mb-4">Equipe do Projeto</h3>
            {team.length === 0 ? (
                <p className="text-slate-400">Nenhum membro na equipe.</p>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {team.map(p => (
                        <div key={p.id} className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700">
                            <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold text-xs">
                                {(resolveParticipantName(p)[0] || '?').toUpperCase()}
                            </div>
                            <div>
                                <p className="text-sm font-medium text-slate-900 dark:text-white">{resolveParticipantName(p)}</p>
                                <p className="text-xs text-slate-500 capitalize">{p.type_id}</p>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default ProjectTeamTab;
