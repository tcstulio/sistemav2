
import React, { useState } from 'react';
import { DolibarrConfig } from '../types';
import { Server, ShieldCheck, PlayCircle, Loader2, AlertTriangle, CheckCircle2, Globe, Key, Settings2, Info, ArrowRight, User, Lock, ChevronDown, ChevronUp } from 'lucide-react';
import { DolibarrService } from '../services/dolibarrService';
import { logger } from '../utils/logger';

const log = logger.child('SetupWizard');

interface SetupWizardProps {
    onComplete: (config: DolibarrConfig) => void;
}

const SetupWizard: React.FC<SetupWizardProps> = ({ onComplete }) => {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [form, setForm] = useState({
        apiUrl: 'https://sistema.coolgroove.com.br/api/index.php',
        login: '',
        password: '',
        themeColor: 'indigo'
    });

    const handleConnect = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsLoading(true);

        const url = DolibarrService.sanitizeUrl(form.apiUrl);
        try {
            if (!form.login || !form.password) {
                throw new Error("Por favor, informe Usuário e Senha.");
            }

            // Exchange User/Pass for API Key via Backend
            const authResult = await DolibarrService.login(form.login, form.password);
            const apiKey = authResult.token;

            if (!apiKey) {
                throw new Error("Falha ao obter chave de API.");
            }

            // Verify Connection
            await DolibarrService.checkConnection(url, apiKey);

            // Complete Setup
            onComplete({
                apiUrl: url,
                apiKey: apiKey,
                themeColor: form.themeColor,
                darkMode: false,
                apiLimit: 0,
                currentUser: authResult.user
            });

        } catch (err: any) {
            log.error(err);
            setError(err.message || "Falha na conexão. Verifique suas credenciais.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-[100dvh] w-full bg-slate-50 dark:bg-slate-950 flex flex-col items-center p-4 md:justify-center overflow-y-auto">
            <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 animate-in zoom-in-95 duration-300 shrink-0 mb-10 md:mb-0">

                {/* Left Side: Branding */}
                <div className="bg-indigo-600 p-8 md:p-12 text-white flex flex-col justify-between relative overflow-hidden">
                    <div className="relative z-10">
                        <div className="w-12 h-12 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center mb-6">
                            <ShieldCheck size={32} className="text-white" />
                        </div>
                        <h1 className="text-3xl font-bold mb-2">CoolGroove</h1>
                        <p className="text-indigo-100 text-lg opacity-90">Painel de Gestão</p>
                        <p className="mt-6 text-sm text-indigo-200 leading-relaxed">
                            Acesse seu painel administrativo para gerenciar vendas, clientes e operações com inteligência.
                        </p>
                    </div>

                    <div className="relative z-10 mt-8">
                        <div className="flex gap-2">
                            <div className="w-2 h-2 rounded-full bg-white opacity-100"></div>
                            <div className="w-2 h-2 rounded-full bg-white opacity-50"></div>
                            <div className="w-2 h-2 rounded-full bg-white opacity-50"></div>
                        </div>
                    </div>

                    {/* Decorative Circles */}
                    <div className="absolute -top-24 -right-24 w-64 h-64 bg-indigo-500 rounded-full opacity-50 blur-3xl"></div>
                    <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-indigo-700 rounded-full opacity-50 blur-3xl"></div>
                </div>

                {/* Right Side: content */}
                <div className="p-8 md:p-12 flex flex-col justify-center">

                    <form onSubmit={handleConnect} className="space-y-5 animate-in fade-in slide-in-from-right-4">
                        <div>
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Conectar</h2>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                                Insira suas credenciais de acesso.
                            </p>
                        </div>

                        {error && (
                            <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900 text-red-700 dark:text-red-300 text-sm rounded-lg">
                                <div className="flex items-start gap-2 mb-2">
                                    <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                                    <span className="font-bold">Falha no Login</span>
                                </div>
                                <p className="mb-2 opacity-90">{error}</p>
                            </div>
                        )}

                        <div className="space-y-4">
                            <div className="hidden">
                                {/* Hidden API URL Field - keeping state but hiding if fixed for this system? 
                                        Actually kept visible or read-only if rebranding implies one system 
                                        The user said "Rename system", implied generic tool or specific instance?
                                        "mude o nome do sistema para CoolGroove" -> keeping URL editable for flexibility unless asked otherwise,
                                        but default to the coolgroove one. 
                                     */}
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">URL do Sistema</label>
                                <input
                                    type="url"
                                    required
                                    className="w-full p-2 border rounded"
                                    value={form.apiUrl}
                                    onChange={e => setForm({ ...form, apiUrl: e.target.value })}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Usuário</label>
                                <div className="relative">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                    <input
                                        type="text"
                                        required
                                        autoFocus
                                        placeholder="ex: admin"
                                        className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all dark:text-white"
                                        value={form.login}
                                        onChange={e => setForm({ ...form, login: e.target.value })}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Senha</label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                    <input
                                        type="password"
                                        required
                                        placeholder="••••••••"
                                        className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all dark:text-white"
                                        value={form.password}
                                        onChange={e => setForm({ ...form, password: e.target.value })}
                                    />
                                </div>
                            </div>

                        </div>

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold shadow-lg shadow-indigo-200 dark:shadow-none transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                        >
                            {isLoading ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                            {isLoading ? 'Autenticando...' : 'Entrar'}
                        </button>
                    </form>
                </div>
            </div>

            <p className="mt-8 text-slate-400 text-xs flex items-center gap-1">
                <Settings2 size={12} /> CoolGroove
            </p>
        </div>
    );
};

export default SetupWizard;
