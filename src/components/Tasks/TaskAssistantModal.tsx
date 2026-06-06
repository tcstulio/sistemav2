import React, { useState, useEffect, useMemo } from 'react';
import { Task, Project, DolibarrUser, TaskTimeLog } from '../../types';
import { AiService } from '../../services/aiService';
import { X, Sparkles, AlertTriangle, CheckCircle2, TrendingUp, Users, Calendar, ArrowRight, Filter, RefreshCw, ChevronRight, User, Search, History, FileText } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { format, subDays, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface TaskAssistantModalProps {
    tasks: Task[];
    projects: Project[];
    users: DolibarrUser[];
    timeLogs?: TaskTimeLog[]; // Added prop
    currentUser: DolibarrUser | null;
    onClose: () => void;
}

type WizardStep = 'scope' | 'type' | 'result';
type AnalysisType = 'overload' | 'progress' | 'comparison' | 'general' | 'history';
type DateRangePreset = 'all' | '30days' | 'month' | 'custom';

export const TaskAssistantModal: React.FC<TaskAssistantModalProps> = ({
    tasks, projects, users, timeLogs = [], currentUser, onClose
}) => {
    // Wizard State
    const [currentStep, setCurrentStep] = useState<WizardStep>('scope');
    const [isLoading, setIsLoading] = useState(false);
    const [result, setResult] = useState<string | null>(null);

    // Filter State
    const [selectedProjectId, setSelectedProjectId] = useState<string>('all');
    const [projectSearch, setProjectSearch] = useState('');
    const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
    const [userSearch, setUserSearch] = useState('');
    const [datePreset, setDatePreset] = useState<DateRangePreset>('30days');
    const [customStartDate, setCustomStartDate] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
    const [customEndDate, setCustomEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));

    // Analysis State
    const [selectedType, setSelectedType] = useState<AnalysisType | null>(null);

    // Initialize with current user selected by default
    useEffect(() => {
        if (currentUser && selectedUserIds.length === 0) {
            setSelectedUserIds([currentUser.id]);
        }
    }, [currentUser]);

    // Update dates on preset change
    useEffect(() => {
        const now = new Date();
        if (datePreset === '30days') {
            setCustomStartDate(format(subDays(now, 30), 'yyyy-MM-dd'));
            setCustomEndDate(format(now, 'yyyy-MM-dd'));
        } else if (datePreset === 'month') {
            setCustomStartDate(format(startOfMonth(now), 'yyyy-MM-dd'));
            setCustomEndDate(format(endOfMonth(now), 'yyyy-MM-dd'));
        }
    }, [datePreset]);


    // Filter Logic
    const filteredContext = useMemo(() => {
        let filteredTasks = tasks;

        // 1. Filter by Date
        if (datePreset !== 'all') {
            const startStr = customStartDate + 'T00:00:00';
            const endStr = customEndDate + 'T23:59:59';
            const startTs = new Date(startStr).getTime() / 1000;
            const endTs = new Date(endStr).getTime() / 1000;

            filteredTasks = filteredTasks.filter(t => {
                const relevantDate = t.date_end ? Number(t.date_end) : Number(t.date_creation);
                if (!relevantDate) return false;
                return relevantDate >= startTs && relevantDate <= endTs;
            });
        }

        // 2. Filter by Project
        if (selectedProjectId !== 'all') {
            filteredTasks = filteredTasks.filter(t => String(t.project_id) === String(selectedProjectId));
        }

        // 3. Filter by Users
        const isAllUsersSelected = selectedUserIds.includes('all') || (selectedUserIds.length > 0 && selectedUserIds.length >= users.length);

        if (!isAllUsersSelected && selectedUserIds.length > 0) {
            filteredTasks = filteredTasks.filter(t => {
                if (!t.fk_user_assign) return false;
                return selectedUserIds.map(String).includes(String(t.fk_user_assign));
            });
        }

        return filteredTasks;
    }, [tasks, selectedProjectId, selectedUserIds, datePreset, customStartDate, customEndDate, users.length]);

    // Derived Lists for UI
    const displayedProjects = useMemo(() => {
        if (!projectSearch) return projects;
        return projects.filter(p => p.title.toLowerCase().includes(projectSearch.toLowerCase()) || p.ref.toLowerCase().includes(projectSearch.toLowerCase()));
    }, [projects, projectSearch]);

    const displayedUsers = useMemo(() => {
        if (!userSearch) return users;
        return users.filter(u =>
            (u.firstname || '').toLowerCase().includes(userSearch.toLowerCase()) ||
            (u.login || '').toLowerCase().includes(userSearch.toLowerCase())
        );
    }, [users, userSearch]);


    // Analysis Handler
    const handleAnalyze = async (type: AnalysisType) => {
        setSelectedType(type);
        setCurrentStep('result');
        setIsLoading(true);

        try {
            const relevantProjects = projects.filter(p =>
                selectedProjectId === 'all' || p.id === selectedProjectId
            ).slice(0, 15);

            const relevantUsers = users.filter(u => selectedUserIds.includes(u.id));

            let prompt = "";

            if (type === 'history') {
                // Special History Logic
                const startStr = customStartDate + 'T00:00:00';
                const endStr = customEndDate + 'T23:59:59';
                const startTs = new Date(startStr).getTime() / 1000;
                const endTs = new Date(endStr).getTime() / 1000;

                // Filter Logs
                // We use 'timeLogs' prop which contains ALL logs ideally, or logs from dashboard context.
                // We must filter them by the wizard's date/user/project selection.
                const filteredLogs = timeLogs.filter(l => {
                    const lDate = new Date(l.date).getTime() / 1000;
                    const dateOk = datePreset === 'all' || (lDate >= startTs && lDate <= endTs);

                    // User check:
                    // If 'all' selected in Wizard or if user ID matches one of selection
                    const isAllUsers = selectedUserIds.includes('all') || selectedUserIds.length === 0; // if empty, maybe default to currentUser? No, setup effect handles defaults.
                    const userOk = isAllUsers || selectedUserIds.includes(l.user_id || '');

                    // Project Filter via Task
                    if (!dateOk || !userOk) return false;

                    if (selectedProjectId === 'all') return true;
                    const task = tasks.find(t => t.id === l.task_id);
                    return task?.project_id === selectedProjectId;
                }).sort((a, b) => b.date - a.date).slice(0, 50); // Limit to recent 50 logs for context

                const logsText = filteredLogs.map(l => {
                    const task = tasks.find(t => t.id === l.task_id);
                    const user = users.find(u => u.id === l.user_id);
                    const taskDesc = task?.description ? task.description.replace(/<[^>]*>/g, '').substring(0, 150) : ''; // Strip HTML, truncate
                    const durationStr = (l.duration / 3600).toFixed(1) + 'h';

                    return `- [${new Date(l.date).toLocaleDateString()}] ${user?.firstname}: ${task?.label || 'Tarefa Desconhecida'} (${durationStr}).\n  Nota Log: "${l.note || ''}"\n  Desc. Tarefa: "${taskDesc}..."`;
                }).join('\n\n');

                prompt = `
                [DADOS DE HISTÓRICO DE TRABALHO]
                Período Análise: ${datePreset === 'all' ? 'Tudo' : `${customStartDate} a ${customEndDate}`}
                Projeto: ${selectedProjectId === 'all' ? 'Todos' : projects.find(p => p.id === selectedProjectId)?.title}
                
                [REGISTROS DE ATIVIDADE (LOGS)]
                ${logsText || "Nenhum apontamento de horas encontrado neste período."}

                [INSTRUÇÃO]
                Analise detalhadamente o histórico de trabalho acima.
                1. Resuma cronologicamente o que foi realizado, citando as notas dos logs.
                2. Verifique se o trabalho descrito nos logs condiz com a descrição da tarefa.
                3. Identifique padrões de produtividade ou foco excessivo em tarefas específicas.
                Use Markdown.
                `;

            } else {
                // Standard Task Analysis
                const tasksSample = filteredContext.slice(0, 30);

                let instruction = "";
                switch (type) {
                    case 'overload': instruction = "Identifique gargalos, pessoas sobrecarregadas e riscos."; break;
                    case 'progress': instruction = "Gere um resumo executivo do progresso."; break;
                    case 'comparison': instruction = "Compare o desempenho entre os usuários."; break;
                    default: instruction = "Faça uma análise geral.";
                }

                prompt = `
                [DADOS]
                Período: ${datePreset === 'all' ? 'Tudo' : `${customStartDate} a ${customEndDate}`}
                Usuários: ${relevantUsers.map(u => u.firstname).join(', ')}
                Projeto: ${selectedProjectId === 'all' ? 'Todos' : projects.find(p => p.id === selectedProjectId)?.title}
                
                [ESTATÍSTICAS]
                Total: ${filteredContext.length} | Concluídas: ${filteredContext.filter(t => (t.progress || 0) === 100).length}

                [AMOSTRA TAREFAS]
                ${JSON.stringify(tasksSample.map(t => ({
                    ref: t.ref, label: t.label, status: t.progress + '%', priority: t.priority,
                    deadline: t.date_end ? new Date(t.date_end * 1000).toLocaleDateString() : 'N/A',
                    assignee: users.find(u => u.id === t.fk_user_assign)?.firstname || 'N/A'
                })))}

                [INSTRUÇÃO]
                ${instruction}
                Markdown.
                `;
            }

            const responseRaw = await AiService.chatWithData(prompt, []);
            const response = typeof responseRaw === 'string' ? responseRaw : responseRaw?.reply;
            setResult(response);

        } catch (error) {
            setResult("Falha ao gerar análise. Tente novamente.");
        } finally {
            setIsLoading(false);
        }
    };

    const toggleUser = (userId: string) => {
        if (userId === 'all') {
            if (selectedUserIds.includes('all')) setSelectedUserIds([]);
            else setSelectedUserIds(users.map(u => u.id));
            return;
        }

        setSelectedUserIds(prev => {
            if (prev.includes(userId)) return prev.filter(id => id !== userId);
            return [...prev, userId];
        });
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-800">
                {/* Header */}
                <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-4 px-6 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="bg-indigo-100 dark:bg-indigo-900/50 p-2 rounded-lg">
                            <Sparkles className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-800 dark:text-white">Assistente de Análise</h2>
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                                <span className={currentStep === 'scope' ? 'text-indigo-600 font-bold' : ''}>1. Configuração</span>
                                <ChevronRight size={12} />
                                <span className={currentStep === 'type' ? 'text-indigo-600 font-bold' : ''}>2. Objetivo</span>
                                <ChevronRight size={12} />
                                <span className={currentStep === 'result' ? 'text-indigo-600 font-bold' : ''}>3. Análise</span>
                            </div>
                        </div>
                    </div>
                    <button onClick={onClose} className="hover:bg-slate-100 dark:hover:bg-slate-800 p-2 rounded-full transition-colors text-slate-500">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950/50">

                    {/* STEP 1: SCOPE */}
                    {currentStep === 'scope' && (
                        <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">

                            {/* Project Filter */}
                            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                                <h3 className="font-semibold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                                    <TrendingUp size={18} className="text-indigo-500" /> Qual o contexto?
                                </h3>
                                <div className="space-y-3">
                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                                        <input
                                            type="text"
                                            placeholder="Filtrar projetos..."
                                            value={projectSearch}
                                            onChange={e => setProjectSearch(e.target.value)}
                                            className="w-full pl-9 p-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                                        />
                                    </div>
                                    <select
                                        className="w-full p-3 bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                                        value={selectedProjectId}
                                        onChange={e => setSelectedProjectId(e.target.value)}
                                        size={5} // Show multiple lines to make it easier with search
                                    >
                                        <option value="all" className="p-2 font-medium">Todos os Projetos</option>
                                        {displayedProjects.map(p => (
                                            <option key={p.id} value={p.id} className="p-2">{p.title} ({p.ref})</option>
                                        ))}
                                        {displayedProjects.length === 0 && <option disabled className="p-2 text-slate-400">Nenhum projeto encontrado</option>}
                                    </select>
                                    <p className="text-xs text-slate-400">Selecione um projeto acima. Use a busca para filtrar a lista.</p>
                                </div>
                            </div>

                            {/* User Filter */}
                            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                                        <Users size={18} className="text-indigo-500" /> Quem analisar?
                                    </h3>
                                    <div className="relative w-48">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-3 h-3" />
                                        <input
                                            type="text"
                                            placeholder="Buscar pessoas..."
                                            value={userSearch}
                                            onChange={e => setUserSearch(e.target.value)}
                                            className="w-full pl-8 p-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md outline-none focus:ring-2 focus:ring-indigo-500"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-48 overflow-y-auto custom-scrollbar">
                                    {displayedUsers.map(u => (
                                        <label key={u.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${selectedUserIds.includes(u.id) ? 'bg-indigo-50 border-indigo-200 dark:bg-indigo-900/20 dark:border-indigo-800' : 'bg-slate-50 border-slate-100 dark:bg-slate-800 dark:border-slate-700 hover:border-slate-300'}`}>
                                            <div className={`w-4 h-4 rounded border flex items-center justify-center ${selectedUserIds.includes(u.id) ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-slate-300'}`}>
                                                {selectedUserIds.includes(u.id) && <CheckCircle2 size={12} className="text-white" />}
                                            </div>
                                            <input
                                                type="checkbox"
                                                className="hidden"
                                                checked={selectedUserIds.includes(u.id)}
                                                onChange={() => toggleUser(u.id)}
                                            />
                                            <span className="text-sm truncate">{u.firstname || u.login}</span>
                                        </label>
                                    ))}
                                    {displayedUsers.length === 0 && (
                                        <div className="col-span-3 text-center py-4 text-slate-400 text-sm">
                                            Ninguém encontrado com esse nome.
                                        </div>
                                    )}
                                </div>
                                <div className="mt-3 flex gap-2">
                                    <button onClick={() => setSelectedUserIds(users.map(u => u.id))} className="text-xs text-indigo-600 hover:underline">Selecionar Todos</button>
                                    <span className="text-slate-300">|</span>
                                    <button onClick={() => setSelectedUserIds([])} className="text-xs text-slate-500 hover:underline">Limpar</button>
                                </div>
                            </div>

                            {/* Date Filter */}
                            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                                <h3 className="font-semibold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                                    <Calendar size={18} className="text-indigo-500" /> Período
                                </h3>
                                <div className="flex flex-wrap gap-2 mb-4">
                                    {[
                                        { id: '30days', label: 'Últimos 30 Dias' },
                                        { id: 'month', label: 'Este Mês' },
                                        { id: 'all', label: 'Todo o Período' },
                                        { id: 'custom', label: 'Personalizado' },
                                    ].map(opt => (
                                        <button
                                            key={opt.id}
                                            onClick={() => setDatePreset(opt.id as DateRangePreset)}
                                            className={`px-3 py-1.5 text-sm rounded-full border transition-all ${datePreset === opt.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'}`}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                                {datePreset !== 'all' && (
                                    <div className="flex items-center gap-4 animate-in fade-in slide-in-from-top-2">
                                        <input
                                            type="date"
                                            value={customStartDate}
                                            onChange={e => { setCustomStartDate(e.target.value); setDatePreset('custom'); }}
                                            className="p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                        />
                                        <span className="text-slate-400">até</span>
                                        <input
                                            type="date"
                                            value={customEndDate}
                                            onChange={e => { setCustomEndDate(e.target.value); setDatePreset('custom'); }}
                                            className="p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                        />
                                    </div>
                                )}
                            </div>

                        </div>
                    )}

                    {/* STEP 2: TYPE */}
                    {currentStep === 'type' && (
                        <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                            <div className="text-center mb-8">
                                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">O que você deseja descobrir?</h3>
                                <p className="text-slate-500">Selecione o tipo de análise para os <strong className="text-indigo-600">{filteredContext.length}</strong> itens filtrados.</p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4"> {/* Changed to 2 cols for better layout with 4 items */}
                                <button onClick={() => handleAnalyze('overload')} className="group p-6 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-indigo-500 dark:hover:border-indigo-500 shadow-sm hover:shadow-md transition-all text-left">
                                    <div className="bg-red-100 w-12 h-12 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                        <AlertTriangle className="text-red-600" />
                                    </div>
                                    <h4 className="font-bold text-slate-900 dark:text-white mb-2">Sobrecarga & Riscos</h4>
                                    <p className="text-sm text-slate-500">Identifique quem está com muitas tarefas, prazos estourados e gargalos.</p>
                                </button>

                                <button onClick={() => handleAnalyze('progress')} className="group p-6 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-indigo-500 dark:hover:border-indigo-500 shadow-sm hover:shadow-md transition-all text-left">
                                    <div className="bg-blue-100 w-12 h-12 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                        <TrendingUp className="text-blue-600" />
                                    </div>
                                    <h4 className="font-bold text-slate-900 dark:text-white mb-2">Resumo de Progresso</h4>
                                    <p className="text-sm text-slate-500">Visão executiva do que foi entregue, o que está em andamento e previsões.</p>
                                </button>

                                <button onClick={() => handleAnalyze('comparison')} className="group p-6 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-indigo-500 dark:hover:border-indigo-500 shadow-sm hover:shadow-md transition-all text-left">
                                    <div className="bg-purple-100 w-12 h-12 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                        <Users className="text-purple-600" />
                                    </div>
                                    <h4 className="font-bold text-slate-900 dark:text-white mb-2">Comparativo</h4>
                                    <p className="text-sm text-slate-500">Compare desempenho entre membros da equipe ou projetos selecionados.</p>
                                </button>

                                <button onClick={() => handleAnalyze('history')} className="group p-6 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-green-500 dark:hover:border-green-500 shadow-sm hover:shadow-md transition-all text-left">
                                    <div className="bg-green-100 w-12 h-12 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                        <History className="text-green-600" />
                                    </div>
                                    <h4 className="font-bold text-slate-900 dark:text-white mb-2">Histórico de Trabalho</h4>
                                    <p className="text-sm text-slate-500">Análise detalhada do que foi feito, notas de logs e cronologia.</p>
                                </button>
                            </div>
                        </div>
                    )}

                    {/* STEP 3: RESULT */}
                    {currentStep === 'result' && (
                        <div className="h-full flex flex-col animate-in slide-in-from-right-4 duration-300">
                            {isLoading ? (
                                <div className="flex-1 flex flex-col items-center justify-center text-center p-12">
                                    <div className="relative">
                                        <div className="w-16 h-16 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <Sparkles size={20} className="text-indigo-600 animate-pulse" />
                                        </div>
                                    </div>
                                    <h3 className="mt-8 text-lg font-semibold text-slate-900 dark:text-white">Analisando {filteredContext.length} Tarefas...</h3>
                                    <p className="text-slate-500 mt-2 max-w-md">Estou cruzando dados de prazos, alocações e histórico para gerar seu relatório.</p>
                                </div>
                            ) : (
                                <div className="flex-1 flex flex-col h-full">
                                    <div className="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-xl border border-indigo-100 dark:border-indigo-800 mb-6 flex items-start gap-4">
                                        <Sparkles className="shrink-0 text-indigo-600 mt-1" />
                                        <div className="flex-1 prose dark:prose-invert max-w-none text-sm text-slate-800 dark:text-slate-200 custom-scrollbar overflow-y-auto max-h-[60vh]">
                                            <ReactMarkdown>{result || "Sem dados."}</ReactMarkdown>
                                        </div>
                                    </div>
                                    <div className="flex justify-center mt-auto pt-4 border-t border-slate-200 dark:border-slate-800">
                                        <button
                                            onClick={() => { setCurrentStep('scope'); setResult(null); }}
                                            className="flex items-center gap-2 px-6 py-3 bg-white border border-slate-300 rounded-full hover:bg-slate-50 transition-colors font-medium text-slate-700"
                                        >
                                            <RefreshCw size={16} /> Nova Análise
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                </div>

                {/* Footer Navigation */}
                {currentStep !== 'result' && (
                    <div className="bg-slate-50 dark:bg-slate-900 p-4 px-6 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center">
                        {currentStep === 'type' ? (
                            <button onClick={() => setCurrentStep('scope')} className="text-slate-500 hover:text-indigo-600 font-medium px-4 py-2">
                                Voltar
                            </button>
                        ) : (
                            <div>
                                <p className="text-xs text-slate-400">
                                    {filteredContext.length} tarefas selecionadas
                                </p>
                            </div>
                        )}

                        {currentStep === 'scope' && (
                            <button
                                onClick={() => setCurrentStep('type')}
                                disabled={filteredContext.length === 0}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-lg font-medium shadow-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                                Continuar <ArrowRight size={16} />
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
