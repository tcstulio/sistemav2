
import React, { useState, useEffect } from 'react';
import { Database, HardDrive, RefreshCw, Play, Pause, AlertCircle, Download, Trash2 } from 'lucide-react';
import { useDolibarr } from '../../context/DolibarrContext';
import { dbService } from '../../services/dbService';
import { runBackgroundSync } from '../../services/backgroundSyncService';
import { logger } from '../../utils/logger';

const log = logger.child('MonitorTab');

export const MonitorTab: React.FC = () => {
    const { config, refreshData, isLoading: isSyncLoading, isSyncPaused, toggleSyncPause } = useDolibarr();
    const [stats, setStats] = useState<Record<string, number>>({});
    const [storageUsage, setStorageUsage] = useState<number>(0);
    const [isBackgroundSyncing, setIsBackgroundSyncing] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [syncResult, setSyncResult] = useState<{ synced: number; errors: string[] } | null>(null);

    const loadMetrics = async () => {
        const s = await dbService.getStorageStats();
        setStats(s);

        if (navigator.storage && navigator.storage.estimate) {
            const estimate = await navigator.storage.estimate();
            if (estimate.usage) setStorageUsage(estimate.usage);
        }
    };

    const handleBackgroundSync = async () => {
        if (!config || isBackgroundSyncing) return;
        setIsBackgroundSyncing(true);
        setSyncResult(null);
        try {
            const result = await runBackgroundSync(config);
            setSyncResult(result);
            await loadMetrics(); // Refresh stats immediately
        } catch (e) {
            log.error('Background sync failed:', e);
        } finally {
            setIsBackgroundSyncing(false);
        }
    };

    const handleDeleteData = async () => {
        if (isDeleting) return;

        const confirmed = window.confirm(
            '⚠️ ATENÇÃO: Esta ação irá DELETAR COMPLETAMENTE o banco de dados local.\n\n' +
            'Isso inclui todos os registros sincronizados (clientes, faturas, propostas, etc.).\n\n' +
            'A página será recarregada para recriar o banco com todas as tabelas.\n\n' +
            'Você precisará sincronizar novamente após deletar.\n\n' +
            'Deseja continuar?'
        );

        if (!confirmed) return;

        setIsDeleting(true);
        try {
            // Use deleteDatabase instead of clearAll to force recreation of all stores
            // This ensures new stores (like proposalLines, orderLines) are created
            await dbService.deleteDatabase();

            // Reload page to force IndexedDB recreation with all stores
            window.location.reload();
        } catch (e) {
            log.error('Failed to delete local database:', e);
            alert('Erro ao deletar banco de dados local. Verifique o console para mais detalhes.');
            setIsDeleting(false);
        }
        // Note: no finally/setIsDeleting(false) needed as page will reload
    };

    useEffect(() => {
        loadMetrics();
        const interval = setInterval(loadMetrics, 5000);
        return () => clearInterval(interval);
    }, []);

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const form = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + form[i];
    };

    return (
        <div className="p-6 h-full overflow-y-auto bg-slate-50 dark:bg-slate-950/50">
            <div className="max-w-7xl mx-auto space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white dark:bg-slate-900 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg text-blue-600">
                                <Database size={20} />
                            </div>
                            <h3 className="font-semibold text-slate-700 dark:text-slate-200">Registros Locais</h3>
                        </div>
                        <div className="text-2xl font-bold text-slate-900 dark:text-white">
                            {(Object.values(stats) as number[]).reduce((a, b) => a + (b > 0 ? b : 0), 0).toLocaleString()}
                        </div>
                        <p className="text-xs text-slate-500">Itens no banco de dados do navegador</p>
                    </div>

                    <div className="bg-white dark:bg-slate-900 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg text-purple-600">
                                <HardDrive size={20} />
                            </div>
                            <h3 className="font-semibold text-slate-700 dark:text-slate-200">Uso de Disco</h3>
                        </div>
                        <div className="text-2xl font-bold text-slate-900 dark:text-white">
                            {formatBytes(storageUsage)}
                        </div>
                        <p className="text-xs text-slate-500">Espaço ocupado pelo sistema</p>
                    </div>

                    <div className="bg-white dark:bg-slate-900 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 flex flex-col justify-center items-start gap-3">
                        <button
                            onClick={() => refreshData()}
                            disabled={isSyncLoading}
                            className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition"
                        >
                            <RefreshCw size={18} className={isSyncLoading ? "animate-spin" : ""} />
                            {isSyncLoading ? "Sincronizando..." : "Forçar Sincronização"}
                        </button>

                        <button
                            onClick={handleBackgroundSync}
                            disabled={isBackgroundSyncing || !config}
                            className="w-full flex items-center justify-center gap-2 bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700 transition disabled:bg-green-400"
                        >
                            <Download size={18} className={isBackgroundSyncing ? "animate-pulse" : ""} />
                            {isBackgroundSyncing ? "Baixando Todos os Dados..." : "Background Sync Completo"}
                        </button>

                        <button
                            onClick={toggleSyncPause}
                            className={`w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg transition ${isSyncPaused ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'}`}
                        >
                            {isSyncPaused ? <Play size={18} /> : <Pause size={18} />}
                            {isSyncPaused ? "Resumir Sincronização" : "Pausar Sincronização"}
                        </button>

                        <button
                            onClick={handleDeleteData}
                            disabled={isDeleting}
                            className="w-full flex items-center justify-center gap-2 bg-red-600 text-white py-2 px-4 rounded-lg hover:bg-red-700 transition disabled:bg-red-400"
                        >
                            <Trash2 size={18} className={isDeleting ? "animate-pulse" : ""} />
                            {isDeleting ? "Deletando Dados..." : "Limpar Dados Locais"}
                        </button>
                        {syncResult && (
                            <div className={`w-full text-xs p-2 rounded ${syncResult.errors.length > 0 ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/20' : 'bg-green-50 text-green-700 dark:bg-green-900/20'}`}>
                                ✓ {syncResult.synced} registros sincronizados
                                {syncResult.errors.length > 0 && (
                                    <span className="block mt-1">⚠ {syncResult.errors.length} erros (ver console)</span>
                                )}
                            </div>
                        )}

                        {isSyncPaused && (
                            <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded w-full justify-center">
                                <AlertCircle size={12} /> Sync Automático Pausado
                            </div>
                        )}
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
                    <div className="p-4 border-b border-slate-200 dark:border-slate-800 font-semibold text-slate-700 dark:text-slate-200">
                        Detalhes das Tabelas
                    </div>
                    <div className="p-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                        {Object.entries(stats).map(([table, count]) => (
                            table !== 'api_logs' && (
                                <div key={table} className="flex flex-col p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                                    <span className="text-xs uppercase font-bold text-slate-400 mb-1 truncate" title={table}>{table}</span>
                                    <span className="text-xl font-mono text-slate-700 dark:text-slate-200">{(count as number) >= 0 ? count : '-'}</span>
                                </div>
                            )
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};
