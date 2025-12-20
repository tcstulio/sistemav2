import React, { useState, useEffect } from 'react';
import { WhatsAppProvider, useWhatsAppContext } from '../contexts/WhatsAppContext'; // Wraps the view
import { useSessions } from '../hooks/whatsapp/useSessions';
import { useConversations } from '../hooks/whatsapp/useConversations';
import { useMessages } from '../hooks/whatsapp/useMessages';
import { WhatsAppService } from '../services/whatsappService'; // For settings
import { useCRMContext } from '../hooks/useCRMContext';

import { ConversationList } from './whatsapp/ConversationList';
import { ChatWindow } from './whatsapp/ChatWindow';
import { MessageInput } from './whatsapp/MessageInput';
import { ContextPanel } from './whatsapp/ContextPanel';
import { ConnectModal } from './whatsapp/ConnectModal';
import { AppView } from '../types';
import { useDolibarr } from '../context/DolibarrContext';
import { useUsers } from '../hooks/dolibarr/useUsers';
import { useCustomers } from '../hooks/dolibarr/useCustomers';
import { useInvoices } from '../hooks/dolibarr/useInvoices';
import { useOrders } from '../hooks/dolibarr/useOrders';
import { useTickets } from '../hooks/dolibarr/useTickets';
import { AiService } from '../services/aiService';
import { toast } from 'sonner';

interface WhatsAppViewProps {
    onNavigate?: (view: AppView, id?: string) => void;
}

const WhatsAppInner: React.FC<WhatsAppViewProps> = ({ onNavigate }) => {
    const { config, currentUser } = useDolibarr();

    // CRM Data
    const { data: users = [] } = useUsers(config || null, !!config);
    const { data: customers = [] } = useCustomers(config || null, !!config);
    const { data: invoices = [] } = useInvoices(config || null, !!config);
    const { data: orders = [] } = useOrders(config || null, !!config);
    const { data: tickets = [] } = useTickets(config || null, !!config);

    // --- State Management ---

    // 1. Sessions
    const { sessions, loading: isSessionsLoading, refreshSessions, startSession, stopSession, qrCodes } = useSessions();
    const [selectedAccount, setSelectedAccount] = useState<string>('all');

    // 2. Conversations
    // Pass selectedAccount to filter conversations (or fetch specific)
    const { conversations, loading: isListLoading, refreshConversations } = useConversations(selectedAccount);
    const [selectedConversation, setSelectedConversation] = useState<any | null>(null);

    // 3. Messages
    const { messages, loading: isChatLoading, sendMessage } = useMessages(
        // Resolve effective session for message hook
        // If 'all' is selected, we need to know which session the chat belongs to.
        // If selectedAccount is specific, use it.
        // If selectedAccount is 'all', use selectedConversation.accountId.
        selectedConversation ? (selectedConversation.accountId || selectedAccount) : selectedAccount,
        selectedConversation ? selectedConversation.id : null
    );

    // 4. UI State
    const [searchTerm, setSearchTerm] = useState('');
    const [filterMode, setFilterMode] = useState<'all' | 'mine' | 'unassigned'>('all');
    const [isContextOpen, setIsContextOpen] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    // Settings State
    const [settingsSessionId, setSettingsSessionId] = useState<string>('default');
    const [chatSettings, setChatSettings] = useState<any | null>(null);
    const [userSettings, setUserSettings] = useState<any>(null); // Fetch explicit

    const [tempSessionSettings, setTempSessionSettings] = useState({
        autoReply: false,
        autoReplyContext: '',
        signatureName: '',
        name: ''
    });
    const [tempUserSettings, setTempUserSettings] = useState({ signatureName: '' });

    // --- Derived Logic ---
    const contextData = useCRMContext(selectedConversation, customers, invoices, orders, tickets);
    const isLoading = isSessionsLoading || isListLoading;

    // --- Effects ---

    // Load Settings on Open
    useEffect(() => {
        if (isSettingsOpen) {
            const targetSession = (selectedAccount !== 'all') ? selectedAccount : 'default';
            setSettingsSessionId(targetSession);

            WhatsAppService.getSessionSettings(targetSession).then(s => {
                setTempSessionSettings({
                    autoReply: s.autoReply || false,
                    autoReplyContext: s.autoReplyContext || '',
                    signatureName: s.signatureName || '',
                    name: s.name || ''
                });
            }).catch(() => { });

            WhatsAppService.getUserSettings().then(s => {
                setUserSettings(s);
                setTempUserSettings({ signatureName: s.signatureName || '' });
            }).catch(() => { });
        }
    }, [isSettingsOpen, selectedAccount]);

    // Load Chat Settings
    useEffect(() => {
        if (selectedConversation) {
            setChatSettings(null);
            WhatsAppService.getChatSettings(selectedConversation.id).then(s => setChatSettings(s)).catch(() => setChatSettings({}));
        }
    }, [selectedConversation]);

    // --- Handlers ---

    // Re-implement specialized senders using Service directly or modify useMessages to support them
    // useMessages only exposes sendMessage (text). helper needed for media.
    // Ideally useMessages should expose them, but for now I'll use Service inside wrapper functions
    // BUT useMessages handles optimistic updates. I should update useMessages to support media if I want consistency.
    // For now, I'll use Service and refresh messages or let socket update.
    // Wait, useChat doesn't expose sendVoice/File.
    // I should add them to useMessages later. For now, calling Service directly is fine, socket will append message.

    const handleSendAudio = async (blob: Blob) => {
        if (!selectedConversation) return;
        setIsSending(true);
        try {
            // Need effective session
            const sessionToUse = selectedConversation.accountId || (selectedAccount !== 'all' ? selectedAccount : 'default');
            await WhatsAppService.sendAudioMessage(selectedConversation.id, blob, sessionToUse);
        } catch (e: any) {
            console.error(e);
            alert(`Erro ao enviar áudio: ${e.message}`);
        } finally {
            setIsSending(false);
        }
    };

    const handleSendFile = async (file: File) => {
        if (!selectedConversation) return;
        setIsSending(true);
        try {
            const sessionToUse = selectedConversation.accountId || (selectedAccount !== 'all' ? selectedAccount : 'default');
            await WhatsAppService.sendFileMessage(selectedConversation.id, file, '', sessionToUse);
        } catch (e) {
            console.error(e);
            alert("Erro ao enviar arquivo");
        } finally {
            setIsSending(false);
        }
    };

    const handleSendMessage = async (text: string) => {
        if (!selectedConversation) return;

        if (text.startsWith('/sys ')) {
            const query = text.replace('/sys ', '');
            setIsSending(true);
            try {
                const result = await AiService.analyzeSystem(query);
                alert(`ANÁLISE DO SISTEMA:\n\n${result}`);
            } catch (e) {
                alert("Erro ao analisar sistema.");
            } finally {
                setIsSending(false);
            }
            return;
        }

        try {
            await sendMessage(text);
        } catch (e) {
            console.error(e);
        }
    };

    const toggleChatAutoReply = async () => {
        if (!selectedConversation) return;
        const currentVal = chatSettings?.autoReplyEnabled;
        let next: boolean | undefined;
        if (currentVal === undefined) next = true;
        else if (currentVal === true) next = false;
        else next = undefined;

        try {
            await WhatsAppService.updateChatSettings(selectedConversation.id, { autoReplyEnabled: next });
            setChatSettings((prev: any) => ({ ...prev, autoReplyEnabled: next }));
            const label = next === undefined ? 'Padrão da Conta' : (next ? 'Ativada' : 'Desativada');
            toast.success(`Auto-resposta: ${label}`);
        } catch (e) {
            toast.error("Erro ao atualizar status.");
        }
    };

    const handleSaveSettings = async () => {
        try {
            await WhatsAppService.updateSessionSettings(settingsSessionId, tempSessionSettings);
            await WhatsAppService.updateUserSettings({ signatureName: tempUserSettings.signatureName });
            toast.success("Configurações salvas.");
            setIsSettingsOpen(false);
            refreshSessions();
        } catch (e) {
            toast.error("Erro ao salvar.");
        }
    };

    const handleAssign = async (userId: string | null) => {
        if (!selectedConversation) return;
        try {
            await WhatsAppService.assignConversation(selectedConversation.id, userId);
            toast.success(userId ? "Conversa assumida!" : "Conversa devolvida.");
            // Refresh list to update UI
            refreshConversations();
        } catch (e) {
            toast.error("Erro ao atribuir.");
        }
    };

    if (!currentUser) return <div className="p-4 text-center text-slate-400">Carregando...</div>;

    // Resolve QR Code for Modal
    // If selectedAccount is in 'SCAN_QR_CODE' status, we might have a QR in the hook state
    // But modal expects a specific URL or base64. 
    // The useSessions 'qrCodes' map has [sessionId]: string (base64 or data url).
    const activeQrCode = qrCodes[selectedAccount];

    return (
        <div className="flex h-full overflow-hidden bg-slate-100 dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800">
            {/* LEFT: Conversation List */}
            <div className={`w-full md:w-[380px] flex-none border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col transition-all duration-300 ${selectedConversation ? 'hidden md:flex' : 'flex'}`}>
                <ConversationList
                    conversations={conversations}
                    selectedConversationId={selectedConversation?.id}
                    onSelect={setSelectedConversation}
                    accounts={sessions}
                    selectedAccount={selectedAccount}
                    onAccountChange={(id) => {
                        setSelectedAccount(id);
                        setSelectedConversation(null);
                    }}
                    onConnect={() => setIsConnectModalOpen(true)}
                    onDeleteSession={async (id) => {
                        if (window.confirm('Excluir sessão?')) {
                            await stopSession(id);
                        }
                    }}
                    onRefresh={() => { refreshSessions(); refreshConversations(); }}
                    onCreateSession={() => {
                        const newId = `session_${Math.floor(Math.random() * 10000)}`;
                        setSelectedAccount(newId);
                        setIsConnectModalOpen(true);
                    }}
                    isLoading={isLoading}
                    searchTerm={searchTerm}
                    onSearchChange={setSearchTerm}
                    filterMode={filterMode}
                    onFilterChange={setFilterMode}
                    currentUser={currentUser}
                    users={users}
                    onSettingsClick={() => setIsSettingsOpen(true)}
                />
            </div>

            {/* MIDDLE: Chat Window */}
            <div className={`flex-1 flex flex-col min-w-0 bg-[#efeae2] dark:bg-[#0b141a] transition-all duration-300 overflow-hidden relative ${!selectedConversation ? 'hidden md:flex' : 'flex'}`}>

                {selectedConversation && (
                    <div className="h-12 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between px-4 shrink-0 z-10">
                        <span className="text-sm font-semibold text-slate-600 dark:text-slate-300 truncate max-w-[50%]">
                            {selectedConversation.customerName}
                        </span>
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-500 hidden sm:inline">Auto-Resposta:</span>
                            <button
                                onClick={toggleChatAutoReply}
                                className={`px-2 py-1 rounded text-xs font-bold transition-colors ${chatSettings?.autoReplyEnabled === true ? 'bg-green-100 text-green-700 border border-green-300' :
                                    chatSettings?.autoReplyEnabled === false ? 'bg-red-100 text-red-700 border border-red-300' :
                                        'bg-slate-100 text-slate-600 border border-slate-300'
                                    }`}
                            >
                                {chatSettings?.autoReplyEnabled === true ? 'LIGADO' :
                                    chatSettings?.autoReplyEnabled === false ? 'DESLIGADO' : 'PADRÃO'}
                            </button>
                        </div>
                    </div>
                )}

                <ChatWindow
                    messages={messages}
                    currentUser={currentUser}
                    users={users}
                    selectedConversation={selectedConversation}
                    isLoading={isChatLoading}
                    error={null}
                    onAssign={handleAssign}
                    onClose={() => setSelectedConversation(null)}
                    onOpenContext={() => setIsContextOpen(!isContextOpen)}
                    isContextOpen={isContextOpen}
                    onRetry={refreshConversations}
                />

                {selectedConversation && (
                    <div className="flex-none z-20 relative">
                        <MessageInput
                            onSendMessage={handleSendMessage}
                            onSendAudio={handleSendAudio}
                            onSendFile={handleSendFile}
                            isSending={isSending}
                            messagesForSmartReply={messages}
                            selectedConversation={selectedConversation}
                            crmContext={contextData}
                        />
                    </div>
                )}
            </div>

            {/* RIGHT: Context Panel */}
            <ContextPanel
                isOpen={isContextOpen && !!selectedConversation}
                onClose={() => setIsContextOpen(false)}
                contextData={contextData}
                onNavigate={onNavigate}
                conversation={selectedConversation}
                chatSettings={chatSettings}
                onUpdateSettings={(settings) => {
                    if (selectedConversation) {
                        WhatsAppService.updateChatSettings(selectedConversation.id, settings).then(() => {
                            setChatSettings((prev: any) => ({ ...prev, ...settings }));
                            toast.success("Configurações atualizadas.");
                        });
                    }
                }}
            />

            {/* MODALS */}
            <ConnectModal
                isOpen={isConnectModalOpen}
                onClose={() => setIsConnectModalOpen(false)}
                qrCodeUrl={activeQrCode}
                isLoading={!activeQrCode && ((sessions.find(s => s.id === selectedAccount)?.status as any) === 'INITIALIZING' || (sessions.find(s => s.id === selectedAccount)?.status as any) === 'STARTING')}
                onRefresh={refreshSessions}
            />

            {/* SETTINGS MODAL */}
            {isSettingsOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md p-6 border border-slate-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto">
                        <h2 className="text-xl font-bold mb-4 text-slate-800 dark:text-white">Configurações do WhatsApp</h2>
                        <div className="space-y-6">
                            <div className="border-b border-slate-200 dark:border-slate-700 pb-4">
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Conta (Sessão)</label>
                                <select
                                    className="w-full rounded-md border p-2 bg-slate-50 dark:bg-slate-900 dark:text-white"
                                    value={settingsSessionId}
                                    onChange={(e) => setSettingsSessionId(e.target.value)}
                                >
                                    {(sessions && sessions.length > 0) ? sessions.map(acc => (
                                        <option key={acc.id} value={acc.id}>{acc.name} ({acc.id})</option>
                                    )) : <option value="default">Padrão</option>}
                                </select>
                            </div>

                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Auto-Resposta (LLM)</label>
                                    <button
                                        onClick={() => setTempSessionSettings(p => ({ ...p, autoReply: !p.autoReply }))}
                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${tempSessionSettings.autoReply ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-700'}`}
                                    >
                                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${tempSessionSettings.autoReply ? 'translate-x-6' : 'translate-x-1'}`} />
                                    </button>
                                </div>

                                <div>
                                    <h3 className="text-md font-semibold text-slate-800 dark:text-white mb-2">Minhas Configurações (Usuário)</h3>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Minha Assinatura</label>
                                    <input
                                        type="text"
                                        value={tempUserSettings?.signatureName || ''}
                                        onChange={e => setTempUserSettings(p => ({ ...p, signatureName: e.target.value }))}
                                        className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
                                    />
                                    <hr className="border-slate-200 dark:border-slate-700 my-4" />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nome do Robô / Assinatura da Sessão</label>
                                    <input
                                        type="text"
                                        value={tempSessionSettings.signatureName || ''}
                                        onChange={e => setTempSessionSettings(p => ({ ...p, signatureName: e.target.value }))}
                                        className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nome da Sessão (Amigável)</label>
                                    <input
                                        type="text"
                                        value={tempSessionSettings.name || ''}
                                        onChange={e => setTempSessionSettings(p => ({ ...p, name: e.target.value }))}
                                        className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Contexto da IA (Prompt)</label>
                                    <textarea
                                        value={tempSessionSettings.autoReplyContext}
                                        onChange={e => setTempSessionSettings(p => ({ ...p, autoReplyContext: e.target.value }))}
                                        className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm h-32 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 mt-6">
                            <button onClick={() => setIsSettingsOpen(false)} className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400">Cancelar</button>
                            <button onClick={handleSaveSettings} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">Salvar</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// Wrap with Provider
const WhatsAppView: React.FC<WhatsAppViewProps> = (props) => {
    return (
        <WhatsAppProvider>
            <WhatsAppInner {...props} />
        </WhatsAppProvider>
    );
};

export default WhatsAppView;
