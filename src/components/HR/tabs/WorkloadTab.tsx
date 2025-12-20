import React, { useMemo } from 'react';
import { DolibarrUser, Task } from '../../../types';
import { BarChart3 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

interface WorkloadTabProps {
    users: DolibarrUser[];
    tasks: Task[];
}

export const WorkloadTab: React.FC<WorkloadTabProps> = ({ users, tasks }) => {

    const workloadData = useMemo(() => {
        const data = users.map(u => {
            const myTasks = tasks.filter(t => (t.fk_user_assign && String(t.fk_user_assign) === String(u.id)) || (t.fk_user_creat && String(t.fk_user_creat) === String(u.id)));
            const spent = myTasks.reduce((acc, t) => acc + (t.duration_effective || 0), 0) / 3600;
            const planned = myTasks.reduce((acc, t) => acc + (t.planned_workload || 0), 0) / 3600;
            return {
                name: u.login || u.firstname,
                spent,
                planned,
                tasks: myTasks.length
            };
        }).filter(d => d.spent > 0 || d.planned > 0).sort((a, b) => b.spent - a.spent);

        return { users: data };
    }, [users, tasks]);

    return (
        <div className="h-full flex flex-col space-y-6 animate-in fade-in">
            <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700 text-center">
                    <span className="text-xs text-slate-500 uppercase tracking-wide">Total Usuários</span>
                    <div className="text-xl font-bold text-slate-800 dark:text-white">{workloadData.users.length}</div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700 text-center">
                    <span className="text-xs text-slate-500 uppercase tracking-wide">Duração Total</span>
                    <div className="text-xl font-bold text-indigo-600 dark:text-indigo-400">
                        {workloadData.users.reduce((acc, u) => acc + u.spent, 0).toFixed(2)}h
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6 flex-none">
                <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col">
                    <h3 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2 text-sm">
                        <BarChart3 size={16} className="text-indigo-500" /> Volume de Tarefas
                    </h3>
                    <div className="h-[300px] w-full">
                        {workloadData.users.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart layout="vertical" data={workloadData.users.slice(0, 10)} margin={{ left: 40, right: 20 }}>
                                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} strokeOpacity={0.1} />
                                    <XAxis type="number" hide />
                                    <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                    <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', backgroundColor: '#1e293b', color: '#f8fafc', fontSize: '12px' }} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
                                    <Bar dataKey="spent" name="Gasto" stackId="a" fill="#6366f1" radius={[0, 0, 0, 0]} barSize={20} />
                                    <Bar dataKey="planned" name="Planejado" stackId="a" fill="#e2e8f0" radius={[0, 4, 4, 0]} barSize={20} />
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex items-center justify-center text-slate-400 text-xs text-center border-2 border-dashed border-slate-100 dark:border-slate-800 rounded-lg">
                                Nenhuma hora registrada ou planejada.
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
