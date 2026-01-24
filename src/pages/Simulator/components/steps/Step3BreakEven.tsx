
import React, { useState, useMemo } from 'react';
import { Sparkles, TrendingUp } from 'lucide-react';
import { SimulationState, DualSimulationResult } from '../../types';
import { money, calculateDualSimulation } from '../../utils';
import { ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip as RechartsTooltip, ReferenceLine } from 'recharts';

interface Step3Props {
    data: SimulationState;
    results: DualSimulationResult;
}

const Step3BreakEven: React.FC<Step3Props> = ({ data, results }) => {
    const [viewMode, setViewMode] = useState<'total' | 'venue' | string>('total');

    const actors = useMemo(() => {
        const list = [
            { id: 'total', label: 'Evento Global', color: '#6366f1' },
            { id: 'venue', label: 'Casa (Venue)', color: '#10b981' },
            ...data.partners.map((p: any, i: number) => ({
                id: p.id, label: p.name, color: ['#f59e0b', '#ec4899', '#3b82f6'][i % 3]
            }))
        ];
        return list;
    }, [data.partners]);

    const activeActor = actors.find(a => a.id === viewMode) || actors[0];

    const chartData = useMemo(() => {
        const points = [];
        const maxPublico = Math.max(data.publico * 1.5, 500);
        const steps = 15;
        const stepSize = Math.ceil(maxPublico / steps);

        for (let i = 0; i <= steps; i++) {
            const p = i * stepSize;

            const simStateAtP = { ...data, publico: p };
            const resultsAtP = calculateDualSimulation(simStateAtP);

            let revenue = 0;
            let costs = 0;

            if (viewMode === 'total') {
                revenue = resultsAtP.totalGross - resultsAtP.totalTaxes;
                costs = resultsAtP.venue.costs + resultsAtP.production.costs;
            } else if (viewMode === 'venue') {
                revenue = resultsAtP.venue.netRevenue;
                costs = resultsAtP.venue.costs;
            } else {
                const pRes = resultsAtP.partnersResults[viewMode];
                revenue = pRes?.netRevenue || 0;
                costs = pRes?.costs || 0;
            }

            points.push({
                pax: p,
                Receita: revenue,
                Custos: costs,
                Lucro: revenue - costs
            });
        }
        return points;
    }, [data, viewMode]);

    const bepInfo = useMemo(() => {
        const crosses = chartData.find((pt, i) => i > 0 && pt.Lucro >= 0 && chartData[i - 1].Lucro < 0);
        const lastLossPt = chartData.find((pt, i, arr) => i < arr.length - 1 && pt.Lucro < 0 && arr[i + 1].Lucro >= 0);

        let exactBep = 0;
        if (crosses && lastLossPt) {
            const ratio = Math.abs(lastLossPt.Lucro) / (Math.abs(lastLossPt.Lucro) + crosses.Lucro);
            exactBep = Math.ceil(lastLossPt.pax + (ratio * (crosses.pax - lastLossPt.pax)));
        } else if (chartData[0].Lucro >= 0) {
            exactBep = 0;
        } else {
            exactBep = 99999;
        }

        const safetyMargin = data.publico - exactBep;
        const safetyMarginPct = data.publico > 0 ? (safetyMargin / data.publico) * 100 : 0;

        return { exactBep, safetyMargin, safetyMarginPct };
    }, [chartData, data.publico]);

    return (
        <div className="space-y-6 animate-in slide-in-from-right fade-in duration-300">
            <div className="text-center space-y-2 mb-6">
                <h2 className="text-2xl font-bold text-slate-800">Análise de Break-Even</h2>
                <p className="text-slate-500">Descubra o ponto exato onde cada parte atinge o equilíbrio financeiro.</p>
            </div>

            <div className="flex bg-white p-1 rounded-2xl border border-slate-200 shadow-sm max-w-2xl mx-auto overflow-x-auto">
                {actors.map(actor => (
                    <button
                        key={actor.id}
                        onClick={() => setViewMode(actor.id)}
                        className={`flex-1 px-4 py-3 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center justify-center gap-2 ${viewMode === actor.id ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: actor.color }}></div>
                        {actor.label}
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                <div className="lg:col-span-1 space-y-4">
                    <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Ponto de Equilíbrio</span>
                        <div className="flex items-baseline gap-1">
                            <span className="text-3xl font-black text-slate-800">{bepInfo.exactBep === 99999 ? '∞' : bepInfo.exactBep}</span>
                            <span className="text-sm font-bold text-slate-400">pax</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-2">Público necessário para pagar todos os custos.</p>
                    </div>

                    <div className={`p-5 rounded-2xl border shadow-sm transition-colors ${bepInfo.safetyMargin >= 0 ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100'}`}>
                        <span className={`text-[10px] font-bold uppercase tracking-wider block mb-1 ${bepInfo.safetyMargin >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>Margem de Segurança</span>
                        <div className="flex items-baseline gap-1">
                            <span className={`text-2xl font-black ${bepInfo.safetyMargin >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                {bepInfo.safetyMargin > 0 ? '+' : ''}{bepInfo.safetyMargin}
                            </span>
                            <span className="text-sm font-bold opacity-60">pax</span>
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                            <div className="flex-1 h-1.5 bg-white/50 rounded-full overflow-hidden">
                                <div className={`h-full ${bepInfo.safetyMargin >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}`} style={{ width: `${Math.min(100, Math.abs(bepInfo.safetyMarginPct))}%` }}></div>
                            </div>
                            <span className="text-[10px] font-bold">{bepInfo.safetyMarginPct.toFixed(0)}%</span>
                        </div>
                    </div>

                    <div className="bg-slate-900 p-5 rounded-2xl shadow-xl text-white">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-3">Insights da IA</span>
                        <div className="flex gap-3">
                            <Sparkles size={16} className="text-yellow-400 shrink-0" />
                            <p className="text-[11px] leading-relaxed text-slate-300">
                                {bepInfo.exactBep === 0 ? "Este parceiro não possui custos fixos ou já começa lucrando devido a garantias." :
                                    bepInfo.exactBep > data.publico ? "Risco Crítico: O público planejado não é suficiente para cobrir os gastos deste ator." :
                                        bepInfo.safetyMarginPct > 30 ? "Segurança Alta: O evento pode ter quebra de público e ainda assim ser rentável." :
                                            "Equilíbrio Delicado: Atente-se aos custos variáveis para não comprometer a margem."}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="lg:col-span-3 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm h-[450px] flex flex-col">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="font-bold text-slate-700 flex items-center gap-2">
                            <TrendingUp size={20} className="text-indigo-600" /> Curva de Viabilidade: {activeActor.label}
                        </h3>
                        <div className="flex gap-4 text-xs font-bold">
                            <div className="flex items-center gap-1.5"><div className="w-3 h-3 bg-emerald-500 rounded-sm"></div> Receita</div>
                            <div className="flex items-center gap-1.5"><div className="w-3 h-3 bg-rose-500 rounded-sm"></div> Custos</div>
                        </div>
                    </div>

                    <div className="flex-1 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chartData} margin={{ top: 30, right: 10, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.1} />
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.1} />
                                        <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="pax" type="number" domain={[0, 'auto']} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={v => `${v}p`} />
                                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={v => `R$ ${v / 1000}k`} />
                                <RechartsTooltip
                                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                                    formatter={(v: any) => money(v)}
                                />
                                <ReferenceLine x={data.publico} stroke="#6366f1" strokeDasharray="3 3" label={{ position: 'top', value: 'Plano', fill: '#6366f1', fontSize: 10, fontWeight: 'bold' }} />
                                {bepInfo.exactBep < 99999 && (
                                    <ReferenceLine x={bepInfo.exactBep} stroke="#94a3b8" strokeDasharray="2 2" label={{ position: 'bottom', value: 'Break-even', fill: '#94a3b8', fontSize: 9 }} />
                                )}
                                <Area type="monotone" dataKey="Receita" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorRev)" />
                                <Area type="monotone" dataKey="Custos" stroke="#f43f5e" strokeWidth={3} fillOpacity={1} fill="url(#colorCost)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Step3BreakEven;
