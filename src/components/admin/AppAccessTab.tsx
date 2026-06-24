import React, { useEffect, useMemo, useState } from 'react';
import { KeyRound, Check, AlertTriangle, Loader2, Search, ShieldCheck, Info } from 'lucide-react';
import { toast } from 'sonner';
import { DolibarrConfig, DolibarrUser, UserGroup } from '../../types';
import * as HRAdmin from '../../services/api/hrAdmin';
import { getUiConfig, updateUiConfig } from '../../services/uiConfigService';
import { enableAppAccess, getAppAccessStatus } from '../../services/adminPermissionsService';
import { Spinner } from '../ui';

// Resultado da checagem de que o grupo concede user->self->creer (342) — o direito que faz a
// Chave de API nascer no login. Não-bloqueante: o admin pode salvar mesmo com aviso (a validação
// depende do custom_sync e pode falhar por outros motivos).
type Validation = { level: 'ok' | 'warn' | 'unknown'; message: string } | null;

function grants342(rights: any): boolean {
    return !!(rights && rights.user && rights.user.self && rights.user.self.creer);
}

function userLabel(u: DolibarrUser): string {
    return u.login || `${u.firstname || ''} ${u.lastname || ''}`.trim() || `Usuário ${u.id}`;
}

function isAdminUser(u: DolibarrUser): boolean {
    return u.admin === 1 || (u.admin as unknown) === '1' || (u.admin as unknown) === true;
}

export const AppAccessTab: React.FC<{ config: DolibarrConfig; themeColor: string }> = ({ config, themeColor }) => {
    const [loading, setLoading] = useState(true);
    const [groups, setGroups] = useState<UserGroup[]>([]);
    const [users, setUsers] = useState<DolibarrUser[]>([]);
    const [savedGroupId, setSavedGroupId] = useState<string>('');
    const [selectedGroupId, setSelectedGroupId] = useState<string>('');
    const [validating, setValidating] = useState(false);
    const [validation, setValidation] = useState<Validation>(null);
    const [savingGroup, setSavingGroup] = useState(false);
    const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
    const [search, setSearch] = useState('');
    const [busyUserId, setBusyUserId] = useState<string>('');

    const validateGroup = async (gid: string) => {
        if (!gid) { setValidation(null); return; }
        setValidating(true);
        try {
            const rights = await HRAdmin.getGroupRights(config, gid);
            if (rights == null) {
                setValidation({ level: 'unknown', message: 'Não foi possível validar os direitos do grupo agora.' });
            } else if (grants342(rights)) {
                setValidation({ level: 'ok', message: 'Este grupo concede "Criar/Modificar próprio usuário" — a Chave de API nasce no login.' });
            } else {
                setValidation({ level: 'warn', message: 'Este grupo NÃO concede "Criar/Modificar próprio usuário" (direito 342). Adicione esse direito ao grupo na tela do Dolibarr, senão a chave não será gerada no login.' });
            }
        } catch {
            setValidation({ level: 'unknown', message: 'Não foi possível validar os direitos do grupo agora.' });
        } finally {
            setValidating(false);
        }
    };

    const loadMembers = async (gid: string) => {
        if (!gid) { setMemberIds(new Set()); return; }
        const ids = await HRAdmin.getGroupMemberIds(config, gid);
        setMemberIds(new Set(ids));
    };

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [cfg, grps, usrs] = await Promise.all([
                    getUiConfig(),
                    HRAdmin.listGroups(config).catch(() => [] as UserGroup[]),
                    HRAdmin.fetchUsers(config).catch(() => [] as DolibarrUser[]),
                ]);
                if (cancelled) return;
                const gid = cfg?.appAccessGroupId || '';
                setGroups(grps);
                setUsers((usrs || []).filter((u) => u.statut === '1' || u.statut === undefined));
                setSavedGroupId(gid);
                setSelectedGroupId(gid);
                if (gid) { await Promise.all([validateGroup(gid), loadMembers(gid)]); }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [config]);

    const onChangeGroup = (gid: string) => {
        setSelectedGroupId(gid);
        validateGroup(gid);
    };

    const saveGroup = async () => {
        // Não-bloqueante por padrão, mas se o grupo escolhido NÃO concede o direito 342, salvar
        // deixaria os usuários habilitados sem conseguir logar — exige confirmação explícita.
        if (selectedGroupId && validation?.level === 'warn') {
            const ok = window.confirm('Este grupo NÃO concede "Criar/Modificar próprio usuário" (342). Quem for habilitado não vai conseguir gerar a Chave de API no login. Salvar mesmo assim?');
            if (!ok) return;
        }
        setSavingGroup(true);
        try {
            await updateUiConfig({ appAccessGroupId: selectedGroupId });
            setSavedGroupId(selectedGroupId);
            await loadMembers(selectedGroupId);
            toast.success(selectedGroupId ? 'Grupo de acesso salvo.' : 'Automação de acesso desligada.');
        } catch (e: any) {
            toast.error(e?.response?.data?.message || e?.message || 'Falha ao salvar.');
        } finally {
            setSavingGroup(false);
        }
    };

    const enableUser = async (u: DolibarrUser) => {
        setBusyUserId(u.id);
        try {
            const r = await enableAppAccess(u.id);
            setMemberIds((prev) => new Set(prev).add(u.id));
            toast.success(r?.message || 'Acesso habilitado. A chave nasce no próximo login.');
        } catch (e: any) {
            toast.error(e?.response?.data?.message || e?.message || 'Falha ao habilitar acesso.');
        } finally {
            setBusyUserId('');
        }
    };

    const q = search.trim().toLowerCase();
    const filtered = useMemo(() => users.filter((u) =>
        !q || userLabel(u).toLowerCase().includes(q) || `${u.firstname || ''} ${u.lastname || ''}`.toLowerCase().includes(q)
    ), [users, q]);

    if (loading) return <div className="flex justify-center py-10"><Spinner /></div>;

    const dirty = selectedGroupId !== savedGroupId;
    const groupConfigured = !!savedGroupId;

    return (
        <div className="space-y-6">
            {/* Explicação */}
            <div className="flex gap-3 p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 text-sm">
                <Info size={18} className="shrink-0 mt-0.5" />
                <div>
                    <p className="font-medium mb-1">Como funciona o acesso ao app</p>
                    <p className="text-blue-700/90 dark:text-blue-300/90">
                        Por segurança, cada usuário acessa o sistema com a <strong>própria Chave de API</strong> do Dolibarr
                        (assim ele só vê e faz o que tem direito). Essa chave nasce sozinha no <strong>primeiro login</strong> —
                        mas só para quem pode editar o próprio cadastro. “Habilitar acesso” coloca a pessoa num <strong>grupo</strong> que
                        concede esse direito. Depois é só ela logar com login e senha.
                    </p>
                </div>
            </div>

            {/* Configuração do grupo */}
            <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800">
                <h3 className="font-bold text-slate-800 dark:text-white mb-1 flex items-center gap-2">
                    <ShieldCheck size={18} className={`text-${themeColor}-600`} /> Grupo de Acesso ao App
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                    Escolha o grupo do Dolibarr que concede o direito <strong>“Criar/Modificar informações do próprio usuário”</strong>.
                    Quem for habilitado entra nesse grupo.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                    <select
                        value={selectedGroupId}
                        onChange={(e) => onChangeGroup(e.target.value)}
                        className="flex-1 px-3 py-2 text-sm border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                    >
                        <option value="">— Nenhum (automação desligada) —</option>
                        {groups.map((g) => (
                            <option key={g.id} value={g.id}>{g.name} (#{g.id})</option>
                        ))}
                    </select>
                    <button
                        onClick={saveGroup}
                        disabled={!dirty || savingGroup}
                        className={`px-4 py-2 text-sm font-medium rounded-lg text-white bg-${themeColor}-600 hover:bg-${themeColor}-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap`}
                    >
                        {savingGroup ? <Loader2 size={15} className="animate-spin inline" /> : 'Salvar grupo'}
                    </button>
                </div>

                {/* Validação do direito 342 */}
                {validating && (
                    <p className="mt-3 text-xs text-slate-500 flex items-center gap-1"><Loader2 size={13} className="animate-spin" /> Validando direitos do grupo…</p>
                )}
                {!validating && validation && (
                    <div className={`mt-3 flex items-start gap-2 text-xs p-2.5 rounded-lg ${validation.level === 'ok'
                        ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                        : validation.level === 'warn'
                            ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300'
                            : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>
                        {validation.level === 'ok' ? <Check size={14} className="mt-0.5 shrink-0" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" />}
                        <span>{validation.message}</span>
                    </div>
                )}
            </div>

            {/* Lista de usuários */}
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                <div className="p-4 border-b dark:border-slate-800 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                    <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2"><KeyRound size={18} className="text-slate-400" /> Pessoas</h3>
                    <div className="relative">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar pessoa…" className="pl-7 pr-2 py-1.5 text-sm border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" />
                    </div>
                </div>

                {!groupConfigured && (
                    <div className="p-4 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 flex items-center gap-2">
                        <AlertTriangle size={15} /> Configure o grupo de acesso acima para habilitar pessoas.
                    </div>
                )}

                <div className="max-h-[55vh] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                    {filtered.map((u) => {
                        const admin = isAdminUser(u);
                        const enabled = memberIds.has(u.id);
                        return (
                            <div key={u.id} className="flex items-center gap-3 px-4 py-2.5">
                                <span className="flex-1 truncate text-sm text-slate-700 dark:text-slate-200">{userLabel(u)}</span>
                                {admin ? (
                                    <span className="text-xs px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">Admin — acesso total</span>
                                ) : enabled ? (
                                    <span className="text-xs px-2 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 flex items-center gap-1"><Check size={12} /> Habilitado</span>
                                ) : (
                                    <button
                                        onClick={() => enableUser(u)}
                                        disabled={!groupConfigured || busyUserId === u.id}
                                        className={`text-xs px-3 py-1.5 rounded-lg font-medium text-white bg-${themeColor}-600 hover:bg-${themeColor}-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1`}
                                    >
                                        {busyUserId === u.id ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />} Habilitar
                                    </button>
                                )}
                            </div>
                        );
                    })}
                    {filtered.length === 0 && <p className="text-xs text-slate-400 text-center py-6">Nenhuma pessoa.</p>}
                </div>
            </div>
        </div>
    );
};

// Linha compacta reutilizável p/ o card "Segurança" do UserDetail. Auto-carrega o status e
// oferece o botão Habilitar. Só renderiza conteúdo útil para admins (o backend também exige admin).
export const AppAccessRow: React.FC<{ userId: string; isAdmin: boolean; themeColor?: string }> = ({ userId, isAdmin, themeColor = 'indigo' }) => {
    const [loading, setLoading] = useState(true);
    const [configured, setConfigured] = useState(false);
    const [inGroup, setInGroup] = useState(false);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!isAdmin) { setLoading(false); return; }
        let cancelled = false;
        getAppAccessStatus(userId)
            .then((s) => { if (!cancelled) { setConfigured(s.configured); setInGroup(s.inGroup); } })
            .catch(() => { })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [userId, isAdmin]);

    if (!isAdmin) return null;

    const handle = async () => {
        setBusy(true);
        try {
            const r = await enableAppAccess(userId);
            setInGroup(true);
            toast.success(r?.message || 'Acesso habilitado.');
        } catch (e: any) {
            toast.error(e?.response?.data?.message || e?.message || 'Falha ao habilitar acesso.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex justify-between items-center">
            <span className="text-sm text-slate-600 dark:text-slate-400">Acesso ao App</span>
            {loading ? (
                <Loader2 size={14} className="animate-spin text-slate-400" />
            ) : !configured ? (
                <span className="text-xs text-slate-400" title="Configure o grupo na Central de Permissões → Acesso ao App">Não configurado</span>
            ) : inGroup ? (
                <span className="px-2 py-1 rounded text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 flex items-center gap-1"><Check size={12} /> Habilitado</span>
            ) : (
                <button
                    onClick={handle}
                    disabled={busy}
                    className={`text-xs px-2.5 py-1 rounded-lg font-medium text-white bg-${themeColor}-600 hover:bg-${themeColor}-700 disabled:opacity-50 flex items-center gap-1`}
                >
                    {busy ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />} Habilitar
                </button>
            )}
        </div>
    );
};
