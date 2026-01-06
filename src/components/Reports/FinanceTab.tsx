import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend } from 'recharts';
import { Payment, SupplierPayment } from '../../types/finance';

interface FinanceTabProps {
    financialStats: any;
    payments: Payment[];
    supplierPayments: SupplierPayment[];
    salaries: any[];
}

export const FinanceTab: React.FC<FinanceTabProps> = ({ financialStats, payments, supplierPayments, salaries }) => {
    // Top Expenses Calculation
    const topSupplierPayments = [...supplierPayments]
        .sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount))
        .slice(0, 5);

    const dataPie = [
        { name: 'Fornecedores', value: financialStats.breakdown.suppliers },
        { name: 'Salários', value: financialStats.breakdown.salaries },
        { name: 'Impostos/VAT', value: financialStats.breakdown.taxes }
    ];

    const COLORS = ['#EF4444', '#F59E0B', '#6366F1'];

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Cash Flow Chart */}
                <div className="bg-white p-6 rounded-lg shadow border border-gray-100">
                    <h3 className="text-lg font-semibold mb-4">Fluxo de Caixa</h3>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={[
                                { name: 'Receita', value: financialStats.inflow },
                                { name: 'Despesa', value: financialStats.outflow },
                                { name: 'Líquido', value: financialStats.net }
                            ]}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="name" />
                                <YAxis />
                                <Tooltip formatter={(value) => `R$ ${Number(value).toFixed(2)}`} />
                                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                                    {[0, 1, 2].map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={index === 1 ? '#EF4444' : index === 2 ? '#10B981' : '#3B82F6'} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Breakdown Pie */}
                <div className="bg-white p-6 rounded-lg shadow border border-gray-100">
                    <h3 className="text-lg font-semibold mb-4">Composição de Despesas</h3>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={dataPie}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {dataPie.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip formatter={(value) => `R$ ${Number(value).toFixed(2)}`} />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* Detailed Table */}
            <div className="bg-white p-6 rounded-lg shadow border border-gray-100">
                <h3 className="text-lg font-semibold mb-4">Maiores Pagamentos (Fornecedores)</h3>
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-4 py-2 text-left">Ref</th>
                                <th className="px-4 py-2 text-left">Data</th>
                                <th className="px-4 py-2 text-left">Descrição/Nota</th>
                                <th className="px-4 py-2 text-right">Valor</th>
                            </tr>
                        </thead>
                        <tbody>
                            {topSupplierPayments.length > 0 ? topSupplierPayments.map(p => (
                                <tr key={p.id} className="border-b">
                                    <td className="px-4 py-2 font-medium">{p.ref}</td>
                                    <td className="px-4 py-2">{new Date(p.date_payment).toLocaleDateString()}</td>
                                    <td className="px-4 py-2 text-gray-500 truncate max-w-xs">{p.note || '-'}</td>
                                    <td className="px-4 py-2 text-right text-red-600 font-bold">R$ {parseFloat(p.amount).toFixed(2)}</td>
                                </tr>
                            )) : (
                                <tr>
                                    <td colSpan={4} className="px-4 py-4 text-center text-gray-400">Nenhum pagamento encontrado no período.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
