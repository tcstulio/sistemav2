/**
 * Breadcrumbs Navigation Component
 *
 * Provides hierarchical navigation context for users.
 */

import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

// Route to label mapping
const ROUTE_LABELS: Record<string, string> = {
    // Core
    '': 'Dashboard',
    'my-tasks': 'Minhas Tarefas',
    'agenda': 'Agenda',

    // Communication
    'whatsapp': 'WhatsApp',
    'email': 'E-mail',
    'chat': 'Chat',
    'automation': 'Automação',

    // CRM
    'customers': 'Clientes',
    'suppliers': 'Fornecedores',
    'venues': 'Espaços',
    'contacts': 'Contatos',

    // Sales
    'proposals': 'Propostas',
    'orders': 'Pedidos',
    'invoices': 'Faturas',
    'shipments': 'Envios',
    'contracts': 'Contratos',

    // Purchasing
    'supplier_proposals': 'Cotações',
    'supplier_invoices': 'Faturas de Fornecedor',
    'smart_quotation': 'Cotação Inteligente',

    // Financial
    'payments': 'Pagamentos',
    'supplier_payments': 'Pagamentos de Fornecedor',
    'tax_payments': 'Impostos',
    'salary_payments': 'Salários',
    'expense_report_payments': 'Despesas',
    'pending_payments': 'Pendências',
    'bank_accounts': 'Bancos',

    // Projects
    'projects': 'Projetos',
    'tasks': 'Tarefas',
    'tickets': 'Chamados',
    'interventions': 'Intervenções',

    // Products
    'products': 'Produtos',
    'services': 'Serviços',
    'categories': 'Categorias',
    'inventory': 'Estoque',
    'manufacturing': 'Produção',

    // HR
    'hr': 'RH',

    // Reports
    'reports': 'Relatórios',
    'monthly-report': 'Relatório Mensal',
    'activity': 'Atividades',

    // System
    'settings': 'Configurações',
    'development': 'Desenvolvimento',
    'simulator': 'Simulador'
};

// Parent route mapping for nested routes
const PARENT_ROUTES: Record<string, string> = {
    'smart_quotation': 'supplier_proposals',
    'monthly-report': 'reports',
    'my-tasks': 'projects',
    'tasks': 'projects'
};

interface BreadcrumbItem {
    label: string;
    path: string;
    isLast: boolean;
}

interface BreadcrumbsProps {
    className?: string;
    showHome?: boolean;
    customItems?: BreadcrumbItem[];
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({
    className = '',
    showHome = true,
    customItems
}) => {
    const location = useLocation();

    // Build breadcrumb items from current path
    const items: BreadcrumbItem[] = React.useMemo(() => {
        if (customItems) return customItems;

        const pathSegments = location.pathname.split('/').filter(Boolean);
        const breadcrumbs: BreadcrumbItem[] = [];

        // Add parent route if exists
        if (pathSegments.length > 0) {
            const firstSegment = pathSegments[0];
            const parentRoute = PARENT_ROUTES[firstSegment];

            if (parentRoute) {
                breadcrumbs.push({
                    label: ROUTE_LABELS[parentRoute] || parentRoute,
                    path: `/${parentRoute}`,
                    isLast: false
                });
            }
        }

        // Build path incrementally
        let currentPath = '';
        pathSegments.forEach((segment, index) => {
            currentPath += `/${segment}`;

            // Skip numeric IDs in breadcrumb labels but keep in path
            const isId = /^\d+$/.test(segment);

            if (!isId) {
                const label = ROUTE_LABELS[segment] || segment.charAt(0).toUpperCase() + segment.slice(1);
                breadcrumbs.push({
                    label,
                    path: currentPath,
                    isLast: index === pathSegments.length - 1
                });
            } else if (index === pathSegments.length - 1) {
                // If last segment is an ID, mark previous as not last
                if (breadcrumbs.length > 0) {
                    breadcrumbs[breadcrumbs.length - 1].isLast = false;
                }
                // Add ID as "Detalhes"
                breadcrumbs.push({
                    label: 'Detalhes',
                    path: currentPath,
                    isLast: true
                });
            }
        });

        return breadcrumbs;
    }, [location.pathname, customItems]);

    // Don't show breadcrumbs on dashboard
    if (location.pathname === '/' && !customItems) {
        return null;
    }

    return (
        <nav
            aria-label="Breadcrumb"
            className={`flex items-center text-sm text-slate-500 dark:text-slate-400 ${className}`}
        >
            <ol className="flex items-center gap-1 flex-wrap">
                {showHome && (
                    <li className="flex items-center">
                        <Link
                            to="/"
                            className="flex items-center hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                            title="Dashboard"
                        >
                            <Home size={16} />
                        </Link>
                        {items.length > 0 && (
                            <ChevronRight size={14} className="mx-1 text-slate-400" />
                        )}
                    </li>
                )}

                {items.map((item, index) => (
                    <li key={item.path} className="flex items-center">
                        {item.isLast ? (
                            <span className="font-medium text-slate-700 dark:text-slate-200">
                                {item.label}
                            </span>
                        ) : (
                            <>
                                <Link
                                    to={item.path}
                                    className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                                >
                                    {item.label}
                                </Link>
                                <ChevronRight size={14} className="mx-1 text-slate-400" />
                            </>
                        )}
                    </li>
                ))}
            </ol>
        </nav>
    );
};

/**
 * Hook to get current page title from route
 */
export function usePageTitle(): string {
    const location = useLocation();
    const pathSegments = location.pathname.split('/').filter(Boolean);

    if (pathSegments.length === 0) {
        return 'Dashboard';
    }

    const lastSegment = pathSegments[pathSegments.length - 1];

    // If it's an ID, use the previous segment
    if (/^\d+$/.test(lastSegment) && pathSegments.length > 1) {
        const parentSegment = pathSegments[pathSegments.length - 2];
        return ROUTE_LABELS[parentSegment] || parentSegment;
    }

    return ROUTE_LABELS[lastSegment] || lastSegment.charAt(0).toUpperCase() + lastSegment.slice(1);
}

export default Breadcrumbs;
