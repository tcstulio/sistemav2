import React, { useState, useEffect } from 'react';
import { Save, RefreshCw, Cpu, Server, CheckCircle, AlertTriangle, List } from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';

// Simplified types for this component
interface LlmConfig {
    provider: 'local' | 'google';
    localUrl?: string; // e.g., http://localhost:11434/v1
    googleKey?: string;
    modelName?: string;
}

export const LlmSettingsTab: React.FC = () => {
    const [config, setConfig] = useState<LlmConfig>({
        provider: 'local',
        localUrl: 'http://localhost:11434/v1',
        modelName: 'llama3'
    });
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isFetchingModels, setIsFetchingModels] = useState(false);
    const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');

    useEffect(() => {
        loadConfig();
    }, []);

    const loadConfig = async () => {
        setIsLoading(true);
        try {
            // Get Key from Context/Storage correctly
            const savedConfigObj = JSON.parse(localStorage.getItem('doligen_config') || '{}');
            const token = savedConfigObj.apiKey || '';

            // Fetch from backend
            const response = await axios.get('/api/admin/config/llm', {
                headers: {
                    'Authorization': 'Bearer ' + token
                }
            });
            const data = response.data;
            setConfig({
                provider: data.configProvider || 'local',
                localUrl: data.localUrl || 'http://localhost:11434/v1',
                googleKey: '',
                modelName: data.localModelName || 'llama3'
            });

            // If local, fetch models
            if (data.configProvider === 'local') {
                fetchModels();
            }

        } catch (e: any) {
            console.error("Failed to load config", e);
            toast.error("Erro ao carregar configurações LLM");
        } finally {
            setIsLoading(false);
        }
    };

    const fetchModels = async () => {
        setIsFetchingModels(true);
        try {
            const savedConfigObj = JSON.parse(localStorage.getItem('doligen_config') || '{}');
            const token = savedConfigObj.apiKey || '';
            const response = await axios.get('/api/admin/config/llm/models', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (response.data && response.data.models) {
                setAvailableModels(response.data.models);
                console.log("Models fetched:", response.data.models);
            }
        } catch (e) {
            console.error("Failed to fetch models", e);
            // toast.error("Não foi possível listar modelos do servidor.");
        } finally {
            setIsFetchingModels(false);
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        setStatus('idle');
        try {
            const savedConfigObj = JSON.parse(localStorage.getItem('doligen_config') || '{}');
            const token = savedConfigObj.apiKey || '';

            await axios.post('/api/admin/config/llm', {
                provider: config.provider,
                url: config.localUrl,
                key: config.googleKey,
                modelName: config.modelName
            }, {
                headers: {
                    'Authorization': 'Bearer ' + token
                }
            });
            setStatus('success');
            toast.success("Configuração salva com sucesso! (Runtime)");
        } catch (e: any) {
            console.error(e);
            setStatus('error');
            toast.error("Erro ao salvar configuração: " + (e.response?.data?.message || e.message));
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="p-6 h-full overflow-y-auto">
            <div className="max-w-2xl mx-auto space-y-8">

                {/* Header */}
                <div>
                    <h2 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                        <Cpu className="text-indigo-500" /> Configuração de IA
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        Escolha o provedor de Inteligência Artificial para o Chatbot e Análise de Sistema.
                    </p>
                </div>

                {/* Provider Selection */}
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-4">Provedor LLM</label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <button
                            onClick={() => setConfig({ ...config, provider: 'local' })}
                            className={`p-4 rounded-lg border-2 text-left transition-all ${config.provider === 'local'
                                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 ring-1 ring-indigo-500'
                                : 'border-slate-200 dark:border-slate-700 hover:border-indigo-300'}`}
                        >
                            <div className="flex items-center gap-3 mb-2">
                                <div className={`p-2 rounded-full ${config.provider === 'local' ? 'bg-indigo-100 dark:bg-indigo-800 text-indigo-600 dark:text-indigo-300' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                                    <Server size={20} />
                                </div>
                                <span className="font-bold text-slate-800 dark:text-white">Local LLM</span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Connect to Ollama, LocalAI, or compatible endpoints. Private & Free.
                            </p>
                        </button>

                        <button
                            onClick={() => setConfig({ ...config, provider: 'google' })}
                            className={`p-4 rounded-lg border-2 text-left transition-all ${config.provider === 'google'
                                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 ring-1 ring-indigo-500'
                                : 'border-slate-200 dark:border-slate-700 hover:border-indigo-300'}`}
                        >
                            <div className="flex items-center gap-3 mb-2">
                                <div className={`p-2 rounded-full ${config.provider === 'google' ? 'bg-indigo-100 dark:bg-indigo-800 text-indigo-600 dark:text-indigo-300' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                                    <Cpu size={20} />
                                </div>
                                <span className="font-bold text-slate-800 dark:text-white">Google Gemini</span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Use Google's Gemini Flash models. Fast & Powerful. Requires API Key.
                            </p>
                        </button>
                    </div>
                </div>

                {/* Settings Form */}
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
                    {config.provider === 'local' ? (
                        <div className="space-y-4 animate-in fade-in">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Local URL (OpenAI Compatible)</label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={config.localUrl}
                                        onChange={(e) => setConfig({ ...config, localUrl: e.target.value })}
                                        className="flex-1 p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm"
                                        placeholder="http://localhost:11434/v1"
                                    />
                                    <button
                                        onClick={fetchModels}
                                        className="px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-slate-600 dark:text-slate-300"
                                        title="Atualizar lista de modelos"
                                    >
                                        <List size={18} className={isFetchingModels ? "animate-spin" : ""} />
                                    </button>
                                </div>
                                <p className="text-xs text-slate-500 mt-1">Ex: http://localhost:11434/v1 (Ollama Default)</p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nome do Modelo</label>
                                <div className="relative">
                                    {availableModels.length > 0 ? (
                                        <select
                                            value={config.modelName || ''}
                                            onChange={(e) => setConfig({ ...config, modelName: e.target.value })}
                                            className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm appearance-none"
                                        >
                                            <option value="">Selecione um modelo...</option>
                                            {availableModels.map(m => (
                                                <option key={m} value={m}>{m}</option>
                                            ))}
                                            <option value="custom">Outro (Digitar manulamente)</option>
                                        </select>
                                    ) : (
                                        <input
                                            type="text"
                                            value={config.modelName}
                                            onChange={(e) => setConfig({ ...config, modelName: e.target.value })}
                                            className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm"
                                            placeholder="llama3"
                                        />
                                    )}
                                </div>
                                <p className="text-xs text-slate-500 mt-1">
                                    {availableModels.length > 0
                                        ? "Modelos detectados automaticamente do servidor."
                                        : "Não foi possível detectar modelos automaticamente. Digite o nome."}
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4 animate-in fade-in">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Google API Key</label>
                                <input
                                    type="password"
                                    value={config.googleKey || ''}
                                    onChange={(e) => setConfig({ ...config, googleKey: e.target.value })}
                                    className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm"
                                    placeholder="AIzaSy..."
                                />
                            </div>
                        </div>
                    )}

                    <div className="mt-6 flex items-center justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                        <button
                            onClick={loadConfig}
                            disabled={isLoading}
                            className="px-4 py-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-sm font-medium flex items-center gap-2"
                        >
                            <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} /> Restaurar
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className={`px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-bold shadow-md transition-all flex items-center gap-2 ${isSaving ? 'opacity-70 cursor-not-allowed' : ''}`}
                        >
                            {isSaving ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
                            Salvar Configuração
                        </button>
                    </div>
                </div>

                {/* Status Feedback */}
                {status === 'success' && (
                    <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg flex items-center gap-3 text-green-700 dark:text-green-300 animate-in slide-in-from-bottom-2">
                        <CheckCircle size={20} />
                        <span className="text-sm font-medium">Configuração aplicada com sucesso! O backend agora usará este provedor.</span>
                    </div>
                )}
                {status === 'error' && (
                    <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-3 text-red-700 dark:text-red-300 animate-in slide-in-from-bottom-2">
                        <AlertTriangle size={20} />
                        <span className="text-sm font-medium">Falha ao salvar configuração. Verifique se o backend está rodando.</span>
                    </div>
                )}

            </div>
        </div>
    );
};
