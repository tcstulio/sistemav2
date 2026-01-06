import React from 'react';
import { User, LeaveRequest } from '../../types/hr';

interface HRTabProps {
    hrStats: any;
    users: User[];
    leaves: LeaveRequest[];
}

export const HRTab: React.FC<HRTabProps> = ({ hrStats, users, leaves }) => {
    const onLeave = leaves.filter(l => l.statut === '3').slice(0, 10);

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-lg shadow border border-gray-100">
                    <h3 className="text-lg font-semibold mb-2">Colaboradores Ativos</h3>
                    <p className="text-3xl font-bold text-gray-800">{hrStats.headcount}</p>
                    <p className="text-sm text-gray-500 mt-1">Total de usuários ativos no sistema</p>
                </div>
                <div className="bg-white p-6 rounded-lg shadow border border-gray-100">
                    <h3 className="text-lg font-semibold mb-2">Licenças/Férias no Período</h3>
                    <p className="text-3xl font-bold text-orange-600">{hrStats.activeLeaves}</p>
                    <p className="text-sm text-gray-500 mt-1">Solicitações aprovadas que coincidem com este mês</p>
                </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow border border-gray-100">
                <h3 className="text-lg font-semibold mb-4">Solicitações Recentes de Ausência</h3>
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-4 py-2 text-left">Usuário</th>
                                <th className="px-4 py-2 text-left">Tipo</th>
                                <th className="px-4 py-2 text-left">Início</th>
                                <th className="px-4 py-2 text-left">Fim</th>
                            </tr>
                        </thead>
                        <tbody>
                            {onLeave.length > 0 ? onLeave.map((l, i) => (
                                <tr key={i} className="border-b">
                                    <td className="px-4 py-2 font-medium">{l.user_login || `User #${l.fk_user}`}</td>
                                    <td className="px-4 py-2">{l.type_label || 'Folga/Férias'}</td>
                                    <td className="px-4 py-2">{new Date(l.date_debut).toLocaleDateString()}</td>
                                    <td className="px-4 py-2">{new Date(l.date_fin).toLocaleDateString()}</td>
                                </tr>
                            )) : (
                                <tr>
                                    <td colSpan={4} className="px-4 py-4 text-center text-gray-400">Nenhuma ausência registrada para este período.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
