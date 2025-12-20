
import { Users, FileText, FolderKanban, Package, Factory } from 'lucide-react';

export type CoverageStatus = 'implemented' | 'mocked' | 'gap' | 'limitation';

export interface ApiFunction {
    name: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    endpoint: string;
    status: CoverageStatus;
    notes?: string;
    bodyTemplate?: object; // Template for POST/PUT
}

export interface DomainCoverage {
    id: string;
    title: string;
    icon: any;
    description: string;
    functions: ApiFunction[];
}

export const API_COVERAGE_MATRIX: DomainCoverage[] = [
    {
        id: 'crm',
        title: 'CRM & Vendas',
        icon: Users,
        description: 'Terceiros, Contatos e Pipeline',
        functions: [
            { name: 'Listar Terceiros', method: 'GET', endpoint: '/thirdparties', status: 'implemented' },
            { name: 'Criar Terceiro', method: 'POST', endpoint: '/thirdparties', status: 'implemented', bodyTemplate: { name: "Novo Cliente", client: "1", code_client: "auto", email: "teste@api.com" } },
            { name: 'Ler Terceiro', method: 'GET', endpoint: '/thirdparties/{id}', status: 'implemented' },
            { name: 'Atualizar Terceiro', method: 'PUT', endpoint: '/thirdparties/{id}', status: 'implemented', bodyTemplate: { name: "Nome Atualizado" } },
            { name: 'Excluir Terceiro', method: 'DELETE', endpoint: '/thirdparties/{id}', status: 'implemented' },
            { name: 'Listar Contatos', method: 'GET', endpoint: '/contacts', status: 'implemented' },
        ]
    },
    {
        id: 'billing',
        title: 'Faturamento & Pagamentos',
        icon: FileText,
        description: 'Faturas, Pedidos e Pagamentos',
        functions: [
            { name: 'Listar Faturas', method: 'GET', endpoint: '/invoices', status: 'implemented' },
            { name: 'Criar Fatura', method: 'POST', endpoint: '/invoices', status: 'implemented', bodyTemplate: { socid: "1", date: Date.now() / 1000, lines: [] } },
            { name: 'Validar Fatura', method: 'POST', endpoint: '/invoices/{id}/validate', status: 'implemented' },
            { name: 'Adicionar Pagamento', method: 'POST', endpoint: '/invoices/{id}/payments', status: 'implemented' },
            { name: 'Listar Pedidos', method: 'GET', endpoint: '/orders', status: 'implemented' },
        ]
    },
    {
        id: 'projects',
        title: 'Projetos & Tarefas',
        icon: FolderKanban,
        description: 'Gestão de projetos e tempo',
        functions: [
            { name: 'Listar Projetos', method: 'GET', endpoint: '/projects', status: 'implemented' },
            { name: 'Criar Projeto', method: 'POST', endpoint: '/projects', status: 'implemented' },
            { name: 'Listar Tarefas', method: 'GET', endpoint: '/tasks', status: 'implemented' },
            { name: 'Add Tempo Gasto', method: 'POST', endpoint: '/tasks/{id}/addtimespent', status: 'implemented' },
        ]
    },
    {
        id: 'stock',
        title: 'Estoque & Inventário',
        icon: Package,
        description: 'Armazéns e Movimentações',
        functions: [
            { name: 'Listar Armazéns', method: 'GET', endpoint: '/warehouses', status: 'implemented' },
            { name: 'Listar Movimentos', method: 'GET', endpoint: '/stockmovements', status: 'implemented' },
            { name: 'Criar Movimento', method: 'POST', endpoint: '/stockmovements', status: 'implemented', bodyTemplate: { product_id: "1", warehouse_id: "1", qty: 1, type: 3 } },
        ]
    },
    {
        id: 'mrp',
        title: 'Manufatura (MRP)',
        icon: Factory,
        description: 'Ordens de Produção e BOMs',
        functions: [
            { name: 'Listar OPs', method: 'GET', endpoint: '/mrp/mo', status: 'implemented' },
            { name: 'Criar OP', method: 'POST', endpoint: '/mrp/mo', status: 'implemented' },
            { name: 'Listar BOMs', method: 'GET', endpoint: '/bom/bom', status: 'implemented' },
        ]
    }
];
