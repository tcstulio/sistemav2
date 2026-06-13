import React, { useEffect, useState } from 'react';
import { Shield, Save, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import {
    getUserPermissions,
    updateUserPermissions,
    type AgentPermissions,
} from '../../services/adminPermissionsService';

/** Entidades que o agente pode manipular (alinhadas ao WRITE_TOOLS/ENTITY_MAP do backend). */
const ENTITIES = [
    'invoice', 'order', 'proposal', 'ticket', 'contact', 'event', 'payment',
    'customer', 'supplier', 'project', 'task', 'product', 'intervention', 'contract',
];

const ACTIONS: Array<{ key: keyof Pick<AgentPermissions, 'canCreate' | 'canEdit' | 'canValidate' | 'canDelete'>; label: string }> = [
    { key: 'canCreate', label: 'Criar' },
    { key: 'canEdit', label: 'Editar' },
    { key: 'canValidate', label: 'Validar' },
    { key: 'canDelete', label: 'Excluir' },
];

const FLAGS: Array<{ key: keyof AgentPermissions; label: string }> = [
    { key: 'canSendEmail', label: 'Enviar e-mail' },
    { key: 'canSendWhatsapp', label: 'Enviar WhatsApp' },
    { key: 'canAccessFinancial', label: 'Acessar financeiro' },
    { key: 'canAccessAccounting', label: 'Acessar contabilidade' },
    { key: 'canAccessHR', label: 'Acessar RH' },
    { key: 'canManageWebhooks', label: 'Gerenciar webhooks' },
    { key: 'canCreateIssues', label: 'Criar issues' },
    { key: 'canStartTasks', label: 'Iniciar tasks' },
    { key: 'canMergePRs', label: 'Fazer merge de PRs' },
];

interface Props {
    userId: string;
}

export const UserPermissionsEditor: React.FC<Props> = ({ userId }) => {
    const [agent, setAgent] = useState<AgentPermissions | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        setLoading(true);
        setError(null);
        getUserPermissions(userId)
            .then((p) => { if (active) setAgent(p.agent); })
            .catch((e) => { if (active) setError(e?.response?.data?.error || e.message || 'Falha ao carregar permissões'); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [userId]);

    const toggleEntity = (action: keyof AgentPermissions, entity: string) => {
        setAgent((prev) => {
            if (!prev) return prev;
            const list = (prev[action] as string[]) || [];
            const has = list.includes(entity);
            return { ...prev, [action]: has ? list.filter((e) => e !== entity) : [...list, entity] };
        });
    };

    const setFlag = (key: keyof AgentPermissions, value: boolean) =>
        setAgent((prev) => (prev ? { ...prev, [key]: value } : prev));

    const setCap = (key: 'maxInvoiceAmount' | 'maxOrderAmount', raw: string) =>
        setAgent((prev) => (prev ? { ...prev, [key]: raw.trim() === '' ? null : Math.max(0, Number(raw) || 0) } : prev));

    const setList = (key: 'restrictedCustomers' | 'restrictedProjects', raw: string) =>
        setAgent((prev) => (prev ? { ...prev, [key]: raw.split(',').map((s) => s.trim()).filter(Boolean) } : prev));

    const save = async () => {
        if (!agent) return;
        setSaving(true);
        try {
            const updated = await updateUserPermissions(userId, { agent });
            setAgent(updated.agent);
            toast.success('Permissões do agente salvas');
        } catch (e: any) {
            toast.error(e?.response?.data?.error || e.message || 'Falha ao salvar');
        } finally {
            setSaving(false);
        }
    };

    // Função pura (não-hook): se a lista contém 'all', a entidade inteira está liberada.
    const hasAll = (action: keyof AgentPermissions) => ((agent?.[action] as string[]) || []).includes('all');

    if (loading) {
        return <div className="flex items-center gap-2 p-6 text-slate-500"><Loader2 className="animate-spin" size={18} /> Carregando permissões…</div>;
    }
    if (error) {
        return (
            <div className="flex items-center gap-2 p-6 text-red-600 dark:text-red-400">
                <AlertTriangle size={18} /> {error}
            </div>
        );
    }
    if (!agent) return null;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                    <Shield size={18} />
                    <span className="font-semibold">Permissões do Agente IA</span>
                </div>
                <button
                    onClick={save}
                    disabled={saving}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                    {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                    Salvar
                </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400">
                Define o que o agente pode fazer EM NOME deste usuário. Estes limites são aplicados de fato nas ferramentas
                do agente (criar/editar/validar, valor máximo, clientes permitidos). Admins ignoram os limites.
            </p>

            {/* Matriz entidade × ação */}
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-800/50">
                        <tr>
                            <th className="text-left px-3 py-2 font-medium text-slate-600 dark:text-slate-300">Entidade</th>
                            {ACTIONS.map((a) => (
                                <th key={a.key} className="px-3 py-2 font-medium text-slate-600 dark:text-slate-300 text-center">{a.label}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {ENTITIES.map((entity) => (
                            <tr key={entity} className="border-t border-slate-100 dark:border-slate-700/50">
                                <td className="px-3 py-1.5 text-slate-700 dark:text-slate-200 capitalize">{entity}</td>
                                {ACTIONS.map((a) => (
                                    <td key={a.key} className="px-3 py-1.5 text-center">
                                        <input
                                            type="checkbox"
                                            aria-label={`${a.label} ${entity}`}
                                            disabled={hasAll(a.key)}
                                            checked={hasAll(a.key) || ((agent[a.key] as string[]) || []).includes(entity)}
                                            onChange={() => toggleEntity(a.key, entity)}
                                        />
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Limites de valor */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Valor máx. de fatura (R$) — vazio = sem limite</span>
                    <input
                        type="number" min={0}
                        value={agent.maxInvoiceAmount ?? ''}
                        onChange={(e) => setCap('maxInvoiceAmount', e.target.value)}
                        className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                    />
                </label>
                <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Valor máx. de pedido (R$) — vazio = sem limite</span>
                    <input
                        type="number" min={0}
                        value={agent.maxOrderAmount ?? ''}
                        onChange={(e) => setCap('maxOrderAmount', e.target.value)}
                        className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                    />
                </label>
            </div>

            {/* Allowlists */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Clientes permitidos (IDs, separados por vírgula) — vazio = todos</span>
                    <input
                        type="text"
                        value={agent.restrictedCustomers.join(', ')}
                        onChange={(e) => setList('restrictedCustomers', e.target.value)}
                        placeholder="ex.: 5, 12, 30"
                        className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                    />
                </label>
                <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Projetos permitidos (IDs, separados por vírgula) — vazio = todos</span>
                    <input
                        type="text"
                        value={agent.restrictedProjects.join(', ')}
                        onChange={(e) => setList('restrictedProjects', e.target.value)}
                        placeholder="ex.: 1, 7"
                        className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                    />
                </label>
            </div>

            {/* Flags booleanas */}
            <div>
                <h4 className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-2">Capacidades</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {FLAGS.map((f) => (
                        <label key={f.key} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                            <input
                                type="checkbox"
                                aria-label={f.label}
                                checked={Boolean(agent[f.key])}
                                onChange={(e) => setFlag(f.key, e.target.checked)}
                            />
                            {f.label}
                        </label>
                    ))}
                </div>
            </div>
        </div>
    );
};
