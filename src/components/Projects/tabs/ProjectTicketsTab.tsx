import React from 'react';
import { Plus, Pencil, AlertTriangle } from 'lucide-react';
import { Ticket } from '../../../types/crm';
import { ConfirmDeleteButton } from '../../ui';

interface ProjectTicketsTabProps {
    tickets: Ticket[];
    onCreateTicket: () => void;
    onEditTicket: (ticket: Ticket) => void;
    onDeleteTicket: (ticketId: string) => Promise<void>;
    refreshData?: () => void;
}

export const ProjectTicketsTab: React.FC<ProjectTicketsTabProps> = ({
    tickets,
    onCreateTicket,
    onEditTicket,
    onDeleteTicket,
    refreshData
}) => {
    return (
        <div className="space-y-3">
            <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-slate-800 dark:text-white">Chamados Vinculados</h3>
                <button
                    onClick={onCreateTicket}
                    className="flex items-center gap-2 px-3 py-1.5 bg-orange-600 text-white rounded-lg text-xs font-medium hover:bg-orange-700 transition-colors"
                >
                    <Plus size={16} /> Novo Chamado
                </button>
            </div>

            {tickets.length === 0 ? (
                <p className="text-center text-slate-400 py-10">Nenhum chamado encontrado.</p>
            ) : (
                tickets.map(t => (
                    <div
                        key={t.id}
                        className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex justify-between items-center hover:shadow-sm transition-shadow group"
                    >
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${t.type_code === 'ISSUE' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                                <AlertTriangle size={20} />
                            </div>
                            <div>
                                <div className="font-bold text-slate-800 dark:text-white text-sm">{t.ref} - {t.subject}</div>
                                <div className="text-xs text-slate-500">{t.message?.substring(0, 50)}...</div>
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="text-right text-xs">
                                <div className="font-bold text-slate-700 dark:text-slate-300">{t.severity_code}</div>
                                <div className="text-slate-400">{t.statut}</div>
                            </div>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                    onClick={() => onEditTicket(t)}
                                    className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"
                                >
                                    <Pencil size={16} />
                                </button>
                                <ConfirmDeleteButton
                                    onDelete={() => onDeleteTicket(t.id)}
                                    onDeleted={refreshData}
                                    itemLabel={t.ref}
                                />
                            </div>
                        </div>
                    </div>
                ))
            )}
        </div>
    );
};

export default ProjectTicketsTab;
