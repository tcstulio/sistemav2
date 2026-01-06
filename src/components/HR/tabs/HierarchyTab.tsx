import React, { useMemo, useState } from 'react';
import { DolibarrUser, DolibarrConfig } from '../../../types';
import { UserAvatar } from '../UserAvatar';
import { ChevronDown, ChevronRight, User as UserIcon, Network } from 'lucide-react';

interface HierarchyTabProps {
    users: DolibarrUser[];
    config: DolibarrConfig;
    onSelectUser: (u: DolibarrUser) => void;
}

interface TreeNode {
    user: DolibarrUser;
    children: TreeNode[];
}

const TreeNodeView: React.FC<{ node: TreeNode; depth: number; config: DolibarrConfig; onSelectUser: (u: DolibarrUser) => void }> = ({ node, depth, config, onSelectUser }) => {
    const [isExpanded, setIsExpanded] = useState(true);
    const hasChildren = node.children.length > 0;

    return (
        <div className="flex flex-col relative">
            <div
                className={`flex items-center gap-3 p-3 my-1 rounded-lg border hover:shadow-md transition-all cursor-pointer bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700`}
                style={{ marginLeft: `${depth * 28}px` }}
                onClick={() => onSelectUser(node.user)}
            >
                <button
                    className={`p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition-colors ${hasChildren ? 'opacity-100' : 'opacity-0 cursor-default'}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        if (hasChildren) setIsExpanded(!isExpanded);
                    }}
                >
                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>

                <UserAvatar user={node.user} config={config} size="sm" />

                <div className="flex flex-col">
                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                        {node.user.firstname} {node.user.lastname}
                    </span>
                    <span className="text-xs text-slate-500">
                        {node.user.job || node.user.login}
                    </span>
                </div>
            </div>

            {isExpanded && hasChildren && (
                <div className="relative">
                    {/* Can add vertical lines here later if needed for better visualization */}
                    {node.children.map(child => (
                        <TreeNodeView key={child.user.id} node={child} depth={depth + 1} config={config} onSelectUser={onSelectUser} />
                    ))}
                </div>
            )}
        </div>
    );
};

export const HierarchyTab: React.FC<HierarchyTabProps> = ({ users, config, onSelectUser }) => {

    // Build Tree Structure
    const treeData = useMemo(() => {
        const userMap = new Map<string, TreeNode>();
        const roots: TreeNode[] = [];

        // 1. Initialize Nodes
        users.forEach(u => {
            userMap.set(u.id, { user: u, children: [] });
        });

        // 2. Connect Relationships
        users.forEach(u => {
            const node = userMap.get(u.id)!;
            // Check if user has supervisor AND supervisor exists in our list AND isn't self (prevent loops)
            if (u.supervisor_id && userMap.has(u.supervisor_id) && u.supervisor_id !== u.id) {
                const parent = userMap.get(u.supervisor_id)!;
                parent.children.push(node);
            } else {
                roots.push(node);
            }
        });

        // Optional: Sort roots and children by name?
        const sortNodes = (nodes: TreeNode[]) => {
            nodes.sort((a, b) => {
                const nameA = (a.user.firstname || a.user.login).toLowerCase();
                const nameB = (b.user.firstname || b.user.login).toLowerCase();
                return nameA.localeCompare(nameB);
            });
            nodes.forEach(n => sortNodes(n.children));
        };
        sortNodes(roots);

        return roots;
    }, [users]);

    if (users.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <Network size={48} className="mb-4 opacity-50" />
                <p>Nenhum usuário encontrado para construir a hierarquia.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4 p-4 pb-20">
            <div className="mb-6">
                <h3 className="text-lg font-medium text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    <Network className="h-5 w-5 text-indigo-500" />
                    Organograma da Empresa
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                    Visualização da estrutura hierárquica baseada nos supervisores definidos.
                </p>
            </div>

            {treeData.length > 5 && (
                <div className="flex items-center gap-2 p-3 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 text-sm rounded-lg border border-indigo-100 dark:border-indigo-900/50 mb-4">
                    <Network className="h-4 w-4" />
                    <p>Exibindo {treeData.length} grupos principais (raízes).</p>
                </div>
            )}

            <div className="space-y-1">
                {treeData.map(node => (
                    <TreeNodeView key={node.user.id} node={node} depth={0} config={config} onSelectUser={onSelectUser} />
                ))}
            </div>
        </div>
    );
};
