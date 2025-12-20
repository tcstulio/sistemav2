import React from 'react';
import { X, ExternalLink, Briefcase, UserCircle, FileText, ShoppingCart, Ticket as TicketIcon, Plus } from 'lucide-react';
import { ThirdParty, Invoice, Order, Ticket, AppView } from '../../types';

interface ContextPanelProps {
    isOpen: boolean;
    onClose: () => void;
    contextData: {
        customer?: ThirdParty;
        invoices: Invoice[];
        orders: Order[];
        tickets: Ticket[];
    } | null;
    onNavigate?: (view: AppView, id: string) => void;
    // [ANTIGRAVITY] New Props
    conversation?: any; // WhatsAppConversation
    chatSettings?: any;
    onUpdateSettings?: (settings: any) => void;
}

export const ContextPanel: React.FC<ContextPanelProps> = ({ isOpen, onClose, contextData, onNavigate, conversation, chatSettings, onUpdateSettings }) => {
    const [activeTab, setActiveTab] = React.useState<'crm' | 'settings'>('crm');

    // Group Config Local State
    const [localGroupSettings, setLocalGroupSettings] = React.useState<any>({});

    React.useEffect(() => {
        if (chatSettings?.groupSettings) {
            setLocalGroupSettings(chatSettings.groupSettings);
        } else {
            setLocalGroupSettings({
                llmEnabled: false,
                responseFrequency: { value: 1, unit: 'hours' },
                burstHandling: { enabled: false, threshold: 5 }
            });
        }
    }, [chatSettings]);

    // Reset tab when conversation changes
    React.useEffect(() => {
        if (conversation && !conversation.isGroup) {
            setActiveTab('crm');
        } else if (conversation && conversation.isGroup) {
            // Keep current tab or default to CRM? Default to CRM is safer.
            setActiveTab('crm');
        }
    }, [conversation?.id]);

    const handleSaveGroupSettings = () => {
        if (onUpdateSettings) {
            onUpdateSettings({
                groupSettings: localGroupSettings
            });
        }
    };
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
                    <h3 className="font-bold text-slate-800 dark:text-white text-lg">Contexto & Opções</h3>
                    <p className="text-xs text-slate-500">
                        {conversation?.isGroup ? 'Grupo' : 'Cliente vinculado'}
                    </p>
                </div>
                <button
                    onClick={onClose}
                    className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full text-slate-500 xl:hidden"
                >
                    <X size={20} />
                </button>
            </div>

            <div className="flex border-b border-slate-200 dark:border-slate-800">
                <button
                    onClick={() => setActiveTab('crm')}
                    className={`flex-1 py-2 text-xs font-semibold ${activeTab === 'crm' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500'}`}
                >
                    CRM
                </button>
                {conversation?.isGroup && (
                    <button
                        onClick={() => setActiveTab('settings')}
                        className={`flex-1 py-2 text-xs font-semibold ${activeTab === 'settings' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500'}`}
                    >
                        Config. Grupo
                    </button>
                )}
            </div>

            <div className="p-4 space-y-6 overflow-y-auto h-[calc(100%-110px)]">
                {activeTab === 'crm' ? (
                    <>
                        {/* Customer Info */}
                        {contextData?.customer ? (
                            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700">
                                <div className="flex items-center gap-3 mb-3">
                                    <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-full">
                                        <Briefcase size={18} />
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-slate-800 dark:text-white text-sm">{contextData.customer.name}</h4>
                                        <p className="text-xs text-slate-500">{contextData.customer.email}</p>
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
                                                <div className="text-[10px] text-slate-500">{new Date(inv.date * 1000).toLocaleDateString()}</div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-xs font-bold text-slate-800 dark:text-white">${inv.total_ttc}</div>
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
                                                <div className="text-[10px] text-slate-500">{new Date(ord.date * 1000).toLocaleDateString()}</div>
                                            </div>
                                            <div className="text-xs font-bold text-slate-800 dark:text-white">${ord.total_ttc}</div>
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
                    </>
                ) : (
                    // Settings Tab
                    <div className="space-y-6">
                        <div className="p-3 bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300 text-xs rounded-lg">
                            Configurações exclusivas para este grupo.
                        </div>

                        <div className="p-3 bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300 text-xs rounded-lg">
                            Atenção: A ativação do Bot é controlada pelo botão "Auto-Resposta" na janela de chat.
                        </div>

                        {/* Frequency */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Frequência de Resposta</label>
                            <div className="flex gap-2">
                                <input
                                    type="number"
                                    min="1"
                                    className="w-20 p-2 text-sm border bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 rounded-md"
                                    value={localGroupSettings.responseFrequency?.value || 1}
                                    onChange={(e) => setLocalGroupSettings((p: any) => ({ ...p, responseFrequency: { ...p.responseFrequency, value: parseInt(e.target.value) || 1 } }))}
                                />
                                <select
                                    className="flex-1 p-2 text-sm border bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 rounded-md"
                                    value={localGroupSettings.responseFrequency?.unit || 'hours'}
                                    onChange={(e) => setLocalGroupSettings((p: any) => ({ ...p, responseFrequency: { ...p.responseFrequency, unit: e.target.value } }))}
                                >
                                    <option value="minutes">Minutos</option>
                                    <option value="hours">Horas</option>
                                    <option value="days">Dias</option>
                                </select>
                            </div>
                            <p className="text-[10px] text-slate-500 mt-1">O bot não responderá antes desse intervalo passar.</p>
                        </div>

                        {/* Burst Handling */}
                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Detector de Spam (Burst)</label>
                                <input
                                    type="checkbox"
                                    checked={localGroupSettings.burstHandling?.enabled || false}
                                    onChange={(e) => setLocalGroupSettings((p: any) => ({ ...p, burstHandling: { ...p.burstHandling, enabled: e.target.checked } }))}
                                />
                            </div>

                            {localGroupSettings.burstHandling?.enabled && (
                                <div className="mt-2">
                                    <label className="text-xs text-slate-600 dark:text-slate-400">Responder somente após X mensagens:</label>
                                    <input
                                        type="number"
                                        min="1"
                                        className="w-full mt-1 p-2 text-sm border bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 rounded-md"
                                        value={localGroupSettings.burstHandling?.threshold || 5}
                                        onChange={(e) => setLocalGroupSettings((p: any) => ({ ...p, burstHandling: { ...p.burstHandling, threshold: parseInt(e.target.value) || 5 } }))}
                                    />
                                </div>
                            )}
                        </div>

                        <button
                            onClick={handleSaveGroupSettings}
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold py-2 rounded-lg mt-4"
                        >
                            Salvar Configurações
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
