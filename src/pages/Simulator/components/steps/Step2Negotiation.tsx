
import React, { useState } from 'react';
import { Briefcase, Coins, Percent, Handshake, PieChart, UserPlus, CheckCircle, AlertTriangle, Beer, Copy, Trash2, FileMinus, Ticket, Building2, DollarSign, X, Save, Plus, Pencil } from 'lucide-react';
import { SimulationState, Partner, CostItem, CostItemMode } from '../../types';
import { money } from '../../utils';

interface Step2Props {
    data: SimulationState;
    setData: React.Dispatch<React.SetStateAction<SimulationState>>;
}

const Step2Negotiation: React.FC<Step2Props> = ({ data, setData }) => {
    const [editingId, setEditingId] = useState<string | number | null>(null);
    const [costForm, setCostForm] = useState<{
        item: string;
        valor: string;
        mode: CostItemMode;
        owner: string;
        shareVenue: number;
        sharedWith: string;
        customSplits: Record<string, number>;
        minTotalValue: string;
    }>({
        item: '',
        valor: '',
        mode: 'fixed',
        owner: 'venue',
        shareVenue: 50,
        sharedWith: '',
        customSplits: {},
        minTotalValue: ''
    });

    const partnerTotalShare = data.partners.reduce((acc: number, p: Partner) => acc + p.splitTicket, 0);
    const houseShare = (data.aluguelMode === 'fixo') ? 0 : (data.aluguelPercentual || 0);
    const unallocated = 100 - (partnerTotalShare + houseShare);
    const partnerTotalBarShare = data.partners.reduce((acc: number, p: Partner) => acc + p.splitBar, 0);
    const houseBarShare = Math.max(0, 100 - partnerTotalBarShare);
    const barOverflow = partnerTotalBarShare > 100 ? partnerTotalBarShare - 100 : 0;

    const autoFixSplit = () => {
        if (data.partners.length === 0) { setData({ ...data, aluguelPercentual: 100 }); return; }
        const share = unallocated / data.partners.length;
        const newPartners = data.partners.map((p: Partner) => ({ ...p, splitTicket: Math.max(0, p.splitTicket + share) }));
        setData({ ...data, partners: newPartners });
    };

    const autoFixBarSplit = () => {
        if (partnerTotalBarShare <= 100) return;
        const scale = 100 / partnerTotalBarShare;
        const newPartners = data.partners.map((p: Partner) => ({ ...p, splitBar: Math.floor(p.splitBar * scale) }));
        setData({ ...data, partners: newPartners });
    };

    const copyTicketToBar = () => {
        const newPartners = data.partners.map((p: Partner) => ({ ...p, splitBar: p.splitTicket }));
        setData({ ...data, partners: newPartners });
    };

    const handleModeChange = (mode: 'fixo' | 'percentual' | 'hibrido') => {
        setData({ ...data, aluguelMode: mode });
    };

    const updatePartner = (id: string, field: keyof Partner, val: any) => {
        setData({ ...data, partners: data.partners.map((p: Partner) => p.id === id ? { ...p, [field]: val } : p) });
    };

    const removePartner = (id: string) => setData({ ...data, partners: data.partners.filter((p: Partner) => p.id !== id) });

    const addPartner = () => {
        const remainingShare = Math.max(0, 100 - (data.aluguelPercentual || 0) - data.partners.reduce((s: number, p: Partner) => s + p.splitTicket, 0));
        const newP: Partner = { id: Date.now().toString(), name: 'Novo Parceiro', splitTicket: remainingShare, splitBar: 0 };
        setData({ ...data, partners: [...data.partners, newP] });
    };

    const resetCostForm = () => { setCostForm({ item: '', valor: '', mode: 'fixed', owner: 'venue', shareVenue: 50, sharedWith: '', customSplits: {}, minTotalValue: '' }); setEditingId(null); }

    const saveCostItem = () => {
        if (!costForm.item || !costForm.valor) return;
        const newItem: CostItem = {
            id: editingId || Date.now(),
            item: costForm.item,
            valor: parseFloat(costForm.valor),
            mode: costForm.mode as any,
            owner: costForm.owner,
            shareVenue: costForm.owner === 'shared' ? Number(costForm.shareVenue) : undefined,
            sharedWith: costForm.owner === 'shared' ? costForm.sharedWith : undefined,
            customSplits: costForm.owner === 'custom' ? costForm.customSplits : undefined,
            minTotalValue: costForm.mode === 'min_pax' ? parseFloat(costForm.minTotalValue) : undefined,
            categoria: 'Outros'
        };
        if (editingId) setData({ ...data, extraCosts: data.extraCosts.map((c: CostItem) => c.id === editingId ? newItem : c) });
        else setData({ ...data, extraCosts: [...data.extraCosts, newItem] });
        resetCostForm();
    };

    const removeCostItem = (id: number | string) => setData({ ...data, extraCosts: data.extraCosts.filter((c: CostItem) => c.id !== id) });

    const editCostItem = (cost: CostItem) => {
        setCostForm({
            item: cost.item || '',
            valor: cost.valor?.toString() || '',
            mode: cost.mode || 'fixed',
            owner: cost.owner || 'venue',
            shareVenue: cost.shareVenue ?? 50,
            sharedWith: cost.sharedWith || '',
            customSplits: cost.customSplits || {},
            minTotalValue: cost.minTotalValue?.toString() || ''
        });
        setEditingId(cost.id);
    };

    const updateCustomSplit = (id: string, pct: number) => setCostForm(prev => ({ ...prev, customSplits: { ...prev.customSplits, [id]: pct } }));
    const customSplitTotal = (costForm.customSplits['venue'] || 0) + data.partners.reduce((acc: number, p: Partner) => acc + (costForm.customSplits[p.id] || 0), 0);

    return (
        <div className="space-y-8 animate-in slide-in-from-right fade-in duration-300">
            <div className="text-center space-y-2 mb-6">
                <h2 className="text-2xl font-bold text-slate-800">Modelo de Negócio</h2>
                <p className="text-slate-500">Como a casa será remunerada? Configure o acordo.</p>
            </div>

            <div className="grid grid-cols-1 gap-8">
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                    <div className="flex items-center gap-2 mb-2">
                        <Briefcase size={20} className="text-indigo-600" />
                        <h3 className="font-bold text-slate-700">Formato do Acordo</h3>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        <button onClick={() => handleModeChange('fixo')} className={`p-3 rounded-xl border-2 flex flex-col items-center justify-center gap-2 transition-all ${data.aluguelMode === 'fixo' ? 'border-indigo-50 border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-100 text-slate-500 hover:bg-slate-50'}`}><Coins size={24} /><span className="text-xs font-bold uppercase">Aluguel Fixo</span></button>
                        <button onClick={() => handleModeChange('percentual')} className={`p-3 rounded-xl border-2 flex flex-col items-center justify-center gap-2 transition-all ${data.aluguelMode === 'percentual' ? 'border-indigo-50 border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-100 text-slate-500 hover:bg-slate-50'}`}><Percent size={24} /><span className="text-xs font-bold uppercase">% Bilheteria</span></button>
                        <button onClick={() => handleModeChange('hibrido')} className={`p-3 rounded-xl border-2 flex flex-col items-center justify-center gap-2 transition-all ${data.aluguelMode === 'hibrido' ? 'border-indigo-50 border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-100 text-slate-500 hover:bg-slate-50'}`}><Handshake size={24} /><span className="text-xs font-bold uppercase">Híbrido (Maior)</span></button>
                    </div>
                    <div className="grid grid-cols-2 gap-6 pt-4 border-t border-slate-100">
                        <div className={data.aluguelMode === 'percentual' ? 'opacity-30 pointer-events-none' : ''}><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Valor do Aluguel (Mínimo)</label><input type="number" value={data.aluguelFixo} onChange={e => setData({ ...data, aluguelFixo: Number(e.target.value) })} className="w-full border border-slate-300 rounded-lg p-3 font-bold text-slate-800 outline-none focus:border-indigo-500 bg-white" placeholder="0.00" /></div>
                        <div className={data.aluguelMode === 'fixo' ? 'opacity-30 pointer-events-none' : ''}><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Split da Casa (%)</label><div className="flex items-center gap-2"><input type="number" min="0" max="100" value={data.aluguelPercentual} onChange={e => setData({ ...data, aluguelPercentual: Math.min(100, Number(e.target.value)) })} className="w-full border border-slate-300 rounded-lg p-3 font-bold text-indigo-600 outline-none focus:border-indigo-500 bg-white" /><span className="font-bold text-slate-400">%</span></div></div>
                    </div>
                    {data.aluguelMode === 'hibrido' && <p className="text-xs text-center text-indigo-600 bg-indigo-50 p-2 rounded-lg font-medium">*Híbrido: A Casa toma o <strong>maior valor</strong>. O split definido acima é a base da comparação.</p>}
                </div>

                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-6">
                    <div className="flex justify-between items-center"><div className="flex items-center gap-2"><PieChart size={20} className="text-emerald-600" /><h3 className="font-bold text-slate-700">Distribuição da Bilheteria</h3></div><button onClick={addPartner} className="text-xs font-bold text-indigo-600 hover:bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100 flex items-center gap-1 transition-colors"><UserPlus size={14} /> Add Sócio</button></div>
                    <div className="space-y-2">
                        <label className="text-[10px] font-bold text-slate-400 uppercase">Proporção da Partilha (Share de Porta)</label>
                        <div className="h-6 w-full bg-slate-100 rounded-full flex overflow-hidden ring-1 ring-slate-200">{houseShare > 0 && <div style={{ width: `${houseShare}%` }} className="bg-indigo-500 h-full flex items-center justify-center text-[10px] font-bold text-white transition-all relative group cursor-help">{houseShare >= 10 && <span>Casa {houseShare}%</span>}<div className="absolute bottom-full mb-1 bg-indigo-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-10">Dedução Casa: {houseShare}%</div></div>}{data.partners.map((p: Partner, idx: number) => (
                            <div key={p.id} style={{ width: `${p.splitTicket}%` }} className={`h-full flex items-center justify-center text-[10px] font-bold text-white transition-all relative group cursor-help border-l border-white/20 ${['bg-emerald-500', 'bg-orange-500', 'bg-blue-500'][idx % 3]}`}>
                                {p.splitTicket >= 10 && <span>{p.name.split(' ')[0]}</span>}
                                <div className="absolute bottom-full mb-1 bg-slate-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-10">{p.name}: {p.splitTicket}%</div>
                            </div>
                        ))}{unallocated > 0.1 && <div className="flex-1 bg-slate-200 h-full flex items-center justify-center text-[10px] font-bold text-slate-500 relative pattern-diagonal-lines">Livre</div>}</div><div className="flex justify-between items-center text-xs"><div className="flex items-center gap-2">{unallocated === 0 ? <span className="text-emerald-600 font-bold flex items-center gap-1"><CheckCircle size={12} /> Distribuição Completa (100%)</span> : unallocated > 0 ? <span className="text-slate-500 font-bold flex items-center gap-1">Restante: {unallocated.toFixed(1)}%</span> : <span className="text-rose-500 font-bold flex items-center gap-1"><AlertTriangle size={12} /> Excesso: {Math.abs(unallocated).toFixed(1)}%</span>}</div>{Math.abs(unallocated) > 0.1 && <button onClick={autoFixSplit} className="text-indigo-600 font-bold hover:underline">Auto-ajustar</button>}</div></div>
                    <div className="border-t border-slate-100 pt-2"></div>
                    <div className="flex justify-between items-center"><div className="flex items-center gap-2"><Beer size={20} className="text-orange-500" /><h3 className="font-bold text-slate-700">Distribuição do Bar</h3></div><button onClick={copyTicketToBar} className="text-xs font-bold text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 px-2 py-1 rounded transition-colors flex items-center gap-1" title="Copiar porcentagens da bilheteria para o bar"><Copy size={12} /> Copiar Bilheteria</button></div>
                    <div className="space-y-2"><div className="h-6 w-full bg-slate-100 rounded-full flex overflow-hidden ring-1 ring-slate-200">{houseBarShare > 0 && <div style={{ width: `${houseBarShare}%` }} className="bg-indigo-500 h-full flex items-center justify-center text-[10px] font-bold text-white transition-all relative group cursor-help">{houseBarShare >= 10 && <span>Casa {houseBarShare.toFixed(0)}%</span>}<div className="absolute bottom-full mb-1 bg-indigo-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-10">Casa: {houseBarShare.toFixed(0)}%</div></div>}{data.partners.map((p: Partner, idx: number) => (p.splitBar > 0 && <div key={p.id} style={{ width: `${p.splitBar}%` }} className={`h-full flex items-center justify-center text-[10px] font-bold text-white transition-all relative group cursor-help border-l border-white/20 ${['bg-emerald-500', 'bg-orange-500', 'bg-blue-500'][idx % 3]}`}>{p.splitBar >= 10 && <span>{p.name.split(' ')[0]}</span>}<div className="absolute bottom-full mb-1 bg-slate-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-10">{p.name}: {p.splitBar}%</div></div>))}{barOverflow > 0 && <div className="w-full h-full bg-rose-500 flex items-center justify-center text-[10px] font-bold text-white relative pattern-diagonal-lines animate-pulse">ERRO: {barOverflow.toFixed(1)}% Excedente</div>}</div><div className="flex justify-between items-center text-xs"><div className="flex items-center gap-2">{barOverflow === 0 ? <span className="text-slate-500 font-bold flex items-center gap-1">Casa Fica com: {houseBarShare.toFixed(1)}%</span> : <span className="text-rose-500 font-bold flex items-center gap-1"><AlertTriangle size={12} /> Distribuição Inválida ({barOverflow.toFixed(1)}% acima de 100%)</span>}</div>{barOverflow > 0 && <button onClick={autoFixBarSplit} className="text-indigo-600 font-bold hover:underline">Auto-ajustar</button>}</div></div>
                    <div className="space-y-3 pt-2">{data.partners.length === 0 ? <div className="text-center py-4 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-xs text-slate-400">Sem sócios externos (100% Casa) ou adicione um sócio acima.</div> : data.partners.map((p: Partner, idx: number) => (<div key={p.id} className="flex items-center gap-3 bg-slate-50 p-2 rounded-xl border border-slate-100"><div className={`w-2 h-8 rounded-full ${['bg-emerald-500', 'bg-orange-500', 'bg-blue-500'][idx % 3]}`}></div><div className="flex-1"><input value={p.name} onChange={e => updatePartner(p.id, 'name', e.target.value)} className="w-full bg-transparent text-sm font-bold text-slate-700 outline-none placeholder:text-slate-400" placeholder="Nome do Parceiro" /></div><div className="flex items-center gap-4"><div><label className="text-[9px] font-bold text-slate-400 uppercase block">Ticket %</label>
                        <input type="number" min="0" max="100" value={p.splitTicket} onChange={e => updatePartner(p.id, 'splitTicket', Number(e.target.value))} className="w-16 bg-white border border-slate-200 rounded p-1 text-center text-xs font-bold" /></div><div><label className="text-[9px] font-bold text-slate-400 uppercase block">Bar %</label>
                            <input type="number" min="0" max="100" value={p.splitBar} onChange={e => updatePartner(p.id, 'splitBar', Number(e.target.value))} className="w-16 bg-white border border-slate-200 rounded p-1 text-center text-xs font-bold" /></div><button onClick={() => removePartner(p.id)} className="p-2 text-slate-300 hover:text-rose-500 transition-colors"><Trash2 size={16} /></button></div></div>))}</div>
                </div>

                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                    <div className="flex items-center gap-2 mb-2"><FileMinus size={20} className="text-orange-500" /><h3 className="font-bold text-slate-700">Deduções de Receita (Impostos)</h3></div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-orange-50/50 p-4 rounded-xl border border-orange-100"><div className="flex flex-col gap-2"><label className="text-xs font-bold text-orange-800 uppercase flex items-center gap-2"><Ticket size={14} /> Taxa Bilheteria (%)</label><div className="relative"><input type="number" min="0" max="100" step="0.1" value={data.impostosTicket} onChange={e => setData({ ...data, impostosTicket: Number(e.target.value) })} className="w-full border border-orange-200 rounded-lg p-3 font-bold text-orange-900 outline-none focus:ring-2 focus:ring-orange-500 bg-white" /><span className="absolute right-3 top-3 text-orange-300 font-bold">%</span></div><p className="text-[10px] text-orange-600/80">Taxa da plataforma + ISS ingressos.</p></div><div className="flex flex-col gap-2"><label className="text-xs font-bold text-orange-800 uppercase flex items-center gap-2"><Beer size={14} /> Impostos Bar (%)</label><div className="relative"><input type="number" min="0" max="100" step="0.1" value={data.impostosBar} onChange={e => setData({ ...data, impostosBar: Number(e.target.value) })} className="w-full border border-orange-200 rounded-lg p-3 font-bold text-orange-900 outline-none focus:ring-2 focus:ring-orange-500 bg-white" /><span className="absolute right-3 top-3 text-orange-300 font-bold">%</span></div><p className="text-[10px] text-orange-600/80">Simples/ICMS F&B.</p></div><div className="flex flex-col gap-2"><label className="text-xs font-bold text-orange-800 uppercase flex items-center gap-2"><Building2 size={14} /> Impostos Aluguel (%)</label><div className="relative"><input type="number" min="0" max="100" step="0.1" value={data.impostosAluguel} onChange={e => setData({ ...data, impostosAluguel: Number(e.target.value) })} className="w-full border border-orange-200 rounded-lg p-3 font-bold text-orange-900 outline-none focus:ring-2 focus:ring-orange-500 bg-white" /><span className="absolute right-3 top-3 text-orange-300 font-bold">%</span></div><p className="text-[10px] text-orange-600/80">ISS/IR sobre locação.</p></div></div>
                </div>

                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                    <div className="flex justify-between items-center mb-2"><div><h3 className="font-bold text-slate-700 flex items-center gap-2"><DollarSign size={20} className="text-rose-500" /> Custos Extras</h3><p className="text-xs text-slate-500 mt-1">Gerencie custos fixos ou compartilhados.</p></div><div className="bg-slate-100 text-slate-600 px-3 py-1 rounded-lg text-xs font-bold">{data.extraCosts.length} itens</div></div>
                    <div className={`bg-slate-50 p-3 rounded-xl border ${editingId ? 'border-indigo-300 bg-indigo-50/30' : 'border-slate-200'} flex flex-col gap-2 transition-colors`}>
                        <div className="flex flex-wrap gap-2 items-center">
                            <input placeholder="Nome" value={costForm.item} onChange={e => setCostForm({ ...costForm, item: e.target.value })} className="flex-1 min-w-[150px] border border-slate-300 rounded-lg p-2 text-sm outline-none" />
                            <input type="number" placeholder="R$" value={costForm.valor} onChange={e => setCostForm({ ...costForm, valor: e.target.value })} className="w-24 border border-slate-300 rounded-lg p-2 text-sm outline-none" />
                            <select value={costForm.mode} onChange={e => setCostForm({ ...costForm, mode: e.target.value as any })} className="border border-slate-300 rounded-lg p-2 text-sm bg-white outline-none">
                                <option value="fixed">Fixo</option>
                                <option value="per_pax">/ Pax</option>
                                <option value="min_pax">Mínimo / Pax</option>
                            </select>
                            {costForm.mode === 'min_pax' && (
                                <input
                                    type="number"
                                    placeholder="Mín. R$"
                                    value={costForm.minTotalValue}
                                    onChange={e => setCostForm({ ...costForm, minTotalValue: e.target.value })}
                                    className="w-24 border border-yellow-300 bg-yellow-50 rounded-lg p-2 text-sm outline-none text-yellow-800 font-bold animate-in fade-in"
                                />
                            )}
                            <select value={costForm.owner} onChange={e => setCostForm({ ...costForm, owner: e.target.value })} className="border border-slate-300 rounded-lg p-2 text-sm bg-white outline-none max-w-[150px]"><option value="venue">Casa Paga</option><option value="shared">Compartilhado</option><option value="custom">Personalizado (%)</option>{data.partners.map((p: Partner) => (<option key={p.id} value={p.id}>{p.name.split(' ')[0]} Paga</option>))}</select>
                            <div className="flex gap-1 ml-auto md:ml-0">{editingId && <button onClick={resetCostForm} className="bg-gray-200 hover:bg-gray-300 text-gray-600 p-2 rounded-lg transition-colors"><X size={20} /></button>}<button onClick={saveCostItem} className={`${editingId ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-indigo-600 hover:bg-indigo-700'} text-white p-2 rounded-lg transition-colors`}>{editingId ? <Save size={20} /> : <Plus size={20} />}</button></div>
                        </div>
                        {costForm.owner === 'shared' && <div className="flex items-center gap-2 bg-purple-50 p-2 rounded-lg border border-purple-100 animate-in fade-in slide-in-from-top-1 text-xs"><div className="flex items-center gap-2"><span className="font-bold text-purple-700">Split:</span><div className="flex items-center bg-white border border-purple-200 rounded px-2 py-1"><span className="text-gray-500 mr-1">Casa</span><input type="number" min="0" max="100" value={costForm.shareVenue} onChange={e => setCostForm({ ...costForm, shareVenue: Number(e.target.value) })} className="w-8 font-bold text-purple-700 outline-none text-center" /><span className="text-purple-400">%</span></div></div><div className="flex-1 h-px bg-purple-200 mx-2"></div><div className="flex items-center gap-2"><span className="text-purple-600">Restante with:</span><select value={costForm.sharedWith} onChange={e => setCostForm({ ...costForm, sharedWith: e.target.value })} className="bg-white border border-purple-200 rounded px-2 py-1 font-bold text-purple-700 outline-none"><option value="">Todos (Rateio)</option>{data.partners.map((p: Partner) => (<option key={p.id} value={p.id}>{p.name}</option>))}</select></div></div>}
                        {costForm.owner === 'custom' && <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-100 animate-in fade-in slide-in-from-top-1"><div className="flex justify-between items-center mb-2"><span className="text-xs font-bold text-yellow-700 uppercase">Porcentagem de Cada Um</span><span className={`text-xs font-bold px-2 py-0.5 rounded ${customSplitTotal === 100 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>Total: {customSplitTotal.toFixed(0)}%</span></div><div className="grid grid-cols-2 sm:grid-cols-3 gap-2"><div className="flex items-center bg-white border border-yellow-200 rounded px-2 py-1"><span className="text-[10px] font-bold text-gray-500 mr-1 truncate flex-1">Casa</span><input type="number" min="0" max="100" value={costForm.customSplits['venue'] || 0} onChange={e => updateCustomSplit('venue', Number(e.target.value))} className="w-10 font-bold text-yellow-700 outline-none text-right text-xs" /><span className="text-[10px] text-gray-400 ml-0.5">%</span></div>{data.partners.map((p: Partner) => (<div key={p.id} className="flex items-center bg-white border border-yellow-200 rounded px-2 py-1"><span className="text-[10px] font-bold text-gray-500 mr-1 truncate flex-1">{p.name.split(' ')[0]}</span><input type="number" min="0" max="100" value={costForm.customSplits[p.id] || 0} onChange={e => updateCustomSplit(p.id, Number(e.target.value))} className="w-10 font-bold text-yellow-700 outline-none text-right text-xs" /><span className="text-[10px] text-gray-400 ml-0.5">%</span></div>))}</div></div>}
                    </div>
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">{data.extraCosts.length === 0 ? <div className="text-center py-4 text-xs text-slate-400 border-2 border-dashed border-slate-100 rounded-xl">Nenhum custo extra.</div> : data.extraCosts.map((c: CostItem) => (<div key={c.id} className={`flex items-center justify-between bg-white border p-2.5 rounded-lg group transition-colors ${editingId === c.id ? 'border-indigo-400 ring-1 ring-indigo-100 bg-indigo-50/20' : 'border-slate-100 hover:border-indigo-100'}`}><div className="flex flex-col"><span className="font-bold text-sm text-slate-700">{c.item}</span><div className="flex gap-2 text-[10px] text-slate-400 uppercase font-bold mt-0.5"><span className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">{c.mode === 'fixed' ? 'Fixo' : c.mode === 'min_pax' ? `Min. ${money(c.minTotalValue || 0)}` : c.mode === 'step' ? 'Escalonado' : 'Por Pessoa'}</span>{c.owner === 'custom' ? <span className="px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 border border-yellow-200">Personalizado</span> : c.owner === 'shared' ? <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-600 border border-purple-200">Split: Casa {c.shareVenue}%</span> : <span className={`px-1.5 py-0.5 rounded ${c.owner === 'venue' ? 'bg-indigo-50 text-indigo-500' : 'bg-orange-50 text-orange-500'}`}>{c.owner === 'venue' ? 'Casa' : (data.partners.find((p: Partner) => p.id === c.owner)?.name || 'Parceiro')}</span>}</div></div><div className="flex items-center gap-2"><span className="font-mono font-bold text-slate-700 text-sm mr-2">{money(c.valor || 0)}</span><button onClick={() => editCostItem(c)} className="text-slate-300 hover:text-indigo-500 transition-colors"><Pencil size={16} /></button><button onClick={() => removeCostItem(c.id)} className="text-slate-300 hover:text-rose-500 transition-colors"><Trash2 size={16} /></button></div></div>))}</div>
                </div>
            </div>
        </div>
    );
};

export default Step2Negotiation;
