
import React from 'react';
import { Calendar, Users, Ticket, Beer, Sparkles, Utensils } from 'lucide-react';
import { SimulationState, DualSimulationResult } from '../../types';
import { money } from '../../utils';

interface Step1Props {
    data: SimulationState;
    setData: React.Dispatch<React.SetStateAction<SimulationState>>;
    setActiveModal: (modal: 'bar' | 'buffet' | 'saved_list' | 'saved_save' | 'extrato' | null) => void;
    results: DualSimulationResult;
}

const Step1Drivers: React.FC<Step1Props> = ({ data, setData, setActiveModal, results }) => {
    // Determine the value to display in the cost slider based on mode
    // If Open Bar: Cost per Pax
    // If Sold Bar: Total Cost per pax calculated from CMV (AvgSpend * CMV%)
    const displayedCostPerPax = data.temOpenBar
        ? data.custoOpenBarPax
        : data.consumoBar * data.cmvBarPercent;

    return (
        <div className="space-y-8 animate-in slide-in-from-right fade-in duration-300">
            <div className="text-center space-y-2 mb-6">
                <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Drivers de Receita</h2>
                <p className="text-slate-500 dark:text-slate-400">Defina o perfil do evento, público e consumo.</p>
            </div>

            <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm mb-6 flex flex-col md:flex-row gap-6">
                <div className="flex-1">
                    <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase block mb-1">Nome do Evento / Modelo</label>
                    <input
                        value={data.modelName}
                        onChange={e => setData({ ...data, modelName: e.target.value })}
                        className="w-full text-lg font-bold text-slate-800 dark:text-slate-100 border-b border-dashed border-slate-300 dark:border-slate-600 focus:border-indigo-500 outline-none pb-1 bg-transparent"
                        placeholder="Ex: Show de Sexta"
                    />
                </div>
                <div className="md:w-64">
                    <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase block mb-1 flex items-center gap-1"><Calendar size={10} /> Data do Evento</label>
                    <input
                        type="date"
                        value={data.eventDate}
                        onChange={e => setData({ ...data, eventDate: e.target.value })}
                        className="w-full text-base font-bold text-slate-700 dark:text-slate-200 border-b border-dashed border-slate-300 dark:border-slate-600 focus:border-indigo-500 outline-none pb-1 bg-transparent"
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* Público */}
                <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
                    <div className="flex justify-between mb-4">
                        <label className="font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                            <Users className="text-indigo-500" size={20} /> Público
                        </label>
                        <span className="text-2xl font-bold text-indigo-600">{data.publico}</span>
                    </div>
                    <input
                        type="range" min="50" max="2000" step="50"
                        value={data.publico}
                        onChange={e => setData({ ...data, publico: Number(e.target.value) })}
                        className="w-full h-2 bg-slate-100 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                    />
                </div>

                {/* Ticket */}
                <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
                    <div className="flex justify-between mb-4">
                        <label className="font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                            <Ticket className="text-emerald-500" size={20} /> Ticket Médio
                        </label>
                        <span className="text-2xl font-bold text-emerald-600">{money(data.ticketMedio)}</span>
                    </div>
                    <input
                        type="range" min="0" max="500" step="10"
                        value={data.ticketMedio}
                        onChange={e => setData({ ...data, ticketMedio: Number(e.target.value) })}
                        className="w-full h-2 bg-slate-100 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                    />
                </div>

                {/* Bar */}
                <div className={`bg-white dark:bg-slate-800 p-5 rounded-2xl border shadow-sm relative group transition-all ${data.temOpenBar ? 'border-orange-200 dark:border-orange-700 ring-1 ring-orange-100 dark:ring-orange-900' : 'border-slate-200 dark:border-slate-700'}`}>
                    <div className="flex justify-between items-center mb-1">
                        <label className="font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                            <Beer className="text-orange-500" size={20} /> Bar
                        </label>
                        <div className="flex items-center gap-2">
                            <button onClick={() => setActiveModal('bar')} className="p-1.5 bg-orange-50 dark:bg-orange-900/30 text-orange-600 rounded-lg hover:bg-orange-100 dark:hover:bg-orange-900/50 transition-colors" title="Simulador Detalhado">
                                <Sparkles size={16} />
                            </button>
                            <button
                                onClick={() => setData((prev: SimulationState) => ({ ...prev, temOpenBar: !prev.temOpenBar }))}
                                className={`h-6 rounded-full px-2 text-[10px] font-bold transition-colors border ${data.temOpenBar ? 'bg-orange-500 text-white border-orange-600' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-600'}`}
                            >
                                {data.temOpenBar ? 'OPEN BAR' : 'VENDIDO'}
                            </button>
                        </div>
                    </div>

                    <div className="space-y-3 mt-3">
                        <div>
                            <div className="flex justify-between text-xs mb-1">
                                <span className="text-slate-500 dark:text-slate-400">{data.temOpenBar ? 'Preço Venda (Add-on)' : 'Consumo Médio'}</span>
                                <span className="font-bold text-slate-700 dark:text-slate-200">{money(data.consumoBar)}</span>
                            </div>
                            <input
                                type="range" min="0" max="400" step="5"
                                value={data.consumoBar}
                                onChange={e => setData({ ...data, consumoBar: Number(e.target.value) })}
                                className="w-full h-1.5 bg-orange-100 dark:bg-orange-900/40 rounded-lg appearance-none cursor-pointer accent-orange-600"
                            />
                        </div>

                        <div>
                            <div className="flex justify-between text-xs mb-1">
                                <span className="text-slate-500 dark:text-slate-400">Custo Bebida</span>
                                <div className="flex items-center gap-1">
                                    <span className="font-bold text-slate-700 dark:text-slate-200">{money(displayedCostPerPax)}</span>
                                    {!data.temOpenBar && (
                                        <span className={`text-[9px] px-1 rounded ${data.cmvBarPercent > 0.35 ? 'bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400' : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400'}`}>
                                            CMV {(data.cmvBarPercent * 100).toFixed(0)}%
                                        </span>
                                    )}
                                </div>
                            </div>
                            <input
                                type="range" min="0" max={data.consumoBar > 0 ? data.consumoBar : 200} step="1"
                                value={displayedCostPerPax}
                                onChange={e => {
                                    const newVal = Number(e.target.value);
                                    if (data.temOpenBar) {
                                        setData({ ...data, custoOpenBarPax: newVal });
                                    } else {
                                        // Reverse calculate CMV: NewCost / AvgSpend = NewCMV
                                        const newCMV = data.consumoBar > 0 ? newVal / data.consumoBar : 0;
                                        setData({ ...data, cmvBarPercent: newCMV });
                                    }
                                }}
                                className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-slate-500"
                            />
                        </div>
                    </div>
                </div>

                {/* Buffet */}
                <div className={`bg-white dark:bg-slate-800 p-5 rounded-2xl border shadow-sm transition-all ${data.temBuffet ? 'border-pink-200 dark:border-pink-700 ring-1 ring-pink-100 dark:ring-pink-900' : 'border-slate-200 dark:border-slate-700 opacity-80 hover:opacity-100'}`}>
                    <div className="flex justify-between items-center mb-4">
                        <label className="font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                            <Utensils className={data.temBuffet ? "text-pink-500" : "text-slate-400"} size={20} /> Buffet
                        </label>
                        <div className="flex gap-2">
                            {data.temBuffet && (
                                <button onClick={() => setActiveModal('buffet')} className="p-1.5 bg-pink-50 dark:bg-pink-900/30 text-pink-600 rounded-lg hover:bg-pink-100 dark:hover:bg-pink-900/50 transition-colors">
                                    <Sparkles size={16} />
                                </button>
                            )}
                            <button
                                onClick={() => setData((prev: SimulationState) => ({ ...prev, temBuffet: !prev.temBuffet }))}
                                className={`w-10 h-6 rounded-full p-1 transition-colors ${data.temBuffet ? 'bg-pink-500' : 'bg-slate-200 dark:bg-slate-700'}`}
                            >
                                <div className={`w-4 h-4 bg-white rounded-full shadow-sm transform transition-transform ${data.temBuffet ? 'translate-x-4' : ''}`}></div>
                            </button>
                        </div>
                    </div>

                    {data.temBuffet ? (
                        <div className="space-y-3">
                            <div>
                                <div className="flex justify-between text-xs mb-1">
                                    <span className="text-slate-500 dark:text-slate-400">Preço Venda</span>
                                    <span className="font-bold text-slate-700 dark:text-slate-200">{money(data.precoBuffet)}</span>
                                </div>
                                <input type="range" min="50" max="500" step="10" value={data.precoBuffet} onChange={e => setData({ ...data, precoBuffet: Number(e.target.value) })} className="w-full h-1.5 bg-pink-100 dark:bg-pink-900/40 rounded-lg accent-pink-500" />
                            </div>
                            <div>
                                <div className="flex justify-between text-xs mb-1">
                                    <span className="text-slate-500 dark:text-slate-400">Custo Insumos (Var)</span>
                                    <span className="font-bold text-slate-700 dark:text-slate-200">{money(data.custoBuffet)}</span>
                                </div>
                                <input type="range" min="30" max="400" step="5" value={data.custoBuffet} onChange={e => setData({ ...data, custoBuffet: Number(e.target.value) })} className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-slate-500" />
                                <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-1">*Custos de Staff (Fixos) estão em Custos Extras</p>
                            </div>
                        </div>
                    ) : (
                        <div className="h-24 flex items-center justify-center text-xs text-slate-400 dark:text-slate-500">
                            Buffet não incluso
                        </div>
                    )}
                </div>
            </div>

            <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl text-center">
                <span className="text-slate-500 dark:text-slate-400 uppercase text-xs font-bold tracking-wider">Faturamento Bruto Projetado</span>
                <div className="text-3xl font-black text-slate-800 dark:text-slate-100 mt-1">{money(results.totalGross)}</div>
            </div>
        </div>
    );
};

export default Step1Drivers;
