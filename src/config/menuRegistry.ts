// #110 — Fonte ÚNICA da estrutura do menu lateral (grupos -> itens).
// Os ÍCONES NÃO ficam aqui de propósito: o Sidebar mantém um mapa `id -> icon`,
// e o editor (MenuConfigEditor) consome só {id, label}, ficando leve.
// O Sidebar usa este registry + o mapa de ícones para montar os grupos,
// depois aplica o filtro de permissão (RBAC) e, por cima, ordem/visibilidade (#110).

export interface MenuRegistryItem {
    /** id estável usado por RBAC, ícones e prefs de ordem/visibilidade */
    id: string;
    /** caminho de navegação */
    path: string;
    /** rótulo exibido */
    label: string;
}

export interface MenuRegistryGroup {
    /** título do grupo (ausente no grupo "raiz" sem cabeçalho) */
    title?: string;
    items: MenuRegistryItem[];
}

export const MENU_REGISTRY: MenuRegistryGroup[] = [
    {
        items: [
            { id: 'dashboard', path: '/', label: 'Painel Principal' },
            { id: 'my-tasks', path: '/my-tasks', label: 'Minhas Tarefas' },
            { id: 'agenda', path: '/agenda', label: 'Agenda' },
        ],
    },
    {
        title: 'AGENTE IA',
        items: [
            { id: 'whatsapp', path: '/whatsapp', label: 'WhatsApp Omni' },
            { id: 'chat', path: '/chat', label: 'Chat Interno' },
            { id: 'email', path: '/email', label: 'Emails' },
            { id: 'automation', path: '/automation', label: 'Automação' },
            { id: 'venues', path: '/venues', label: 'Espaços' },
            { id: 'centrovibe', path: '/centrovibe', label: 'CentroVibe' },
            { id: 'simulator', path: '/simulator', label: 'Simulador' },
        ],
    },
    {
        title: 'VENDAS & CRM',
        items: [
            { id: 'customers', path: '/customers', label: 'Clientes' },
            { id: 'proposals', path: '/proposals', label: 'Propostas' },
            { id: 'orders', path: '/orders', label: 'Pedidos de Venda' },
            { id: 'shipments', path: '/shipments', label: 'Envios' },
            { id: 'contracts', path: '/contracts', label: 'Contratos' },
            { id: 'interventions', path: '/interventions', label: 'Intervenções' },
            { id: 'tickets', path: '/tickets', label: 'Chamados' },
        ],
    },
    {
        title: 'FINANCEIRO',
        items: [
            { id: 'invoices', path: '/invoices', label: 'Faturas' },
            { id: 'payments', path: '/payments', label: 'Pagamentos' },
            { id: 'tax_payments', path: '/tax_payments', label: 'Impostos e Encargos' },
        ],
    },
    {
        title: 'COMPRAS & DESPESAS',
        items: [
            { id: 'suppliers', path: '/suppliers', label: 'Fornecedores' },
            { id: 'supplier_proposals', path: '/supplier_proposals', label: 'Solicitações de Preço' },
            { id: 'supplier_invoices', path: '/supplier_invoices', label: 'Faturas de Fornecedor' },
            { id: 'supplier_payments', path: '/supplier_payments', label: 'Pagamentos de Fornecedor' },
            { id: 'pending_payments', path: '/pending_payments', label: 'Pendências Financeiras' },
            { id: 'expense_report_payments', path: '/expense_report_payments', label: 'Pagamentos de Despesas' },
        ],
    },
    {
        title: 'GESTÃO & OPERACIONAL',
        items: [
            { id: 'projects', path: '/projects', label: 'Projetos' },
            { id: 'hr', path: '/hr', label: 'RH & Equipe' },
            { id: 'salary_payments', path: '/salary_payments', label: 'Salários' },
            { id: 'bank_accounts', path: '/bank_accounts', label: 'Bancos' },
            { id: 'reports', path: '/reports', label: 'Relatórios' },
            { id: 'monthly_report', path: '/monthly-report', label: 'Relatório Mensal (IA)' },
        ],
    },
    {
        title: 'ESTOQUE & PRODUTOS',
        items: [
            { id: 'products', path: '/products', label: 'Produtos' },
            { id: 'categories', path: '/categories', label: 'Categorias/Tags' },
            { id: 'inventory', path: '/inventory', label: 'Estoque' },
            { id: 'warehouses', path: '/warehouses', label: 'Estoques' },
            { id: 'manufacturing', path: '/manufacturing', label: 'Produção' },
        ],
    },
    {
        title: 'SISTEMA',
        items: [
            { id: 'opencode-tasks', path: '/opencode-tasks', label: 'Tasks (opencode)' },
            { id: 'activity', path: '/activity', label: 'Atividades' },
            { id: 'groups', path: '/admin/groups', label: 'Grupos' },
            { id: 'development', path: '/development', label: 'Console Dev' },
            { id: 'chat_sessions', path: '/chat-sessions', label: 'Sessões IA' },
            { id: 'settings', path: '/settings', label: 'Configurações' },
        ],
    },
];

/** Lista achatada de todos os itens (útil p/ editor e testes). */
export const MENU_REGISTRY_ITEMS: MenuRegistryItem[] = MENU_REGISTRY.flatMap((g) => g.items);
