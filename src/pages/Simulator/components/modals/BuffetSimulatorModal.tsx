
import React, { useState, useEffect } from 'react';
import { Utensils, X, Users, ChefHat, DollarSign, Info } from 'lucide-react';
import { BuffetSimulationData, CostItem } from '../../types';
import { money } from '../../utils';

interface Props {
    initialData?: BuffetSimulationData;
    publicoEstimado: number;
    onClose: () => void;
    onApply: (custoVariavel: number, vendaPorPessoa: number, fullState: BuffetSimulationData, staffCosts: CostItem[]) => void;
}

const BUFFET_STYLES = {
    coquetel: { label: 'Coquetel Volante', baseCost: 35, description: 'Salgados volantes, serviço em pé.' },
    finger: { label: 'Finger Food / Ilhas', baseCost: 55, description: 'Ilhas gastronômicas e mini porções.' },
    jantar: { label: 'Jantar Empratado', baseCost: 85, description: 'Entrada, prato principal e sobremesa.' },
    full: { label: 'Buffet Completo', baseCost: 70, description: 'Buffet self-service com variedade.' }
};

const QUALITY_MULTIPLIERS = {
    economico: 0.85,
    padrao: 1.0,
    premium: 1.4
};

const BuffetSimulatorModal: React.FC<Props> = ({ initialData, publicoEstimado, onClose, onApply }) => {
    const [data, setData] = useState<BuffetSimulationData>(initialData || {
        estilo: 'coquetel',
        nivel: 'padrao',
        custoInsumoBase: 35,
        garcons: { qtd: 0, custo: 180, ratio: 20 },
        cozinha: { qtd: 0, custo: 250, ratio: 50 },
        margemAlvo: 100
    });

    const [calculo, setCalculo] = useState({
        custoInsumosTotal: 0,
        custoInsumoUnitario: 0,
        custoStaffTotal: 0,
        custoPorCabecaTotal: 0,
        precoVendaSugerido: 0
    });

    // Recalcular quando inputs mudam
    useEffect(() => {
        // 1. Custo Insumos (Variável Pura)
        const baseStyle = BUFFET_STYLES[data.estilo].baseCost;
        const multiplier = QUALITY_MULTIPLIERS[data.nivel];
        const custoInsumoUnitario = baseStyle * multiplier;

        // 2. Staff (Escalonado / Step Cost)
        // Nota: O cálculo aqui é apenas para visualização do total estimado.
        // A lógica real será passada como CostItems do tipo 'step'.
        const numGarcons = Math.ceil(publicoEstimado / (data.garcons.ratio || 1));
        const numCozinha = Math.ceil(publicoEstimado / (data.cozinha.ratio || 1));

        const custoGarconsTotal = numGarcons * data.garcons.custo;
        const custoCozinhaTotal = numCozinha * data.cozinha.custo;
        const custoStaffTotal = custoGarconsTotal + custoCozinhaTotal;

        // 3. Totais e Unitários Combinados (Para referência visual)
        const custoTotalEvento = (custoInsumoUnitario * publicoEstimado) + custoStaffTotal;
        const custoPorCabecaTotal = custoTotalEvento / (publicoEstimado || 1);

        // A venda sugerida considera o custo TOTAL por cabeça para garantir margem sobre a operação completa
        const vendaSugerida = custoPorCabecaTotal * (1 + (data.margemAlvo / 100));

        // Atualizar estado derivado para exibição
        setCalculo({
            custoInsumosTotal: custoInsumoUnitario * publicoEstimado,
            custoInsumoUnitario,
            custoStaffTotal,
            custoPorCabecaTotal,
            precoVendaSugerido: vendaSugerida
        });

        // Atualizar também o estado local de quantidades para feedback visual
        setData(prev => ({
            ...prev,
            garcons: { ...prev.garcons, qtd: numGarcons },
            cozinha: { ...prev.cozinha, qtd: numCozinha }
        }));

    }, [data.estilo, data.nivel, data.garcons.ratio, data.garcons.custo, data.cozinha.ratio, data.cozinha.custo, data.margemAlvo, publicoEstimado]);

    const handleApply = () => {
        // Gerar CostItems específicos para o Staff
        // Usamos mode: 'step' para que o simulador principal recalcule corretamente se o público mudar
        const staffCosts: CostItem[] = [
            {
                id: `buffet_staff_waiter_${Date.now()}`,
                item: 'Staff Buffet (Garçons/Copa)',
                categoria: 'Staff Buffet',
                valor: data.garcons.custo,
                mode: 'step',
                stepSize: data.garcons.ratio,
                minUnits: 1,
                owner: 'venue' // Assumindo que quem contrata o buffet paga o custo, geralmente 'venue' se for produção própria ou repasse
            },
            {
                id: `buffet_staff_kitchen_${Date.now()}`,
                item: 'Staff Buffet (Cozinha)',
                categoria: 'Staff Buffet',
                valor: data.cozinha.custo,
                mode: 'step',
                stepSize: data.cozinha.ratio,
                minUnits: 1,
                owner: 'venue'
            }
        ];

        onApply(calculo.custoInsumoUnitario, calculo.precoVendaSugerido, data, staffCosts);
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white rounded-xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">

                {/* Header */}
                <div className="flex justify-between items-center p-6 border-b bg-gray-50/50">
                    <div>
                        <h3 className="font-bold text-xl text-orange-600 flex items-center gap-2">
                            <Utensils size={24} /> Engenharia de Buffet
                        </h3>
                        <p className="text-xs text-gray-500 mt-1">
                            Simulando custos de insumos e equipe para <strong>{publicoEstimado} pessoas</strong>.
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors"><X className="text-gray-500" /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-8">

                    {/* 1. Estilo e Nível */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="text-xs font-bold text-gray-500 uppercase block mb-3">Estilo de Serviço</label>
                            <div className="space-y-2">
                                {Object.entries(BUFFET_STYLES).map(([key, info]) => (
                                    <button
                                        key={key}
                                        onClick={() => setData({ ...data, estilo: key as any })}
                                        className={`w-full text-left p-3 rounded-xl border transition-all ${data.estilo === key ? 'bg-orange-50 border-orange-500 ring-1 ring-orange-500' : 'bg-white border-gray-200 hover:border-orange-300'}`}
                                    >
                                        <div className="font-bold text-sm text-gray-800">{info.label}</div>
                                        <div className="text-xs text-gray-500">{info.description}</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div>
                            <label className="text-xs font-bold text-gray-500 uppercase block mb-3">Qualidade dos Insumos</label>
                            <div className="flex gap-2 mb-6">
                                {['economico', 'padrao', 'premium'].map(niv => (
                                    <button
                                        key={niv}
                                        onClick={() => setData({ ...data, nivel: niv as any })}
                                        className={`flex-1 py-2 rounded-lg text-xs font-bold border capitalize ${data.nivel === niv ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-gray-500'}`}
                                    >
                                        {niv}
                                    </button>
                                ))}
                            </div>

                            <div className="bg-orange-50 p-4 rounded-xl border border-orange-100">
                                <span className="text-xs font-bold text-orange-600 uppercase block mb-1">Custo Insumos (Variável)</span>
                                <div className="flex items-baseline gap-1">
                                    <span className="text-2xl font-bold text-gray-800">
                                        {money(calculo.custoInsumoUnitario)}
                                    </span>
                                    <span className="text-xs text-gray-500">/ pessoa</span>
                                </div>
                                <p className="text-[10px] text-gray-400 mt-2">Custo de comida/bebida puro.</p>
                            </div>
                        </div>
                    </div>

                    {/* 2. Equipe */}
                    <div className="border-t pt-6">
                        <div className="flex justify-between items-center mb-4">
                            <h4 className="text-sm font-bold text-gray-800 flex items-center gap-2"><Users size={16} /> Dimensionamento de Equipe</h4>
                            <div className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded font-medium flex items-center gap-1">
                                <Info size={12} /> Custos inseridos como "Escalonados"
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Garçons */}
                            <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                                <div className="flex justify-between mb-2">
                                    <span className="text-xs font-bold text-gray-600">Garçons / Copa</span>
                                    <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">{data.garcons.qtd} escalados</span>
                                </div>
                                <div className="grid grid-cols-2 gap-3 mb-2">
                                    <div>
                                        <label className="text-[9px] text-gray-500 uppercase block">1 a cada X pax</label>
                                        <input
                                            type="number"
                                            value={data.garcons.ratio}
                                            onChange={e => setData({ ...data, garcons: { ...data.garcons, ratio: Number(e.target.value) } })}
                                            className="w-full border rounded p-1 text-sm bg-white text-gray-900"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[9px] text-gray-500 uppercase block">Custo Diária</label>
                                        <input
                                            type="number"
                                            value={data.garcons.custo}
                                            onChange={e => setData({ ...data, garcons: { ...data.garcons, custo: Number(e.target.value) } })}
                                            className="w-full border rounded p-1 text-sm bg-white text-gray-900"
                                        />
                                    </div>
                                </div>
                                <div className="text-right text-xs font-bold text-gray-500">Total: {money(data.garcons.qtd * data.garcons.custo)}</div>
                            </div>

                            {/* Cozinha */}
                            <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                                <div className="flex justify-between mb-2">
                                    <span className="text-xs font-bold text-gray-600 flex items-center gap-1"><ChefHat size={12} /> Cozinha</span>
                                    <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">{data.cozinha.qtd} escalados</span>
                                </div>
                                <div className="grid grid-cols-2 gap-3 mb-2">
                                    <div>
                                        <label className="text-[9px] text-gray-500 uppercase block">1 a cada X pax</label>
                                        <input
                                            type="number"
                                            value={data.cozinha.ratio}
                                            onChange={e => setData({ ...data, cozinha: { ...data.cozinha, ratio: Number(e.target.value) } })}
                                            className="w-full border rounded p-1 text-sm bg-white text-gray-900"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[9px] text-gray-500 uppercase block">Custo Diária</label>
                                        <input
                                            type="number"
                                            value={data.cozinha.custo}
                                            onChange={e => setData({ ...data, cozinha: { ...data.cozinha, custo: Number(e.target.value) } })}
                                            className="w-full border rounded p-1 text-sm bg-white text-gray-900"
                                        />
                                    </div>
                                </div>
                                <div className="text-right text-xs font-bold text-gray-500">Total: {money(data.cozinha.qtd * data.cozinha.custo)}</div>
                            </div>
                        </div>
                    </div>

                    {/* 3. Precificação */}
                    <div className="border-t pt-6">
                        <div className="flex items-center gap-4 mb-4">
                            <h4 className="text-sm font-bold text-gray-800 flex items-center gap-2"><DollarSign size={16} /> Markup Desejado</h4>
                            <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
                                <button onClick={() => setData({ ...data, margemAlvo: Math.max(0, data.margemAlvo - 10) })} className="w-6 h-6 flex items-center justify-center font-bold text-gray-500 hover:bg-white rounded">-</button>
                                <span className="text-xs font-bold w-12 text-center">{data.margemAlvo}%</span>
                                <button onClick={() => setData({ ...data, margemAlvo: data.margemAlvo + 10 })} className="w-6 h-6 flex items-center justify-center font-bold text-gray-500 hover:bg-white rounded">+</button>
                            </div>
                        </div>
                    </div>

                </div>

                {/* Footer Results */}
                <div className="p-6 bg-slate-900 text-white flex gap-6 items-center">
                    <div className="flex-1">
                        <div className="flex justify-between mb-1">
                            <span className="text-xs text-slate-400">Custo Total Ref. / Pessoa</span>
                            <span className="text-xs font-bold text-rose-300">{money(calculo.custoPorCabecaTotal)}</span>
                        </div>
                        <div className="w-full bg-slate-700 h-1.5 rounded-full overflow-hidden flex">
                            <div className="bg-rose-500 h-full" style={{ width: `${(calculo.custoInsumoUnitario / calculo.custoPorCabecaTotal) * 100}%` }}></div>
                            <div className="bg-rose-300 h-full" style={{ width: `${(1 - (calculo.custoInsumoUnitario / calculo.custoPorCabecaTotal)) * 100}%` }}></div>
                        </div>
                        <p className="text-[9px] text-slate-500 mt-1 flex justify-between">
                            <span>Insumos (Var)</span> <span>Staff (Step)</span>
                        </p>
                    </div>

                    <div className="flex-1">
                        <div className="flex justify-between mb-1">
                            <span className="text-xs text-slate-400">Preço Venda / Pessoa</span>
                            <span className="text-xs font-bold text-emerald-300">{money(calculo.precoVendaSugerido)}</span>
                        </div>
                        <div className="w-full bg-slate-700 h-1.5 rounded-full overflow-hidden">
                            <div className="bg-emerald-500 h-full" style={{ width: '100%' }}></div>
                        </div>
                        <p className="text-[9px] text-slate-500 mt-1">Margem: {data.margemAlvo}%</p>
                    </div>

                    <button
                        onClick={handleApply}
                        className="px-6 py-3 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-xl shadow-lg shadow-orange-900/50 transition-all active:scale-95"
                    >
                        Aplicar
                    </button>
                </div>

            </div>
        </div>
    );
};

export default BuffetSimulatorModal;
