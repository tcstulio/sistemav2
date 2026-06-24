import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Users, User, Save, Eye, EyeOff, Minus, Search, Rows, Columns, RotateCcw } from 'lucide-react';
import { Button, Spinner } from '../ui';
import { useDolibarr } from '../../context/DolibarrContext';
import { DolibarrService } from '../../services/dolibarrService';
import { getUiConfig, patchScreenPermissions, ScreenPermsDelta } from '../../services/uiConfigService';
import { ScreenPermissions, EMPTY_SCREEN_PERMISSIONS, PROTECTED_SCREENS } from '../../utils/screenPermissions';
import { MENU_REGISTRY } from '../../config/menuRegistry';
import { UserGroup, DolibarrUser } from '../../types';
import { logger } from '../../utils/logger';

const log = logger.child('ScreenAccessMatrix');
type Scope = 'groups' | 'users';
type Orient = 'entity' | 'screen';
type Tri = 'inherit' | 'allow' | 'hide';

interface Entity { id: string; label: string; }
interface Screen { id: string; label: string; }

// Matriz VER (Central de Permissões): configura visibilidade de telas por grupo/pessoa,
// alternável entre "por entidade" (linha=grupo/pessoa) e "por tela" (linha=tela). Salva DELTA
// (só entidades alteradas) via PATCH com versão (409 = recarrega). Admin sempre vê tudo.
export const ScreenAccessMatrix: React.FC<{ isAdmin: boolean; themeColor?: string }> = ({ isAdmin, themeColor = 'indigo' }) => {
    const { config } = useDolibarr();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [groups, setGroups] = useState<UserGroup[]>([]);
    const [users, setUsers] = useState<DolibarrUser[]>([]);
    const [perms, setPerms] = useState<ScreenPermissions>(EMPTY_SCREEN_PERMISSIONS);
    const [version, setVersion] = useState<number>(0);
    const [dirty, setDirty] = useState<Set<string>>(new Set()); // entityIds alterados

    const [scope, setScope] = useState<Scope>('groups');
    const [orient, setOrient] = useState<Orient>('entity');
    const [search, setSearch] = useState('');

    const screens: Screen[] = useMemo(() => MENU_REGISTRY.flatMap((g: any) => g.items.map((i: any) => ({ id: i.id, label: i.label }))), []);

    const reload = async () => {
        if (!isAdmin || !config) { setLoading(false); return; }
        setLoading(true);
        try {
            const [g, u, cfg] = await Promise.all([DolibarrService.listGroups(config), DolibarrService.fetchUsers(config), getUiConfig()]);
            setGroups(g || []);
            setUsers((u || []).filter((x) => x.statut === '1' || x.statut === undefined));
            setPerms(cfg?.screenPermissions || EMPTY_SCREEN_PERMISSIONS);
            setVersion(cfg?.version || 0);
            setDirty(new Set());
        } catch (e) { log.error('load', e); toast.error('Falha ao carregar permissões.'); }
        finally { setLoading(false); }
    };
    useEffect(() => { reload(); /* eslint-disable-next-line */ }, [isAdmin, config]);

    const allEntities: Entity[] = scope === 'groups'
        ? groups.map((g) => ({ id: String(g.id), label: g.name || `Grupo ${g.id}` }))
        : users.map((u) => ({ id: String(u.id), label: u.login || `${u.firstname || ''} ${u.lastname || ''}`.trim() || `Usuário ${u.id}` }));

    // Entidades visíveis: filtro por busca; sem busca, grupos mostra todos, usuários mostra só os
    // que já têm override (evita 252 linhas) + dica p/ buscar.
    const entities: Entity[] = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (q) return allEntities.filter((e) => e.label.toLowerCase().includes(q));
        if (scope === 'groups') return allEntities;
        return allEntities.filter((e) => !!perms.users?.[e.id]); // usuários com override
    }, [allEntities, search, scope, perms]);

    const triOf = (entityId: string, screenId: string): Tri => {
        const r = perms[scope]?.[entityId];
        if (r?.allowed?.includes(screenId)) return 'allow';
        if (r?.hidden?.includes(screenId)) return 'hide';
        return 'inherit';
    };

    const cycle = (entityId: string, screenId: string) => {
        const isProtected = PROTECTED_SCREENS.has(screenId);
        const cur = triOf(entityId, screenId);
        const nextTri: Tri = cur === 'inherit' ? 'allow' : cur === 'allow' ? (isProtected ? 'inherit' : 'hide') : 'inherit';
        setPerms((prev) => {
            const scopeMap = { ...(prev[scope] || {}) };
            const rule = { hidden: [...(scopeMap[entityId]?.hidden || [])], allowed: [...(scopeMap[entityId]?.allowed || [])] };
            rule.allowed = rule.allowed.filter((s) => s !== screenId);
            rule.hidden = rule.hidden.filter((s) => s !== screenId);
            if (nextTri === 'allow') rule.allowed.push(screenId);
            else if (nextTri === 'hide') rule.hidden.push(screenId);
            scopeMap[entityId] = rule;
            return { ...prev, [scope]: scopeMap };
        });
        setDirty((prev) => new Set(prev).add(entityId));
    };

    const save = async () => {
        if (dirty.size === 0) { toast.info('Nada para salvar.'); return; }
        setSaving(true);
        try {
            const delta: ScreenPermsDelta = { [scope]: {} } as any;
            dirty.forEach((id) => {
                const r = perms[scope]?.[id] || { hidden: [], allowed: [] };
                (delta as any)[scope][id] = { hidden: r.hidden || [], allowed: r.allowed || [] };
            });
            const updated = await patchScreenPermissions(delta, version);
            setPerms(updated.screenPermissions || perms);
            setVersion(updated.version || version + 1);
            setDirty(new Set());
            toast.success('Permissões salvas. Aplicam no próximo carregamento dos afetados.');
        } catch (e: any) {
            if (e?.conflict) {
                toast.error('Outro admin salvou enquanto você editava. Recarregando…');
                await reload();
            } else {
                toast.error(`Falha ao salvar: ${e?.response?.data?.error || e?.message || 'erro'}`);
            }
        } finally { setSaving(false); }
    };

    if (!isAdmin) return null;
    if (loading) return <div className="flex justify-center py-10"><Spinner /></div>;

    // Em "por tela", linhas=telas e colunas=entidades; em "por entidade", o inverso.
    const rows = orient === 'entity' ? entities.map((e) => ({ id: e.id, label: e.label, kind: 'entity' as const }))
                                     : screens.map((s) => ({ id: s.id, label: s.label, kind: 'screen' as const }));
    const cols = orient === 'entity' ? screens.map((s) => ({ id: s.id, label: s.label }))
                                     : entities.map((e) => ({ id: e.id, label: e.label }));
    const cellTri = (rowId: string, colId: string) => orient === 'entity' ? triOf(rowId, colId) : triOf(colId, rowId);
    const cellClick = (rowId: string, colId: string) => orient === 'entity' ? cycle(rowId, colId) : cycle(colId, rowId);
    const colIsProtected = (colId: string) => orient === 'entity' ? PROTECTED_SCREENS.has(colId) : false;
    const rowIsProtected = (rowId: string) => orient === 'screen' ? PROTECTED_SCREENS.has(rowId) : false;

    return (
        <div className="flex flex-col gap-3">
            {/* Controles */}
            <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-lg overflow-hidden border dark:border-slate-700">
                    <button onClick={() => { setScope('groups'); setSearch(''); }} className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium ${scope === 'groups' ? `bg-${themeColor}-600 text-white` : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}><Users size={14} /> Grupos</button>
                    <button onClick={() => { setScope('users'); setSearch(''); }} className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium ${scope === 'users' ? `bg-${themeColor}-600 text-white` : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}><User size={14} /> Pessoas</button>
                </div>
                <button onClick={() => setOrient((o) => o === 'entity' ? 'screen' : 'entity')} title="Alternar orientação" className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    {orient === 'entity' ? <Rows size={14} /> : <Columns size={14} />} {orient === 'entity' ? 'Por pessoa/grupo' : 'Por tela'}
                </button>
                <div className="relative flex-1 min-w-[160px] max-w-xs">
                    <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Buscar ${scope === 'groups' ? 'grupo' : 'pessoa'}…`} className="w-full pl-7 pr-2 py-1.5 text-sm border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" />
                </div>
                <Button variant="ghost" icon={<RotateCcw size={14} />} onClick={reload} title="Recarregar">{''}</Button>
                <Button variant="primary" loading={saving} icon={<Save size={16} />} onClick={save} disabled={dirty.size === 0}>Salvar{dirty.size ? ` (${dirty.size})` : ''}</Button>
            </div>

            {/* Legenda */}
            <div className="flex items-center gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1"><Minus size={12} className="text-slate-400" /> Herdar</span>
                <span className="flex items-center gap-1"><Eye size={12} className="text-emerald-500" /> Liberar</span>
                <span className="flex items-center gap-1"><EyeOff size={12} className="text-red-500" /> Ocultar</span>
                <span className="ml-auto">Clique na célula p/ alternar. Admin sempre vê tudo; Dashboard/Config são protegidas.</span>
            </div>

            {scope === 'users' && !search.trim() && (
                <p className="text-xs text-amber-600 dark:text-amber-400">Mostrando só pessoas com override. Use a busca para encontrar e configurar outras ({allEntities.length} no total).</p>
            )}

            {/* Matriz */}
            {rows.length === 0 || cols.length === 0 ? (
                <p className="text-sm text-slate-500 py-6 text-center">Nada para exibir. {scope === 'users' && 'Busque uma pessoa.'}</p>
            ) : (
                <div className="overflow-auto border rounded-lg dark:border-slate-700 max-h-[60vh]">
                    <table className="text-sm border-collapse">
                        <thead className="sticky top-0 z-10">
                            <tr>
                                <th className="sticky left-0 z-20 bg-slate-100 dark:bg-slate-800 px-3 py-2 text-left font-semibold text-slate-600 dark:text-slate-300 min-w-[180px] border-b dark:border-slate-700">{orient === 'entity' ? (scope === 'groups' ? 'Grupo' : 'Pessoa') : 'Tela'}</th>
                                {cols.map((c) => (
                                    <th key={c.id} className="bg-slate-100 dark:bg-slate-800 px-1 py-2 text-[11px] font-medium text-slate-500 dark:text-slate-400 border-b dark:border-slate-700 whitespace-nowrap" title={c.label}>
                                        <div className="max-w-[90px] truncate mx-auto">{c.label}{colIsProtected(c.id) && ' 🔒'}</div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                                    <td className="sticky left-0 z-10 bg-white dark:bg-slate-900 px-3 py-1.5 font-medium text-slate-700 dark:text-slate-200 border-b dark:border-slate-800 truncate max-w-[200px]" title={r.label}>{r.label}{rowIsProtected(r.id) && ' 🔒'}</td>
                                    {cols.map((c) => {
                                        const tri = cellTri(r.id, c.id);
                                        const prot = colIsProtected(c.id) || rowIsProtected(r.id);
                                        return (
                                            <td key={c.id} className="text-center border-b dark:border-slate-800 px-0.5">
                                                <button onClick={() => cellClick(r.id, c.id)} title={`${r.label} × ${c.label}: ${tri === 'allow' ? 'Liberar' : tri === 'hide' ? 'Ocultar' : 'Herdar'}`}
                                                    className={`w-7 h-7 inline-flex items-center justify-center rounded transition-colors ${tri === 'allow' ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600' : tri === 'hide' ? 'bg-red-100 dark:bg-red-900/40 text-red-600' : 'text-slate-300 dark:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                                                    {tri === 'allow' ? <Eye size={14} /> : tri === 'hide' ? <EyeOff size={14} /> : <Minus size={13} />}
                                                </button>
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default ScreenAccessMatrix;
