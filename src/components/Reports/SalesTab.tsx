import React from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Proposal, Order } from '../../types/sales';

interface SalesTabProps {
    salesStats: any;
    proposals: Proposal[];
    orders: Order[];
}

export const SalesTab: React.FC<SalesTabProps> = ({ salesStats, proposals, orders }) => {
    // Sort orders by value
    const topOrders = [...orders]
        .sort((a, b) => parseFloat(b.total_ttc) - parseFloat(a.total_ttc))
        .slice(0, 5);

    const COLORS = ['#94A3B8', '#10B981'];

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-lg shadow border border-gray-100">
                    <h3 className="text-lg font-semibold mb-4">Funil de Conversão (Qtd)</h3>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={[
                                        { name: 'Não Convertido', value: salesStats.proposalsCount - salesStats.ordersCount },
                                        { name: 'Vendas Fechadas', value: salesStats.ordersCount }
                                    ]}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={0}
                                    outerRadius={80}
                                    dataKey="value"
                                >
                                    {[0, 1].map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="text-center mt-2 text-sm text-gray-500">
                        Taxa de Conversão: <span className="font-bold text-gray-800">{salesStats.conversionRate.toFixed(1)}%</span>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-lg shadow border border-gray-100">
                    <h3 className="text-lg font-semibold mb-4">Resumo Comercial</h3>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 bg-gray-50 rounded-lg">
                            <p className="text-xs text-gray-500 uppercase">Volume de Propostas</p>
                            <p className="text-xl font-bold text-gray-800">R$ {salesStats.proposalsValue.toFixed(2)}</p>
                            <p className="text-xs text-gray-400 mt-1">{salesStats.proposalsCount} propostas</p>
                        </div>
                        <div className="p-4 bg-emerald-50 rounded-lg">
                            <p className="text-xs text-emerald-600 uppercase">Vendas Realizadas</p>
                            <p className="text-xl font-bold text-emerald-700">R$ {salesStats.ordersValue.toFixed(2)}</p>
                            <p className="text-xs text-emerald-500 mt-1">{salesStats.ordersCount} pedidos</p>
                        </div>
                        <div className="col-span-2 p-4 bg-blue-50 rounded-lg flex justify-between items-center">
                            <div>
                                <p className="text-xs text-blue-600 uppercase">Ticket Médio</p>
                                <p className="text-xl font-bold text-blue-700">R$ {salesStats.avgTicket.toFixed(2)}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow border border-gray-100">
                <h3 className="text-lg font-semibold mb-4">Últimos Pedidos Fechados</h3>
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-4 py-2 text-left">Ref</th>
                                <th className="px-4 py-2 text-left">Cliente</th>
                                <th className="px-4 py-2 text-left">Data</th>
                                <th className="px-4 py-2 text-right">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {topOrders.length > 0 ? topOrders.map(o => (
                                <tr key={o.id} className="border-b">
                                    <td className="px-4 py-2 font-medium">{o.ref}</td>
                                    <td className="px-4 py-2">{o.socid ? `Cliente #${o.socid}` : '-'}</td>
                                    <td className="px-4 py-2">{new Date(o.date_commande || o.datec).toLocaleDateString()}</td>
                                    <td className="px-4 py-2 text-right text-emerald-600 font-bold">R$ {parseFloat(o.total_ttc).toFixed(2)}</td>
                                </tr>
                            )) : (
                                <tr>
                                    <td colSpan={4} className="px-4 py-4 text-center text-gray-400">Nenhum pedido encontrado.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
