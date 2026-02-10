import React, { useState, useMemo } from 'react';
import { Intervention, AppView } from '../types';
import { ClipboardList, Search, Plus, Loader2, CheckCircle2, Calendar, FolderKanban, User } from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { useDolibarr } from '../context/DolibarrContext';
import { useInterventions, useCustomers, useProjects, useInterventionLines } from '../hooks/dolibarr';
import { LinkedObjects } from './common/LinkedObjects';
import { formatDateOnly } from '../utils/dateUtils';

// Design System
import { PageHeader, MasterDetailLayout, Card, Button, Input, Modal, Tabs, Tab, EmptyState, StatusBadge } from './ui';
import type { StatusConfig } from './ui';

const interventionStatuses: Record<string, StatusConfig> = {
    '0': { label: 'Rascunho', variant: 'slate' },
    '1': { label: 'Validado', variant: 'blue', icon: <CheckCircle2 size={12} /> },
    '2': { label: 'Concluído', variant: 'emerald', icon: <CheckCircle2 size={12} /> },
};

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
    const { data: linesData } = useInterventionLines(config);
    const lines = linesData || [];

    const handleSelectIntervention = (intervention: Intervention) => {
        const linkedLines = lines.filter(l => String(l.parent_id) === String(intervention.id));
        setSelectedIntervention({ ...intervention, lines: linkedLines });
    };

    if (!config) return null;

    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'me' | 'draft' | 'validated' | 'done'>('all');
    const [selectedIntervention, setSelectedIntervention] = useState<Intervention | null>(null);
    const [processingId, setProcessingId] = useState<string | null>(null);

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
            if (filterStatus === 'me') {
                return matchesSearch && (String(i.fk_user_author) === String(config?.currentUser?.id));
            }

            return matchesSearch;
        });
    }, [interventions, customers, searchTerm, filterStatus, config]);

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

    const renderHeader = (
        <div className={selectedIntervention ? 'hidden lg:block' : 'block'}>
            <PageHeader
                title="Intervenções"
                subtitle="Serviço de campo e ordens de trabalho"
                actions={
                    <div className="flex items-center gap-2">
                        <Input
                            placeholder="Buscar..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            icon={<Search size={16} />}
                            className="w-48 md:w-64"
                            fullWidth={false}
                        />
                        <Button icon={<Plus size={16} />} onClick={() => setIsCreateModalOpen(true)}>
                            Nova Intervenção
                        </Button>
                    </div>
                }
                tabs={
                    <Tabs value={filterStatus} onChange={(v) => setFilterStatus(v as any)}>
                        <Tab value="all">Todas</Tab>
                        <Tab value="me">Minhas</Tab>
                        <Tab value="draft">Rascunhos</Tab>
                        <Tab value="validated">Validadas</Tab>
                        <Tab value="done">Concluídas</Tab>
                    </Tabs>
                }
            />
        </div>
    );

    const renderList = (
        <div className="p-4 md:p-6">
            {filteredInterventions.length === 0 ? (
                <EmptyState icon={ClipboardList} title="Nenhuma intervenção encontrada" description="Tente ajustar a busca ou crie uma nova." />
            ) : (
                <div className="space-y-3">
                    {filteredInterventions.map(int => (
                        <Card
                            key={int.id}
                            onClick={() => handleSelectIntervention(int)}
                            selected={selectedIntervention?.id === int.id}
                            className="cursor-pointer"
                        >
                            <div className="flex justify-between items-start mb-2">
                                <h4 className="font-bold text-slate-800 dark:text-white text-sm">{int.ref}</h4>
                                <StatusBadge status={int.statut} config={interventionStatuses} size="sm" />
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
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );

    const renderDetail = selectedIntervention ? (
        <>
            <PageHeader
                onBack={() => setSelectedIntervention(null)}
                title={
                    <span className="flex items-center gap-2">
                        {selectedIntervention.ref}
                        <StatusBadge status={selectedIntervention.statut} config={interventionStatuses} />
                    </span>
                }
                subtitle="Relatório de Serviço de Campo"
                actions={
                    selectedIntervention.statut === '0' ? (
                        <Button size="sm" icon={processingId ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} onClick={handleValidate} disabled={!!processingId}>
                            Validar
                        </Button>
                    ) : undefined
                }
            />

            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950/50">
                <div className="max-w-3xl mx-auto space-y-6">
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
                            </div>
                        </div>
                    </div>

                    <LinkedObjects
                        id={selectedIntervention.id}
                        type="fichinter"
                        onNavigate={onNavigate}
                    />

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
    ) : null;

    return (
        <>
            <div className="flex flex-col h-full">
                {renderHeader}
                <MasterDetailLayout
                    list={renderList}
                    detail={renderDetail}
                    showDetail={!!selectedIntervention}
                    onCloseDetail={() => setSelectedIntervention(null)}
                />
            </div>

            <Modal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                title={
                    <span className="flex items-center gap-2">
                        <ClipboardList size={18} className="text-indigo-600" /> Nova Intervenção
                    </span>
                }
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsCreateModalOpen(false)}>Cancelar</Button>
                        <Button onClick={(e: any) => handleCreateIntervention(e)} loading={isSubmitting} icon={<CheckCircle2 size={16} />}>Criar</Button>
                    </>
                }
            >
                <div className="space-y-4">
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
                </div>
            </Modal>
        </>
    );
};

export default InterventionList;
