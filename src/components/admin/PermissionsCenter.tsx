import React, { useEffect, useMemo, useState } from 'react';
import { ShieldCheck, Monitor, Bot, History, Search, User, KeyRound, Users } from 'lucide-react';
import { useDolibarr } from '../../context/DolibarrContext';
import { DolibarrService } from '../../services/dolibarrService';
import { DolibarrUser } from '../../types';
import { ThemeColor } from '../../utils/theme';
import { Spinner } from '../ui';
import { ScreenAccessMatrix } from './ScreenAccessMatrix';
import { UserPermissionsEditor } from './UserPermissionsEditor';
import { AuditLog } from './AuditLog';
import { AppAccessTab } from './AppAccessTab';
import GroupManager from './GroupManager';
import { RestrictedAccess } from '../RestrictedAccess';

type Tab = 'screens' | 'groups' | 'access' | 'agent' | 'audit';

/** Mapas estáticos de classes Tailwind por cor de tema (#1100).
 *  Classes listadas literalmente por chave para que o JIT do Tailwind v4 as gere
 *  em build time (interpolações como `bg-${themeColor}-50` não são detectadas). */
export const TAB_ACTIVE_CLASSES: Record<ThemeColor, string> = {
    slate: 'border-slate-500 text-slate-600 dark:text-slate-400',
    gray: 'border-gray-500 text-gray-600 dark:text-gray-400',
    zinc: 'border-zinc-500 text-zinc-600 dark:text-zinc-400',
    neutral: 'border-neutral-500 text-neutral-600 dark:text-neutral-400',
    stone: 'border-stone-500 text-stone-600 dark:text-stone-400',
    red: 'border-red-500 text-red-600 dark:text-red-400',
    orange: 'border-orange-500 text-orange-600 dark:text-orange-400',
    amber: 'border-amber-500 text-amber-600 dark:text-amber-400',
    yellow: 'border-yellow-500 text-yellow-600 dark:text-yellow-400',
    lime: 'border-lime-500 text-lime-600 dark:text-lime-400',
    green: 'border-green-500 text-green-600 dark:text-green-400',
    emerald: 'border-emerald-500 text-emerald-600 dark:text-emerald-400',
    teal: 'border-teal-500 text-teal-600 dark:text-teal-400',
    cyan: 'border-cyan-500 text-cyan-600 dark:text-cyan-400',
    sky: 'border-sky-500 text-sky-600 dark:text-sky-400',
    blue: 'border-blue-500 text-blue-600 dark:text-blue-400',
    indigo: 'border-indigo-500 text-indigo-600 dark:text-indigo-400',
    violet: 'border-violet-500 text-violet-600 dark:text-violet-400',
    purple: 'border-purple-500 text-purple-600 dark:text-purple-400',
    fuchsia: 'border-fuchsia-500 text-fuchsia-600 dark:text-fuchsia-400',
    pink: 'border-pink-500 text-pink-600 dark:text-pink-400',
    rose: 'border-rose-500 text-rose-600 dark:text-rose-400',
};

export const PERSON_ACTIVE_CLASSES: Record<ThemeColor, string> = {
    slate: 'bg-slate-50 dark:bg-slate-900/30 text-slate-700 dark:text-slate-300',
    gray: 'bg-gray-50 dark:bg-gray-900/30 text-gray-700 dark:text-gray-300',
    zinc: 'bg-zinc-50 dark:bg-zinc-900/30 text-zinc-700 dark:text-zinc-300',
    neutral: 'bg-neutral-50 dark:bg-neutral-900/30 text-neutral-700 dark:text-neutral-300',
    stone: 'bg-stone-50 dark:bg-stone-900/30 text-stone-700 dark:text-stone-300',
    red: 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300',
    orange: 'bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
    amber: 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
    yellow: 'bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
    lime: 'bg-lime-50 dark:bg-lime-900/30 text-lime-700 dark:text-lime-300',
    green: 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300',
    emerald: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
    teal: 'bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300',
    cyan: 'bg-cyan-50 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300',
    sky: 'bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300',
    blue: 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
    indigo: 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300',
    violet: 'bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300',
    purple: 'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
    fuchsia: 'bg-fuchsia-50 dark:bg-fuchsia-900/30 text-fuchsia-700 dark:text-fuchsia-300',
    pink: 'bg-pink-50 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300',
    rose: 'bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300',
};

export const ICON_TEXT600_CLASSES: Record<ThemeColor, string> = {
    slate: 'text-slate-600',
    gray: 'text-gray-600',
    zinc: 'text-zinc-600',
    neutral: 'text-neutral-600',
    stone: 'text-stone-600',
    red: 'text-red-600',
    orange: 'text-orange-600',
    amber: 'text-amber-600',
    yellow: 'text-yellow-600',
    lime: 'text-lime-600',
    green: 'text-green-600',
    emerald: 'text-emerald-600',
    teal: 'text-teal-600',
    cyan: 'text-cyan-600',
    sky: 'text-sky-600',
    blue: 'text-blue-600',
    indigo: 'text-indigo-600',
    violet: 'text-violet-600',
    purple: 'text-purple-600',
    fuchsia: 'text-fuchsia-600',
    pink: 'text-pink-600',
    rose: 'text-rose-600',
};

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

    const personActiveClasses = PERSON_ACTIVE_CLASSES[themeColor as ThemeColor] ?? PERSON_ACTIVE_CLASSES.indigo;

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
                            <button key={u.id} onClick={() => setSelId(String(u.id))} className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left border-b dark:border-slate-800 ${selId === String(u.id) ? `${personActiveClasses} font-medium` : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
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

// Botão de aba (no escopo do módulo p/ não recriar o componente a cada render — evita remontagem).
const TabBtn: React.FC<{ active: boolean; onClick: () => void; icon: React.ReactNode; label: string; themeColor: string }> = ({ active, onClick, icon, label, themeColor }) => {
    const activeClasses = TAB_ACTIVE_CLASSES[themeColor as ThemeColor] ?? TAB_ACTIVE_CLASSES.indigo;
    return (
        <button onClick={onClick}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${active ? activeClasses : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}>
            {icon} {label}
        </button>
    );
};

// Central Única de Permissões. Reúne VER (matriz de telas), FAZER do AGENTE (per-user) e Auditoria.
const PermissionsCenter: React.FC<{ config?: any }> = () => {
    const { config, currentUser } = useDolibarr();
    const isAdmin = currentUser?.admin === 1 || currentUser?.admin === '1' || (currentUser?.admin as unknown) === true;
    const themeColor = config?.themeColor || 'indigo';
    const iconColorClasses = ICON_TEXT600_CLASSES[themeColor as ThemeColor] ?? ICON_TEXT600_CLASSES.indigo;
    const [tab, setTab] = useState<Tab>('screens');

    if (!isAdmin) return <RestrictedAccess view="central de permissões" />;

    return (
        <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
            <div className="flex items-center gap-2 mb-1">
                <ShieldCheck size={22} className={iconColorClasses} />
                <h1 className="text-xl font-bold text-slate-900 dark:text-white">Central de Permissões</h1>
            </div>
            <p className="text-sm text-slate-500 mb-4">Controle, num só lugar, o que cada grupo e pessoa pode ver e fazer no sistema.</p>

            <div className="flex gap-1 border-b dark:border-slate-800 mb-4 overflow-x-auto">
                <TabBtn active={tab === 'screens'} onClick={() => setTab('screens')} icon={<Monitor size={15} />} label="Telas (Ver)" themeColor={themeColor} />
                <TabBtn active={tab === 'groups'} onClick={() => setTab('groups')} icon={<Users size={15} />} label="Grupos & Permissões" themeColor={themeColor} />
                <TabBtn active={tab === 'access'} onClick={() => setTab('access')} icon={<KeyRound size={15} />} label="Acesso ao App" themeColor={themeColor} />
                <TabBtn active={tab === 'agent'} onClick={() => setTab('agent')} icon={<Bot size={15} />} label="Agente" themeColor={themeColor} />
                <TabBtn active={tab === 'audit'} onClick={() => setTab('audit')} icon={<History size={15} />} label="Auditoria" themeColor={themeColor} />
            </div>

            {tab === 'screens' && <ScreenAccessMatrix isAdmin={isAdmin} themeColor={themeColor} />}
            {tab === 'groups' && config && <GroupManager config={config} embedded />}
            {tab === 'access' && config && <AppAccessTab config={config} themeColor={themeColor} />}
            {tab === 'agent' && <AgentTab config={config} themeColor={themeColor} />}
            {tab === 'audit' && <AuditLog />}
        </div>
    );
};

export default PermissionsCenter;
