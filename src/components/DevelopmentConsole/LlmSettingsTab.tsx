import React, { useState, useEffect } from 'react';
import {
    Save, RefreshCw, Cpu, Server, CheckCircle, AlertTriangle, List,
    Play, MessageSquare, Landmark, FileSearch, FileText, Settings2,
    BarChart3, Zap, Clock, DollarSign, AlertCircle, Send, Loader2,
    ChevronRight, Sparkles
} from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';
import { logger } from '../../utils/logger';

const log = logger.child('LlmSettingsTab');

// --- Types ---

interface LlmConfig {
    provider: 'local' | 'google';
    localUrl?: string;
    googleKey?: string;
    modelName?: string;
}

interface ModuleConfig {
    provider: string;
    model: string;
}

interface LlmStats {
    callsToday: number;
    tokensToday: number;
    errors: number;
    lastError: string | null;
    lastCallTime: number;
    currentProvider: string;
    currentModel: string;
    estimatedCost: number;
}

interface TestResult {
    success: boolean;
    provider: string;
    model?: string;
    testResponse?: string;
    availableModels?: string[];
    error?: string;
    suggestion?: string;
    latencyMs?: number;
}

// --- Main Component ---

export const LlmSettingsTab: React.FC = () => {
    // State
    const [activeTab, setActiveTab] = useState<'provider' | 'modules' | 'prompts' | 'monitor' | 'test'>('provider');

    // Provider tab
    const [config, setConfig] = useState<LlmConfig>({
        provider: 'local',
        localUrl: 'http://localhost:11434/v1',
        modelName: 'llama3'
    });
    const [availableModels, setAvailableModels] = useState<string[]>([]); // Global active provider models
    const [localModels, setLocalModels] = useState<string[]>([]);
    const [googleModels, setGoogleModels] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isFetchingModels, setIsFetchingModels] = useState(false);
    const [testResult, setTestResult] = useState<TestResult | null>(null);
    const [isTesting, setIsTesting] = useState(false);

    // Modules tab
    const [moduleConfigs, setModuleConfigs] = useState<Record<string, ModuleConfig>>({});

    // Prompts tab
    const [customPrompts, setCustomPrompts] = useState<Record<string, string>>({});
    const [selectedPrompt, setSelectedPrompt] = useState<string>('system_base');

    // Monitor tab
    const [stats, setStats] = useState<LlmStats | null>(null);

    // Test tab
    const [testPrompt, setTestPrompt] = useState('Olá! Responda com uma piada curta sobre programação.');
    const [testResponse, setTestResponse] = useState('');
    const [isTestingPrompt, setIsTestingPrompt] = useState(false);
    const [testLatency, setTestLatency] = useState(0);

    // Get auth token
    const getToken = () => {
        const savedConfig = JSON.parse(localStorage.getItem('coolgroove_config') || '{}');
        return savedConfig.apiKey || '';
    };

    // Load data on mount
    useEffect(() => {
        loadConfig();
        loadModules();
        loadPrompts();
        loadStats();
    }, []);

    // --- Load Functions ---

    const loadConfig = async () => {
        setIsLoading(true);
        try {
            const response = await axios.get('/api/admin/config/llm', {
                headers: { 'Authorization': 'Bearer ' + getToken() }
            });
            setConfig({
                provider: response.data.configProvider || 'local',
                localUrl: response.data.localUrl || 'http://localhost:11434/v1',
                googleKey: '',
                modelName: response.data.localModelName || (response.data.configProvider === 'google' ? 'gemini-2.0-flash' : 'llama3')
            });
            // Fetch models for whatever provider is configured
            fetchModels(response.data.configProvider || 'local');
        } catch (e) {
            log.error("Failed to load config", e);
        } finally {
            setIsLoading(false);
        }
    };

    const loadModules = async () => {
        try {
            const response = await axios.get('/api/admin/config/llm/modules', {
                headers: { 'Authorization': 'Bearer ' + getToken() }
            });
            setModuleConfigs(response.data);
        } catch (e) {
            log.error("Failed to load modules", e);
        }
    };

    const loadPrompts = async () => {
        try {
            const response = await axios.get('/api/admin/config/llm/prompts', {
                headers: { 'Authorization': 'Bearer ' + getToken() }
            });
            setCustomPrompts(response.data);
        } catch (e) {
            log.error("Failed to load prompts", e);
        }
    };

    const loadStats = async () => {
        try {
            const response = await axios.get('/api/admin/config/llm/stats', {
                headers: { 'Authorization': 'Bearer ' + getToken() }
            });
            setStats(response.data);
        } catch (e) {
            log.error("Failed to load stats", e);
        }
    };

    const fetchModels = async (forProvider?: string) => {
        const targetProvider = forProvider || config.provider;
        setIsFetchingModels(true);
        try {
            const response = await axios.get(`/api/admin/config/llm/models?provider=${targetProvider}`, {
                headers: { 'Authorization': 'Bearer ' + getToken() }
            });

            if (response.data?.models) {
                if (targetProvider === 'local') setLocalModels(response.data.models);
                if (targetProvider === 'google') setGoogleModels(response.data.models);

                // If fetching for current global provider, update main list too
                if (targetProvider === config.provider) {
                    setAvailableModels(response.data.models);
                }
            }
        } catch (e) {
            log.error("Failed to fetch models", e);
            // Fallback for Google if API fails
            if (targetProvider === 'google') {
                const defaults = [
                    'gemini-2.0-flash',
                    'gemini-2.0-flash-lite',
                    'gemini-1.5-flash',
                    'gemini-1.5-flash-8b',
                    'gemini-1.5-pro',
                    'gemini-pro'
                ];
                setGoogleModels(defaults);
                if (config.provider === 'google') setAvailableModels(defaults);
            }
        } finally {
            setIsFetchingModels(false);
        }
    };

    // --- Save Functions ---

    const handleSaveConfig = async () => {
        setIsSaving(true);
        try {
            await axios.post('/api/admin/config/llm', {
                provider: config.provider,
                url: config.localUrl,
                key: config.googleKey,
                modelName: config.modelName
            }, {
                headers: { 'Authorization': 'Bearer ' + getToken() }
            });
            toast.success("Configuração salva com sucesso!");
        } catch (e: any) {
            toast.error("Erro: " + (e.response?.data?.message || e.message));
        } finally {
            setIsSaving(false);
        }
    };

    const handleSaveModules = async () => {
        try {
            await axios.post('/api/admin/config/llm/modules', {
                modules: moduleConfigs
            }, {
                headers: { 'Authorization': 'Bearer ' + getToken() }
            });
            toast.success("Configurações de módulos salvas!");
        } catch (e: any) {
            toast.error("Erro: " + (e.response?.data?.message || e.message));
        }
    };

    const handleSavePrompts = async () => {
        try {
            await axios.post('/api/admin/config/llm/prompts', {
                prompts: customPrompts
            }, {
                headers: { 'Authorization': 'Bearer ' + getToken() }
            });
            toast.success("Prompts salvos!");
        } catch (e: any) {
            toast.error("Erro: " + (e.response?.data?.message || e.message));
        }
    };

    // --- Test Functions ---

    const handleTestConnection = async () => {
        setIsTesting(true);
        setTestResult(null);
        try {
            const response = await axios.post('/api/admin/config/llm/test', {
                provider: config.provider,
                url: config.localUrl,
                model: config.modelName,
                apiKey: config.googleKey
            }, {
                headers: { 'Authorization': 'Bearer ' + getToken() }
            });
            setTestResult(response.data);
            if (response.data.success) {
                toast.success("Conexão bem-sucedida!");
                if (response.data.availableModels?.length > 0) {
                    setAvailableModels(response.data.availableModels);
                }
            } else {
                toast.error(response.data.error || "Falha na conexão");
            }
        } catch (e: any) {
            setTestResult({ success: false, provider: config.provider, error: e.message });
            toast.error("Erro: " + e.message);
        } finally {
            setIsTesting(false);
        }
    };

    const handleTestPrompt = async () => {
        if (!testPrompt.trim()) return;
        setIsTestingPrompt(true);
        setTestResponse('');
        try {
            const response = await axios.post('/api/admin/config/llm/playground', {
                prompt: testPrompt,
                provider: config.provider,
                model: config.modelName
            }, {
                headers: { 'Authorization': 'Bearer ' + getToken() }
            });
            setTestResponse(response.data.response);
            setTestLatency(response.data.latencyMs);
            loadStats(); // Refresh stats
        } catch (e: any) {
            setTestResponse(`Erro: ${e.response?.data?.error || e.message}`);
        } finally {
            setIsTestingPrompt(false);
        }
    };

    // --- Render Tabs ---

    const tabs = [
        { id: 'provider', label: 'Provider', icon: Server },
        { id: 'modules', label: 'Módulos', icon: Settings2 },
        { id: 'test', label: 'Playground', icon: Play },
        { id: 'monitor', label: 'Monitor', icon: BarChart3 },
        { id: 'prompts', label: 'Prompts', icon: FileText }
    ] as const;

    const moduleIcons: Record<string, any> = {
        chat: MessageSquare,
        banking: Landmark,
        system_analysis: FileSearch,
        proposals: FileText
    };

    const moduleLabels: Record<string, string> = {
        chat: 'Chat / Atendimento',
        banking: 'Análise Bancária',
        system_analysis: 'Análise de Sistema',
        proposals: 'Propostas / Projetos'
    };

    const promptLabels: Record<string, string> = {
        system_base: 'Prompt Base do Sistema',
        banking_categorization: 'Categorização Bancária',
        banking_anomalies: 'Detecção de Anomalias',
        chat_signature: 'Assinatura do Chat'
    };

    return (
        <div className="p-6 h-full overflow-y-auto bg-slate-50 dark:bg-slate-950">
            <div className="max-w-4xl mx-auto space-y-6">

                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-3">
                            <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl text-white">
                                <Sparkles size={24} />
                            </div>
                            Central de IA
                        </h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                            Configure provedores, módulos e monitore o uso da IA
                        </p>
                    </div>

                    {/* Current Status Badge */}
                    <div className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                        <div className={`w-2 h-2 rounded-full ${testResult?.success ? 'bg-emerald-500' : 'bg-slate-300'} animate-pulse`} />
                        <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                            {config.provider === 'local' ? 'Local LLM' : 'Google Gemini'}
                        </span>
                        <ChevronRight size={14} className="text-slate-400" />
                        <span className="text-xs font-mono text-slate-500">{config.modelName}</span>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                    {tabs.map(tab => {
                        const Icon = tab.icon;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === tab.id
                                    ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600 dark:text-indigo-400'
                                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                                    }`}
                            >
                                <Icon size={16} />
                                <span className="hidden sm:inline">{tab.label}</span>
                            </button>
                        );
                    })}
                </div>

                {/* Tab Content */}
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">

                    {/* Provider Tab */}
                    {activeTab === 'provider' && (
                        <div className="p-6 space-y-6">
                            {/* Provider Selection */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
                                    Provedor LLM
                                </label>
                                <div className="grid grid-cols-2 gap-4">
                                    <button
                                        onClick={() => {
                                            setConfig({ ...config, provider: 'local', modelName: 'llama3' });
                                            fetchModels('local');
                                        }}
                                        className={`p-4 rounded-xl border-2 text-left transition-all ${config.provider === 'local'
                                            ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                                            : 'border-slate-200 dark:border-slate-700 hover:border-indigo-300'
                                            }`}
                                    >
                                        <div className="flex items-center gap-3 mb-2">
                                            <Server className={config.provider === 'local' ? 'text-indigo-600' : 'text-slate-400'} />
                                            <span className="font-bold text-slate-800 dark:text-white">Local LLM</span>
                                        </div>
                                        <p className="text-xs text-slate-500">Ollama, LM Studio, LocalAI</p>
                                    </button>
                                    <button
                                        onClick={() => {
                                            setConfig({ ...config, provider: 'google', modelName: 'gemini-2.0-flash' });
                                            fetchModels('google');
                                        }}
                                        className={`p-4 rounded-xl border-2 text-left transition-all ${config.provider === 'google'
                                            ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                                            : 'border-slate-200 dark:border-slate-700 hover:border-indigo-300'
                                            }`}
                                    >
                                        <div className="flex items-center gap-3 mb-2">
                                            <Cpu className={config.provider === 'google' ? 'text-indigo-600' : 'text-slate-400'} />
                                            <span className="font-bold text-slate-800 dark:text-white">Google Gemini</span>
                                        </div>
                                        <p className="text-xs text-slate-500">gemini-2.0-flash, gemini-pro</p>
                                    </button>
                                </div>
                            </div>

                            {/* Config Fields */}
                            {config.provider === 'local' ? (
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                            URL do Servidor (OpenAI Compatible)
                                        </label>
                                        <input
                                            type="text"
                                            value={config.localUrl}
                                            onChange={(e) => setConfig({ ...config, localUrl: e.target.value })}
                                            className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 dark:text-white font-mono text-sm"
                                            placeholder="http://localhost:11434/v1"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                            Modelo
                                        </label>
                                        <div className="flex gap-2">
                                            {availableModels.length > 0 ? (
                                                <select
                                                    value={config.modelName}
                                                    onChange={(e) => setConfig({ ...config, modelName: e.target.value })}
                                                    className="flex-1 p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 dark:text-white"
                                                >
                                                    {availableModels.map(m => (
                                                        <option key={m} value={m}>{m}</option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <input
                                                    type="text"
                                                    value={config.modelName}
                                                    onChange={(e) => setConfig({ ...config, modelName: e.target.value })}
                                                    className="flex-1 p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 dark:text-white font-mono text-sm"
                                                    placeholder="llama3"
                                                />
                                            )}
                                            <button
                                                onClick={() => fetchModels()}
                                                className="px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-lg"
                                            >
                                                <List size={18} className={isFetchingModels ? "animate-spin" : ""} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                            Google API Key
                                        </label>
                                        <input
                                            type="password"
                                            value={config.googleKey || ''}
                                            onChange={(e) => setConfig({ ...config, googleKey: e.target.value })}
                                            className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 dark:text-white font-mono text-sm"
                                            placeholder="AIzaSy..."
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                            Modelo Gemini
                                        </label>
                                        <div className="flex gap-2">
                                            {availableModels.length > 0 ? (
                                                <select
                                                    value={config.modelName || 'gemini-2.0-flash'}
                                                    onChange={(e) => setConfig({ ...config, modelName: e.target.value })}
                                                    className="flex-1 p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 dark:text-white"
                                                >
                                                    {availableModels.map(m => (
                                                        <option key={m} value={m}>{m}</option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <input
                                                    type="text"
                                                    value={config.modelName || 'gemini-2.0-flash'}
                                                    onChange={(e) => setConfig({ ...config, modelName: e.target.value })}
                                                    className="flex-1 p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 dark:text-white font-mono text-sm"
                                                    placeholder="gemini-2.0-flash"
                                                />
                                            )}
                                            <button
                                                onClick={() => fetchModels('google')}
                                                className="px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-lg"
                                                title="Buscar modelos disponíveis"
                                            >
                                                <List size={18} className={isFetchingModels ? "animate-spin" : ""} />
                                            </button>
                                        </div>
                                        <p className="text-xs text-slate-500 mt-1">
                                            Clique no botão para buscar modelos disponíveis na sua conta
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Test Connection Result */}
                            {testResult && (
                                <div className={`p-4 rounded-lg border ${testResult.success
                                    ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800'
                                    : 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800'
                                    }`}>
                                    <div className="flex items-center gap-2 mb-2">
                                        {testResult.success ? (
                                            <CheckCircle className="text-emerald-600" size={18} />
                                        ) : (
                                            <AlertTriangle className="text-red-600" size={18} />
                                        )}
                                        <span className={`font-medium ${testResult.success ? 'text-emerald-700' : 'text-red-700'}`}>
                                            {testResult.success ? 'Conexão bem-sucedida!' : 'Falha na conexão'}
                                        </span>
                                    </div>
                                    {testResult.testResponse && (
                                        <p className="text-sm text-slate-600 dark:text-slate-400">
                                            Resposta: "{testResult.testResponse}"
                                        </p>
                                    )}
                                    {testResult.error && (
                                        <p className="text-sm text-red-600">{testResult.error}</p>
                                    )}
                                    {testResult.suggestion && (
                                        <p className="text-xs text-slate-500 mt-1">{testResult.suggestion}</p>
                                    )}
                                </div>
                            )}

                            {/* Actions */}
                            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                                <button
                                    onClick={handleTestConnection}
                                    disabled={isTesting}
                                    className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-lg text-sm font-medium flex items-center gap-2"
                                >
                                    {isTesting ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
                                    Testar Conexão
                                </button>
                                <button
                                    onClick={handleSaveConfig}
                                    disabled={isSaving}
                                    className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-bold flex items-center gap-2"
                                >
                                    {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                    Salvar
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Modules Tab */}
                    {activeTab === 'modules' && (
                        <div className="p-6 space-y-6">
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                Configure qual provedor e modelo usar para cada módulo do sistema.
                            </p>

                            <div className="space-y-4">
                                {Object.entries(moduleConfigs).map(([key, value]) => {
                                    const Icon = moduleIcons[key] || Settings2;
                                    return (
                                        <div key={key} className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700">
                                            <div className="flex items-center gap-3 mb-3">
                                                <Icon size={18} className="text-indigo-600" />
                                                <span className="font-medium text-slate-700 dark:text-slate-300">
                                                    {moduleLabels[key] || key}
                                                </span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <select
                                                    value={value.provider}
                                                    onChange={(e) => {
                                                        const newProvider = e.target.value;
                                                        setModuleConfigs({
                                                            ...moduleConfigs,
                                                            [key]: { ...value, provider: newProvider }
                                                        });
                                                        // Auto-fetch models if list empty for this provider
                                                        if (newProvider === 'local' && localModels.length === 0) fetchModels('local');
                                                        if (newProvider === 'google' && googleModels.length === 0) fetchModels('google');
                                                    }}
                                                    className="p-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm"
                                                >
                                                    <option value="local">Local LLM</option>
                                                    <option value="google">Google Gemini</option>
                                                </select>

                                                <div className="flex gap-2">
                                                    {(value.provider === 'local' ? localModels : googleModels).length > 0 ? (
                                                        <select
                                                            value={value.model}
                                                            onChange={(e) => setModuleConfigs({
                                                                ...moduleConfigs,
                                                                [key]: { ...value, model: e.target.value }
                                                            })}
                                                            className="flex-1 p-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm"
                                                        >
                                                            {(value.provider === 'local' ? localModels : googleModels).map(m => (
                                                                <option key={m} value={m}>{m}</option>
                                                            ))}
                                                        </select>
                                                    ) : (
                                                        <input
                                                            type="text"
                                                            value={value.model}
                                                            onChange={(e) => setModuleConfigs({
                                                                ...moduleConfigs,
                                                                [key]: { ...value, model: e.target.value }
                                                            })}
                                                            className="flex-1 p-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm font-mono"
                                                            placeholder="Nome do modelo"
                                                        />
                                                    )}
                                                    <button
                                                        onClick={() => fetchModels(value.provider)}
                                                        className="px-3 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 rounded-lg"
                                                        title="Buscar modelos"
                                                    >
                                                        <List size={16} className={isFetchingModels ? "animate-spin" : ""} />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="flex justify-end pt-4 border-t border-slate-100 dark:border-slate-800">
                                <button
                                    onClick={handleSaveModules}
                                    className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-bold flex items-center gap-2"
                                >
                                    <Save size={16} />
                                    Salvar Módulos
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Test/Playground Tab */}
                    {activeTab === 'test' && (
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                    Prompt de Teste
                                </label>
                                <textarea
                                    value={testPrompt}
                                    onChange={(e) => setTestPrompt(e.target.value)}
                                    rows={4}
                                    className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 dark:text-white resize-none"
                                    placeholder="Digite seu prompt aqui..."
                                />
                            </div>

                            <div className="flex justify-between items-center">
                                <div className="text-sm text-slate-500">
                                    Usando: <span className="font-mono">{config.provider} / {config.modelName}</span>
                                </div>
                                <button
                                    onClick={handleTestPrompt}
                                    disabled={isTestingPrompt || !testPrompt.trim()}
                                    className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-bold flex items-center gap-2 disabled:opacity-50"
                                >
                                    {isTestingPrompt ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                                    Enviar
                                </button>
                            </div>

                            {testResponse && (
                                <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-medium text-slate-500">Resposta</span>
                                        {testLatency > 0 && (
                                            <span className="text-xs text-slate-400 flex items-center gap-1">
                                                <Clock size={12} /> {testLatency}ms
                                            </span>
                                        )}
                                    </div>
                                    <pre className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-sans">
                                        {testResponse}
                                    </pre>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Monitor Tab */}
                    {activeTab === 'monitor' && (
                        <div className="p-6 space-y-6">
                            <div className="flex justify-between items-center">
                                <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
                                    Estatísticas de Hoje
                                </span>
                                <button
                                    onClick={loadStats}
                                    className="text-sm text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                                >
                                    <RefreshCw size={14} /> Atualizar
                                </button>
                            </div>

                            {stats && (
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl">
                                        <div className="flex items-center gap-2 text-indigo-600 mb-1">
                                            <Zap size={16} />
                                            <span className="text-xs font-medium">Chamadas</span>
                                        </div>
                                        <p className="text-2xl font-bold text-indigo-700 dark:text-indigo-400">
                                            {stats.callsToday}
                                        </p>
                                    </div>
                                    <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl">
                                        <div className="flex items-center gap-2 text-emerald-600 mb-1">
                                            <MessageSquare size={16} />
                                            <span className="text-xs font-medium">Tokens</span>
                                        </div>
                                        <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
                                            {(stats.tokensToday / 1000).toFixed(1)}k
                                        </p>
                                    </div>
                                    <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-xl">
                                        <div className="flex items-center gap-2 text-amber-600 mb-1">
                                            <DollarSign size={16} />
                                            <span className="text-xs font-medium">Custo Est.</span>
                                        </div>
                                        <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">
                                            R$ {stats.estimatedCost.toFixed(2)}
                                        </p>
                                    </div>
                                    <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-xl">
                                        <div className="flex items-center gap-2 text-red-600 mb-1">
                                            <AlertCircle size={16} />
                                            <span className="text-xs font-medium">Erros</span>
                                        </div>
                                        <p className="text-2xl font-bold text-red-700 dark:text-red-400">
                                            {stats.errors}
                                        </p>
                                    </div>
                                </div>
                            )}

                            {stats?.lastError && (
                                <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                                    <p className="text-sm font-medium text-red-700 dark:text-red-400">Último Erro:</p>
                                    <p className="text-sm text-red-600">{stats.lastError}</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Prompts Tab */}
                    {activeTab === 'prompts' && (
                        <div className="p-6 space-y-4">
                            <div className="flex gap-4">
                                <div className="w-1/3 space-y-2">
                                    {Object.keys(customPrompts).map(key => (
                                        <button
                                            key={key}
                                            onClick={() => setSelectedPrompt(key)}
                                            className={`w-full p-3 rounded-lg text-left text-sm transition-all ${selectedPrompt === key
                                                ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 font-medium'
                                                : 'bg-slate-50 dark:bg-slate-800 text-slate-600 hover:bg-slate-100'
                                                }`}
                                        >
                                            {promptLabels[key] || key}
                                        </button>
                                    ))}
                                </div>
                                <div className="flex-1">
                                    <textarea
                                        value={customPrompts[selectedPrompt] || ''}
                                        onChange={(e) => setCustomPrompts({
                                            ...customPrompts,
                                            [selectedPrompt]: e.target.value
                                        })}
                                        rows={8}
                                        className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 dark:text-white resize-none font-mono text-sm"
                                    />
                                </div>
                            </div>

                            <div className="flex justify-end pt-4 border-t border-slate-100 dark:border-slate-800">
                                <button
                                    onClick={handleSavePrompts}
                                    className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-bold flex items-center gap-2"
                                >
                                    <Save size={16} />
                                    Salvar Prompts
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
