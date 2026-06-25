import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { sanitizeHtml } from '../utils/sanitizeHtml';
import { Intervention, InterventionLine, AppView } from '../types';
import { ClipboardList, Plus, Loader2, CheckCircle2, Calendar, FolderKanban, User, Pencil, Clock, Trash2 } from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { useDolibarr } from '../context/DolibarrContext';
import { useInterventions, useCustomers, useProjects, useInterventionLines } from '../hooks/dolibarr';
import { useListControls } from '../hooks/useListControls';
import { usePrefill, PrefillResult } from '../hooks/usePrefill';
import { LinkedObjects } from './common/LinkedObjects';
import { formatDateOnly } from '../utils/dateUtils';
import { notifyError } from '../utils/notifyError';
import { useConfirm } from '../hooks/useConfirm';

// Design System
import { PageHeader, MasterDetailLayout, Card, Button, Modal, Tabs, Tab, EmptyState, StatusBadge, ListToolbar, ConfirmDeleteButton } from './ui';
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
    const { config, canDo } = useDolibarr();
    const { id: urlId } = useParams<{ id: string }>();
    const { data: interventionsData, refetch: refetchInterventions } = useInterventions(config);
    const interventions = interventionsData || [];
    const { data: customersData } = useCustomers(config);
    const customers = customersData || [];
    const { data: projectsData } = useProjects(config);
    const projects = projectsData || [];
    const { data: linesData, refetch: refetchLines } = useInterventionLines(config);
    const lines = linesData || [];
    const confirm = useConfirm();

    // #658: fallback when backend does not support editing (501)
    const [editSupported, setEditSupported] = useState(true);

    const handleSelectIntervention = (intervention: Intervention) => {
        const linkedLines = lines.filter(l => String(l.parent_id) === String(intervention.id));
        setSelectedIntervention({ ...intervention, lines: linkedLines });
    };

    if (!config) return null;

    const [filterStatus, setFilterStatus] = useState<'all' | 'me' | 'draft' | 'validated' | 'done'>('all');
    const [selectedIntervention, setSelectedIntervention] = useState<Intervention | null>(null);
    const [processingId, setProcessingId] = useState<string | null>(null);

    useEffect(() => {
        if (urlId && interventions.length > 0 && !selectedIntervention) {
            const found = interventions.find(i => String(i.id) === urlId);
            if (found) handleSelectIntervention(found);
        }
    }, [urlId, interventions]);

    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [editInterventionId, setEditInterventionId] = useState<string | undefined>(undefined);
    const [newIntervention, setNewIntervention] = useState({
        socid: '',
        project_id: '',
        date: new Date().toISOString().split('T')[0],
        description: ''
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const isEditIntervention = !!editInterventionId;

    // #610: Add line modal state
    const [isAddLineModalOpen, setIsAddLineModalOpen] = useState(false);
    const [newLine, setNewLine] = useState({ desc: '', durationHours: '', durationMinutes: '', date: new Date().toISOString().split('T')[0] });
    const [isSubmittingLine, setIsSubmittingLine] = useState(false);

    const tsToInput = (ts?: number) => (ts ? new Date(ts < 1e11 ? ts * 1000 : ts).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);

    const openEditIntervention = (i: Intervention) => {
        setEditInterventionId(String(i.id));
        setNewIntervention({
            socid: String(i.socid),
            project_id: i.project_id ? String(i.project_id) : '',
            date: tsToInput(i.date),
            description: i.description || '',
        });
        setIsCreateModalOpen(true);
    };

    // Deeplink HITL do agente (#57): create_intervention abre o modal pré-preenchido.
    const prefill = usePrefill();
    const appliedPrefillRef = useRef<PrefillResult | null>(null);
    useEffect(() => {
        if (!prefill || appliedPrefillRef.current === prefill) return;
        if (prefill.kind === 'create_intervention') {
            appliedPrefillRef.current = prefill;
            setNewIntervention({
                socid: prefill.data.socid || '',
                project_id: prefill.data.project_id || '',
                date: prefill.data.date || new Date().toISOString().split('T')[0],
                description: prefill.data.description || '',
            });
            setEditInterventionId(undefined);
            setIsCreateModalOpen(true);
            toast.info('Revise os dados e confirme a criação da intervenção.');
        } else if (prefill.kind === 'edit_intervention') {
            const i = interventions.find(it => String(it.id) === String(prefill.data.id));
            if (!i) return; // aguarda os dados
            appliedPrefillRef.current = prefill;
            setEditInterventionId(String(i.id));
            setNewIntervention({
                socid: String(i.socid),
                project_id: prefill.data.project_id ?? (i.project_id ? String(i.project_id) : ''),
                date: prefill.data.date || tsToInput(i.date),
                description: prefill.data.description ?? i.description ?? '',
            });
            setIsCreateModalOpen(true);
            toast.info('Revise as mudanças e salve a intervenção.');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [prefill, interventions]);

    const getCustomerName = (socid: string) => {
        const customer = customers.find(c => String(c.id) === String(socid));
        return customer ? customer.name : (socid ? `Desconhecido (${socid})` : 'Desconhecido');
    };

    const getProjectName = (projId?: string) => {
        if (!projId) return null;
        const p = projects.find(prj => String(prj.id) === String(projId));
        return p ? p.title : null;
    };

    // Busca + ordenação padronizadas (#121). O filtro por status fica nas Tabs (inclui
    // "Minhas") e é aplicado sobre controls.result.
    const controls = useListControls(interventions, {
        searchText: (i) => `${i.ref} ${getCustomerName(i.socid)} ${i.description || ''}`,
        sorts: [
            { key: 'date', label: 'Data', get: (i) => i.date || 0 },
            { key: 'ref', label: 'Referência', get: (i) => i.ref },
            { key: 'customer', label: 'Cliente', get: (i) => getCustomerName(i.socid) },
        ],
        initialSortKey: 'date',
        initialSortDir: 'desc',
    });

    const filteredInterventions = useMemo(() => {
        return controls.result.filter(i => {
            if (filterStatus === 'draft') return i.statut === '0';
            if (filterStatus === 'validated') return i.statut === '1';
            if (filterStatus === 'done') return i.statut === '2';
            if (filterStatus === 'me') {
                return String(i.fk_user_author) === String(config?.currentUser?.id);
            }
            return true;
        });
    }, [controls.result, filterStatus, config]);

    const handleSubmitIntervention = async (e: React.FormEvent) => {
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
            if (editInterventionId) {
                // Rota backend custom PUT /interventions/{id} (issue #657) via updateIntervention.
                await DolibarrService.updateIntervention(config, editInterventionId, payload);
                toast.success("Intervenção atualizada");
            } else {
                await DolibarrService.createIntervention(config, payload);
                toast.success("Intervenção criada com sucesso");
            }
            setIsCreateModalOpen(false);
            setEditInterventionId(undefined);
            setNewIntervention({ socid: '', project_id: '', date: new Date().toISOString().split('T')[0], description: '' });
            if (onRefresh) onRefresh();
        } catch (e: any) {
            // #658: Se backend retornar 501, desabilitar o botão Editar
            if (e?.status === 501 || e?.message?.includes('501')) {
                setEditSupported(false);
                setIsCreateModalOpen(false);
                setEditInterventionId(undefined);
                toast.warning('Edição de intervenções não está disponível nesta instalação.');
            } else {
                notifyError('Salvar intervenção', e);
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    // #610: Handle adding a line to an intervention
    const handleAddLine = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedIntervention || !newLine.desc) return;
        const hours = parseInt(newLine.durationHours || '0', 10) || 0;
        const minutes = parseInt(newLine.durationMinutes || '0', 10) || 0;
        const durationSeconds = hours * 3600 + minutes * 60;
        if (durationSeconds <= 0) return;

        setIsSubmittingLine(true);
        try {
            const payload: { desc: string; duration: number; date?: number } = {
                desc: newLine.desc,
                duration: durationSeconds,
            };
            if (newLine.date) {
                payload.date = Math.floor(new Date(newLine.date).getTime() / 1000);
            }
            await DolibarrService.addInterventionLine(config, selectedIntervention.id, payload);
            toast.success('Item adicionado com sucesso');
            setIsAddLineModalOpen(false);
            setNewLine({ desc: '', durationHours: '', durationMinutes: '', date: new Date().toISOString().split('T')[0] });
            // Refetch lines and update selected intervention
            await refetchLines();
            if (onRefresh) onRefresh();
        } catch (err: any) {
            notifyError('Adicionar item', err);
        } finally {
            setIsSubmittingLine(false);
        }
    };

    // #610: Handle deleting a line
    const handleDeleteLine = async (line: InterventionLine) => {
        if (!selectedIntervention) return;
        if (!(await confirm('Remover este item da intervenção?'))) return;
        try {
            await DolibarrService.deleteInterventionLine(config, selectedIntervention.id, line.id);
            toast.success('Item removido');
            await refetchLines();
            if (onRefresh) onRefresh();
        } catch (err: any) {
            notifyError('Remover item', err);
        }
    };

    const handleValidate = async () => {
        if (!selectedIntervention) return;
        if (!(await confirm('Validar esta intervenção?'))) return;
        setProcessingId(selectedIntervention.id);
        try {
            await DolibarrService.validateIntervention(config, selectedIntervention.id);
            toast.success("Intervenção Validada");
            if (onRefresh) onRefresh();
            setSelectedIntervention(null);
        } catch (e: any) {
            notifyError('Validar intervenção', e);
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

    // #610: compute total duration from lines
    const computeTotalDuration = (interLines?: InterventionLine[]) => {
        if (!interLines || interLines.length === 0) return 0;
        return interLines.reduce((sum, l) => sum + (l.duration || 0), 0);
    };

    const renderHeader = (
        <div className={selectedIntervention ? 'hidden lg:block' : 'block'}>
            <PageHeader
                title="Intervenções"
                subtitle="Serviço de campo e ordens de trabalho"
                actions={
                    <div className="flex items-center gap-2">
                        <ListToolbar controls={controls} searchPlaceholder="Buscar intervenção..." />
                        {canDo('create', 'interventions') && (
                        <Button icon={<Plus size={16} />} onClick={() => setIsCreateModalOpen(true)}>
                            Nova Intervenção
                        </Button>
                        )}
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
                                <div className="flex items-center gap-1 shrink-0">
                                    <StatusBadge status={int.statut} config={interventionStatuses} size="sm" />
                                    {int.statut === '0' && canDo('delete', 'interventions') && (
                                        <ConfirmDeleteButton
                                            itemLabel={int.ref}
                                            onDelete={() => DolibarrService.deleteIntervention(config, int.id)}
                                            onDeleted={() => {
                                                if (selectedIntervention?.id === int.id) setSelectedIntervention(null);
                                                refetchInterventions();
                                                if (onRefresh) onRefresh();
                                            }}
                                        />
                                    )}
                                </div>
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
                            <div className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                                {int.project_id ? (
                                    <span
                                        className="flex items-center gap-1 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (onNavigate) onNavigate('projects', int.project_id!);
                                        }}
                                    >
                                        <FolderKanban size={10} /> {getProjectName(int.project_id)}
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-1 italic text-slate-400">
                                        <FolderKanban size={10} /> Sem projeto
                                    </span>
                                )}
                            </div>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );

    const selectedLines = selectedIntervention?.lines || [];
    const totalDuration = computeTotalDuration(selectedLines);

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
                    <div className="flex items-center gap-2">
                        {canDo('edit', 'interventions') && (editSupported ? (
                            <Button variant="secondary" size="sm" icon={<Pencil size={14} />} onClick={() => openEditIntervention(selectedIntervention)}>
                                Editar
                            </Button>
                        ) : (
                            <Button variant="secondary" size="sm" icon={<Pencil size={14} />} disabled title="Edição não disponível nesta instalação">
                                Editar
                            </Button>
                        ))}
                        {selectedIntervention.statut === '0' && canDo('validate', 'interventions') && (
                            <Button size="sm" icon={processingId ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} onClick={handleValidate} disabled={!!processingId}>
                                Validar
                            </Button>
                        )}
                        {selectedIntervention.statut === '0' && canDo('delete', 'interventions') && (
                            <ConfirmDeleteButton
                                withLabel
                                itemLabel={selectedIntervention.ref}
                                stopPropagation={false}
                                onDelete={() => DolibarrService.deleteIntervention(config, selectedIntervention.id)}
                                onDeleted={() => {
                                    setSelectedIntervention(null);
                                    refetchInterventions();
                                    if (onRefresh) onRefresh();
                                }}
                            />
                        )}
                    </div>
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
                            <div className="col-span-2">
                                    <label className="text-xs text-slate-500 uppercase font-bold">Projeto Vinculado</label>
                                    {selectedIntervention.project_id ? (
                                        <div
                                            className="flex items-center gap-2 mt-1 text-indigo-600 dark:text-indigo-400 font-medium cursor-pointer hover:underline"
                                            onClick={() => onNavigate && onNavigate('projects', selectedIntervention.project_id!)}
                                        >
                                            <FolderKanban size={16} /> {getProjectName(selectedIntervention.project_id)}
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-2 mt-1 text-slate-400 italic text-sm">
                                            <FolderKanban size={16} /> Sem projeto
                                        </div>
                                    )}
                                </div>
                            <div className="col-span-2">
                                <label className="text-xs text-slate-500 uppercase font-bold">Descrição</label>
                                <div
                                    className="mt-1 text-sm text-slate-600 dark:text-slate-300 prose prose-slate prose-sm max-w-none dark:prose-invert"
                                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(selectedIntervention.description || 'Sem descrição.') }}
                                />
                            </div>
                        </div>
                    </div>

                    <LinkedObjects
                        id={selectedIntervention.id}
                        type="fichinter"
                        onNavigate={onNavigate}
                    />

                    {/* #610: Items / Lines section with CRUD */}
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                        <div className="flex justify-between items-center mb-4">
                            <div>
                                <h3 className="font-bold text-slate-800 dark:text-white">Itens / Serviços Realizados</h3>
                                {/* #610: total duration display */}
                                <div className="flex items-center gap-1 text-sm text-slate-500 mt-0.5" data-testid="total-duration">
                                    <Clock size={13} />
                                    <span>Duração total: <strong>{formatDuration(totalDuration)}</strong></span>
                                </div>
                            </div>
                            {canDo('edit', 'interventions') && (
                            <Button size="sm" icon={<Plus size={14} />} onClick={() => setIsAddLineModalOpen(true)}>
                                Adicionar item
                            </Button>
                            )}
                        </div>
                        <div className="space-y-2">
                            {selectedLines.length > 0 ? (
                                selectedLines.map((line, idx) => (
                                    <div key={line.id ?? idx} className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700">
                                        <div className="flex-1 min-w-0">
                                            <div
                                                className="font-medium text-slate-800 dark:text-white text-sm prose prose-slate prose-sm max-w-none dark:prose-invert [&>p]:m-0"
                                                dangerouslySetInnerHTML={{ __html: sanitizeHtml(line.desc) }}
                                            />
                                            {line.date && <div className="text-xs text-slate-500">{formatDateOnly(line.date)}</div>}
                                        </div>
                                        <div className="flex items-center gap-3 ml-3 shrink-0">
                                            <div className="text-right">
                                                <div className="font-bold text-slate-800 dark:text-white">{formatDuration(line.duration || 0)}</div>
                                            </div>
                                            {canDo('delete', 'interventions') && (
                                            <button
                                                className="text-slate-400 hover:text-red-500 transition-colors"
                                                title="Remover item"
                                                onClick={() => handleDeleteLine(line)}
                                                aria-label="Remover item"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                            )}
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

            {/* Create / Edit Intervention Modal */}
            <Modal
                isOpen={isCreateModalOpen}
                onClose={() => { setIsCreateModalOpen(false); setEditInterventionId(undefined); }}
                title={
                    <span className="flex items-center gap-2">
                        <ClipboardList size={18} className="text-indigo-600" /> {isEditIntervention ? 'Editar Intervenção' : 'Nova Intervenção'}
                    </span>
                }
                footer={
                    <>
                        <Button variant="secondary" onClick={() => { setIsCreateModalOpen(false); setEditInterventionId(undefined); }}>Cancelar</Button>
                        <Button onClick={(e: any) => handleSubmitIntervention(e)} loading={isSubmitting} icon={<CheckCircle2 size={16} />}>{isEditIntervention ? 'Salvar' : 'Criar'}</Button>
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

            {/* #610: Add Line Modal */}
            <Modal
                isOpen={isAddLineModalOpen}
                onClose={() => { setIsAddLineModalOpen(false); }}
                title={
                    <span className="flex items-center gap-2">
                        <Clock size={18} className="text-indigo-600" /> Adicionar item
                    </span>
                }
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsAddLineModalOpen(false)}>Cancelar</Button>
                        <Button onClick={(e: any) => handleAddLine(e)} loading={isSubmittingLine} icon={<CheckCircle2 size={16} />}>Confirmar</Button>
                    </>
                }
            >
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Descrição do serviço</label>
                        <textarea
                            className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white resize-none h-20"
                            value={newLine.desc}
                            onChange={e => setNewLine({ ...newLine, desc: e.target.value })}
                            placeholder="Descreva o serviço realizado..."
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Duração</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                min="0"
                                className="w-24 p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                value={newLine.durationHours}
                                onChange={e => setNewLine({ ...newLine, durationHours: e.target.value })}
                                placeholder="0"
                                aria-label="Horas"
                            />
                            <span className="text-slate-600 dark:text-slate-300">h</span>
                            <input
                                type="number"
                                min="0"
                                max="59"
                                className="w-24 p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                value={newLine.durationMinutes}
                                onChange={e => setNewLine({ ...newLine, durationMinutes: e.target.value })}
                                placeholder="0"
                                aria-label="Minutos"
                            />
                            <span className="text-slate-600 dark:text-slate-300">min</span>
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Data (opcional)</label>
                        <input
                            type="date"
                            className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                            value={newLine.date}
                            onChange={e => setNewLine({ ...newLine, date: e.target.value })}
                        />
                    </div>
                </div>
            </Modal>
        </>
    );
};

export default InterventionList;
