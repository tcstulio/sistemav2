
import React, { useEffect, useState } from 'react';
import { DolibarrConfig, AgendaEvent, AppView } from '../types';
import { dbService } from '../services/dbService';
import { DolibarrService } from '../services/dolibarrService';
import { mapAgendaEvent, mapTask, mapProject, mapIntervention } from '../hooks/dolibarr/mappers';
import { useDolibarrLink } from '../hooks/useDolibarrLink';
import { CalendarDays, Clock, FolderKanban, ClipboardList, ChevronLeft, Calendar as CalendarIcon, Link, User, Building, FileText, Ticket, ExternalLink, AlertCircle, Eye, EyeOff, Pencil, Trash2, Save, X, Loader2 } from 'lucide-react';
import { logger } from '../utils/logger';
import { SafeHtml } from '../utils/sanitizeHtml';

const log = logger.child('AgendaEntryDetail');

interface AgendaEntryDetailProps {
    config: DolibarrConfig;
    initialItemId?: string;
    onNavigate: (view: AppView, id: string) => void;
}

const AgendaEntryDetail: React.FC<AgendaEntryDetailProps> = ({ config, initialItemId, onNavigate }) => {
    const { getLink, openLink } = useDolibarrLink(config);
    const [data, setData] = useState<any | null>(null);
    const [type, setType] = useState<'event' | 'task' | 'project' | 'intervention' | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Edit State
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [editForm, setEditForm] = useState<Partial<AgendaEvent>>({});

    useEffect(() => {
        const fetchData = async () => {
            if (!initialItemId) return;
            setLoading(true);
            setError(null);

            try {
                // Determine Type from ID Prefix
                let id = initialItemId;
                let detectedType: 'event' | 'task' | 'project' | 'intervention' = 'event';

                if (initialItemId.startsWith('evt-')) {
                    id = initialItemId.replace('evt-', '');
                    detectedType = 'event';
                } else if (initialItemId.startsWith('tsk-')) {
                    id = initialItemId.replace('tsk-', '');
                    detectedType = 'task';
                } else if (initialItemId.startsWith('prj-')) {
                    id = initialItemId.replace('prj-', '');
                    detectedType = 'project';
                } else if (initialItemId.startsWith('int-')) {
                    id = initialItemId.replace('int-', '');
                    detectedType = 'intervention';
                }

                setType(detectedType);

                // Read from local IndexedDB (already synced via custom_sync.php)
                let rawData;
                let result;
                switch (detectedType) {
                    case 'event':
                        rawData = await dbService.get<any>('events', id);
                        result = rawData ? mapAgendaEvent(rawData) : null;
                        break;
                    case 'task':
                        rawData = await dbService.get<any>('tasks', id);
                        result = rawData ? mapTask(rawData) : null;
                        break;
                    case 'project':
                        rawData = await dbService.get<any>('projects', id);
                        result = rawData ? mapProject(rawData) : null;
                        break;
                    case 'intervention':
                        rawData = await dbService.get<any>('interventions', id);
                        result = rawData ? mapIntervention(rawData) : null;
                        break;
                }

                if (!result) {
                    setError("Item não encontrado no cache local. Aguarde a sincronização.");
                } else {
                    setData(result);
                }

            } catch (err) {
                log.error("Failed to fetch agenda details from IndexedDB", err);
                setError("Não foi possível carregar os detalhes do item.");
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [config, initialItemId]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full text-slate-400">
                <div className="flex flex-col items-center gap-2">
                    <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                    <p>Carregando detalhes...</p>
                </div>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="p-8 text-center text-slate-500 dark:text-slate-400">
                <p>{error || "Item não encontrado."}</p>
                <button
                    onClick={() => onNavigate('agenda', '')}
                    className="mt-4 px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                    Voltar para Agenda
                </button>
            </div>
        );
    }

    const formatDate = (timestamp?: number) => {
        if (!timestamp) return '-';
        const ts = timestamp < 100000000000 ? timestamp * 1000 : timestamp;
        return new Date(ts).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' });
    };

    // Local Helpers for Date Formats
    const toInputDate = (ts?: number) => {
        if (!ts) return '';
        const d = new Date(ts > 100000000000 ? ts : ts * 1000);
        const pad = (n: number) => n < 10 ? '0' + n : n;
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    const handleStartEdit = () => {
        if (type === 'event' && data) {
            const event = data as AgendaEvent;
            setEditForm({
                label: event.label,
                description: event.description,
                date_start: event.date_start, // Keep as timestamp
                date_end: event.date_end,     // Keep as timestamp
                percentage: event.percentage,
                location: event.location,
            });
            setIsEditing(true);
        }
    };

    const handleSaveEvent = async () => {
        if (!data || type !== 'event') return;
        if (!editForm.label) {
            alert("O título é obrigatório.");
            return;
        }

        setIsSaving(true);
        try {
            await DolibarrService.updateEvent(config, data.id, {
                label: editForm.label,
                description: editForm.description,
                datep: editForm.date_start ? editForm.date_start / 1000 : undefined, // Convert MS to Seconds for API
                datef: editForm.date_end ? editForm.date_end / 1000 : undefined,   // Convert MS to Seconds for API
                percent: editForm.percentage,
                location: editForm.location
            });

            // Update local state optimistically
            setData({ ...data, ...editForm });
            setIsEditing(false);

            // Trigger a background refresh if possible? 
            // The user might need to wait for next sync to see changes persist if they reload.
            // But immediate feedback is good.
        } catch (e) {
            log.error("Failed to save event", e);
            alert("Erro ao salvar evento. Verifique a conexão.");
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteEvent = async () => {
        if (!data) return;
        if (!confirm("Tem certeza que deseja excluir este evento permanentemente?")) return;

        setIsDeleting(true);
        try {
            await DolibarrService.deleteEvent(config, data.id);
            onNavigate('agenda', '');
        } catch (e) {
            log.error("Failed to delete event", e);
            alert("Erro ao excluir evento. Tente novamente.");
            setIsDeleting(false);
        }
    };

    // --- RENDERERS FOR DIFFERENT TYPES ---

    // 1. EVENT RENDERER
    if (type === 'event') {
        const event = data as AgendaEvent;
        return (
            <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 overflow-y-auto">
                <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-4 md:p-6 sticky top-0 z-10">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <button onClick={() => isEditing ? setIsEditing(false) : onNavigate('agenda', '')} className="p-2 -ml-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-500 transition-colors">
                                <ChevronLeft size={20} />
                            </button>
                            <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Agenda / Evento {isEditing ? '(Editando)' : ''}</span>
                        </div>

                        {/* Action Buttons */}
                        {!isEditing && (
                            <div className="flex items-center gap-2">
                                <button onClick={handleStartEdit} className="p-2 hover:bg-indigo-50 text-slate-500 hover:text-indigo-600 rounded-lg transition-colors" title="Editar Evento">
                                    <Pencil size={20} />
                                </button>
                                <button onClick={handleDeleteEvent} disabled={isDeleting} className="p-2 hover:bg-red-50 text-slate-500 hover:text-red-600 rounded-lg transition-colors" title="Excluir Evento">
                                    {isDeleting ? <Loader2 className="animate-spin" size={20} /> : <Trash2 size={20} />}
                                </button>
                            </div>
                        )}
                    </div>

                    {isEditing ? (
                        // EDIT FORM HEADER PART
                        <div className="animate-in slide-in-from-top-4 fade-in">
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Assunto</label>
                                    <input
                                        type="text"
                                        className="w-full text-xl font-bold p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                        value={editForm.label || ''}
                                        onChange={e => setEditForm(prev => ({ ...prev, label: e.target.value }))}
                                    />
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Início</label>
                                        <input
                                            type="datetime-local"
                                            className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                            value={toInputDate(editForm.date_start)}
                                            onChange={e => {
                                                const date = new Date(e.target.value);
                                                if (!isNaN(date.getTime())) {
                                                    setEditForm(prev => ({ ...prev, date_start: date.getTime() }))
                                                }
                                            }}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Fim</label>
                                        <input
                                            type="datetime-local"
                                            className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                            value={toInputDate(editForm.date_end)}
                                            onChange={e => {
                                                const date = new Date(e.target.value);
                                                if (!isNaN(date.getTime())) {
                                                    setEditForm(prev => ({ ...prev, date_end: date.getTime() }))
                                                }
                                            }}
                                        />
                                    </div>
                                </div>
                                <div className="flex items-center gap-4">
                                    <div className="flex-1">
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Progresso (%)</label>
                                        <input
                                            type="number" min="0" max="100"
                                            className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                            value={editForm.percentage || 0}
                                            onChange={e => setEditForm(prev => ({ ...prev, percentage: parseInt(e.target.value) }))}
                                        />
                                    </div>
                                </div>

                                <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800 mt-4">
                                    <button onClick={() => setIsEditing(false)} className="px-4 py-2 text-slate-500 hover:text-slate-700 font-medium">Cancelar</button>
                                    <button onClick={handleSaveEvent} disabled={isSaving} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium shadow-sm flex items-center gap-2">
                                        {isSaving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />} Salvar Alterações
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        // READ ONLY HEADER
                        <div className="flex flex-wrap justify-between items-start gap-4">
                            <div>
                                <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">{event.label}</h1>
                                <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
                                    <span className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded border border-slate-200 dark:border-slate-700"><CalendarDays size={14} /> {formatDate(event.date_start)}</span>
                                    {event.date_end && (
                                        <><span>→</span><span className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded border border-slate-200 dark:border-slate-700"><Clock size={14} /> {formatDate(event.date_end)}</span></>
                                    )}
                                </div>
                            </div>
                            <div className={`px-3 py-1.5 rounded-full text-sm font-medium border ${event.percentage === 100 ? 'bg-green-100 text-green-700 border-green-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>{event.percentage}% Concluído</div>
                        </div>
                    )}
                </div>

                <div className="p-4 md:p-8 max-w-5xl mx-auto w-full space-y-6">
                    {isEditing ? (
                        // EDIT FORM BODY
                        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-2"><FileText size={18} className="text-indigo-500" /> Descrição Completa</label>
                            <textarea
                                className="w-full p-4 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white h-64 resize-none font-mono text-sm leading-relaxed"
                                value={editForm.description || ''}
                                onChange={e => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                                placeholder="Descrição detalhada do evento..."
                            />
                        </div>
                    ) : (
                        // READ ONLY BODY
                        <>
                            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
                                <h2 className="text-lg font-semibold text-slate-800 dark:text-white mb-4 flex items-center gap-2"><FileText size={18} className="text-indigo-500" /> Descrição</h2>
                                <SafeHtml
                                    html={event.description || "Sem descrição."}
                                    className="prose dark:prose-invert max-w-none text-slate-600 dark:text-slate-300"
                                />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {event.project_id && (
                                    <div onClick={() => onNavigate('projects', event.project_id!)} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-indigo-300 cursor-pointer transition-all hover:shadow-md flex items-center gap-3 group">
                                        <div className="p-2 bg-indigo-50 rounded-lg group-hover:bg-indigo-100"><FolderKanban size={20} className="text-indigo-600" /></div>
                                        <div><p className="text-sm text-slate-500">Projeto Vinculado</p><p className="font-medium text-slate-900 dark:text-white">Ver Projeto</p></div>
                                        <ChevronLeft size={16} className="ml-auto transform rotate-180 text-slate-400" />
                                    </div>
                                )}
                                {event.socid && (
                                    <div onClick={() => onNavigate('customers', event.socid!)} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-blue-300 cursor-pointer transition-all hover:shadow-md flex items-center gap-3 group">
                                        <div className="p-2 bg-blue-50 rounded-lg group-hover:bg-blue-100"><Building size={20} className="text-blue-600" /></div>
                                        <div><p className="text-sm text-slate-500">Cliente / Fornecedor</p><p className="font-medium text-slate-900 dark:text-white">Ver Cadastro</p></div>
                                        <ChevronLeft size={16} className="ml-auto transform rotate-180 text-slate-400" />
                                    </div>
                                )}
                                {/* Linked Object (Ticket, Invoice, Proposal, etc) */}
                                {event.elementtype && event.fk_element && (
                                    <div
                                        onClick={() => {
                                            let view: AppView | null = null;
                                            switch (event.elementtype) {
                                                case 'ticket': view = 'tickets'; break;
                                                case 'propal': view = 'proposals'; break;
                                                case 'commande': view = 'orders'; break;
                                                case 'facture': view = 'invoices'; break;
                                                case 'contrat': view = 'contracts'; break;
                                                // Add more internal views here
                                            }
                                            if (view) {
                                                onNavigate(view, event.fk_element!);
                                            } else {
                                                // Fallback to External Link
                                                openLink(event.elementtype || '', event.fk_element!);
                                            }
                                        }}
                                        className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-purple-300 dark:hover:border-purple-700 cursor-pointer transition-all hover:shadow-md group"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-purple-50 dark:bg-purple-900/20 rounded-lg group-hover:bg-purple-100 dark:group-hover:bg-purple-900/40 transition-colors">
                                                <Link size={20} className="text-purple-600 dark:text-purple-400" />
                                            </div>
                                            <div>
                                                <p className="text-sm text-slate-500 dark:text-slate-400">Elemento de Origem ({event.elementtype})</p>
                                                <p className="font-medium text-slate-900 dark:text-white">Ver Documento</p>
                                            </div>
                                            <ChevronLeft size={16} className="ml-auto transform rotate-180 text-slate-400" />
                                        </div>
                                    </div>
                                )}

                                {/* Extra Details Grid */}
                                <div className="md:col-span-2 grid grid-cols-2 md:grid-cols-4 gap-4 mt-2">
                                    {(event.fk_user_author || event.user_author_name) && (
                                        <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-100 dark:border-slate-700">
                                            <p className="text-xs text-slate-500 uppercase font-bold mb-1 flex items-center gap-1"><User size={12} /> Criado Por</p>
                                            <p className="text-sm font-medium dark:text-slate-200 whitespace-nowrap overflow-hidden text-ellipsis">
                                                {event.user_author_name || `ID: ${event.fk_user_author}`}
                                            </p>
                                        </div>
                                    )}
                                    {event.priority !== undefined && (
                                        <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-100 dark:border-slate-700">
                                            <p className="text-xs text-slate-500 uppercase font-bold mb-1 flex items-center gap-1"><AlertCircle size={12} /> Prioridade</p>
                                            <p className="text-sm font-medium dark:text-slate-200">{event.priority}</p>
                                        </div>
                                    )}
                                    {event.transparency !== undefined && (
                                        <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-100 dark:border-slate-700">
                                            <p className="text-xs text-slate-500 uppercase font-bold mb-1 flex items-center gap-1">{event.transparency ? <EyeOff size={12} /> : <Eye size={12} />} Disponibilidade</p>
                                            <p className="text-sm font-medium dark:text-slate-200">{event.transparency === 1 ? 'Ocupado' : 'Disponível'}</p>
                                        </div>
                                    )}
                                    {event.fulldayevent && (
                                        <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-100 dark:border-slate-700">
                                            <p className="text-xs text-slate-500 uppercase font-bold mb-1 flex items-center gap-1"><CalendarIcon size={12} /> Duração</p>
                                            <p className="text-sm font-medium dark:text-slate-200">Dia Inteiro</p>
                                        </div>
                                    )}
                                </div>

                                {/* External Link Button */}
                                <div className="md:col-span-2 flex justify-center mt-4">
                                    <button
                                        onClick={() => openLink('agenda', event.id)}
                                        className="flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-400 hover:underline px-4 py-2"
                                    >
                                        <ExternalLink size={14} /> Abrir no Dolibarr
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        );
    }

    // 2. TASK RENDERER
    if (type === 'task') {
        // Need to cast correctly, assuming Task interface matches response
        const task = data as any;
        return (
            <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 overflow-y-auto">
                <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-4 md:p-6 sticky top-0 z-10">
                    <div className="flex items-center gap-2 mb-4">
                        <button onClick={() => onNavigate('agenda', '')} className="p-2 -ml-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-500 transition-colors"><ChevronLeft size={20} /></button>
                        <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Agenda / Tarefa</span>
                    </div>
                    <div className="flex flex-wrap justify-between items-start gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">{task.label || task.ref}</h1>
                            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
                                {task.date_start && <span className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded border border-slate-200 dark:border-slate-700"><CalendarDays size={14} /> Início: {formatDate(task.date_start)}</span>}
                                {task.date_end && <span className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded border border-slate-200 dark:border-slate-700"><Clock size={14} /> Fim: {formatDate(task.date_end)}</span>}
                            </div>
                        </div>
                        <div className={`px-3 py-1.5 rounded-full text-sm font-medium border ${parseInt(task.progress) === 100 ? 'bg-green-100 text-green-700 border-green-200' : 'bg-orange-100 text-orange-700 border-orange-200'}`}>{task.progress}% Concluído</div>
                    </div>
                </div>

                <div className="p-4 md:p-8 max-w-5xl mx-auto w-full space-y-6">
                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
                        <h2 className="text-lg font-semibold text-slate-800 dark:text-white mb-4 flex items-center gap-2"><FileText size={18} className="text-indigo-500" /> Descrição</h2>
                        <div className="prose dark:prose-invert max-w-none text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{task.description || "Sem descrição."}</div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {task.fk_user_assign && (
                            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center gap-3">
                                <div className="p-2 bg-white dark:bg-slate-900 rounded-lg shadow-sm text-slate-500"><User size={20} /></div>
                                <div><p className="text-xs text-slate-500 uppercase font-bold">Responsável</p><p className="text-sm font-medium text-slate-900 dark:text-white">ID: {task.fk_user_assign}</p></div>
                            </div>
                        )}
                        {task.fk_user_creat && (
                            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center gap-3">
                                <div className="p-2 bg-white dark:bg-slate-900 rounded-lg shadow-sm text-slate-500"><User size={20} /></div>
                                <div><p className="text-xs text-slate-500 uppercase font-bold">Criado por</p><p className="text-sm font-medium text-slate-900 dark:text-white">ID: {task.fk_user_creat}</p></div>
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {(task.fk_projet || task.project_id) && (
                            <div onClick={() => onNavigate('projects', (task.fk_projet || task.project_id)!)} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-indigo-300 cursor-pointer transition-all hover:shadow-md flex items-center gap-3 group">
                                <div className="p-2 bg-indigo-50 rounded-lg group-hover:bg-indigo-100"><FolderKanban size={20} className="text-indigo-600" /></div>
                                <div><p className="text-sm text-slate-500">Projeto Pai</p><p className="font-medium text-slate-900 dark:text-white">Ver Projeto</p></div>
                                <ChevronLeft size={16} className="ml-auto transform rotate-180 text-slate-400" />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // 3. PROJECT RENDERER
    if (type === 'project') {
        const project = data as any;
        return (
            <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 overflow-y-auto">
                {/* Similar Header for Project context */}
                <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-4 md:p-6 sticky top-0 z-10">
                    <div className="flex items-center gap-2 mb-4">
                        <button onClick={() => onNavigate('agenda', '')} className="p-2 -ml-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-500 transition-colors"><ChevronLeft size={20} /></button>
                        <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Agenda / Projeto (Prazo)</span>
                    </div>
                    <div className="flex flex-wrap justify-between items-start gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">{project.title || project.ref}</h1>
                            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
                                {project.date_end && <span className="flex items-center gap-1.5 bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-300 px-2 py-1 rounded border border-red-200 dark:border-red-800"><Clock size={14} /> Deadline: {formatDate(project.date_end)}</span>}
                            </div>
                        </div>
                    </div>
                </div>
                <div className="p-4 md:p-8 max-w-5xl mx-auto w-full space-y-6">
                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
                        <p className="text-slate-600 dark:text-slate-300">Visualizando detalhes do prazo do projeto.</p>
                    </div>
                    <div className="grid grid-cols-1 gap-4">
                        <div onClick={() => onNavigate('projects', project.id!)} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-indigo-300 cursor-pointer transition-all hover:shadow-md flex items-center gap-3 group">
                            <div className="p-2 bg-indigo-50 rounded-lg group-hover:bg-indigo-100"><FolderKanban size={20} className="text-indigo-600" /></div>
                            <div><p className="text-sm text-slate-500">Acessar Projeto Completo</p><p className="font-medium text-slate-900 dark:text-white">Abrir Painel do Projeto</p></div>
                            <ChevronLeft size={16} className="ml-auto transform rotate-180 text-slate-400" />
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    // 4. INTERVENTION RENDERER
    if (type === 'intervention') {
        const intervention = data as any;
        return (
            <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 overflow-y-auto">
                <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-4 md:p-6 sticky top-0 z-10">
                    <div className="flex items-center gap-2 mb-4">
                        <button onClick={() => onNavigate('agenda', '')} className="p-2 -ml-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-500 transition-colors"><ChevronLeft size={20} /></button>
                        <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Agenda / Intervenção</span>
                    </div>
                    <div className="flex flex-wrap justify-between items-start gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">{intervention.ref}</h1>
                            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
                                {intervention.date && <span className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded border border-slate-200 dark:border-slate-700"><CalendarDays size={14} /> Data: {formatDate(intervention.date)}</span>}
                            </div>
                        </div>
                    </div>
                </div>
                <div className="p-4 md:p-8 max-w-5xl mx-auto w-full space-y-6">
                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
                        <h2 className="text-lg font-semibold text-slate-800 dark:text-white mb-4 flex items-center gap-2"><FileText size={18} className="text-indigo-500" /> Descrição</h2>
                        <div className="prose dark:prose-invert max-w-none text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{intervention.description || "Sem descrição."}</div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {(intervention.fk_projet || intervention.project_id) && (
                            <div onClick={() => onNavigate('projects', (intervention.fk_projet || intervention.project_id)!)} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-indigo-300 cursor-pointer transition-all hover:shadow-md flex items-center gap-3 group">
                                <div className="p-2 bg-indigo-50 rounded-lg group-hover:bg-indigo-100"><FolderKanban size={20} className="text-indigo-600" /></div>
                                <div><p className="text-sm text-slate-500">Projeto Vinculado</p><p className="font-medium text-slate-900 dark:text-white">Ver Projeto</p></div>
                                <ChevronLeft size={16} className="ml-auto transform rotate-180 text-slate-400" />
                            </div>
                        )}
                        {intervention.socid && (
                            <div onClick={() => onNavigate('customers', intervention.socid!)} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-blue-300 cursor-pointer transition-all hover:shadow-md flex items-center gap-3 group">
                                <div className="p-2 bg-blue-50 rounded-lg group-hover:bg-blue-100"><Building size={20} className="text-blue-600" /></div>
                                <div><p className="text-sm text-slate-500">Cliente</p><p className="font-medium text-slate-900 dark:text-white">Ver Cliente</p></div>
                                <ChevronLeft size={16} className="ml-auto transform rotate-180 text-slate-400" />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    return null;
};

export default AgendaEntryDetail;
