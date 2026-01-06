import React, { useState, useMemo } from 'react';
import { Intervention, ThirdParty, DolibarrConfig, AppView, Project } from '../types';
import { ClipboardList, Search, Plus, X, Loader2, CheckCircle2, Clock, Calendar, CheckSquare, Wrench, FolderKanban, User, Timer } from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { useDolibarr } from '../context/DolibarrContext';
import { useInterventions, useCustomers, useProjects, useInterventionLines } from '../hooks/dolibarr';
import { LinkedObjects } from './common/LinkedObjects';
import { formatDateOnly } from '../utils/dateUtils';

interface InterventionListProps {
    onNavigate?: (view: AppView, id: string) => void;
    onRefresh?: () => void;
}

const InterventionList: React.FC<InterventionListProps> = ({ onNavigate, onRefresh }) => {
    const { config } = useDolibarr();
    const { data: interventionsData } = useInterventions(config);
    const interventions = interventionsData || [];
    const { data: customersData } = useCustomers(config);
    const customers = customersData || [];
    const { data: projectsData } = useProjects(config);
    const projects = projectsData || [];

    // FETCH LINES
    const { data: linesData } = useInterventionLines(config);
    const lines = linesData || [];

    const handleSelectIntervention = (intervention: Intervention) => {
        // Link lines
        const linkedLines = lines.filter(l => String(l.parent_id) === String(intervention.id));
        setSelectedIntervention({ ...intervention, lines: linkedLines });
    };

    if (!config) return <div className="p-8 text-center">Carregando configuração...</div>;

    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'me' | 'draft' | 'validated' | 'done'>('all');
    const [selectedIntervention, setSelectedIntervention] = useState<Intervention | null>(null);
    const [processingId, setProcessingId] = useState<string | null>(null);

    // Creation State
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [newIntervention, setNewIntervention] = useState({
        socid: '',
        project_id: '',
        date: new Date().toISOString().split('T')[0],
        description: ''
    });
    const [isSubmitting, setIsSubmitting] = useState(false);

    const getCustomerName = (socid: string) => {
        const customer = customers.find(c => String(c.id) === String(socid));
        return customer ? customer.name : (socid ? `Desconhecido (${socid})` : 'Desconhecido');
    };

    const getProjectName = (projId?: string) => {
        if (!projId) return null;
        const p = projects.find(prj => String(prj.id) === String(projId));
        return p ? p.title : null;
    };

    const filteredInterventions = useMemo(() => {
        return interventions.filter(i => {
            const customerName = getCustomerName(i.socid).toLowerCase();
            const matchesSearch =
                i.ref.toLowerCase().includes(searchTerm.toLowerCase()) ||
                customerName.includes(searchTerm.toLowerCase());

            if (filterStatus === 'draft') return matchesSearch && i.statut === '0';
            if (filterStatus === 'validated') return matchesSearch && i.statut === '1';
            if (filterStatus === 'done') return matchesSearch && i.statut === '2';
            // Note: Interventions in Dolibarr don't have a direct single assignee field simpler than getting linked users. 
            // However, we often use 'fk_user_author' or specific linked tables. 
            // As a simplified UX improvement, we filter by who created it OR if we had an assignee field.
            // For now, let's assume if I created it, it's "Mine" or if it's assigned (future proof).
            if (filterStatus === 'me') {
                return matchesSearch && (String(i.fk_user_author) === String(config?.currentUser?.id));
            }

            return matchesSearch;
        });
    }, [interventions, customers, searchTerm, filterStatus, config]);

    const getStatusBadge = (status: string) => {
        switch (status) {
            case '0': return <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">Rascunho</span>;
            case '1': return <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">Validado</span>;
            case '2': return <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">Concluído</span>;
            default: return <span className="text-xs bg-slate-100">Desconhecido</span>;
        }
    };

    const handleCreateIntervention = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newIntervention.socid) return;
        setIsSubmitting(true);
        try {
            const payload = {
                socid: newIntervention.socid,
                fk_project: newIntervention.project_id || undefined,
                date: new Date(newIntervention.date).getTime() / 1000,
                description: newIntervention.description
            };
            await DolibarrService.createIntervention(config, payload);
            alert("Intervenção Criada com Sucesso");
            setIsCreateModalOpen(false);
            setNewIntervention({ socid: '', project_id: '', date: new Date().toISOString().split('T')[0], description: '' });
            if (onRefresh) onRefresh();
        } catch (e: any) {
            console.error(e);
            alert(`Falha: ${e.message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleValidate = async () => {
        if (!selectedIntervention) return;
        if (!confirm("Validar esta intervenção?")) return;
        setProcessingId(selectedIntervention.id);
        try {
            await DolibarrService.validateIntervention(config, selectedIntervention.id);
            alert("Intervenção Validada");
            if (onRefresh) onRefresh();
            setSelectedIntervention(null);
        } catch (e: any) {
            alert(`Erro: ${e.message}`);
        } finally {
            setProcessingId(null);
        }
    };

    const formatDuration = (seconds: number) => {
        if (!seconds) return '0h';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return m > 0 ? `${h}h ${m}m` : `${h}h`;
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 transition-colors relative">

            {/* Create Modal */}
            {isCreateModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg border border-slate-200 dark:border-slate-800 animate-in zoom-in-95">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 rounded-t-xl">
                            <h3 className="font-bold text-lg dark:text-white flex items-center gap-2">
                                <ClipboardList size={18} className="text-indigo-600" /> Nova Intervenção
                            </h3>
                            <button onClick={() => setIsCreateModalOpen(false)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleCreateIntervention} className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Cliente</label>
                                <select
                                    className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                    value={newIntervention.socid}
                                    onChange={e => setNewIntervention({ ...newIntervention, socid: e.target.value })}
                                    required
                                >
                                    <option value="">Selecione o Cliente...</option>
                                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Data</label>
                                    <input type="date" className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" value={newIntervention.date} onChange={e => setNewIntervention({ ...newIntervention, date: e.target.value })} required />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Projeto (Opcional)</label>
                                    <select
                                        className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                        value={newIntervention.project_id}
                                        onChange={e => setNewIntervention({ ...newIntervention, project_id: e.target.value })}
                                    >
                                        <option value="">Nenhum</option>
                                        {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Descrição</label>
                                <textarea className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white resize-none h-20" value={newIntervention.description} onChange={e => setNewIntervention({ ...newIntervention, description: e.target.value })} placeholder="Trabalho a ser feito..." />
                            </div>
                            <div className="flex justify-end gap-3 pt-2">
                                <button type="button" onClick={() => setIsCreateModalOpen(false)} className="px-4 py-2 text-slate-500 hover:text-slate-700 font-medium">Cancelar</button>
                                <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium shadow-sm flex items-center gap-2">
                                    {isSubmitting ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />} Criar
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Header */}
            <div className={`p-4 md:p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex-none ${selectedIntervention ? 'hidden lg:block' : 'block'}`}>
                <div className="flex justify-between items-center mb-4">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Intervenções</h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400">Serviço de campo e ordens de trabalho</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input
                                type="text"
                                placeholder="Buscar..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-10 pr-4 py-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white w-64"
                            />
                        </div>
                        <button
                            onClick={() => onRefresh && onRefresh()}
                            className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                            title="Atualizar Lista"
                        >
                            <Loader2 size={20} className={!interventions ? "animate-spin" : ""} />
                        </button>
                        <button onClick={() => setIsCreateModalOpen(true)} className={`p-2 bg-${config.themeColor}-600 hover:bg-${config.themeColor}-700 text-white rounded-lg transition-colors`}><Plus size={20} /></button>
                    </div>
                </div>
                <div className="flex gap-2 border-b border-slate-100 dark:border-slate-800 overflow-x-auto">
                    {['all', 'me', 'draft', 'validated', 'done'].map(status => (
                        <button
                            key={status}
                            onClick={() => setFilterStatus(status as any)}
                            className={`pb-2 px-3 text-sm font-medium transition-colors border-b-2 capitalize whitespace-nowrap ${filterStatus === status ? `border-${config.themeColor}-600 text-${config.themeColor}-600 dark:text-${config.themeColor}-400 dark:border-${config.themeColor}-400` : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                        >
                            {status === 'all' ? 'Todas' : status === 'me' ? 'Minhas' : status === 'draft' ? 'Rascunhos' : status === 'validated' ? 'Validadas' : 'Concluídas'}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 min-h-0 flex overflow-hidden">
                {/* List */}
                <div className={`flex-1 overflow-y-auto p-4 md:p-6 ${selectedIntervention ? 'hidden lg:block lg:w-1/3 xl:w-1/4 border-r border-slate-200 dark:border-slate-800' : 'w-full'}`}>
                    {filteredInterventions.length === 0 ? (
                        <div className="text-center py-20 text-slate-400">
                            <Wrench size={48} className="mx-auto mb-4 opacity-50" />
                            <p>Nenhuma intervenção encontrada.</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {filteredInterventions.map(int => (
                                <div key={int.id} onClick={() => handleSelectIntervention(int)} className={`p-4 border rounded-xl cursor-pointer transition-all ${selectedIntervention?.id === int.id ? `border-${config.themeColor}-500 bg-${config.themeColor}-50 dark:bg-${config.themeColor}-900/20` : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:shadow-md'}`}>
                                    <div className="flex justify-between items-start mb-2">
                                        <h4 className="font-bold text-slate-800 dark:text-white text-sm">{int.ref}</h4>
                                        {getStatusBadge(int.statut)}
                                    </div>
                                    <div className="text-sm text-slate-600 dark:text-slate-300 font-medium mb-1 truncate">{int.description || 'Sem descrição'}</div>
                                    <div className="text-xs text-slate-500 flex items-center justify-between mt-2">
                                        <span
                                            className="flex items-center gap-1 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (onNavigate) onNavigate('customers', int.socid);
                                            }}
                                        >
                                            <User size={10} /> {getCustomerName(int.socid)}
                                        </span>
                                        <span className="flex items-center gap-1"><Calendar size={10} /> {formatDateOnly(int.date)}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Detail */}
                <div className={`flex-1 bg-white dark:bg-slate-900 flex flex-col ${selectedIntervention ? 'block absolute inset-0 z-20 lg:static lg:inset-auto' : 'hidden lg:flex lg:items-center lg:justify-center'}`}>
                    {selectedIntervention ? (
                        <>
                            <div className="flex-none bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-100 dark:border-slate-800 p-4 flex items-center justify-between z-10">
                                <div>
                                    <h2 className="text-lg font-bold dark:text-white flex items-center gap-2">{selectedIntervention.ref} {getStatusBadge(selectedIntervention.statut)}</h2>
                                    <span className="text-xs text-slate-500">Relatório de Serviço de Campo</span>
                                </div>
                                <button onClick={() => setSelectedIntervention(null)} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950/50">
                                <div className="max-w-3xl mx-auto space-y-6">
                                    {/* Actions */}
                                    <div className="flex justify-end gap-2">
                                        {selectedIntervention.statut === '0' && (
                                            <button onClick={handleValidate} disabled={!!processingId} className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium shadow-sm transition-colors disabled:opacity-50">
                                                {processingId ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />} Validar
                                            </button>
                                        )}
                                    </div>

                                    <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                                        <h3 className="font-bold text-slate-800 dark:text-white mb-4 border-b border-slate-100 dark:border-slate-800 pb-2">Informações</h3>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <div>
                                                <label className="text-xs text-slate-500 uppercase font-bold">Cliente</label>
                                                <div
                                                    className="flex items-center gap-2 mt-1 text-slate-800 dark:text-white font-medium cursor-pointer hover:underline hover:text-indigo-600 dark:hover:text-indigo-400"
                                                    onClick={() => onNavigate && onNavigate('customers', selectedIntervention.socid)}
                                                >
                                                    {getCustomerName(selectedIntervention.socid)}
                                                </div>
                                            </div>
                                            <div>
                                                <label className="text-xs text-slate-500 uppercase font-bold">Data</label>
                                                <div className="flex items-center gap-2 mt-1 text-slate-800 dark:text-white font-medium">
                                                    <Calendar size={16} className="text-indigo-500" />
                                                    {formatDateOnly(selectedIntervention.date)}
                                                </div>
                                            </div>
                                            {selectedIntervention.project_id && (
                                                <div className="col-span-2">
                                                    <label className="text-xs text-slate-500 uppercase font-bold">Projeto Vinculado</label>
                                                    <div
                                                        className="flex items-center gap-2 mt-1 text-indigo-600 dark:text-indigo-400 font-medium cursor-pointer hover:underline"
                                                        onClick={() => onNavigate && onNavigate('projects', selectedIntervention.project_id!)}
                                                    >
                                                        <FolderKanban size={16} /> {getProjectName(selectedIntervention.project_id)}
                                                    </div>
                                                </div>
                                            )}
                                            <div className="col-span-2">
                                                <label className="text-xs text-slate-500 uppercase font-bold">Descrição</label>
                                                <div
                                                    className="mt-1 text-sm text-slate-600 dark:text-slate-300 prose prose-slate prose-sm max-w-none dark:prose-invert"
                                                    dangerouslySetInnerHTML={{ __html: selectedIntervention.description || 'Sem descrição.' }}
                                                />
                                                {/* DEBUG: Remove later */}
                                                <details className="mt-4">
                                                    <summary className="text-xs text-red-500 cursor-pointer">Debug Data</summary>
                                                    <pre className="text-xs text-slate-500 overflow-auto">
                                                        {JSON.stringify({
                                                            ...selectedIntervention,
                                                            linesCount: selectedIntervention.lines?.length || 0,
                                                            firstLine: selectedIntervention.lines?.[0] || 'No lines'
                                                        }, null, 2)}
                                                    </pre>
                                                </details>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Linked Objects */}
                                    <LinkedObjects
                                        id={selectedIntervention.id}
                                        type="fichinter"
                                        onNavigate={onNavigate}
                                    />

                                    {/* Lines */}
                                    <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                                        <h3 className="font-bold text-slate-800 dark:text-white mb-4">Itens / Serviços Realizados</h3>
                                        <div className="space-y-2">
                                            {selectedIntervention.lines && selectedIntervention.lines.length > 0 ? (
                                                selectedIntervention.lines.map((line, idx) => (
                                                    <div key={idx} className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700">
                                                        <div>
                                                            <div
                                                                className="font-medium text-slate-800 dark:text-white text-sm prose prose-slate prose-sm max-w-none dark:prose-invert [&>p]:m-0"
                                                                dangerouslySetInnerHTML={{ __html: line.desc }}
                                                            />
                                                            <div className="text-xs text-slate-500">{formatDateOnly(line.date)}</div>
                                                        </div>
                                                        <div className="text-right">
                                                            <div className="font-bold text-slate-800 dark:text-white">{formatDuration(line.duration)}</div>
                                                        </div>
                                                    </div>
                                                ))
                                            ) : (
                                                <p className="text-slate-400 italic text-sm text-center py-4">Nenhum item registrado.</p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-slate-400">
                            <ClipboardList size={48} className="mb-4 opacity-50" />
                            <p>Selecione uma intervenção para ver detalhes.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default InterventionList;
