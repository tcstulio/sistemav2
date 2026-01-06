import React from 'react';
import { Project, Task } from '../../types/projects';

interface ProjectsTabProps {
    projectStats: any;
    projects: Project[];
    tasks: Task[];
}

export const ProjectsTab: React.FC<ProjectsTabProps> = ({ projectStats, projects, tasks }) => {
    // List active projects with progress
    const activeProjectsList = projects.filter(p => p.statut === '1').slice(0, 10);

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-lg shadow border border-gray-100 flex flex-col items-center justify-center">
                    <p className="text-gray-500 text-sm uppercase mb-2">Projetos Ativos</p>
                    <p className="text-4xl font-bold text-purple-600">{projectStats.activeCount}</p>
                </div>
                <div className="bg-white p-6 rounded-lg shadow border border-gray-100 flex flex-col items-center justify-center">
                    <p className="text-gray-500 text-sm uppercase mb-2">Tarefas Criadas</p>
                    <p className="text-4xl font-bold text-blue-500">{projectStats.tasksCreated}</p>
                </div>
                <div className="bg-white p-6 rounded-lg shadow border border-gray-100 flex flex-col items-center justify-center">
                    <p className="text-gray-500 text-sm uppercase mb-2">Tarefas Concluídas</p>
                    <p className="text-4xl font-bold text-emerald-500">{projectStats.tasksCompleted}</p>
                </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow border border-gray-100">
                <h3 className="text-lg font-semibold mb-4">Status dos Projetos Ativos</h3>
                <div className="space-y-4">
                    {activeProjectsList.length > 0 ? activeProjectsList.map(p => (
                        <div key={p.id} className="border-b pb-4 last:border-0 last:pb-0">
                            <div className="flex justify-between items-center mb-1">
                                <span className="font-medium text-gray-800">{p.ref} - {p.title}</span>
                                <span className="text-sm text-gray-500">{p.progress || 0}%</span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2.5">
                                <div
                                    className="bg-purple-600 h-2.5 rounded-full transition-all duration-500"
                                    style={{ width: `${p.progress || 0}%` }}
                                ></div>
                            </div>
                            <div className="flex justify-between mt-1 text-xs text-gray-400">
                                <span>Início: {p.date_start ? new Date(p.date_start).toLocaleDateString() : 'N/A'}</span>
                                <span>Fim: {p.date_end ? new Date(p.date_end).toLocaleDateString() : 'Em aberto'}</span>
                            </div>
                        </div>
                    )) : (
                        <div className="text-center text-gray-400 py-4">Nenhum projeto ativo.</div>
                    )}
                </div>
            </div>
        </div>
    );
};
