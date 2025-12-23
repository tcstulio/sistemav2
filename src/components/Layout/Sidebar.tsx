import React, { useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useDolibarr } from '../../context/DolibarrContext';
import { useModules } from '../../hooks/dolibarr';
import { Layout, Users, FileText, Package, ShoppingCart, Truck, Settings, LifeBuoy, BarChart3, Menu, X, LogOut, FileSignature, TrendingUp, PenTool, Factory, FolderKanban, ClipboardList, Landmark, CalendarDays, Tag, MessageSquare, Activity, Bug, UserCircle, Bot, Mail } from 'lucide-react';

interface SidebarProps {
    isOpen: boolean;
    setIsOpen: (open: boolean) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, setIsOpen }) => {
    const { config, setConfig, canAccess } = useDolibarr();
    const { data: modules } = useModules(config);
    const navigate = useNavigate();
    const location = useLocation();

    // Menu Configuration
    const menuItems = [
        { id: 'dashboard', path: '/', label: 'Painel Principal', icon: Layout },
        { id: 'whatsapp', path: '/whatsapp', label: 'WhatsApp Omni', icon: MessageSquare },
        { id: 'email', path: '/email', label: 'Emails', icon: Mail },
        { id: 'automation', path: '/automation', label: 'Automação', icon: Bot },
        { id: 'agenda', path: '/agenda', label: 'Agenda', icon: CalendarDays },
        { id: 'projects', path: '/projects', label: 'Projetos', icon: FolderKanban },
        { id: 'customers', path: '/customers', label: 'Clientes', icon: Users },
        { id: 'suppliers', path: '/suppliers', label: 'Fornecedores', icon: Truck },
        { id: 'proposals', path: '/proposals', label: 'Propostas', icon: FileSignature },
        { id: 'orders', path: '/orders', label: 'Pedidos de Venda', icon: ShoppingCart },
        { id: 'shipments', path: '/shipments', label: 'Envios', icon: Truck },
        { id: 'invoices', path: '/invoices', label: 'Faturas', icon: FileText },
        { id: 'payments', path: '/payments', label: 'Pagamentos', icon: TrendingUp },
        { id: 'contracts', path: '/contracts', label: 'Contratos', icon: PenTool },
        { id: 'products', path: '/products', label: 'Produtos', icon: Package },
        { id: 'categories', path: '/categories', label: 'Categorias/Tags', icon: Tag },
        { id: 'inventory', path: '/inventory', label: 'Estoque', icon: Factory },
        { id: 'manufacturing', path: '/manufacturing', label: 'Produção', icon: Settings },
        { id: 'interventions', path: '/interventions', label: 'Intervenções', icon: ClipboardList },
        { id: 'tickets', path: '/tickets', label: 'Chamados', icon: LifeBuoy },
        { id: 'bank_accounts', path: '/bank_accounts', label: 'Bancos', icon: Landmark },
        { id: 'hr', path: '/hr', label: 'RH & Equipe', icon: UserCircle },
        { id: 'reports', path: '/reports', label: 'Relatórios', icon: BarChart3 },
        { id: 'activity', path: '/activity', label: 'Atividades', icon: Activity },

        { id: 'development', path: '/development', label: 'Console Dev', icon: Bug }
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
            case 'products': return activeModules.includes('product') || activeModules.includes('service');
            default: return true;
        }
    };

    // Filter Logic
    const visibleMenuItems = useMemo(() => {
        return menuItems.filter(item => {
            const isModuleActive = checkModuleAccess(item.id);
            const hasPermission = canAccess ? canAccess(item.id) : true;

            // Admin Override: Admins see everything, even if module is technically 'off' in ERP (Fallback)
            const isAdmin = config?.currentUser?.admin === 1 || config?.currentUser?.admin === '1' || config?.currentUser?.admin === true;

            if (isAdmin) {
                return true;
            }

            return isModuleActive && hasPermission;
        });
    }, [config, modules, canAccess]);

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
        <aside className={`fixed inset-y-0 left-0 z-30 w-64 bg-slate-900 text-white transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 lg:static lg:inset-auto flex flex-col`}>
            <div className="p-4 flex items-center gap-3 border-b border-slate-800">
                <div className={`w-8 h-8 rounded-lg bg-gradient-to-br from-${config.themeColor}-500 to-${config.themeColor}-700 flex items-center justify-center font-bold text-lg`}>D</div>
                <span className="font-bold text-lg tracking-tight">DoliGenAI</span>
                <button onClick={() => setIsOpen(false)} className="lg:hidden ml-auto text-slate-400"><X size={20} /></button>
            </div>

            <nav className="flex-1 overflow-y-auto p-4 space-y-1 custom-scrollbar">
                {visibleMenuItems.map(item => {
                    const isActive = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));
                    return (
                        <button
                            key={item.id}
                            onClick={() => handleNavigate(item.path)}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${isActive ? `bg-${config.themeColor}-600 text-white shadow-md` : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
                        >
                            <item.icon size={18} />
                            <span className="font-medium text-sm">{item.label}</span>
                        </button>
                    )
                })}
            </nav>

            <div className="p-4 border-t border-slate-800">
                <button onClick={handleLogout} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors text-sm">
                    <LogOut size={16} /> Desconectar
                </button>
            </div>
        </aside>
    );
};
