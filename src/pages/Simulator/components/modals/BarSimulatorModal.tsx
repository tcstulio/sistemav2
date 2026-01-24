
import React, { useState, useEffect } from 'react';
import { Martini, X, Beer, Wine, Coffee, DollarSign, Calculator, Droplets, AlertTriangle, RefreshCcw } from 'lucide-react';
import { BarMix, BarMixItem, ConsumptionProfile } from '../../types';
import { money } from '../../utils';
import { DEFAULT_BAR_MIX } from '../../constants';

interface Props {
    initialData?: { duracao: number; perfil: string; mix: BarMix };
    onClose: () => void;
    onApply: (vendaTotal: number, custoTotal: number, fullState: any, impliedCmv?: number) => void;
    isOpenBarMode: boolean;
    barSim?: any;
    setBarSim?: any;
    consumptionProfiles: ConsumptionProfile;
}

const BarSimulatorModal: React.FC<Props> = ({ initialData, onClose, onApply, isOpenBarMode, consumptionProfiles }) => {
    const [localState, setLocalState] = useState<{
        duracao: number;
        perfil: keyof ConsumptionProfile;
        mix: BarMix;
    }>(() => ({
        duracao: initialData?.duracao || 5,
        perfil: (initialData?.perfil as keyof ConsumptionProfile) || 'moderado',
        mix: initialData?.mix ? JSON.parse(JSON.stringify(initialData.mix)) : JSON.parse(JSON.stringify(DEFAULT_BAR_MIX))
    }));

    const [custoTotal, setCustoTotal] = useState(0);
    const [vendaTotal, setVendaTotal] = useState(0);
    const [volumeTotalML, setVolumeTotalML] = useState(0);
    const [markupOpenBar, setMarkupOpenBar] = useState(200); // 200% default markup for Open Bar suggestion

    // Helper para estimar volume por tipo
    const getVolumeEstimado = (key: string, label: string) => {
        const k = key.toLowerCase();
        const l = label.toLowerCase();
        if (k.includes('cerveja') || l.includes('cerveja') || l.includes('chopp')) return 350; // Lata/Longneck
        if (k.includes('shot') || l.includes('shot') || l.includes('dose')) return 50;
        if (k.includes('agua') || l.includes('refri') || k.includes('nao') || l.includes('soft')) return 300; // Lata padrão
        if (k.includes('vinho') || l.includes('espumante')) return 150; // Taça
        return 250; // Drinks padrão com gelo
    };

    useEffect(() => {
        // Uses global config for drinks per hour base
        let dph: number = Number(consumptionProfiles[localState.perfil] || 1.5);

        if (isOpenBarMode) dph *= 1.3; // Open Bar usually consumes more

        let totalDrinksPessoa = 0;
        for (let h = 1; h <= localState.duracao; h++) {
            // Diminishing returns after 4th hour
            totalDrinksPessoa += (h > 4 ? dph * 0.7 : dph);
        }

        const mixEntries = Object.entries(localState.mix || {}) as [string, BarMixItem][];
        const totalShare = mixEntries.reduce((acc, [_, item]) => acc + (Number(item.share) || 0), 0) || 1;

        let cTotal = 0;
        let vTotal = 0;
        let volTotal = 0;

        mixEntries.forEach(([key, item]) => {
            const share = Number(item.share) || 0;
            // Normaliza a quantidade baseada no share real, para o calculo financeiro funcionar mesmo se não for 100%
            // (Embora a UI vá pedir para corrigir)
            const qtd = (share / totalShare) * totalDrinksPessoa;

            cTotal += qtd * (Number(item.custo) || 0);
            vTotal += qtd * (Number(item.venda) || 0);
            volTotal += qtd * getVolumeEstimado(key, item.label);
        });

        setCustoTotal(cTotal);
        setVendaTotal(vTotal);
        setVolumeTotalML(volTotal);
    }, [localState, isOpenBarMode, consumptionProfiles]);

    const updateMixItem = (key: string, field: string, value: string | number) => {
        setLocalState(prev => ({
            ...prev,
            mix: {
                ...prev.mix,
                [key]: {
                    ...prev.mix[key],
                    [field]: parseFloat(value as string) || 0
                }
            }
        }));
    };

    const normalizeMix = () => {
        const currentTotal = Object.values(localState.mix).reduce((acc: number, item: any) => {
            return acc + (item.share || 0);
        }, 0);
        if (currentTotal === 0) return;

        const factor = 100 / currentTotal;
        const newMix: BarMix = JSON.parse(JSON.stringify(localState.mix));

        // Scale everything
        Object.keys(newMix).forEach(key => {
            newMix[key].share = Math.round((newMix[key].share as number) * factor);
        });

        // Fix rounding errors to ensure exactly 100
        const newTotal = Object.values(newMix).reduce((acc: number, item) => {
            return acc + (item.share || 0);
        }, 0);
        const diff = 100 - newTotal;
        if (diff !== 0) {
            // Add diff to the largest item
            const largestKey = Object.keys(newMix).reduce((a, b) => newMix[a].share > newMix[b].share ? a : b);
            newMix[largestKey].share += diff;
        }

        setLocalState(prev => ({ ...prev, mix: newMix }));
    };

    const impliedCmv = vendaTotal > 0 ? custoTotal / vendaTotal : 0;
    const lucroPorPessoa = vendaTotal - custoTotal;
    const precoSugeridoOpenBar = custoTotal * (1 + (markupOpenBar / 100));

    const totalShare = Object.values(localState.mix).reduce((acc: number, item: any) => {
        return acc + (item.share || 0);
    }, 0);
    const isMixValid = Math.abs(totalShare - 100) < 0.5;

    return (
        <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white rounded-xl p-0 w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
                <div className="flex justify-between items-center p-6 border-b bg-gray-50/50">
                    <div>
                        <h3 className="font-bold text-xl text-indigo-900 flex items-center gap-2">
                            <Martini size={24} className="text-indigo-600" /> {isOpenBarMode ? 'Cálculo de Open Bar' : 'Engenharia de Menu (Bar)'}
                        </h3>
                        <p className="text-xs text-gray-500 mt-1">
                            {isOpenBarMode
                                ? 'Defina o custo por cabeça para precificar corretamente seu ingresso.'
                                : 'Simule o Ticket Médio e ajuste o CMV do seu bar.'}
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors"><X className="text-gray-500" /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {/* Controls Top */}
                    <div className="grid grid-cols-2 gap-4 bg-indigo-50/50 p-4 rounded-xl border border-indigo-100">
                        <div>
                            <label className="text-[10px] font-bold text-gray-600 uppercase mb-2 block tracking-wider">Perfil do Público</label>
                            <div className="flex flex-col gap-2">
                                {['leve', 'moderado', 'pesado'].map(p => (
                                    <button
                                        key={p}
                                        onClick={() => setLocalState(prev => ({ ...prev, perfil: p as keyof ConsumptionProfile }))}
                                        className={`p-2 rounded-lg text-xs font-bold border capitalize transition-all flex justify-between items-center ${localState.perfil === p ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}
                                    >
                                        <span>{p}</span>
                                        <span className="text-[9px] opacity-70">~{consumptionProfiles[p as keyof ConsumptionProfile]} drinks/h</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-gray-600 uppercase mb-2 block tracking-wider">Duração do Evento ({localState.duracao}h)</label>
                            <input
                                type="range"
                                min="3"
                                max="12"
                                step="1"
                                value={localState.duracao}
                                onChange={e => setLocalState(prev => ({ ...prev, duracao: Number(e.target.value) }))}
                                className="w-full h-2 bg-indigo-200 rounded-lg accent-indigo-600 mb-2"
                            />
                            <p className="text-[10px] text-gray-500 leading-tight">
                                *O algoritmo considera redução natural de consumo após a 4ª hora de festa.
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Mix List */}
                        <div>
                            <div className="flex justify-between items-center mb-3">
                                <h4 className="text-sm font-bold text-gray-800 flex items-center gap-2"><Beer size={16} /> Mix de Produtos</h4>
                                <div className={`text-xs font-bold px-2 py-1 rounded flex items-center gap-1 ${isMixValid ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                                    {isMixValid ? 'Total: 100%' : `Total: ${totalShare}%`}
                                    {!isMixValid && <AlertTriangle size={12} />}
                                </div>
                            </div>

                            {!isMixValid && (
                                <button
                                    onClick={normalizeMix}
                                    className="w-full mb-3 py-2 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-lg text-xs font-bold flex items-center justify-center gap-2 hover:bg-indigo-100 transition-colors animate-pulse"
                                >
                                    <RefreshCcw size={12} /> Ajustar para 100% Automaticamente
                                </button>
                            )}

                            <div className="space-y-3 h-64 overflow-y-auto pr-2 custom-scrollbar">
                                {Object.entries(localState.mix).map(([key, item]: [string, any]) => (
                                    <div key={key} className="border border-gray-200 rounded-xl p-3 bg-white hover:border-indigo-300 transition-colors">
                                        <div className="flex justify-between text-xs font-bold text-gray-700 mb-2">
                                            <span className="capitalize">{item.label || key}</span>
                                            <span className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">{item.share}% Share</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="0" max="100"
                                            value={item.share || 0}
                                            onChange={e => updateMixItem(key, 'share', e.target.value)}
                                            className="w-full h-1 bg-gray-100 rounded-lg accent-gray-400 mb-3"
                                        />
                                        <div className="flex gap-2">
                                            <div className="flex-1">
                                                <label className="text-[9px] text-gray-500 uppercase block">Custo</label>
                                                <input
                                                    type="number"
                                                    value={item.custo || 0}
                                                    onChange={e => updateMixItem(key, 'custo', e.target.value)}
                                                    className="w-full border rounded p-1 text-xs bg-gray-50"
                                                />
                                            </div>
                                            {!isOpenBarMode && (
                                                <div className="flex-1">
                                                    <label className="text-[9px] text-gray-500 uppercase block">Venda</label>
                                                    <input
                                                        type="number"
                                                        value={item.venda || 0}
                                                        onChange={e => updateMixItem(key, 'venda', e.target.value)}
                                                        className="w-full border rounded p-1 text-xs bg-gray-50"
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Analysis Panel */}
                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col justify-between">
                            {isOpenBarMode ? (
                                <>
                                    <div>
                                        <h4 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2"><Calculator size={16} /> Precificação Sugerida</h4>
                                        <div className="mb-4">
                                            <span className="text-xs font-bold text-slate-500 uppercase block mb-1">Custo Bebida / Pessoa</span>
                                            <span className="text-3xl font-bold text-rose-500 block">{money(custoTotal)}</span>
                                        </div>

                                        <div className="bg-white p-3 rounded-lg border border-slate-200 mb-3">
                                            <label className="text-xs font-bold text-indigo-600 uppercase block mb-2">Margem Desejada ({markupOpenBar}%)</label>
                                            <input
                                                type="range"
                                                min="0"
                                                max="500"
                                                step="10"
                                                value={markupOpenBar}
                                                onChange={e => setMarkupOpenBar(Number(e.target.value))}
                                                className="w-full h-1.5 bg-indigo-100 rounded-lg accent-indigo-600 mb-2"
                                            />
                                            <div className="flex justify-between items-end mt-2">
                                                <span className="text-[10px] text-gray-500">Valor para cobrir bebida + lucro</span>
                                                <span className="text-lg font-bold text-emerald-600">{money(precoSugeridoOpenBar)}</span>
                                            </div>
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div>
                                        <h4 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2"><DollarSign size={16} /> Resultado Financeiro</h4>
                                        <div className="grid grid-cols-2 gap-4 mb-4">
                                            <div>
                                                <span className="text-[10px] font-bold text-slate-500 uppercase block">Ticket Médio</span>
                                                <span className="text-xl font-bold text-emerald-600">{money(vendaTotal)}</span>
                                            </div>
                                            <div>
                                                <span className="text-[10px] font-bold text-slate-500 uppercase block">Custo (CMV)</span>
                                                <span className="text-xl font-bold text-rose-500">{money(custoTotal)}</span>
                                            </div>
                                        </div>

                                        <div className="bg-white p-3 rounded-lg border border-slate-200 mb-3">
                                            <div className="flex justify-between items-center mb-1">
                                                <span className="text-xs font-bold text-slate-600 uppercase">CMV Projetado</span>
                                                <span className="text-xs font-bold text-slate-800">{(impliedCmv * 100).toFixed(1)}%</span>
                                            </div>
                                            <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                                                <div className={`h-full ${impliedCmv > 0.35 ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, impliedCmv * 100)}%` }}></div>
                                            </div>
                                            <p className="text-[9px] text-gray-400 mt-1">
                                                {impliedCmv > 0.35 ? 'Atenção: CMV alto. Considere aumentar preços.' : 'Margem saudável.'}
                                            </p>
                                        </div>

                                        <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-100 mb-3">
                                            <span className="text-[10px] font-bold text-emerald-600 uppercase block">Lucro Bruto / Pessoa</span>
                                            <span className="text-2xl font-bold text-emerald-700">{money(lucroPorPessoa)}</span>
                                        </div>
                                    </div>
                                </>
                            )}

                            {/* Volume Visualization */}
                            <div className="bg-blue-50 p-3 rounded-lg border border-blue-100">
                                <div className="flex justify-between items-center mb-1">
                                    <span className="text-[10px] font-bold text-blue-600 uppercase flex items-center gap-1">
                                        <Droplets size={12} /> Volume Estimado
                                    </span>
                                    <span className="text-lg font-bold text-blue-800">{(volumeTotalML / 1000).toFixed(2)} L <span className="text-xs font-normal opacity-70">/pax</span></span>
                                </div>
                                <div className="w-full bg-blue-200 h-1.5 rounded-full overflow-hidden mb-1">
                                    {/* Visual scale assuming 2.5L max per person for bar width */}
                                    <div className="h-full bg-blue-500" style={{ width: `${Math.min(100, (volumeTotalML / 2500) * 100)}%` }}></div>
                                </div>
                                <p className="text-[9px] text-blue-500 leading-tight">
                                    Equivale a aprox. <strong>{Math.ceil(volumeTotalML / 350)} latas</strong> (350ml) por pessoa.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="p-6 bg-slate-900 text-white flex gap-4 items-center justify-between">
                    <div className="text-xs text-slate-400 max-w-[60%]">
                        Ao aplicar, os valores de {isOpenBarMode ? 'Custo Open Bar' : 'Venda Média e Custo (CMV)'} serão atualizados na tela principal.
                    </div>
                    <button
                        disabled={!isMixValid}
                        onClick={() => onApply(vendaTotal, custoTotal, localState, impliedCmv)}
                        className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-900/50 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform active:scale-[0.98]"
                    >
                        {isMixValid ? 'Aplicar Resultados' : 'Ajuste o Mix para 100%'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default BarSimulatorModal;
