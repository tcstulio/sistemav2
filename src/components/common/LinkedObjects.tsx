import React, { useMemo } from 'react';
import { useLinks } from '../../hooks/dolibarr/hooks';
import { ArrowRight, Link as LinkIcon, FileText, ShoppingCart, Truck, CreditCard, FolderKanban, Users, Box, ClipboardList, Ticket, CheckSquare, ScrollText, User, CalendarDays } from 'lucide-react';
import { useDolibarr } from '../../context/DolibarrContext';

interface LinkedObjectsProps {
    id: string; // Current Object ID
    type: string; // Current Object Type (e.g., 'propal', 'commande', 'facture')
    onNavigate?: (view: any, id: string) => void; // Using 'any' for view type temporarily to avoid import loops
}

export const LinkedObjects: React.FC<LinkedObjectsProps> = ({ id, type, onNavigate }) => {
    const { config } = useDolibarr();
    const { data: links = [] } = useLinks(config);

    // Map Dolibarr types to UI labels and icons
    const typeMapping: Record<string, { label: string, view: string, icon: React.ReactNode }> = {
        'propal': { label: 'Proposta', view: 'proposals', icon: <FileText size={14} /> },
        'commande': { label: 'Pedido', view: 'orders', icon: <ShoppingCart size={14} /> },
        'facture': { label: 'Fatura', view: 'invoices', icon: <CreditCard size={14} /> },
        'project': { label: 'Projeto', view: 'projects', icon: <FolderKanban size={14} /> },
        'project_task': { label: 'Tarefa', view: '', icon: <CheckSquare size={14} /> },
        'ticket': { label: 'Ticket', view: 'tickets', icon: <Ticket size={14} /> },
        'expedition': { label: 'Envio', view: 'shipments', icon: <Truck size={14} /> },
        'shipping': { label: 'Envio', view: 'shipments', icon: <Truck size={14} /> },
        'societe': { label: 'Terceiro', view: 'customers', icon: <Users size={14} /> },
        'product': { label: 'Produto', view: 'products', icon: <Box size={14} /> },
        'fichinter': { label: 'Intervenção', view: 'interventions', icon: <ClipboardList size={14} /> },
        'contrat': { label: 'Contrato', view: 'contracts', icon: <ScrollText size={14} /> },
        'commande_fournisseur': { label: 'Pedido Compra', view: '', icon: <ShoppingCart size={14} /> },
        'facture_fourn': { label: 'Fatura Forn.', view: '', icon: <FileText size={14} /> },
        'paiment_fourn': { label: 'Pagamento Forn.', view: '', icon: <CreditCard size={14} /> },
        'user': { label: 'Usuário', view: 'hr', icon: <User size={14} /> },
        'holiday': { label: 'Férias/Licença', view: 'hr', icon: <CalendarDays size={14} /> },
    };

    const relatedLinks = useMemo(() => {
        return links.filter(link => {
            // Check if current object is source
            if (link.sourcetype === type && String(link.sourceid) === String(id)) return true;
            // Check if current object is target
            if (link.targettype === type && String(link.targetid) === String(id)) return true;
            return false;
        }).map(link => {
            // Normalize to "User is viewing Source, showing Target" or vice versa
            // If current is source, we show target
            const isSource = link.sourcetype === type && String(link.sourceid) === String(id);

            const remoteType = isSource ? link.targettype : link.sourcetype;
            const remoteId = isSource ? link.targetid : link.sourceid;

            return {
                id: link.id,
                remoteType,
                remoteId,
                direction: isSource ? 'out' : 'in', // 'out' = This -> Other, 'in' = Other -> This
                def: typeMapping[remoteType] || { label: remoteType, view: '', icon: <LinkIcon size={14} /> }
            };
        });
    }, [links, id, type]);

    if (relatedLinks.length === 0) return null;

    return (
        <div className="bg-white dark:bg-slate-900 rounded-xl p-4 sm:p-6 border border-slate-200 dark:border-slate-800 shadow-sm mt-4 sm:mt-6 animate-in fade-in slide-in-from-bottom-2">
            <h4 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                <LinkIcon size={18} className="text-indigo-500" /> Itens Relacionados
            </h4>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                {relatedLinks.map(link => (
                    <div
                        key={link.id}
                        className={`flex items-center gap-2 sm:gap-3 p-3 rounded-lg border border-slate-100 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors min-h-[56px] ${link.def.view ? 'cursor-pointer bg-slate-50 dark:bg-slate-800/50' : 'bg-slate-50 opacity-75'}`}
                        onClick={() => {
                            if (link.def.view && onNavigate) {
                                onNavigate(link.def.view as any, link.remoteId);
                            }
                        }}
                    >
                        <div className={`p-2 rounded-full shrink-0 ${link.direction === 'out' ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300' : 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-300'}`}>
                            {link.def.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-[10px] text-slate-500 flex items-center gap-1">
                                {link.direction === 'out' ? 'Origina' : 'Originado'} <ArrowRight size={10} />
                            </div>
                            <div className="text-xs sm:text-sm font-medium text-slate-800 dark:text-white truncate">
                                {link.def.label} #{link.remoteId}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
