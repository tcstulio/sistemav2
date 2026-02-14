
import React, { useState, useEffect } from 'react';
import { X, Save, FolderOpen, Trash2, Clock, ArrowRight, Check, AlertCircle, Play, RefreshCcw, Lock } from 'lucide-react';
import { money } from '../../utils';
import { logger } from '../../../../utils/logger';

const log = logger.child('SavedSimulations');

export interface SimulationSnapshot {
    id: string;
    name: string;
    date: number;
    data: any; // Full state blob
    summary: {
        revenue: number;
        profit: number;
        modelLabel: string;
    };
}

const STORAGE_KEY_SNAPSHOTS = 'eventscale_snapshots_v1';

interface Props {
    currentData: any;
    currentSummary: { revenue: number; profit: number; modelLabel: string };
    activeSnapshotId: string | null;
    isAdmin?: boolean;
    userName?: string;
    onClose: () => void;
    onLoad: (data: any, id: string) => void;
    initialView?: 'list' | 'save';
}

const SavedSimulationsModal: React.FC<Props> = ({ currentData, currentSummary, activeSnapshotId, isAdmin = true, userName = 'usuario', onClose, onLoad, initialView = 'list' }) => {
    const [snapshots, setSnapshots] = useState<SimulationSnapshot[]>([]);
    const [newName, setNewName] = useState('');
    const [view, setView] = useState<'list' | 'save'>(initialView);
    const [status, setStatus] = useState<'idle' | 'success'>('idle');

    useEffect(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY_SNAPSHOTS);
            if (saved) {
                const allSnaps: SimulationSnapshot[] = JSON.parse(saved);
                // All users see all saved snapshots (permission is managed via Dolibarr login)
                setSnapshots(allSnaps);
            }
        } catch (e) {
            log.error("Failed to load snapshots", e);
        }
    }, []);

    const saveSnapshot = (isUpdate = false) => {
        let updatedSnapshots: SimulationSnapshot[] = [];
        const savedRaw = localStorage.getItem(STORAGE_KEY_SNAPSHOTS);
        const fullList: SimulationSnapshot[] = savedRaw ? JSON.parse(savedRaw) : [];

        if (isUpdate && activeSnapshotId) {
            updatedSnapshots = fullList.map(s => {
                if (s.id === activeSnapshotId) {
                    return {
                        ...s,
                        date: Date.now(),
                        data: { ...currentData },
                        summary: { ...currentSummary }
                    };
                }
                return s;
            });
        } else {
            const nameToUse = newName.trim() || `${currentSummary.modelLabel} ${new Date().toLocaleDateString()}`;
            const newSnapshot: SimulationSnapshot = {
                id: Date.now().toString(),
                name: nameToUse,
                date: Date.now(),
                data: { ...currentData },
                summary: { ...currentSummary }
            };
            updatedSnapshots = [newSnapshot, ...fullList];
        }

        try {
            localStorage.setItem(STORAGE_KEY_SNAPSHOTS, JSON.stringify(updatedSnapshots));

            // Re-filter for local state
            setSnapshots([...updatedSnapshots]);

            setStatus('success');
            setTimeout(() => {
                setStatus('idle');
                setView('list');
                setNewName('');
            }, 1200);
        } catch (e) {
            alert("Erro ao salvar no armazenamento local. Limite de espaço atingido?");
        }
    };

    const deleteSnapshot = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (confirm('Tem certeza que deseja excluir este cenário permanentemente?')) {
            const savedRaw = localStorage.getItem(STORAGE_KEY_SNAPSHOTS);
            const fullList: SimulationSnapshot[] = savedRaw ? JSON.parse(savedRaw) : [];
            const updated = fullList.filter(s => s.id !== id);
            localStorage.setItem(STORAGE_KEY_SNAPSHOTS, JSON.stringify(updated));

            // Update local filtered state
            setSnapshots(snapshots.filter(s => s.id !== id));
        }
    };

    const loadSnapshot = (snapshot: SimulationSnapshot) => {
        onLoad(snapshot.data, snapshot.id);
        onClose();
    };

    const activeSnap = snapshots.find(s => s.id === activeSnapshotId);

    return (
        <div className="fixed inset-0 bg-black/60 z-[90] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh] overflow-hidden border border-slate-200">

                <div className="flex justify-between items-center p-6 border-b bg-slate-50">
                    <div>
                        <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                            <FolderOpen size={24} className="text-indigo-600" /> Biblioteca de Cenários
                        </h3>
                        <p className="text-sm text-slate-500">
                            {isAdmin ? 'Gerencie todos os cenários do sistema.' : 'Simulações salvas no navegador.'}
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-400 hover:text-slate-600"><X size={24} /></button>
                </div>

                <div className="p-2 bg-white border-b border-slate-100 flex gap-2">
                    <button
                        onClick={() => setView('list')}
                        className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all ${view === 'list' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                        Meus Cenários ({snapshots.length})
                    </button>
                    <button
                        onClick={() => setView('save')}
                        className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all ${view === 'save' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-200' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                        {activeSnapshotId ? 'Atualizar / Salvar Novo' : 'Salvar Simulação'}
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 bg-slate-50 custom-scrollbar">
                    {view === 'save' && (
                        <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm text-center">
                                <div className="text-xs font-bold text-slate-400 uppercase mb-2">Resumo para Salvar</div>
                                <h4 className="text-xl font-bold text-slate-800 mb-1">{currentSummary.modelLabel}</h4>
                                <div className={`text-3xl font-black mb-6 ${currentSummary.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                    {money(currentSummary.profit)}
                                </div>

                                <div className="space-y-4">
                                    {activeSnapshotId && activeSnap && (
                                        <button
                                            onClick={() => saveSnapshot(true)}
                                            disabled={status === 'success'}
                                            className={`w-full py-4 rounded-2xl font-bold text-lg shadow-lg transition-all active:scale-95 flex items-center justify-center gap-3 border-2 ${status === 'success' ? 'bg-emerald-500 text-white border-emerald-600' : 'bg-white text-indigo-600 border-indigo-100 hover:bg-indigo-50 shadow-indigo-50'}`}
                                        >
                                            {status === 'success' ? (
                                                <> <Check size={24} /> Atualizado! </>
                                            ) : (
                                                <> <RefreshCcw size={20} /> Atualizar "{activeSnap.name}" </>
                                            )}
                                        </button>
                                    )}

                                    <div className="relative py-4 flex items-center">
                                        <div className="flex-grow border-t border-slate-200"></div>
                                        <span className="flex-shrink mx-4 text-xs font-bold text-slate-400 uppercase">{activeSnapshotId ? 'Ou salvar como novo' : 'Identificação'}</span>
                                        <div className="flex-grow border-t border-slate-200"></div>
                                    </div>

                                    <div className="text-left space-y-2">
                                        <label className="text-xs font-bold text-slate-500 uppercase ml-1">Nome da Simulação</label>
                                        <input
                                            value={newName}
                                            onChange={e => setNewName(e.target.value)}
                                            placeholder={activeSnap ? "Ex: Nova variação de custos" : "Ex: Cenário Otimista +30% público"}
                                            className="w-full border-2 border-slate-100 rounded-xl p-4 text-sm font-bold focus:border-emerald-500 focus:ring-4 focus:ring-emerald-50 outline-none transition-all"
                                            autoFocus={!activeSnapshotId}
                                            onKeyDown={(e) => e.key === 'Enter' && saveSnapshot(false)}
                                        />
                                    </div>

                                    <button
                                        onClick={() => saveSnapshot(false)}
                                        disabled={status === 'success'}
                                        className={`w-full py-4 rounded-2xl font-bold text-lg shadow-xl transition-all active:scale-95 flex items-center justify-center gap-3 ${status === 'success' ? 'bg-emerald-500 text-white' : 'bg-slate-900 text-white hover:bg-slate-800 shadow-slate-200'}`}
                                    >
                                        {status === 'success' ? (
                                            <> <Check size={24} /> Salvo com Sucesso! </>
                                        ) : (
                                            <> <Save size={20} /> Salvar na Biblioteca </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {view === 'list' && (
                        <div className="space-y-4 animate-in slide-in-from-left-4 duration-300">
                            {snapshots.length === 0 ? (
                                <div className="text-center py-16 text-slate-400">
                                    <div className="bg-slate-100 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
                                        <FolderOpen size={40} className="opacity-20" />
                                    </div>
                                    <p className="font-medium">Sua biblioteca está vazia.</p>
                                    <div className="text-xs mt-2 px-6">
                                        Comece salvando uma simulação na aba ao lado.
                                    </div>
                                </div>
                            ) : (
                                snapshots.map(snap => (
                                    <div
                                        key={snap.id}
                                        onClick={() => loadSnapshot(snap)}
                                        className={`bg-white p-5 rounded-2xl border shadow-sm hover:shadow-md transition-all cursor-pointer group relative overflow-hidden flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${snap.id === activeSnapshotId ? 'border-indigo-500 ring-1 ring-indigo-100' : 'border-slate-200 hover:border-indigo-400'}`}
                                    >
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <h4 className="font-bold text-slate-800 group-hover:text-indigo-700 transition-colors text-lg leading-tight">{snap.name}</h4>
                                                {snap.id === activeSnapshotId && <span className="bg-indigo-600 text-white text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-tighter">ABERTO</span>}
                                                <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded uppercase">{snap.summary.modelLabel}</span>
                                            </div>
                                            <div className="text-[10px] text-slate-400 flex items-center gap-1">
                                                <Clock size={12} /> {new Date(snap.date).toLocaleDateString()}
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between sm:justify-end gap-6 sm:gap-8">
                                            <div className="text-right">
                                                <div className={`text-lg font-black ${snap.summary.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                    {money(snap.summary.profit)}
                                                </div>
                                                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">LUCRO</div>
                                            </div>

                                            <div className="flex items-center gap-2">
                                                {isAdmin && (
                                                    <button
                                                        onClick={(e) => deleteSnapshot(snap.id, e)}
                                                        className="p-3 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
                                                        title="Excluir Permanentemente"
                                                    >
                                                        <Trash2 size={18} />
                                                    </button>
                                                )}
                                                <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <Play size={20} fill="currentColor" />
                                                </div>
                                            </div>
                                        </div>

                                        <div className={`absolute left-0 top-0 bottom-0 w-1 bg-indigo-500 transition-opacity ${snap.id === activeSnapshotId ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}></div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>

                <div className="p-4 bg-slate-50 border-t border-slate-100 text-center">
                    <p className="text-[10px] text-slate-400 italic">Simulações salvas localmente por @{userName}.</p>
                </div>
            </div>
        </div>
    );
};

export default SavedSimulationsModal;
