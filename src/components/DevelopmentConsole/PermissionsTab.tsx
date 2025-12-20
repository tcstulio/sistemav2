
import React, { useState } from 'react';
import { Copy, Check, ChevronDown, ChevronRight, Key } from 'lucide-react';
import { useDolibarr } from '../../context/DolibarrContext';

export const PermissionsTab: React.FC = () => {
    const { currentUser } = useDolibarr();
    const [permissionMapping, setPermissionMapping] = useState<Record<string, { module: string, perms: string[] }>>({});
    const [generatedCode, setGeneratedCode] = useState('');

    const APP_SCREENS = [
        { id: 'dashboard', label: 'Dashboard' },
        { id: 'customers', label: 'Clientes' },
        { id: 'suppliers', label: 'Fornecedores' },
        { id: 'contacts', label: 'Contatos' },
        { id: 'proposals', label: 'Propostas' },
        { id: 'orders', label: 'Pedidos de Venda' },
        { id: 'invoices', label: 'Faturas' },
        { id: 'payments', label: 'Pagamentos' },
        { id: 'contracts', label: 'Contratos' },
        { id: 'supplier_orders', label: 'Pedidos de Compra' },
        { id: 'supplier_invoices', label: 'Faturas de Fornecedor' },
        { id: 'projects', label: 'Projetos' },
        { id: 'tasks', label: 'Tarefas' },
        { id: 'interventions', label: 'Intervenções' },
        { id: 'agenda', label: 'Agenda' },
        { id: 'products', label: 'Produtos' },
        { id: 'services', label: 'Serviços' },
        { id: 'inventory', label: 'Estoque' },
        { id: 'shipments', label: 'Envios/Expedição' },
        { id: 'warehouses', label: 'Armazéns' },
        { id: 'movements', label: 'Movimentações' },
        { id: 'manufacturing', label: 'Manufatura (MRP)' },
        { id: 'boms', label: 'Listas de Materiais (BOM)' },
        { id: 'users', label: 'Usuários' },
        { id: 'hr', label: 'RH / Férias' },
        { id: 'tickets', label: 'Tickets' },
        { id: 'bank_accounts', label: 'Bancos' },
        { id: 'categories', label: 'Categorias' },
    ];

    const getAvailableModules = () => {
        if (!currentUser?.rights) return [];
        return Object.keys(currentUser.rights);
    };

    const getAvailablePermissions = (moduleName: string) => {
        if (!currentUser?.rights || !moduleName) return [];
        const moduleRights = currentUser.rights[moduleName];
        if (!moduleRights) return [];

        const flattenPermissions = (obj: any, prefix = ''): string[] => {
            let perms: string[] = [];
            for (const key in obj) {
                if (typeof obj[key] === 'object' && obj[key] !== null) {
                    perms = [...perms, ...flattenPermissions(obj[key], prefix + key + '.')];
                } else {
                    perms.push(prefix + key);
                }
            }
            return perms;
        };

        return flattenPermissions(moduleRights);
    };

    const handleMapChange = (screenId: string, field: 'module' | 'perm', value: string) => {
        setPermissionMapping(prev => {
            const current = prev[screenId] || { module: '', perms: [] };
            if (field === 'module') {
                return { ...prev, [screenId]: { module: value, perms: [] } };
            } else {
                return { ...prev, [screenId]: { ...current, perms: [value] } };
            }
        });
    };

    const generateMappingCode = () => {
        const code = `const rightsMap: Record<string, { module: string, perms: string[] }> = {\n` +
            Object.entries(permissionMapping)
                .filter(([_, map]) => map.module && map.perms.length > 0)
                .map(([screen, map]) => `  '${screen}': { module: '${map.module}', perms: [${map.perms.map(p => `'${p}'`).join(', ')}] },`)
                .join('\n') +
            `\n};`;
        setGeneratedCode(code);
    };

    return (
        <div className="flex h-full flex-col">
            <div className="flex-1 overflow-hidden flex">
                {/* Mapper Area */}
                <div className="flex-1 p-6 overflow-y-auto bg-slate-50 dark:bg-slate-950/50">
                    <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4">Mapeador de Permissões</h3>
                    <div className="space-y-4">
                        {APP_SCREENS.map(screen => (
                            <div key={screen.id} className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm">
                                <div className="flex flex-col md:flex-row gap-4 items-start md:items-center">
                                    <div className="w-1/4">
                                        <div className="font-bold text-slate-700 dark:text-slate-200">{screen.label}</div>
                                        <div className="text-xs text-slate-500 font-mono">{screen.id}</div>
                                    </div>

                                    <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                                        <select
                                            className="p-2 border rounded text-sm dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                            value={permissionMapping[screen.id]?.module || ''}
                                            onChange={(e) => handleMapChange(screen.id, 'module', e.target.value)}
                                        >
                                            <option value="">Selecione Módulo...</option>
                                            {getAvailableModules().map(m => <option key={m} value={m}>{m}</option>)}
                                        </select>

                                        <select
                                            className="p-2 border rounded text-sm dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                            disabled={!permissionMapping[screen.id]?.module}
                                            value={permissionMapping[screen.id]?.perms?.[0] || ''}
                                            onChange={(e) => handleMapChange(screen.id, 'perm', e.target.value)}
                                        >
                                            <option value="">Selecione Permissão...</option>
                                            {permissionMapping[screen.id]?.module && getAvailablePermissions(permissionMapping[screen.id].module).map(p => (
                                                <option key={p} value={p}>{p}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Code Sidebar */}
                <div className="w-96 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col p-4">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="font-bold dark:text-white">Código Gerado</h3>
                        <button onClick={generateMappingCode} className="btn btn-sm btn-primary text-xs bg-blue-600 text-white px-3 py-1 rounded">Generate</button>
                    </div>
                    <div className="flex-1 bg-slate-900 p-4 rounded-lg overflow-auto border border-slate-700">
                        <pre className="text-green-400 text-xs font-mono whitespace-pre-wrap">{generatedCode || '// Configure o mapeamento e clique em Generate'}</pre>
                    </div>
                </div>
            </div>
        </div>
    );
};
