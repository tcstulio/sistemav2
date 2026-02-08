import React, { useMemo, useState, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useDolibarr } from '../../context/DolibarrContext';
import { useModules } from '../../hooks/dolibarr';
import { safeStorage } from '../../utils/safeStorage';
import {
    Layout, Users, FileText, Package, ShoppingCart, Truck, Settings, LifeBuoy,
    BarChart3, X, LogOut, FileSignature, TrendingUp, PenTool, Factory,
    FolderKanban, ClipboardList, Landmark, CalendarDays, Tag, MessageSquare,
    Activity, Bug, UserCircle, Mail, Bot, Clock, Receipt, Banknote,
    Calculator, Building2, ChevronDown, ChevronRight
} from 'lucide-react';

interface SidebarProps {
    isOpen: boolean;
    setIsOpen: (open: boolean) => void;
}

interface MenuItem {
    id: string;
    path: string;
    label: string;
    icon: React.ElementType;
}

interface MenuGroup {
    title?: string;
    items: MenuItem[];
}

const COLLAPSED_GROUPS_KEY = 'sidebar_collapsed_groups';

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, setIsOpen }) => {
    const { config, setConfig, canAccess } = useDolibarr();
    const { data: modules } = useModules(config);
    const navigate = useNavigate();
    const location = useLocation();

    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() =>
        safeStorage.getJSON(COLLAPSED_GROUPS_KEY, {} as Record<string, boolean>)
    );

    const toggleGroup = useCallback((title: string) => {
        setCollapsedGroups(prev => {
            const next = { ...prev, [title]: !prev[title] };
            safeStorage.setJSON(COLLAPSED_GROUPS_KEY, next);
            return next;
        });
    }, []);

    // Menu Configuration
    const menuGroups: MenuGroup[] = [
        {
            items: [
                { id: 'dashboard', path: '/', label: 'Painel Principal', icon: Layout },
                { id: 'my-tasks', path: '/my-tasks', label: 'Minhas Tarefas', icon: ClipboardList },
                { id: 'agenda', path: '/agenda', label: 'Agenda', icon: CalendarDays },
            ]
        },
        {
            title: 'AGENTE IA',
            items: [
                { id: 'whatsapp', path: '/whatsapp', label: 'WhatsApp Omni', icon: MessageSquare },
                { id: 'chat', path: '/chat', label: 'Chat Interno', icon: MessageSquare },
                { id: 'email', path: '/email', label: 'Emails', icon: Mail },
                { id: 'automation', path: '/automation', label: 'Automação', icon: Bot },
                { id: 'venues', path: '/venues', label: 'Espaços', icon: Building2 },
                { id: 'simulator', path: '/simulator', label: 'Simulador', icon: Calculator },
            ]
        },
        {
            title: 'VENDAS & CRM',
            items: [
                { id: 'customers', path: '/customers', label: 'Clientes', icon: Users },
                { id: 'proposals', path: '/proposals', label: 'Propostas', icon: FileSignature },
                { id: 'orders', path: '/orders', label: 'Pedidos de Venda', icon: ShoppingCart },
                { id: 'shipments', path: '/shipments', label: 'Envios', icon: Truck },
                { id: 'contracts', path: '/contracts', label: 'Contratos', icon: PenTool },
                { id: 'interventions', path: '/interventions', label: 'Intervenções', icon: ClipboardList },
                { id: 'tickets', path: '/tickets', label: 'Chamados', icon: LifeBuoy },
            ]
        },
        {
            title: 'FINANCEIRO',
            items: [
                { id: 'invoices', path: '/invoices', label: 'Faturas', icon: FileText },
                { id: 'payments', path: '/payments', label: 'Pagamentos', icon: TrendingUp },
                { id: 'tax_payments', path: '/tax_payments', label: 'Impostos e Encargos', icon: Landmark },
            ]
        },
        {
            title: 'COMPRAS & DESPESAS',
            items: [
                { id: 'suppliers', path: '/suppliers', label: 'Fornecedores', icon: Truck },
                { id: 'supplier_proposals', path: '/supplier_proposals', label: 'Solicitações de Preço', icon: FileSignature },
                { id: 'supplier_invoices', path: '/supplier_invoices', label: 'Faturas de Fornecedor', icon: FileText },
                { id: 'supplier_payments', path: '/supplier_payments', label: 'Pagamentos de Fornecedor', icon: TrendingUp },
                { id: 'pending_payments', path: '/pending_payments', label: 'Pendências Financeiras', icon: Clock },
                { id: 'expense_report_payments', path: '/expense_report_payments', label: 'Pagamentos de Despesas', icon: Receipt },
            ]
        },
        {
            title: 'GESTÃO & OPERACIONAL',
            items: [
                { id: 'projects', path: '/projects', label: 'Projetos', icon: FolderKanban },
                { id: 'hr', path: '/hr', label: 'RH & Equipe', icon: UserCircle },
                { id: 'salary_payments', path: '/salary_payments', label: 'Salários', icon: Banknote },
                { id: 'bank_accounts', path: '/bank_accounts', label: 'Bancos', icon: Landmark },
                { id: 'reports', path: '/reports', label: 'Relatórios', icon: BarChart3 },
                { id: 'monthly_report', path: '/monthly-report', label: 'Relatório Mensal (IA)', icon: FileText },
            ]
        },
        {
            title: 'ESTOQUE & PRODUTOS',
            items: [
                { id: 'products', path: '/products', label: 'Produtos', icon: Package },
                { id: 'categories', path: '/categories', label: 'Categorias/Tags', icon: Tag },
                { id: 'inventory', path: '/inventory', label: 'Estoque', icon: Factory },
                { id: 'manufacturing', path: '/manufacturing', label: 'Produção', icon: Settings },
            ]
        },
        {
            title: 'SISTEMA',
            items: [
                { id: 'activity', path: '/activity', label: 'Atividades', icon: Activity },
                { id: 'development', path: '/development', label: 'Console Dev', icon: Bug },
                { id: 'settings', path: '/settings', label: 'Configurações', icon: Settings },
            ]
        }
    ];

    // Helper: Map Dolibarr Modules to App Views
    const checkModuleAccess = (viewId: string): boolean => {
        if (!config) return false;
        if (!modules || modules.length === 0) return true; // Fail open if modules not loaded yet

        const activeModules = modules.filter(m => m.active === '1').map(m => m.name.toLowerCase());

        switch (viewId) {
            case 'proposals': return activeModules.includes('propale');
            case 'orders': return activeModules.includes('commande');
            case 'invoices': return activeModules.includes('facture');
            case 'supplier_invoices': return activeModules.includes('fournisseur') || activeModules.includes('facture');
            case 'pending_payments': return activeModules.includes('facture') || activeModules.includes('fournisseur');
            case 'projects': return activeModules.includes('projet');
            case 'bank_accounts': return activeModules.includes('banque');
            case 'interventions': return activeModules.includes('ficheinter');
            case 'hr': return activeModules.includes('recruitment') || activeModules.includes('holiday');
            case 'contracts': return activeModules.includes('contrat');
            case 'manufacturing': return activeModules.includes('mrp') || activeModules.includes('bom');
            case 'shipments': return activeModules.includes('expedition');
            case 'tickets': return activeModules.includes('ticket');
            case 'agenda': return activeModules.includes('agenda');
            case 'customers': return activeModules.includes('societe');
            case 'suppliers': return activeModules.includes('fournisseur');
            case 'supplier_proposals': return activeModules.includes('fournisseur') || activeModules.includes('supplier_proposal');
            case 'products': return activeModules.includes('product') || activeModules.includes('service');
            default: return true;
        }
    };

    // Filter Logic
    const visibleMenuGroups = useMemo(() => {
        return menuGroups.map(group => {
            const filteredItems = group.items.filter(item => {
                const isModuleActive = checkModuleAccess(item.id);
                const hasPermission = canAccess ? canAccess(item.id) : true;

                // Admin Override: Admins see everything
                const isAdmin = config?.currentUser?.admin === 1 || config?.currentUser?.admin === '1' || config?.currentUser?.admin === true;

                if (isAdmin) {
                    return true;
                }

                return isModuleActive && hasPermission;
            });

            return {
                ...group,
                items: filteredItems
            };
        }).filter(group => group.items.length > 0);
    }, [config, modules, canAccess]);

    // Auto-expand group if it contains the active route
    const groupHasActiveItem = useCallback((group: MenuGroup): boolean => {
        return group.items.some(item =>
            location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path))
        );
    }, [location.pathname]);

    const handleLogout = () => {
        if (confirm("Deseja desconectar do ERP?")) {
            setConfig(null);
            navigate('/');
        }
    };

    const handleNavigate = (path: string) => {
        navigate(path);
        setIsOpen(false);
    };

    if (!config) return null;

    return (
        <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 text-white transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 lg:static lg:inset-auto flex flex-col`}>
            {/* Header / Logo */}
            <div className="p-4 flex items-center gap-3 border-b border-slate-800 shrink-0">
                <div className={`w-8 h-8 rounded-lg bg-gradient-to-br from-${config.themeColor}-500 to-${config.themeColor}-700 flex items-center justify-center font-bold text-lg shadow-lg`}>D</div>
                <span className="font-bold text-lg tracking-tight">CoolGroove</span>
                <button onClick={() => setIsOpen(false)} className="lg:hidden ml-auto text-slate-400 hover:text-white transition-colors"><X size={20} /></button>
            </div>

            {/* Scrollable Navigation */}
            <nav className="flex-1 overflow-y-auto p-4 space-y-1 custom-scrollbar">
                {visibleMenuGroups.map((group, groupIdx) => {
                    const hasTitle = !!group.title;
                    const isCollapsed = hasTitle && collapsedGroups[group.title!] && !groupHasActiveItem(group);

                    return (
                        <div key={groupIdx}>
                            {hasTitle ? (
                                <button
                                    onClick={() => toggleGroup(group.title!)}
                                    className="w-full flex items-center justify-between px-3 py-2 mt-3 mb-1 rounded-md hover:bg-slate-800/50 transition-colors group"
                                >
                                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider group-hover:text-slate-400 transition-colors">
                                        {group.title}
                                    </h3>
                                    {isCollapsed
                                        ? <ChevronRight size={14} className="text-slate-600 group-hover:text-slate-400 transition-colors" />
                                        : <ChevronDown size={14} className="text-slate-600 group-hover:text-slate-400 transition-colors" />
                                    }
                                </button>
                            ) : null}
                            <div
                                className={`space-y-0.5 overflow-hidden transition-all duration-200 ${
                                    isCollapsed ? 'max-h-0 opacity-0' : 'max-h-[1000px] opacity-100'
                                }`}
                            >
                                {group.items.map(item => {
                                    const isActive = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));
                                    return (
                                        <button
                                            key={item.id}
                                            onClick={() => handleNavigate(item.path)}
                                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all text-sm font-medium
                                                ${isActive
                                                    ? `bg-${config.themeColor}-600 text-white shadow-md`
                                                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                                                }`}
                                        >
                                            <item.icon size={18} className={isActive ? 'text-white' : 'text-slate-500'} />
                                            <span className="truncate">{item.label}</span>
                                        </button>
                                    )
                                })}
                            </div>
                        </div>
                    );
                })}
            </nav>

            {/* Footer / Logout */}
            <div className="p-4 border-t border-slate-800 shrink-0">
                <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-slate-400 hover:bg-red-900/20 hover:text-red-400 transition-colors text-sm font-medium"
                >
                    <LogOut size={16} /> Desconectar
                </button>
            </div>
        </aside>
    );
};
