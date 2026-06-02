import React, { useState, useRef, useEffect } from 'react';
import { Project, DolibarrConfig, DolibarrUser, Task } from '../../types';
import { X, Plus, Trash2, ArrowRight, Save, Wand2, Sparkles, Import, Users, Loader2, Search, Check, ChevronDown } from 'lucide-react';
import { DolibarrService } from '../../services/dolibarrService';
import { AiService } from '../../services/aiService';
import { logger } from '../../utils/logger';

const log = logger.child('TaskWizard');

interface TaskWizardProps {
    isOpen: boolean;
    onClose: () => void;
    project: Project;
    config: DolibarrConfig;
    users: DolibarrUser[];
    allProjects?: Project[];
    allTasks?: Task[];
    onSuccess: () => void;
    initialTasks?: { label: string; description: string }[];
}

interface TaskRow {
    id: string; // internal id for key
    label: string;
    description: string;
    planned_workload: number;
    assigned_user_id: string; // Main responsible
    participant_ids: string[]; // Contributors
}

// --- Helper Components ---

const SearchableUserSelect: React.FC<{
    users: DolibarrUser[];
    value: string;
    onChange: (val: string) => void;
    placeholder?: string;
}> = ({ users, value, onChange, placeholder = "Selecione..." }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);

    const selectedUser = users.find(u => u.id === value);
    const filteredUsers = users.filter(u =>
        (u.firstname + ' ' + (u.lastname || '') + u.login).toLowerCase().includes(search.toLowerCase())
    );

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="relative w-full" ref={containerRef}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="w-full p-2 border border-slate-200 dark:border-slate-700 dark:bg-slate-800 rounded text-xs flex items-center justify-between hover:border-indigo-300 focus:ring-2 focus:ring-indigo-500 outline-none"
            >
                <span className="truncate">
                    {selectedUser ? (selectedUser.firstname + ' ' + (selectedUser.lastname || '')).trim() : <span className="text-slate-400">{placeholder}</span>}
                </span>
                <ChevronDown size={12} className="text-slate-400 ml-1 flex-none" />
            </button>

            {isOpen && (
                <div className="absolute top-full left-0 w-full min-w-[200px] mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl rounded-lg z-50 overflow-hidden flex flex-col max-h-60">
                    <div className="p-2 border-b border-slate-100 dark:border-slate-800 flex-none sticky top-0 bg-white dark:bg-slate-900">
                        <div className="relative">
                            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                autoFocus
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Buscar..."
                                className="w-full pl-8 pr-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded bg-slate-50 dark:bg-slate-800 outline-none focus:border-indigo-500"
                            />
                        </div>
                    </div>
                    <div className="overflow-y-auto flex-1 p-1">
                        <div
                            onClick={() => { onChange(''); setIsOpen(false); }}
                            className="p-2 text-xs text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 rounded cursor-pointer italic"
                        >
                            Nenhum
                        </div>
                        {filteredUsers.map(u => (
                            <div
                                key={u.id}
                                onClick={() => { onChange(u.id); setIsOpen(false); }}
                                className={`p-2 text-xs flex items-center gap-2 rounded cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-900/20 ${u.id === value ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' : ''}`}
                            >
                                <div className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-600 dark:text-slate-300">
                                    {u.firstname?.[0]}
                                </div>
                                {(u.firstname + ' ' + (u.lastname || '')).trim()}
                            </div>
                        ))}
                        {filteredUsers.length === 0 && <div className="p-2 text-center text-xs text-slate-400">Sem resultados</div>}
                    </div>
                </div>
            )}
        </div>
    );
};

const MultiSelectUsers: React.FC<{
    users: DolibarrUser[];
    selectedIds: string[];
    onToggle: (id: string) => void;
}> = ({ users, selectedIds, onToggle }) => {
    const [search, setSearch] = useState('');

    // Sort selected first, then alphabetical
    const filteredUsers = users.filter(u =>
        (u.firstname + ' ' + (u.lastname || '') + u.login).toLowerCase().includes(search.toLowerCase())
    ).sort((a, b) => {
        const aSelected = selectedIds.includes(a.id);
        const bSelected = selectedIds.includes(b.id);
        if (aSelected && !bSelected) return -1;
        if (!aSelected && bSelected) return 1;
        return (a.firstname || '').localeCompare(b.firstname || '');
    });

    return (
        <div className="relative group/multiselect w-full">
            <button className="flex items-center justify-between w-full p-2 border border-slate-200 dark:border-slate-700 dark:bg-slate-800 rounded text-xs hover:border-indigo-300">
                <span className="truncate">
                    {selectedIds.length > 0 ? `${selectedIds.length} selecionado(s)` : 'Adicionar...'}
                </span>
                <Users size={12} className="text-slate-400 ml-1" />
            </button>
            <div className="absolute top-full left-0 w-64 max-h-60 overflow-hidden bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl rounded-lg z-50 hidden group-hover/multiselect:flex flex-col">
                <div className="p-2 border-b border-slate-100 dark:border-slate-800 flex-none bg-white dark:bg-slate-900">
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Filtrar..."
                        className="w-full p-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded bg-slate-50 dark:bg-slate-800 outline-none focus:border-indigo-500"
                    />
                </div>
                <div className="overflow-y-auto p-1 flex-1">
                    {filteredUsers.map(u => (
                        <div
                            key={u.id}
                            onClick={() => onToggle(u.id)}
                            className={`p-2 text-xs flex items-center gap-2 cursor-pointer rounded hover:bg-slate-50 dark:hover:bg-slate-800 ${selectedIds.includes(u.id) ? 'text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20' : ''}`}
                        >
                            <div className={`w-3 h-3 flex-none rounded border flex items-center justify-center ${selectedIds.includes(u.id) ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300'}`}>
                                {selectedIds.includes(u.id) && <Check size={8} className="text-white" />}
                            </div>
                            <span className="truncate">{(u.firstname + ' ' + (u.lastname || '')).trim()}</span>
                        </div>
                    ))}
                    {filteredUsers.length === 0 && <div className="p-2 text-center text-xs text-slate-400">Sem resultados</div>}
                </div>
            </div>
        </div>
    );
}

// --- Main Component ---

export const TaskWizard: React.FC<TaskWizardProps> = ({ isOpen, onClose, project, config, users, allProjects = [], allTasks = [], onSuccess, initialTasks }) => {
    const [rows, setRows] = useState<TaskRow[]>(() => {
        if (initialTasks && initialTasks.length > 0) {
            return initialTasks.map((t, i) => ({
                id: `init-${i}`,
                label: t.label,
                description: t.description,
                planned_workload: 0,
                assigned_user_id: '',
                participant_ids: []
            }));
        }
        return [{ id: '1', label: '', description: '', planned_workload: 0, assigned_user_id: '', participant_ids: [] }];
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [aiPrompt, setAiPrompt] = useState('');
    const [isAiLoading, setIsAiLoading] = useState(false);
    const [showAiInput, setShowAiInput] = useState(false);

    // Import project state
    const [importSearch, setImportSearch] = useState('');
    const [showImportDropdown, setShowImportDropdown] = useState(false);
    const importDropdownRef = useRef<HTMLDivElement>(null);

    // Close import dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (importDropdownRef.current && !importDropdownRef.current.contains(event.target as Node)) {
                setShowImportDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    if (!isOpen) return null;

    const addRow = () => {
        setRows([...rows, {
            id: Date.now().toString(),
            label: '',
            description: '',
            planned_workload: 0,
            assigned_user_id: '',
            participant_ids: []
        }]);
    };

    const removeRow = (id: string) => {
        if (rows.length > 1) {
            setRows(rows.filter(r => r.id !== id));
        }
    };

    const updateRow = (id: string, field: keyof TaskRow, value: any) => {
        setRows(rows.map(r => r.id === id ? { ...r, [field]: value } : r));
    };

    const toggleParticipant = (rowId: string, userId: string) => {
        const row = rows.find(r => r.id === rowId);
        if (!row) return;

        const current = row.participant_ids || [];
        const updated = current.includes(userId)
            ? current.filter(id => id !== userId)
            : [...current, userId];

        updateRow(rowId, 'participant_ids', updated);
    };

    const handleMagicFill = async () => {
        if (!aiPrompt.trim() && !project.title) return;
        setIsAiLoading(true);
        const context = aiPrompt.trim() || `Project: ${project.title}. Ref: ${project.ref}.`;

        try {
            const suggestions = await AiService.generateProjectTasks(context);
            if (suggestions && Array.isArray(suggestions)) {
                const newRows = suggestions.map((s: any, idx: number) => ({
                    id: `ai-${Date.now()}-${idx}`,
                    label: s.label || 'Nova Tarefa',
                    description: s.description || '',
                    planned_workload: Number(s.planned_workload) || 0,
                    assigned_user_id: '',
                    participant_ids: []
                }));
                // Append or replace? Let's append if rows are empty (default 1 empty), else append
                if (rows.length === 1 && !rows[0].label) {
                    setRows(newRows);
                } else {
                    setRows([...rows, ...newRows]);
                }
                setShowAiInput(false);
            }
        } catch (e) {
            log.error("Failed to generate AI suggestions", e);
            alert('Erro ao gerar sugestões com IA.');
        } finally {
            setIsAiLoading(false);
        }
    };

    const handleImportFromProject = (projectId: string) => {
        if (!projectId) return;
        const sourceTasks = allTasks.filter(t => String(t.project_id) === String(projectId));
        if (sourceTasks.length === 0) {
            alert('Projeto selecionado não possui tarefas.');
            return;
        }

        const newRows = sourceTasks.map((t, idx) => ({
            id: `import-${Date.now()}-${idx}`,
            label: t.label,
            description: t.description || '',
            planned_workload: t.planned_workload ? t.planned_workload / 3600 : 0,
            assigned_user_id: '', // Reset user
            participant_ids: []
        }));

        if (rows.length === 1 && !rows[0].label) {
            setRows(newRows);
        } else {
            setRows([...rows, ...newRows]);
        }
        setShowImportDropdown(false);
        setImportSearch('');
    };

    const handleSubmit = async () => {
        // Validation
        const validRows = rows.filter(r => r.label.trim());
        if (validRows.length === 0) {
            alert('Adicione pelo menos uma tarefa com título.');
            return;
        }

        setIsSubmitting(true);
        try {
            for (const row of validRows) {
                // 1. Create Task
                const payload: any = {
                    label: row.label,
                    description: row.description,
                    project_id: project.id,
                    planned_workload: (row.planned_workload || 0) * 3600,
                };
                // If main responsible is set, we might need to add them as a contact or use fk_user_assign if API supports it directly on create.
                // Standard Dolibarr often ignores fk_user_assign on create sometimes, or requires separate addcontact.
                // But let's try assuming standard API might accept it or we do it after.
                // Actually, best practice: Create -> Add Contact (Responsible) -> Add Contacts (Contributors).

                const createdTask = await DolibarrService.createTask(config, payload);
                if (createdTask && createdTask.id) {
                    // 2. Add Responsible (if selected)
                    if (row.assigned_user_id) {
                        try {
                            // Try adding as 'responsible' type if mapped, or just 'internal'
                            // Standard keys: '9' for responsible? '1' for participant?
                            // Actually standard API usually uses codes.
                            // Let's assume standard 'internal_contact' logic
                            // For now, I'll use the new helper.
                            await DolibarrService.addTaskParticipant(config, createdTask.id, row.assigned_user_id);
                        } catch (e) { log.warn('Failed to assign user', e); }
                    }

                    // 3. Add Participants
                    if (row.participant_ids && row.participant_ids.length > 0) {
                        for (const uid of row.participant_ids) {
                            if (uid === row.assigned_user_id) continue; // Skip if main responsible
                            try {
                                await DolibarrService.addTaskParticipant(config, createdTask.id, uid);
                            } catch (e) { log.warn('Failed to add participant', { uid, error: e }); }
                        }
                    }
                }
            }
            onSuccess();
            onClose();
        } catch (e) {
            log.error("Failed to create tasks", e);
            alert('Erro ao criar tarefas.');
        } finally {
            setIsSubmitting(false);
        }
    };

    // Filter projects for import
    const filteredProjects = allProjects
        .filter(p => p.id !== project.id)
        .filter(p => (p.ref + ' ' + p.title).toLowerCase().includes(importSearch.toLowerCase()));

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-6xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[90vh]">
                <div className="flex justify-between items-center p-4 border-b border-slate-100 dark:border-slate-800 flex-none bg-slate-50 dark:bg-slate-900 rounded-t-xl">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg">
                            <Sparkles className="text-indigo-600 dark:text-indigo-400" size={20} />
                        </div>
                        <div>
                            <h3 className="font-bold text-lg dark:text-white leading-tight">Wizard de Tarefas</h3>
                            <p className="text-xs text-slate-500">Criação em lote para: <span className="font-medium text-slate-700 dark:text-slate-300">{project.ref}</span></p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {!showAiInput && (
                            <button
                                onClick={() => setShowAiInput(true)}
                                className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-lg text-xs font-medium hover:shadow-lg transition-all"
                            >
                                <Wand2 size={14} /> Magic Fill (IA)
                            </button>
                        )}

                        <div className="relative" ref={importDropdownRef}>
                            <button
                                onClick={() => setShowImportDropdown(!showImportDropdown)}
                                className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 p-1.5 px-3 rounded-lg text-xs font-medium transition-colors"
                            >
                                <Import size={14} className="text-slate-500" />
                                <span>Importar de Projeto...</span>
                            </button>
                            {showImportDropdown && (
                                <div className="absolute top-full right-0 mt-1 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl rounded-lg z-50 overflow-hidden flex flex-col max-h-60 animate-in slide-in-from-top-2">
                                    <div className="p-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800">
                                        <input
                                            autoFocus
                                            type="text"
                                            value={importSearch}
                                            onChange={(e) => setImportSearch(e.target.value)}
                                            placeholder="Buscar projeto..."
                                            className="w-full p-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded outline-none focus:border-indigo-500"
                                        />
                                    </div>
                                    <div className="overflow-y-auto flex-1 p-1">
                                        {filteredProjects.map(p => (
                                            <div
                                                key={p.id}
                                                onClick={() => handleImportFromProject(p.id)}
                                                className="p-2 text-xs hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded cursor-pointer"
                                            >
                                                <div className="font-bold text-slate-700 dark:text-slate-300">{p.ref}</div>
                                                <div className="truncate text-slate-500">{p.title}</div>
                                            </div>
                                        ))}
                                        {filteredProjects.length === 0 && <div className="p-4 text-center text-xs text-slate-400">Nenhum projeto encontrado</div>}
                                    </div>
                                </div>
                            )}
                        </div>

                        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"><X size={20} /></button>
                    </div>
                </div>

                {showAiInput && (
                    <div className="p-4 bg-indigo-50 dark:bg-indigo-900/10 border-b border-indigo-100 dark:border-indigo-900/20 flex gap-2 items-start animate-in slide-in-from-top-2">
                        <textarea
                            value={aiPrompt}
                            onChange={(e) => setAiPrompt(e.target.value)}
                            placeholder="Descreva as tarefas que você precisa (ex: 'Desenvolver login com Google e recuperação de senha')..."
                            className="flex-1 p-3 border border-indigo-200 dark:border-indigo-800 rounded-lg text-sm dark:bg-slate-800 focus:ring-2 focus:ring-indigo-500 resize-none h-20 shadow-sm"
                        />
                        <div className="flex flex-col gap-2">
                            <button
                                onClick={handleMagicFill}
                                disabled={isAiLoading}
                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium flex items-center gap-2 justify-center shadow-md transition-all active:scale-95"
                            >
                                {isAiLoading ? <Loader2 className="animate-spin" size={16} /> : <Wand2 size={16} />}
                                Gerar Tarefas
                            </button>
                            <button onClick={() => setShowAiInput(false)} className="text-xs text-slate-500 hover:text-slate-700 hover:underline text-center">Cancelar</button>
                        </div>
                    </div>
                )}

                <div className="flex-1 overflow-auto p-4 bg-slate-50/50 dark:bg-black/20">
                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 border-b border-slate-200 dark:border-slate-700">
                                <tr>
                                    <th className="p-3 font-medium w-10 text-center">#</th>
                                    <th className="p-3 font-medium w-1/4">Título *</th>
                                    <th className="p-3 font-medium w-1/3">Descrição</th>
                                    <th className="p-3 font-medium w-24 text-center">Horas</th>
                                    <th className="p-3 font-medium w-40">Responsável</th>
                                    <th className="p-3 font-medium w-40">Participantes</th>
                                    <th className="p-3 font-medium w-10"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {rows.map((row, index) => (
                                    <tr key={row.id} className="group hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                        <td className="p-3 text-slate-400 text-xs text-center">{index + 1}</td>
                                        <td className="p-3">
                                            <input
                                                type="text"
                                                value={row.label}
                                                onChange={(e) => updateRow(row.id, 'label', e.target.value)}
                                                placeholder="Título da tarefa..."
                                                className="w-full p-2 border border-slate-200 dark:border-slate-700 dark:bg-slate-800 rounded focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all font-medium"
                                            />
                                        </td>
                                        <td className="p-3">
                                            <input
                                                type="text"
                                                value={row.description}
                                                onChange={(e) => updateRow(row.id, 'description', e.target.value)}
                                                placeholder="Descrição (opcional)"
                                                className="w-full p-2 border border-slate-200 dark:border-slate-700 dark:bg-slate-800 rounded focus:ring-2 focus:ring-indigo-500 outline-none text-slate-600 dark:text-slate-300"
                                            />
                                        </td>
                                        <td className="p-3">
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.5"
                                                value={row.planned_workload}
                                                onChange={(e) => updateRow(row.id, 'planned_workload', parseFloat(e.target.value) || 0)}
                                                className="w-full p-2 text-center border border-slate-200 dark:border-slate-700 dark:bg-slate-800 rounded focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
                                            />
                                        </td>
                                        <td className="p-3">
                                            <SearchableUserSelect
                                                users={users}
                                                value={row.assigned_user_id}
                                                onChange={(val) => updateRow(row.id, 'assigned_user_id', val)}
                                            />
                                        </td>
                                        <td className="p-3">
                                            <MultiSelectUsers
                                                users={users}
                                                selectedIds={row.participant_ids}
                                                onToggle={(uid) => toggleParticipant(row.id, uid)}
                                            />
                                        </td>
                                        <td className="p-3 text-center">
                                            <button
                                                onClick={() => removeRow(row.id)}
                                                className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                                title="Remover linha"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="flex justify-between items-center p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 rounded-b-xl flex-none">
                    <button
                        onClick={addRow}
                        className="flex items-center gap-2 text-indigo-600 hover:text-indigo-700 font-medium text-sm px-3 py-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-lg transition-colors border border-dashed border-indigo-200 dark:border-indigo-800"
                    >
                        <Plus size={16} /> Adicionar Linha
                    </button>

                    <div className="flex items-center gap-3">
                        <div className="text-right mr-4 text-xs text-slate-500 hidden sm:block">
                            <span className="font-bold text-slate-700 dark:text-slate-300">{rows.filter(r => r.label).length}</span> tarefas a criar <br />
                            <span className="font-bold text-slate-700 dark:text-slate-300">{rows.reduce((acc, r) => acc + (r.planned_workload || 0), 0)}h</span> total estimado
                        </div>
                        <button
                            onClick={handleSubmit}
                            disabled={isSubmitting || rows.filter(r => r.label).length === 0}
                            className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-lg shadow-indigo-200/50 dark:shadow-none font-bold text-sm transition-all transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 className="animate-spin" size={18} /> Processando...
                                </>
                            ) : (
                                <>
                                    <Save size={18} /> Confirmar Criação
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
