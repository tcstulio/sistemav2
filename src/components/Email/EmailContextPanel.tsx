import React from 'react';
import { X, ExternalLink, Briefcase, UserCircle, FileText, ShoppingCart, Ticket as TicketIcon, Plus } from 'lucide-react';
import { ThirdParty, Invoice, Order, Ticket, AppView } from '../../types';
import { formatDateOnly } from '../../utils/dateUtils';
import { formatCurrency } from '../../utils/formatUtils';

interface EmailContextPanelProps {
    isOpen: boolean;
    onClose: () => void;
    contextData: {
        customer?: ThirdParty;
        invoices: Invoice[];
        orders: Order[];
        tickets: Ticket[];
    } | null;
    onNavigate?: (view: AppView, id: string) => void;
    emailAddress?: string;
}

export const EmailContextPanel: React.FC<EmailContextPanelProps> = ({ isOpen, onClose, contextData, onNavigate, emailAddress }) => {

    return (
        <div className={`
            fixed inset-y-0 right-0 w-80 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 z-[100] shadow-2xl transition-transform duration-300 ease-in-out
            ${isOpen ? 'translate-x-0' : 'translate-x-full'}
            xl:relative xl:translate-x-0 xl:shadow-none xl:z-auto xl:w-80 xl:flex-none
            ${isOpen ? 'xl:block' : 'xl:hidden'}
        `}>
            {/* Mobile Overlay Backdrop */}
            {isOpen && (
                <div
                    className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[-1] xl:hidden"
                    onClick={onClose}
                />
            )}

            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-900/50">
                <div>
                    <h3 className="font-bold text-slate-800 dark:text-white text-lg">Contexto</h3>
                    <p className="text-xs text-slate-500">
                        {emailAddress || 'Nenhum email selecionado'}
                    </p>
                </div>
                <button
                    onClick={onClose}
                    className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full text-slate-500 xl:hidden"
                >
                    <X size={20} />
                </button>
            </div>

            <div className="p-4 space-y-6 overflow-y-auto h-[calc(100%-60px)]">
                {/* Customer Info */}
                {contextData?.customer ? (
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-full">
                                <Briefcase size={18} />
                            </div>
                            <div className="min-w-0">
                                <h4 className="font-bold text-slate-800 dark:text-white text-sm truncate">{contextData.customer.name}</h4>
                                <p className="text-xs text-slate-500 truncate">{contextData.customer.email}</p>
                            </div>
                        </div>
                        <button
                            onClick={() => onNavigate && onNavigate('customers', contextData.customer!.id)}
                            className="w-full py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center justify-center gap-1"
                        >
                            Ver Perfil Completo <ExternalLink size={10} />
                        </button>
                    </div>
                ) : (
                    <div className="text-center p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
                        <UserCircle size={32} className="mx-auto text-slate-400 mb-2 opacity-50" />
                        <p className="text-xs text-slate-500 mb-2">Cliente não encontrado.</p>
                        <button className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">Vincular Manualmente</button>
                    </div>
                )}

                {/* Recent Invoices */}
                <div>
                    <h4 className="font-bold text-slate-700 dark:text-slate-300 text-sm mb-2 flex items-center gap-2">
                        <FileText size={14} /> Faturas Recentes
                    </h4>
                    {contextData?.invoices && contextData.invoices.length > 0 ? (
                        <div className="space-y-2">
                            {contextData.invoices.map(inv => (
                                <div
                                    key={inv.id}
                                    className="p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700 flex justify-between items-center cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                    onClick={() => onNavigate && onNavigate('invoices', inv.id)}
                                >
                                    <div>
                                        <div className="text-xs font-bold text-slate-700 dark:text-slate-300">{inv.ref}</div>
                                        <div className="text-[10px] text-slate-500">{formatDateOnly(inv.date)}</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xs font-bold text-slate-800 dark:text-white">{formatCurrency(inv.total_ttc)}</div>
                                        <span className={`text-[8px] px-1.5 py-0.5 rounded-full ${inv.statut === '2' ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700'}`}>
                                            {inv.statut === '2' ? 'Pago' : 'Aberto'}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : <p className="text-xs text-slate-400 italic">Nenhuma fatura recente.</p>}
                </div>

                {/* Active Orders */}
                <div>
                    <h4 className="font-bold text-slate-700 dark:text-slate-300 text-sm mb-2 flex items-center gap-2">
                        <ShoppingCart size={14} /> Pedidos em Aberto
                    </h4>
                    {contextData?.orders && contextData.orders.length > 0 ? (
                        <div className="space-y-2">
                            {contextData.orders.map(ord => (
                                <div
                                    key={ord.id}
                                    className="p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700 flex justify-between items-center cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                    onClick={() => onNavigate && onNavigate('orders', ord.id)}
                                >
                                    <div>
                                        <div className="text-xs font-bold text-slate-700 dark:text-slate-300">{ord.ref}</div>
                                        <div className="text-[10px] text-slate-500">{formatDateOnly(ord.date)}</div>
                                    </div>
                                    <div className="text-xs font-bold text-slate-800 dark:text-white">{formatCurrency(ord.total_ttc)}</div>
                                </div>
                            ))}
                        </div>
                    ) : <p className="text-xs text-slate-400 italic">Nenhum pedido ativo.</p>}
                </div>

                {/* Recent Tickets */}
                <div>
                    <h4 className="font-bold text-slate-700 dark:text-slate-300 text-sm mb-2 flex items-center gap-2">
                        <TicketIcon size={14} /> Chamados Recentes
                    </h4>
                    {contextData?.tickets && contextData.tickets.length > 0 ? (
                        <div className="space-y-2">
                            {contextData.tickets.map(tkt => (
                                <div
                                    key={tkt.id}
                                    className="p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                    onClick={() => onNavigate && onNavigate('tickets', tkt.id)}
                                >
                                    <div className="text-xs font-bold text-slate-700 dark:text-slate-300 line-clamp-1">{tkt.subject}</div>
                                    <div className="flex justify-between items-center mt-1">
                                        <span className="text-[10px] text-slate-500">{tkt.ref}</span>
                                        <span className={`text-[8px] px-1.5 py-0.5 rounded-full ${tkt.statut === 'CLOSED' ? 'bg-slate-200 text-slate-600' : 'bg-blue-100 text-blue-700'}`}>
                                            {tkt.statut}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : <p className="text-xs text-slate-400 italic">Nenhum chamado recente.</p>}
                </div>

                {contextData?.customer && (
                    <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                        <button className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm flex items-center justify-center gap-2 transition-colors">
                            <Plus size={14} /> Criar Novo Ticket
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
