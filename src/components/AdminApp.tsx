import React, { useState, useEffect } from 'react';
import { Layout, Server, Database, Activity, RefreshCw, Power, Lock, Key } from 'lucide-react';
import { toast, Toaster } from 'sonner';
import { useDolibarr } from '../context/DolibarrContext';
import { useConfirm } from '../hooks/useConfirm';
import { notifyError } from '../utils/notifyError';

const AdminApp: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'backend'>('backend');
    const [backendStatus, setBackendStatus] = useState<any>(null);
    const { config } = useDolibarr();
    const confirm = useConfirm();

    // Auth State
    const [adminKey, setAdminKey] = useState('');
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [authError, setAuthError] = useState(false);

    useEffect(() => {
        const savedKey = sessionStorage.getItem('doli_admin_key');
        if (savedKey) {
            setAdminKey(savedKey);
            setIsAuthenticated(true);
        }
    }, []);

    const handleLogin = (e: React.FormEvent) => {
        e.preventDefault();
        if (adminKey.trim().length > 0) {
            sessionStorage.setItem('doli_admin_key', adminKey);
            setIsAuthenticated(true);
            setAuthError(false);
        }
    };

    const handleLogout = () => {
        sessionStorage.removeItem('doli_admin_key');
        setAdminKey('');
        setIsAuthenticated(false);
    };

    const fetchBackendStatus = async () => {
        try {
            // Use the proxy path or direct if configured
            const response = await fetch('/api/admin/status', {
                headers: { 'x-admin-key': adminKey }
            });
            if (response.status === 403) {
                setAuthError(true);
                setIsAuthenticated(false); // Force re-login
                return;
            }
            const data = await response.json();
            setBackendStatus(data);
        } catch (e) {
            setBackendStatus({ error: 'Offline', services: { backend: 'OFFLINE' } });
        }
    };

    const handleRestart = async () => {
        if (!(await confirm({ message: 'Isso tentará reiniciar a conexão do WhatsApp. Confirmar?', danger: true }))) return;
        try {
            const res = await fetch('/api/admin/restart', {
                method: 'POST',
                headers: { 'x-admin-key': adminKey }
            });
            if (res.status === 403) {
                toast.error('Acesso Negado: Chave Inválida');
                return;
            }
            toast.success('Comando enviado.');
            fetchBackendStatus();
        } catch (e) {
            notifyError('Reiniciar WAHA', e);
        }
    };

    useEffect(() => {
        if (isAuthenticated && activeTab === 'backend') {
            fetchBackendStatus();
            const interval = setInterval(fetchBackendStatus, 10000);
            return () => clearInterval(interval);
        }
    }, [activeTab, isAuthenticated]);

    if (!isAuthenticated) {
        return (
            <>
            <Toaster richColors position="bottom-center" />
            <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 text-slate-200">
                <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-xl p-8 shadow-2xl">
                    <div className="text-center mb-8">
                        <div className="w-16 h-16 bg-red-600/20 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Lock size={32} />
                        </div>
                        <h1 className="text-2xl font-bold text-white">Área Restrita</h1>
                        <p className="text-slate-400">Acesso Administrativo ao Sistema</p>
                    </div>

                    <form onSubmit={handleLogin} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1">Chave de Segurança</label>
                            <div className="relative">
                                <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                <input
                                    type="password"
                                    className="w-full bg-slate-950 border border-slate-700 rounded-lg py-3 pl-10 pr-4 text-white focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none transition-all placeholder:text-slate-600"
                                    placeholder="Digite a chave de admin..."
                                    value={adminKey}
                                    onChange={e => setAdminKey(e.target.value)}
                                />
                            </div>
                        </div>

                        {authError && (
                            <div className="p-3 bg-red-900/30 border border-red-900/50 rounded-lg text-red-400 text-sm text-center">
                                Chave incorreta ou sessão expirada.
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={!adminKey}
                            className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-lg transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Entrar no Console
                        </button>
                    </form>

                    <div className="mt-6 text-center">
                        <a href="/" className="text-sm text-slate-500 hover:text-white transition-colors flex items-center justify-center gap-2">
                            <Layout size={14} /> Voltar para Aplicação Principal
                        </a>
                    </div>
                </div>
            </div>
            </>
        );
    }

    return (
            <>
            <Toaster richColors position="bottom-center" />
            <div className="min-h-screen bg-slate-950 text-slate-200 font-sans">
            {/* Admin Header */}
            <header className="bg-black border-b border-slate-800 p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-red-600 rounded flex items-center justify-center font-bold">A</div>
                    <div>
                        <h1 className="font-bold text-lg leading-none">Admin Console</h1>
                        <p className="text-xs text-slate-500">System Management</p>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <div className="text-xs text-slate-500 font-mono hidden md:block">
                        {backendStatus?.system?.platform}
                    </div>
                    <button
                        onClick={handleLogout}
                        className="text-xs bg-slate-800 hover:bg-red-900/30 hover:text-red-400 px-3 py-1.5 rounded transition-colors"
                    >
                        Logout
                    </button>
                </div>
            </header>

            <div className="flex flex-col md:flex-row h-[calc(100vh-64px)] overflow-hidden">
                {/* Sidebar */}
                <aside className="w-full md:w-64 border-b md:border-b-0 md:border-r border-slate-800 bg-slate-950/50 p-2 md:p-4 flex md:flex-col gap-2 shrink-0 overflow-x-auto">
                    <button
                        onClick={() => setActiveTab('backend')}
                        className={`flex-1 md:flex-none flex items-center justify-center md:justify-start gap-3 px-3 py-2 rounded transition-colors whitespace-nowrap ${activeTab === 'backend' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:bg-slate-900'}`}
                    >
                        <Server size={18} /> <span className="hidden md:inline">Backend Status</span><span className="md:hidden">Status</span>
                    </button>

                    <div className="hidden md:block mt-auto border-t border-slate-800 pt-4">
                        <a href="/" className="flex items-center gap-2 text-xs text-slate-500 hover:text-white transition-colors">
                            <Layout size={14} /> Voltar ao ERP
                        </a>
                    </div>
                </aside>

                {/* Content */}
                <main className="flex-1 p-4 md:p-6 overflow-y-auto bg-slate-950">
                    {activeTab === 'backend' && (
                        <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4">
                            <div className="flex items-center justify-between">
                                <h2 className="text-xl font-bold flex items-center gap-2 text-white">
                                    <Server className="text-green-500" /> Estado do Servidor
                                </h2>
                                <button onClick={fetchBackendStatus} className="p-2 hover:bg-slate-800 rounded-full transition-colors text-slate-400 hover:text-white">
                                    <RefreshCw size={18} />
                                </button>
                            </div>

                            {/* Status Cards */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="bg-slate-900 p-6 rounded-xl border border-slate-800 shadow-sm">
                                    <div className="text-slate-400 text-sm mb-1">Backend Uptime</div>
                                    <div className="text-2xl font-mono text-white">
                                        {backendStatus?.uptime ? (backendStatus.uptime / 60).toFixed(2) + ' min' : (backendStatus?.error ? 'OFF' : '--')}
                                    </div>
                                    <div className="mt-2 text-xs text-green-400 flex items-center gap-1">
                                        Port: 3004 {backendStatus?.error && <span className="text-red-500 font-bold">(Desconectado)</span>}
                                    </div>
                                </div>

                                <div className="bg-slate-900 p-6 rounded-xl border border-slate-800 shadow-sm">
                                    <div className="text-slate-400 text-sm mb-1">Memória (RSS)</div>
                                    <div className="text-2xl font-mono text-white">
                                        {backendStatus?.system?.processMem ? (backendStatus.system.processMem / 1024 / 1024).toFixed(0) + ' MB' : '--'}
                                    </div>
                                </div>

                                <div className="bg-slate-900 p-6 rounded-xl border border-slate-800 shadow-sm">
                                    <div className="text-slate-400 text-sm mb-1">WAHA Status</div>
                                    <div className={`text-2xl font-mono ${backendStatus?.services?.waha === 'WORKING' ? 'text-green-400' : 'text-red-400'}`}>
                                        {backendStatus?.services?.waha || '--'}
                                    </div>
                                </div>
                            </div>

                            {/* Controls */}
                            <div className="bg-slate-900 p-6 rounded-xl border border-slate-800 shadow-sm">
                                <h3 className="font-semibold mb-4 text-white">Ações de Controle</h3>
                                <div className="flex flex-wrap gap-4">
                                    <button
                                        onClick={handleRestart}
                                        disabled={!backendStatus || backendStatus.error}
                                        className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <Power size={18} /> Reiniciar Sessão WAHA
                                    </button>
                                </div>
                                <p className="mt-4 text-xs text-slate-500 max-w-lg">
                                    Nota: Reiniciar o backend completo requer acesso ao terminal do servidor. Ações aqui afetam apenas subsistemas que o backend controla diremente.
                                </p>
                            </div>
                        </div>
                    )}
                </main>
            </div>
        </div>
            </>
    );
};

export default AdminApp;
