
import React from 'react';
import { Save, Settings2, Building2, Users } from 'lucide-react';
import { SimulationState, DualSimulationResult, FinancialResult } from '../../types';
import { money, percent } from '../../utils';

interface Step4Props {
    data: SimulationState;
    setData: React.Dispatch<React.SetStateAction<SimulationState>>;
    results: DualSimulationResult;
    onSave: () => void;
}

const Step4Results: React.FC<Step4Props> = ({ data, setData, results, onSave }) => {
    const venueProfitClass = results.venue.profit >= 0 ? 'text-emerald-600' : 'text-rose-600';

    return (
        <div className="space-y-6 animate-in slide-in-from-bottom fade-in duration-500">
            <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-lg flex flex-col md:flex-row justify-between items-center gap-4">
                <div className="flex gap-8">
                    <div>
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Faturamento Total</span>
                        <div className="text-3xl font-bold">{money(results.totalGross)}</div>
                    </div>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={onSave}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-emerald-900/50"
                    >
                        <Save size={20} /> Salvar Simulação
                    </button>
                </div>
            </div>

            <div className="bg-white p-6 rounded-3xl border border-indigo-100 shadow-sm">
                <div className="flex items-center gap-2 mb-6">
                    <Settings2 className="text-indigo-600" size={18} />
                    <h3 className="font-bold text-slate-700 text-sm uppercase">Sensibilidade de Cenário (Ajuste Rápido)</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    <div className="space-y-3">
                        <div className="flex justify-between items-end">
                            <label className="text-[10px] font-bold text-slate-400 uppercase">Público</label>
                            <span className="text-xl font-bold text-indigo-600">{data.publico}</span>
                        </div>
                        <input
                            type="range" min="50" max="2000" step="50"
                            value={data.publico}
                            onChange={e => setData({ ...data, publico: Number(e.target.value) })}
                            className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                        />
                    </div>

                    <div className="space-y-3">
                        <div className="flex justify-between items-end">
                            <label className="text-[10px] font-bold text-slate-400 uppercase">Ticket Médio</label>
                            <span className="text-xl font-bold text-emerald-600">{money(data.ticketMedio)}</span>
                        </div>
                        <input
                            type="range" min="0" max="500" step="10"
                            value={data.ticketMedio}
                            onChange={e => setData({ ...data, ticketMedio: Number(e.target.value) })}
                            className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                        />
                    </div>

                    <div className="space-y-3">
                        <div className="flex justify-between items-end">
                            <label className="text-[10px] font-bold text-slate-400 uppercase">Bar / Pax</label>
                            <span className="text-xl font-bold text-orange-600">{money(data.consumoBar)}</span>
                        </div>
                        <input
                            type="range" min="0" max="400" step="5"
                            value={data.consumoBar}
                            onChange={e => setData({ ...data, consumoBar: Number(e.target.value) })}
                            className="w-full h-1.5 bg-orange-100 rounded-lg appearance-none cursor-pointer accent-orange-600"
                        />
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8">
                <div className="bg-white rounded-3xl shadow-xl border-2 border-indigo-50 overflow-hidden flex flex-col">
                    <div className="bg-indigo-600 p-4 text-white flex items-center gap-3">
                        <div className="p-2 bg-white/20 rounded-lg"><Building2 size={24} /></div>
                        <div><h3 className="font-bold text-lg">Resultado da Casa</h3><p className="text-xs text-indigo-200">Sua performance líquida</p></div>
                    </div>
                    <div className="p-6 flex-1 flex flex-col">
                        <div className="mb-6 text-center">
                            <span className="text-xs text-slate-400 uppercase font-bold">Lucro Operacional</span>
                            <div className={`text-4xl font-black ${venueProfitClass} tracking-tight`}>{money(results.venue.profit)}</div>
                            <div className="text-sm text-slate-500 mt-1">Margem: {percent(results.venue.roi)} (ROI)</div>
                        </div>
                        <div className="space-y-2 flex-1">
                            {results.venue.items.map((item: any, i: number) => (
                                <div key={i} className={`flex justify-between text-sm py-2 border-b border-slate-50 last:border-0 ${item.type === 'neutral' ? 'italic opacity-70' : ''}`}>
                                    <span className={`${item.type === 'neutral' ? 'text-slate-400' : 'text-slate-600'}`}>{item.label}</span>
                                    <span className={`font-mono font-bold ${item.type === 'neutral' ? 'text-slate-400' : item.value >= 0 ? 'text-indigo-600' : 'text-rose-500'}`}>{item.value > 0 ? '+' : ''}{money(item.value)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="space-y-4">
                    {data.partners.length === 0 ? <div className="bg-white rounded-3xl shadow-xl border-2 border-emerald-50 overflow-hidden flex flex-col h-full items-center justify-center p-8 text-center text-slate-400"><p>Sem parceiros externos.</p><p className="text-xs">Produção 100% Casa.</p></div> :
                        (Object.values(results.partnersResults) as FinancialResult[]).map((pRes, idx) => (
                            <div key={idx} className="bg-white rounded-3xl shadow-lg border border-emerald-100 overflow-hidden flex flex-col">
                                <div className="bg-emerald-600 p-3 text-white flex items-center justify-between">
                                    <div className="flex items-center gap-3"><div className="p-1.5 bg-white/20 rounded-lg"><Users size={18} /></div><h3 className="font-bold text-sm">{pRes.label}</h3></div>
                                    <div className="text-right"><div className={`font-black text-lg`}>{money(pRes.profit)}</div></div>
                                </div>
                                <div className="p-4 bg-emerald-50/30">
                                    <div className="space-y-1">
                                        {pRes.items.map((item, i) => (
                                            <div key={i} className={`flex justify-between text-xs py-1 border-b border-emerald-100/50 last:border-0 ${item.type === 'neutral' ? 'italic opacity-70' : ''}`}>
                                                <span className={`${item.type === 'neutral' ? 'text-slate-500' : 'text-slate-600'}`}>{item.label}</span>
                                                <span className={`font-mono font-bold ${item.type === 'neutral' ? 'text-slate-500' : item.value >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{item.value > 0 ? '+' : ''}{money(item.value)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ))
                    }
                </div>
            </div>
        </div>
    );
};

export default Step4Results;
