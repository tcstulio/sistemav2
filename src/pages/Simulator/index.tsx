
import React, { useState, useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight, RefreshCcw, FolderOpen } from 'lucide-react';
import { useDolibarr } from '../../context/DolibarrContext';
import { SimulationState } from './types';
import { STORAGE_KEY_DRAFT, DEFAULT_BAR_MIX, DEFAULT_BUFFET_SIM, DEFAULT_COSTS } from './constants';
import { calculateDualSimulation } from './utils';
import Step1Drivers from './components/steps/Step1Drivers';
import Step2Negotiation from './components/steps/Step2Negotiation';
import Step3BreakEven from './components/steps/Step3BreakEven';
import Step4Results from './components/steps/Step4Results';
import BarSimulatorModal from './components/modals/BarSimulatorModal';
import BuffetSimulatorModal from './components/modals/BuffetSimulatorModal';
import SavedSimulationsModal from './components/modals/SavedSimulationsModal';
import ExtratoDetalhado from './components/modals/ExtratoDetalhado';

const Simulator = () => {
    const { currentUser: doliUser } = useDolibarr();

    // Map Dolibarr user to simulator context
    const isAdmin = doliUser?.admin || (doliUser as any)?.superadmin || false;
    const userName = doliUser?.firstname ? `${doliUser.firstname} ${doliUser.lastname}` : doliUser?.login || 'Usuário';

    const [step, setStep] = useState(1);
    const totalSteps = 4;
    const [activeModal, setActiveModal] = useState<'bar' | 'buffet' | 'saved_list' | 'saved_save' | 'extrato' | null>(null);
    const [activeSnapshotId, setActiveSnapshotId] = useState<string | null>(null);

    const [data, setData] = useState<SimulationState>(() => {
        const savedDraft = localStorage.getItem(STORAGE_KEY_DRAFT);
        if (savedDraft) {
            try {
                const parsed = JSON.parse(savedDraft);
                // Migration check
                if (parsed.custoOpenBarPax === undefined) parsed.custoOpenBarPax = 40;
                if (parsed.cmvBarPercent === undefined) parsed.cmvBarPercent = 0.3;
                return parsed;
            } catch (e) {
                console.error("Draft load failed", e);
            }
        }

        return {
            modelName: 'Evento Padrão',
            eventDate: new Date().toLocaleDateString('en-CA'),
            publico: 300,
            ticketMedio: 60,
            temOpenBar: false,
            consumoBar: 90,

            custoOpenBarPax: 40,
            cmvBarPercent: 0.3,
            impostosBuffet: 16,

            barDetails: { duracao: 5, perfil: 'moderado', mix: DEFAULT_BAR_MIX },
            temBuffet: false,
            precoBuffet: 120,
            custoBuffet: 80,
            buffetDetails: DEFAULT_BUFFET_SIM,
            impostosTicket: 10,
            impostosBar: 16,
            impostosAluguel: 22,
            aluguelMode: 'fixo',
            aluguelFixo: 6000,
            aluguelPercentual: 0,
            partners: [{ id: 'p1', name: 'Produtor Externo', splitTicket: 100, splitBar: 0 }],
            extraCosts: DEFAULT_COSTS
        };
    });

    useEffect(() => {
        localStorage.setItem(STORAGE_KEY_DRAFT, JSON.stringify(data));
    }, [data]);

    const results = useMemo(() => calculateDualSimulation(data), [data]);

    // Adapted handler for the BarSimulatorModal: (vendaTotal, custoTotal, fullState, impliedCmv?)
    const applyBarData = (vendaTotal: number, custoTotal: number, fullState: any, impliedCmv?: number) => {
        setData(prev => ({
            ...prev,
            barDetails: {
                mix: fullState.mix,
                duracao: fullState.duracao,
                perfil: fullState.perfil
            },
            consumoBar: vendaTotal,
            custoOpenBarPax: prev.temOpenBar ? custoTotal : prev.custoOpenBarPax,
            cmvBarPercent: !prev.temOpenBar && vendaTotal > 0 ? custoTotal / vendaTotal : prev.cmvBarPercent
        }));
        setActiveModal(null);
    };

    // Adapted handler for the BuffetSimulatorModal: (custoVariavel, vendaPorPessoa, fullState, staffCosts)
    const applyBuffetData = (custoVariavel: number, vendaPorPessoa: number, fullState: any, staffCosts: any[]) => {
        // Transform staff costs to CostItem format
        const transformedStaffCosts = staffCosts.map((s: any) => ({
            id: Date.now() + Math.random(),
            item: s.item,
            valor: s.valor,
            mode: s.mode || 'fixed',
            owner: s.owner || 'venue',
            categoria: s.categoria || 'Buffet'
        }));

        // Remove previous buffet staff costs to avoid duplication
        const cleanCosts = data.extraCosts.filter(c => !c.item?.includes('Buffet'));

        setData(prev => ({
            ...prev,
            custoBuffet: custoVariavel,
            precoBuffet: vendaPorPessoa,
            buffetDetails: fullState,
            extraCosts: [...cleanCosts, ...transformedStaffCosts]
        }));
        setActiveModal(null);
    };

    const handleLoadSimulation = (savedData: any, snapshotId: string) => {
        if (savedData.custoOpenBarPax === undefined) savedData.custoOpenBarPax = 40;
        if (savedData.cmvBarPercent === undefined) savedData.cmvBarPercent = 0.3;

        setData(savedData);
        setActiveSnapshotId(snapshotId);
        setStep(4);
    };

    const handleReset = () => {
        localStorage.removeItem(STORAGE_KEY_DRAFT);
        window.location.reload();
    };

    if (!doliUser) {
        return <div className="p-10 text-center">Carregando usuário...</div>
    }

    return (
        <div className="min-h-screen bg-slate-50 font-sans text-slate-800 pb-20">

            {/* Header removed as it is handled by MainLayout, but we can keep a sub-header or toolbar if needed */}
            <div className="bg-white border-b border-slate-200 px-6 py-4 mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4 sticky top-0 z-30 shadow-sm">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">Simulador de Eventos</h1>
                    <p className="text-sm text-slate-500">Planeje a viabilidade financeira do seu evento</p>
                </div>

                <div className="flex items-center gap-3">
                    <div className="hidden lg:flex items-center gap-1 mr-4 bg-slate-100 p-1 rounded-lg">
                        {[1, 2, 3, 4].map(s => (
                            <button
                                key={s}
                                onClick={() => setStep(s)}
                                className={`h-2 w-8 rounded-full transition-all ${s <= step ? 'bg-indigo-600' : 'bg-slate-300 hover:bg-indigo-400'}`}
                                title={`Ir para passo ${s}`}
                            />
                        ))}
                    </div>

                    <button
                        onClick={() => setActiveModal('saved_list')}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl text-slate-700 hover:bg-slate-100 font-bold text-sm transition-colors border border-slate-200 shadow-sm bg-white"
                    >
                        <FolderOpen size={18} /> <span className="hidden sm:inline">Biblioteca</span>
                    </button>
                </div>
            </div>

            <main className="max-w-6xl mx-auto px-4 md:px-6">
                <div className="min-h-[600px]">
                    {step === 1 && <Step1Drivers data={data} setData={setData} setActiveModal={setActiveModal} results={results} />}
                    {step === 2 && <Step2Negotiation data={data} setData={setData} />}
                    {step === 3 && <Step3BreakEven data={data} results={results} />}
                    {step === 4 && <Step4Results data={data} setData={setData} results={results} onSave={() => setActiveModal('saved_save')} />}
                </div>

                <div className="mt-8 flex justify-between pt-6 border-t border-slate-200 sticky bottom-0 bg-slate-50/90 backdrop-blur-sm p-4 z-20">
                    <button onClick={() => setStep(s => Math.max(1, s - 1))} disabled={step === 1} className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-slate-500 hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"><ChevronLeft size={20} /> Voltar</button>
                    {step < totalSteps ? (
                        <button onClick={() => setStep(s => Math.min(totalSteps, s + 1))} className="flex items-center gap-2 px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 transition-all active:scale-95">Próximo <ChevronRight size={20} /></button>
                    ) : (
                        <button onClick={handleReset} className="flex items-center gap-2 px-8 py-3 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl font-bold transition-all active:scale-95"><RefreshCcw size={18} /> Novo Cálculo</button>
                    )}
                </div>
            </main>

            {activeModal === 'bar' && <BarSimulatorModal isOpenBarMode={data.temOpenBar} initialData={data.barDetails} consumptionProfiles={{ leve: 1, moderado: 2, pesado: 3.5 }} onApply={applyBarData} onClose={() => setActiveModal(null)} />}
            {activeModal === 'buffet' && <BuffetSimulatorModal publicoEstimado={data.publico} initialData={data.buffetDetails} onApply={applyBuffetData} onClose={() => setActiveModal(null)} />}
            {(activeModal === 'saved_list' || activeModal === 'saved_save') && (
                <SavedSimulationsModal
                    currentData={data}
                    currentSummary={{ revenue: results.totalGross, profit: results.venue.profit, modelLabel: data.modelName }}
                    activeSnapshotId={activeSnapshotId}
                    isAdmin={isAdmin}
                    userName={doliUser?.login || 'usuario'}
                    onLoad={handleLoadSimulation}
                    onClose={() => setActiveModal(null)}
                    initialView={activeModal === 'saved_save' ? 'save' : 'list'}
                />
            )}
            {activeModal === 'extrato' && <ExtratoDetalhado dados={results.extrato} onClose={() => setActiveModal(null)} />}
        </div>
    );
};

export default Simulator;
