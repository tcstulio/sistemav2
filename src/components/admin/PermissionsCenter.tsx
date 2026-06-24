import React, { useEffect, useMemo, useState } from 'react';
import { ShieldCheck, Monitor, Bot, History, Search, User } from 'lucide-react';
import { useDolibarr } from '../../context/DolibarrContext';
import { DolibarrService } from '../../services/dolibarrService';
import { DolibarrUser } from '../../types';
import { Spinner } from '../ui';
import { ScreenAccessMatrix } from './ScreenAccessMatrix';
import { UserPermissionsEditor } from './UserPermissionsEditor';
import { AuditLog } from './AuditLog';
import { RestrictedAccess } from '../RestrictedAccess';

type Tab = 'screens' | 'agent' | 'audit';

// Aba Agente: escolhe uma PESSOA e configura o que o assistente pode fazer em nome dela.
// O store do agente é per-user (extrafield Dolibarr), separado do VER — save próprio.
const AgentTab: React.FC<{ config: any; themeColor: string }> = ({ config, themeColor }) => {
    const [users, setUsers] = useState<DolibarrUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [selId, setSelId] = useState('');

    useEffect(() => {
        let cancelled = false;
        DolibarrService.fetchUsers(config)
            .then((u) => { if (!cancelled) setUsers((u || []).filter((x) => x.statut === '1' || x.statut === undefined)); })
            .catch(() => { })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [config]);

    const q = search.trim().toLowerCase();
    const filtered = useMemo(() => users.filter((u) =>
        !q || (u.login || '').toLowerCase().includes(q) || `${u.firstname || ''} ${u.lastname || ''}`.toLowerCase().includes(q)
    ).slice(0, 60), [users, q]);

    if (loading) return <div className="flex justify-center py-10"><Spinner /></div>;

    return (
        <div className="grid md:grid-cols-[260px_1fr] gap-4">
            <div className="border dark:border-slate-700 rounded-lg overflow-hidden">
                <div className="relative p-2 border-b dark:border-slate-700">
                    <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar pessoa…" className="w-full pl-7 pr-2 py-1.5 text-sm border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" />
                </div>
                <div className="max-h-[60vh] overflow-y-auto">
                    {filtered.map((u) => {
                        const label = u.login || `${u.firstname || ''} ${u.lastname || ''}`.trim() || `Usuário ${u.id}`;
                        return (
                            <button key={u.id} onClick={() => setSelId(String(u.id))} className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left border-b dark:border-slate-800 ${selId === String(u.id) ? `bg-${themeColor}-50 dark:bg-${themeColor}-900/30 text-${themeColor}-700 dark:text-${themeColor}-300 font-medium` : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                                <User size={14} className="shrink-0 text-slate-400" /> <span className="truncate">{label}</span>
                            </button>
                        );
                    })}
                    {filtered.length === 0 && <p className="text-xs text-slate-400 text-center py-4">Nenhuma pessoa.</p>}
                </div>
            </div>
            <div>
                {selId
                    ? <UserPermissionsEditor userId={selId} />
                    : <div className="text-sm text-slate-500 py-10 text-center border border-dashed dark:border-slate-700 rounded-lg">Selecione uma pessoa para configurar as permissões do <strong>agente</strong> (o que o assistente pode criar/editar/excluir em nome dela).</div>}
            </div>
        </div>
    );
};

// Central Única de Permissões. Reúne VER (matriz de telas), FAZER do AGENTE (per-user) e Auditoria.
const PermissionsCenter: React.FC<{ config?: any }> = () => {
    const { config, currentUser } = useDolibarr();
    const isAdmin = currentUser?.admin === 1 || currentUser?.admin === '1' || (currentUser?.admin as unknown) === true;
    const themeColor = config?.themeColor || 'indigo';
    const [tab, setTab] = useState<Tab>('screens');

    if (!isAdmin) return <RestrictedAccess view="central de permissões" />;

    const TabBtn: React.FC<{ id: Tab; icon: React.ReactNode; label: string }> = ({ id, icon, label }) => (
        <button onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${tab === id ? `border-${themeColor}-500 text-${themeColor}-600 dark:text-${themeColor}-400` : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}>
            {icon} {label}
        </button>
    );

    return (
        <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
            <div className="flex items-center gap-2 mb-1">
                <ShieldCheck size={22} className={`text-${themeColor}-600`} />
                <h1 className="text-xl font-bold text-slate-900 dark:text-white">Central de Permissões</h1>
            </div>
            <p className="text-sm text-slate-500 mb-4">Controle, num só lugar, o que cada grupo e pessoa pode ver e fazer no sistema.</p>

            <div className="flex gap-1 border-b dark:border-slate-800 mb-4 overflow-x-auto">
                <TabBtn id="screens" icon={<Monitor size={15} />} label="Telas (Ver)" />
                <TabBtn id="agent" icon={<Bot size={15} />} label="Agente" />
                <TabBtn id="audit" icon={<History size={15} />} label="Auditoria" />
            </div>

            {tab === 'screens' && <ScreenAccessMatrix isAdmin={isAdmin} themeColor={themeColor} />}
            {tab === 'agent' && <AgentTab config={config} themeColor={themeColor} />}
            {tab === 'audit' && <AuditLog />}
        </div>
    );
};

export default PermissionsCenter;
