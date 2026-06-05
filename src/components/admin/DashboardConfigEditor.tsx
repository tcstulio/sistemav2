import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Card, Button } from '../ui';
import { LayoutDashboard, Eye, EyeOff, ChevronUp, ChevronDown, RotateCcw, Save } from 'lucide-react';
import { DASHBOARD_WIDGETS } from '../../config/dashboardWidgets';
import { applyOrderVisibility, getUserPrefs, setUserPrefs, OrderVisibilityPrefs, EMPTY_PREFS } from '../../utils/orderVisibility';
import { getUiConfig, updateUiConfig } from '../../services/uiConfigService';
import { setOrgBranding, useOrgBranding } from '../../hooks/useOrgBranding';

// #111 — Editor de widgets do painel (ordem + visibilidade).
//  - Seção ADMIN (se isAdmin): reordenar/ocultar widgets org-wide (updateUiConfig({ dashboard })).
//  - Seção USUÁRIO (sempre): override pessoal de ordem/visibilidade (localStorage).
// MANTENHA esta assinatura de props (Settings.tsx depende dela).
export interface DashboardConfigEditorProps {
    isAdmin: boolean;
    themeColor?: string;
}

const DASHBOARD_PREFS_KEY = 'coolgroove_dashboard_prefs';

/** Aplica prefs à lista de widgets e devolve {def, hidden} na ordem efetiva. */
function buildList(prefs: OrderVisibilityPrefs) {
    // Aplica somente a ordem (não filtra ocultos: aqui queremos listar TUDO, marcando o que está oculto).
    const ordered = applyOrderVisibility(
        DASHBOARD_WIDGETS,
        (w) => w.id,
        { hidden: [], order: prefs.order },
        null,
    );
    const hiddenSet = new Set(prefs.hidden);
    return ordered.map((def) => ({ def, hidden: hiddenSet.has(def.id) }));
}

interface WidgetListProps {
    prefs: OrderVisibilityPrefs;
    onChange: (next: OrderVisibilityPrefs) => void;
}

/** Lista reutilizável de widgets com toggle de visibilidade + setas de reordenar. */
const WidgetList: React.FC<WidgetListProps> = ({ prefs, onChange }) => {
    const items = buildList(prefs);

    const toggleHidden = (id: string) => {
        const hidden = prefs.hidden.includes(id)
            ? prefs.hidden.filter((h) => h !== id)
            : [...prefs.hidden, id];
        onChange({ ...prefs, hidden });
    };

    const move = (index: number, dir: -1 | 1) => {
        const ids = items.map((it) => it.def.id);
        const target = index + dir;
        if (target < 0 || target >= ids.length) return;
        [ids[index], ids[target]] = [ids[target], ids[index]];
        onChange({ ...prefs, order: ids });
    };

    return (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            {items.map((it, index) => (
                <li
                    key={it.def.id}
                    className={`flex items-center gap-2 px-3 py-2 bg-white dark:bg-slate-900 ${it.hidden ? 'opacity-50' : ''}`}
                >
                    <button
                        type="button"
                        onClick={() => toggleHidden(it.def.id)}
                        title={it.hidden ? 'Mostrar widget' : 'Ocultar widget'}
                        className="text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 p-1 rounded transition-colors"
                    >
                        {it.hidden ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                    <span className="flex-1 text-sm text-slate-700 dark:text-slate-200 truncate">{it.def.label}</span>
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => move(index, -1)}
                            disabled={index === 0}
                            title="Mover para cima"
                            className="text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 p-1 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            <ChevronUp size={16} />
                        </button>
                        <button
                            type="button"
                            onClick={() => move(index, 1)}
                            disabled={index === items.length - 1}
                            title="Mover para baixo"
                            className="text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 p-1 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            <ChevronDown size={16} />
                        </button>
                    </div>
                </li>
            ))}
        </ul>
    );
};

export const DashboardConfigEditor: React.FC<DashboardConfigEditorProps> = ({ isAdmin }) => {
    const orgBranding = useOrgBranding();

    // ----- Estado ADMIN (padrão da organização) -----
    const [orgPrefs, setOrgPrefs] = useState<OrderVisibilityPrefs>(EMPTY_PREFS);
    const [savingOrg, setSavingOrg] = useState(false);
    useEffect(() => {
        if (!isAdmin) return;
        if (orgBranding?.dashboard) {
            setOrgPrefs({ hidden: orgBranding.dashboard.hidden || [], order: orgBranding.dashboard.order || [] });
            return;
        }
        getUiConfig().then((c) => {
            if (c?.dashboard) setOrgPrefs({ hidden: c.dashboard.hidden || [], order: c.dashboard.order || [] });
        });
    }, [isAdmin, orgBranding]);

    const handleSaveOrg = async () => {
        setSavingOrg(true);
        try {
            const updated = await updateUiConfig({ dashboard: orgPrefs });
            setOrgBranding(updated); // atualiza consumidores (Dashboard) na hora
            toast.success('Padrão do painel atualizado para todos os usuários.');
        } catch {
            toast.error('Falha ao salvar (requer permissão de admin).');
        } finally {
            setSavingOrg(false);
        }
    };

    // ----- Estado USUÁRIO (override pessoal) -----
    const [userPrefs, setUserPrefsLocal] = useState<OrderVisibilityPrefs>(() => getUserPrefs(DASHBOARD_PREFS_KEY));

    const handleSaveUser = () => {
        setUserPrefs(DASHBOARD_PREFS_KEY, userPrefs);
        window.dispatchEvent(new Event('dashboard-prefs-changed'));
        toast.success('Personalização do seu painel salva.');
    };

    const handleResetUser = () => {
        setUserPrefs(DASHBOARD_PREFS_KEY, EMPTY_PREFS);
        setUserPrefsLocal(EMPTY_PREFS);
        window.dispatchEvent(new Event('dashboard-prefs-changed'));
        toast.success('Painel restaurado para o padrão.');
    };

    return (
        <Card header={<h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-200 uppercase tracking-wider"><LayoutDashboard size={16} /> Painel Principal</h3>}>
            <div className="space-y-6">
                {isAdmin && (
                    <div>
                        <p className="text-sm text-slate-500 mb-3">
                            Defina a ordem e a visibilidade dos widgets do painel para <strong>todos</strong> os usuários.
                            Cada usuário pode personalizar localmente abaixo.
                        </p>
                        <WidgetList prefs={orgPrefs} onChange={setOrgPrefs} />
                        <div className="flex justify-end mt-3">
                            <Button type="button" variant="primary" loading={savingOrg} icon={<Save size={16} />} onClick={handleSaveOrg}>
                                Salvar padrão da organização
                            </Button>
                        </div>
                    </div>
                )}

                <div>
                    <p className="text-sm text-slate-500 mb-3">
                        Personalize <strong>o seu</strong> painel. Estas mudanças valem só para você, neste navegador.
                    </p>
                    <WidgetList prefs={userPrefs} onChange={setUserPrefsLocal} />
                    <div className="flex justify-end gap-2 mt-3">
                        <Button type="button" variant="ghost" icon={<RotateCcw size={16} />} onClick={handleResetUser}>
                            Restaurar padrão
                        </Button>
                        <Button type="button" variant="primary" icon={<Save size={16} />} onClick={handleSaveUser}>
                            Salvar personalização
                        </Button>
                    </div>
                </div>
            </div>
        </Card>
    );
};

export default DashboardConfigEditor;
