import React, { useEffect, useState } from 'react';
import { History, RefreshCw, Loader2, AlertTriangle } from 'lucide-react';
import { getAuditLog, type AdminAuditEntry } from '../../services/adminPermissionsService';

const ACTION_LABELS: Record<string, string> = {
    'user.permissions.update': 'Permissões do agente',
    'ui-config.update': 'Config de UI',
    'ui-config.screen-permissions': 'Permissões de tela',
};

function fmtTs(ts: number): string {
    try {
        return new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    } catch {
        return String(ts);
    }
}

export const AuditLog: React.FC<{ config?: unknown }> = () => {
    const [entries, setEntries] = useState<AdminAuditEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = () => {
        setLoading(true);
        setError(null);
        getAuditLog({ limit: 200 })
            .then(setEntries)
            .catch((e) => setError(e?.response?.data?.error || e.message || 'Falha ao carregar auditoria'))
            .finally(() => setLoading(false));
    };

    useEffect(load, []);

    return (
        <div className="p-4 sm:p-6 max-w-5xl mx-auto">
            <div className="flex items-center justify-between mb-4">
                <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800 dark:text-white">
                    <History size={20} /> Auditoria de Administração
                </h2>
                <button
                    onClick={load}
                    disabled={loading}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
                >
                    {loading ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
                    Atualizar
                </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                Registro de alterações administrativas (permissões, configuração da organização). Mais recentes primeiro.
            </p>

            {error && (
                <div className="flex items-center gap-2 p-4 text-red-600 dark:text-red-400">
                    <AlertTriangle size={18} /> {error}
                </div>
            )}

            {!error && !loading && entries.length === 0 && (
                <div className="p-6 text-center text-slate-500 dark:text-slate-400">Nenhuma ação registrada ainda.</div>
            )}

            {entries.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 dark:bg-slate-800/50">
                            <tr>
                                <th className="text-left px-3 py-2 font-medium text-slate-600 dark:text-slate-300">Quando</th>
                                <th className="text-left px-3 py-2 font-medium text-slate-600 dark:text-slate-300">Admin</th>
                                <th className="text-left px-3 py-2 font-medium text-slate-600 dark:text-slate-300">Ação</th>
                                <th className="text-left px-3 py-2 font-medium text-slate-600 dark:text-slate-300">Detalhe</th>
                            </tr>
                        </thead>
                        <tbody>
                            {entries.map((e) => (
                                <tr key={e.id} className="border-t border-slate-100 dark:border-slate-700/50 align-top">
                                    <td className="px-3 py-2 whitespace-nowrap text-slate-500 dark:text-slate-400">{fmtTs(e.ts)}</td>
                                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{e.adminLogin}</td>
                                    <td className="px-3 py-2">
                                        <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                                            {ACTION_LABELS[e.action] || e.action}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                                        {e.summary || (e.target ? `alvo: ${e.target}` : '—')}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};
