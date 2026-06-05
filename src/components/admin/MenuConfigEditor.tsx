import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Card, Button } from '../ui';
import { Menu, Eye, EyeOff, ChevronUp, ChevronDown, RotateCcw, Save } from 'lucide-react';
import { MENU_REGISTRY, MENU_REGISTRY_ITEMS, MenuRegistryItem } from '../../config/menuRegistry';
import {
    applyOrderVisibility,
    getUserPrefs,
    setUserPrefs,
    OrderVisibilityPrefs,
} from '../../utils/orderVisibility';
import { updateUiConfig, getUiConfig } from '../../services/uiConfigService';
import { useOrgBranding, setOrgBranding } from '../../hooks/useOrgBranding';

// #110 — Editor do menu lateral (ordem + visibilidade).
// Modelo: admin define o padrão da organização; usuário personaliza localmente.
// MANTENHA esta assinatura de props (Settings.tsx depende dela).
export interface MenuConfigEditorProps {
    isAdmin: boolean;
    themeColor?: string;
}

const MENU_PREFS_KEY = 'coolgroove_menu_prefs';

// ---------------------------------------------------------------------------
// Helpers de estado: cada grupo mantém sua própria lista ordenada de ids;
// achatamos para um único `order` (compatível com applyOrderVisibility) na hora de salvar.
// ---------------------------------------------------------------------------

interface EditorState {
    hidden: Set<string>;
    /** order por grupo (índice do grupo no MENU_REGISTRY -> ids em ordem) */
    orderByGroup: string[][];
}

/** Constrói o estado inicial do editor a partir de prefs salvas (org ou usuário). */
function buildState(prefs?: Partial<OrderVisibilityPrefs> | null): EditorState {
    const hidden = new Set<string>(prefs?.hidden || []);
    const orderByGroup = MENU_REGISTRY.map(group =>
        // ordena os itens do grupo conforme as prefs; não oculta aqui (queremos mostrar todos no editor)
        applyOrderVisibility(group.items, i => i.id, null, { order: prefs?.order || [], hidden: [] })
            .map(i => i.id)
    );
    return { hidden, orderByGroup };
}

/** Achata o estado do editor em OrderVisibilityPrefs para persistir. */
function flattenState(state: EditorState): OrderVisibilityPrefs {
    return {
        hidden: Array.from(state.hidden),
        order: state.orderByGroup.flat(),
    };
}

// ---------------------------------------------------------------------------
// Lista editável (reutilizada nas seções admin e usuário).
// ---------------------------------------------------------------------------

interface EditableMenuListProps {
    state: EditorState;
    onChange: (next: EditorState) => void;
}

const EditableMenuList: React.FC<EditableMenuListProps> = ({ state, onChange }) => {
    const itemsById = useMemo(() => {
        const map = new Map<string, MenuRegistryItem>();
        MENU_REGISTRY_ITEMS.forEach(i => map.set(i.id, i));
        return map;
    }, []);

    const toggleHidden = (id: string) => {
        const hidden = new Set(state.hidden);
        if (hidden.has(id)) hidden.delete(id); else hidden.add(id);
        onChange({ ...state, hidden });
    };

    const move = (groupIdx: number, itemIdx: number, dir: -1 | 1) => {
        const target = itemIdx + dir;
        const groupOrder = state.orderByGroup[groupIdx];
        if (target < 0 || target >= groupOrder.length) return;
        const nextGroup = [...groupOrder];
        [nextGroup[itemIdx], nextGroup[target]] = [nextGroup[target], nextGroup[itemIdx]];
        const orderByGroup = state.orderByGroup.map((g, i) => (i === groupIdx ? nextGroup : g));
        onChange({ ...state, orderByGroup });
    };

    return (
        <div className="space-y-4">
            {MENU_REGISTRY.map((group, groupIdx) => (
                <div key={group.title || `grp-${groupIdx}`}>
                    {group.title && (
                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                            {group.title}
                        </h4>
                    )}
                    <ul className="space-y-1">
                        {state.orderByGroup[groupIdx].map((id, itemIdx) => {
                            const item = itemsById.get(id);
                            if (!item) return null;
                            const isHidden = state.hidden.has(id);
                            return (
                                <li
                                    key={id}
                                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-sm
                                        ${isHidden
                                            ? 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 text-slate-400'
                                            : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200'
                                        }`}
                                >
                                    <button
                                        type="button"
                                        title={isHidden ? 'Mostrar item' : 'Ocultar item'}
                                        aria-label={isHidden ? 'Mostrar item' : 'Ocultar item'}
                                        onClick={() => toggleHidden(id)}
                                        className="text-slate-400 hover:text-indigo-600 transition-colors"
                                    >
                                        {isHidden ? <EyeOff size={16} /> : <Eye size={16} />}
                                    </button>
                                    <span className={`flex-1 truncate ${isHidden ? 'line-through' : ''}`}>{item.label}</span>
                                    <button
                                        type="button"
                                        title="Mover para cima"
                                        aria-label="Mover para cima"
                                        disabled={itemIdx === 0}
                                        onClick={() => move(groupIdx, itemIdx, -1)}
                                        className="text-slate-400 hover:text-indigo-600 disabled:opacity-30 disabled:hover:text-slate-400 transition-colors"
                                    >
                                        <ChevronUp size={16} />
                                    </button>
                                    <button
                                        type="button"
                                        title="Mover para baixo"
                                        aria-label="Mover para baixo"
                                        disabled={itemIdx === state.orderByGroup[groupIdx].length - 1}
                                        onClick={() => move(groupIdx, itemIdx, 1)}
                                        className="text-slate-400 hover:text-indigo-600 disabled:opacity-30 disabled:hover:text-slate-400 transition-colors"
                                    >
                                        <ChevronDown size={16} />
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ))}
        </div>
    );
};

// ---------------------------------------------------------------------------
// Editor principal.
// ---------------------------------------------------------------------------

export const MenuConfigEditor: React.FC<MenuConfigEditorProps> = ({ isAdmin }) => {
    const branding = useOrgBranding();

    // --- Seção USUÁRIO (sempre) ---
    const [userState, setUserState] = useState<EditorState>(() => buildState(getUserPrefs(MENU_PREFS_KEY)));
    const handleSaveUser = () => {
        const prefs = flattenState(userState);
        setUserPrefs(MENU_PREFS_KEY, prefs);
        window.dispatchEvent(new Event('menu-prefs-changed'));
        toast.success('Menu personalizado');
    };
    const handleResetUser = () => {
        const cleared: EditorState = { hidden: new Set(), orderByGroup: buildState(null).orderByGroup };
        setUserState(cleared);
        setUserPrefs(MENU_PREFS_KEY, { hidden: [], order: [] });
        window.dispatchEvent(new Event('menu-prefs-changed'));
        toast.success('Menu restaurado ao padrão');
    };

    // --- Seção ADMIN (só se isAdmin) ---
    const [adminState, setAdminState] = useState<EditorState>(() => buildState(branding?.menu));
    const [savingAdmin, setSavingAdmin] = useState(false);
    // Hidrata o estado admin quando a config da org chega/atualiza.
    React.useEffect(() => {
        if (!isAdmin) return;
        getUiConfig().then(c => { if (c) setAdminState(buildState(c.menu)); });
    }, [isAdmin]);
    const handleSaveAdmin = async () => {
        setSavingAdmin(true);
        try {
            const prefs = flattenState(adminState);
            const updated = await updateUiConfig({ menu: prefs });
            setOrgBranding(updated); // atualiza Sidebar e demais consumidores na hora
            toast.success('Padrão do menu salvo para a organização');
        } catch {
            toast.error('Falha ao salvar (requer permissão de admin).');
        } finally {
            setSavingAdmin(false);
        }
    };

    return (
        <Card header={<h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-200 uppercase tracking-wider"><Menu size={16} /> Menu Lateral</h3>}>
            <div className="space-y-6">
                {isAdmin && (
                    <section>
                        <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
                            <div>
                                <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Padrão da organização</h4>
                                <p className="text-xs text-slate-500">
                                    Define a ordem e a visibilidade do menu para <strong>todos</strong> os usuários.
                                    Itens sem permissão continuam ocultos pelo controle de acesso.
                                </p>
                            </div>
                            <Button
                                type="button"
                                variant="primary"
                                size="sm"
                                loading={savingAdmin}
                                icon={<Save size={14} />}
                                onClick={handleSaveAdmin}
                            >
                                Salvar padrão da organização
                            </Button>
                        </div>
                        <EditableMenuList state={adminState} onChange={setAdminState} />
                    </section>
                )}

                {isAdmin && <hr className="border-slate-200 dark:border-slate-800" />}

                <section>
                    <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
                        <div>
                            <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Meu menu</h4>
                            <p className="text-xs text-slate-500">
                                Personalize a ordem e a visibilidade só para você (salvo neste navegador).
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                icon={<RotateCcw size={14} />}
                                onClick={handleResetUser}
                            >
                                Restaurar padrão
                            </Button>
                            <Button
                                type="button"
                                variant="primary"
                                size="sm"
                                icon={<Save size={14} />}
                                onClick={handleSaveUser}
                            >
                                Salvar meu menu
                            </Button>
                        </div>
                    </div>
                    <EditableMenuList state={userState} onChange={setUserState} />
                </section>
            </div>
        </Card>
    );
};

export default MenuConfigEditor;
