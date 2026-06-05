import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ShieldCheck, Users, User, Save, Eye, EyeOff, Minus } from 'lucide-react';
import { Card, Button, Spinner } from '../ui';
import { useDolibarr } from '../../context/DolibarrContext';
import { DolibarrService } from '../../services/dolibarrService';
import { getUiConfig, updateUiConfig } from '../../services/uiConfigService';
import { ScreenPermissions, ScreenRule, EMPTY_SCREEN_PERMISSIONS, PROTECTED_SCREENS } from '../../utils/screenPermissions';
import { MENU_REGISTRY } from '../../config/menuRegistry';
import { UserGroup, DolibarrUser } from '../../types';
import { logger } from '../../utils/logger';

const log = logger.child('ScreenPermissionsEditor');

type Scope = 'groups' | 'users';
type Tri = 'inherit' | 'allow' | 'hide';

// #112 — Editor admin de permissões de tela por pessoa/grupo (org-wide).
// Para cada entidade (grupo ou pessoa), define por tela: Herdar (RBAC base) / Liberar / Ocultar.
export interface ScreenPermissionsEditorProps {
    isAdmin: boolean;
    themeColor?: string;
}

function ruleToMap(rule?: ScreenRule): Record<string, Tri> {
    const m: Record<string, Tri> = {};
    rule?.allowed?.forEach((id) => { m[id] = 'allow'; });
    rule?.hidden?.forEach((id) => { m[id] = 'hide'; });
    return m;
}

function mapToRule(m: Record<string, Tri>): ScreenRule {
    const rule: ScreenRule = { hidden: [], allowed: [] };
    Object.entries(m).forEach(([id, tri]) => {
        if (tri === 'allow') rule.allowed.push(id);
        else if (tri === 'hide') rule.hidden.push(id);
    });
    return rule;
}

export const ScreenPermissionsEditor: React.FC<ScreenPermissionsEditorProps> = ({ isAdmin, themeColor = 'indigo' }) => {
    const { config } = useDolibarr();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [groups, setGroups] = useState<UserGroup[]>([]);
    const [users, setUsers] = useState<DolibarrUser[]>([]);
    const [perms, setPerms] = useState<ScreenPermissions>(EMPTY_SCREEN_PERMISSIONS);

    const [scope, setScope] = useState<Scope>('groups');
    const [entityId, setEntityId] = useState<string>('');
    const [draft, setDraft] = useState<Record<string, Tri>>({});

    // Carrega entidades + permissões atuais.
    useEffect(() => {
        if (!isAdmin || !config) { setLoading(false); return; }
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const [g, u, cfg] = await Promise.all([
                    DolibarrService.listGroups(config),
                    DolibarrService.fetchUsers(config),
                    getUiConfig(),
                ]);
                if (cancelled) return;
                setGroups(g || []);
                setUsers((u || []).filter((x) => x.statut === '1' || x.statut === undefined));
                setPerms(cfg?.screenPermissions || EMPTY_SCREEN_PERMISSIONS);
            } catch (e) {
                log.error('Falha ao carregar dados de permissões', e);
                toast.error('Falha ao carregar permissões.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [isAdmin, config]);

    // Ao trocar de entidade/escopo, popula o rascunho com a regra atual.
    useEffect(() => {
        if (!entityId) { setDraft({}); return; }
        setDraft(ruleToMap(perms[scope]?.[entityId]));
    }, [scope, entityId, perms]);

    const entities = scope === 'groups'
        ? groups.map((g) => ({ id: String(g.id), label: g.name || `Grupo ${g.id}` }))
        : users.map((u) => ({ id: String(u.id), label: u.login || `${u.firstname || ''} ${u.lastname || ''}`.trim() || `Usuário ${u.id}` }));

    const setTri = (screenId: string, tri: Tri) => {
        setDraft((prev) => {
            const next = { ...prev };
            if (tri === 'inherit') delete next[screenId];
            else next[screenId] = tri;
            return next;
        });
    };

    const handleSave = async () => {
        if (!entityId) { toast.error('Selecione uma entidade.'); return; }
        setSaving(true);
        try {
            const rule = mapToRule(draft);
            const nextPerms: ScreenPermissions = {
                groups: { ...perms.groups },
                users: { ...perms.users },
            };
            if (rule.hidden.length === 0 && rule.allowed.length === 0) {
                delete nextPerms[scope][entityId]; // sem override = remove a entrada
            } else {
                nextPerms[scope][entityId] = rule;
            }
            const updated = await updateUiConfig({ screenPermissions: nextPerms });
            setPerms(updated.screenPermissions || nextPerms);
            toast.success('Permissões salvas. Aplicam no próximo carregamento dos usuários afetados.');
        } catch (e: any) {
            toast.error(`Falha ao salvar: ${e?.response?.data?.error || e?.message || 'erro'}`);
        } finally {
            setSaving(false);
        }
    };

    const dirtyCount = useMemo(() => Object.keys(draft).length, [draft]);

    if (!isAdmin) return null;

    return (
        <Card header={<h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-200 uppercase tracking-wider"><ShieldCheck size={16} /> Permissões de Tela (Admin)</h3>}>
            <p className="text-sm text-slate-500 mb-4">
                Libere ou oculte telas para um <strong>grupo</strong> ou <strong>pessoa</strong>. Aplica por cima das permissões do Dolibarr;
                <em> Liberar</em> mostra a tela mesmo sem direito, <em>Ocultar</em> esconde. Admins sempre veem tudo.
            </p>

            {loading ? (
                <div className="flex justify-center py-8"><Spinner /></div>
            ) : (
                <>
                    {/* Escopo */}
                    <div className="flex gap-2 mb-3">
                        <button
                            type="button"
                            onClick={() => { setScope('groups'); setEntityId(''); }}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${scope === 'groups' ? `bg-${themeColor}-600 text-white` : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}
                        >
                            <Users size={15} /> Grupos
                        </button>
                        <button
                            type="button"
                            onClick={() => { setScope('users'); setEntityId(''); }}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${scope === 'users' ? `bg-${themeColor}-600 text-white` : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}
                        >
                            <User size={15} /> Pessoas
                        </button>
                    </div>

                    {/* Entidade */}
                    <select
                        value={entityId}
                        onChange={(e) => setEntityId(e.target.value)}
                        className="w-full md:w-80 text-sm px-3 py-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white mb-4"
                    >
                        <option value="">— selecione {scope === 'groups' ? 'um grupo' : 'uma pessoa'} —</option>
                        {entities.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
                    </select>

                    {entityId && (
                        <>
                            <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1 custom-scrollbar">
                                {MENU_REGISTRY.map((group, gi) => (
                                    <div key={gi}>
                                        {group.title && <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">{group.title}</h4>}
                                        <div className="space-y-1">
                                            {group.items.map((item) => {
                                                const tri = draft[item.id] || 'inherit';
                                                const isProtected = PROTECTED_SCREENS.has(item.id);
                                                return (
                                                    <div key={item.id} className="flex items-center justify-between gap-2 py-1">
                                                        <span className="text-sm text-slate-700 dark:text-slate-200 truncate">
                                                            {item.label}
                                                            {isProtected && <span className="ml-1 text-[10px] text-slate-400">(protegida)</span>}
                                                        </span>
                                                        <div className="flex items-center rounded-lg overflow-hidden border dark:border-slate-700 shrink-0">
                                                            <TriBtn active={tri === 'inherit'} onClick={() => setTri(item.id, 'inherit')} title="Herdar" color="slate"><Minus size={13} /></TriBtn>
                                                            <TriBtn active={tri === 'allow'} onClick={() => setTri(item.id, 'allow')} title="Liberar" color="emerald"><Eye size={13} /></TriBtn>
                                                            <TriBtn active={tri === 'hide'} onClick={() => !isProtected && setTri(item.id, 'hide')} title={isProtected ? 'Tela protegida (não pode ocultar)' : 'Ocultar'} color="red" disabled={isProtected}><EyeOff size={13} /></TriBtn>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="flex items-center justify-between mt-4">
                                <span className="text-xs text-slate-500">{dirtyCount} tela(s) com override</span>
                                <Button type="button" variant="primary" loading={saving} icon={<Save size={16} />} onClick={handleSave}>Salvar permissões</Button>
                            </div>
                        </>
                    )}
                </>
            )}
        </Card>
    );
};

const TriBtn: React.FC<{ active: boolean; onClick: () => void; title: string; color: 'slate' | 'emerald' | 'red'; disabled?: boolean; children: React.ReactNode }>
    = ({ active, onClick, title, color, disabled, children }) => {
        const activeCls = color === 'emerald' ? 'bg-emerald-500 text-white' : color === 'red' ? 'bg-red-500 text-white' : 'bg-slate-400 text-white';
        return (
            <button
                type="button"
                onClick={onClick}
                title={title}
                disabled={disabled}
                className={`px-2 py-1.5 transition-colors ${active ? activeCls : 'bg-white dark:bg-slate-800 text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
                {children}
            </button>
        );
    };

export default ScreenPermissionsEditor;
