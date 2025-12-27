import React, { useState, useEffect, useMemo } from 'react';
import { EmailService } from '../../services/emailService';
import { EmailAccount, EmailMessage, EmailBody } from '../../types/email';
import { EmailAccountList } from './EmailAccountList';
import { EmailList } from './EmailList';
import { EmailComposer } from './EmailComposer';
import { EmailContextPanel } from './EmailContextPanel'; // [ANTIGRAVITY] New
import { StoreConfigModal } from './StoreConfigModal';
import { Plus, Folder, Inbox, ChevronDown, ArrowLeft, Send, UserX, Bot, SidebarClose, SidebarOpen } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useDolibarr } from '../../context/DolibarrContext';
import { useUsers, useCustomers, useInvoices, useOrders, useTickets } from '../../hooks/dolibarr';
import { toast } from 'sonner';

const EmailView: React.FC = () => {
    // State
    const [accounts, setAccounts] = useState<EmailAccount[]>([]);
    const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

    // Mobile View State
    const [mobileView, setMobileView] = useState<'ACCOUNTS' | 'MESSAGES' | 'READING'>('ACCOUNTS');

    // Folder State
    const [folders, setFolders] = useState<any[]>([]); // imap-simple returns objects, we need names
    const [selectedFolder, setSelectedFolder] = useState<string>('INBOX');

    const [messages, setMessages] = useState<EmailMessage[]>([]);
    const [selectedMessageId, setSelectedMessageId] = useState<number | null>(null);
    const [messageBody, setMessageBody] = useState<EmailBody | null>(null);

    // UI State
    const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
    const [isComposerOpen, setIsComposerOpen] = useState(false);
    const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
    const [isLoadingMessages, setIsLoadingMessages] = useState(false);
    const [isLoadingBody, setIsLoadingBody] = useState(false);

    // CRM & Automations Data
    const { config } = useDolibarr();
    const { data: users = [] } = useUsers(config || null, !!config);
    const { data: customers = [] } = useCustomers(config || null, !!config);
    const { data: invoices = [] } = useInvoices(config || null, !!config);
    const { data: orders = [] } = useOrders(config || null, !!config);
    const { data: tickets = [] } = useTickets(config || null, !!config);

    // Automation State
    const [isContextOpen, setIsContextOpen] = useState(false);
    const [itemsWidth, setItemsWidth] = useState(400); // Resizable? Fixed for now
    const [threadSettings, setThreadSettings] = useState<any>(null); // Auto-reply etc
    const [assignment, setAssignment] = useState<string | null>(null);

    // Initial Load
    useEffect(() => {
        loadAccounts();
    }, []);

    // Derived Context Data
    const contextData = useMemo(() => {
        if (!messageBody?.from) return null;

        // Extract email from "Name <email@domain.com>" or just "email@domain.com"
        const emailMatch = messageBody.from.match(/<(.+)>/) || [null, messageBody.from];
        const email = (emailMatch[1] || emailMatch[0]).trim();

        // 1. Try to find customer by name or email
        const customer = customers.find(c => {
            // Email match
            if (c.email && c.email.toLowerCase() === email.toLowerCase()) return true;
            // Name match (loose) if email match fails? Dangerous. Let's stick to email mostly.
            return false;
        });

        if (!customer) return { customer: undefined, invoices: [], orders: [], tickets: [] }; // Return empty structure so we can show "Link" button

        // Fetch related data
        const custInvoices = invoices.filter(i => String(i.socid) === String(customer.id)).slice(0, 5);
        const custOrders = orders.filter(o => String(o.socid) === String(customer.id)).slice(0, 5);
        const custTickets = tickets.filter(t => String(t.socid) === String(customer.id)).slice(0, 5);

        return { customer, invoices: custInvoices, orders: custOrders, tickets: custTickets };
    }, [messageBody, customers, invoices, orders, tickets]);

    // Load folders and messages when account selected
    useEffect(() => {
        if (selectedAccountId) {
            // Reset state
            setSelectedFolder('INBOX');
            setFolders([]);
            setMessages([]);
            setSelectedMessageId(null);
            setMessageBody(null);
            setThreadSettings(null); // Reset automations
            setAssignment(null);

            // Switch to messages view on mobile
            setMobileView('MESSAGES');

            // Fetch
            loadFolders(selectedAccountId);
            loadMessages(selectedAccountId, 'INBOX');
        }
    }, [selectedAccountId]);

    // Load messages when folder selected (if account is set)
    useEffect(() => {
        if (selectedAccountId) {
            loadMessages(selectedAccountId, selectedFolder);
            setSelectedMessageId(null);
            setMessageBody(null);
            setThreadSettings(null);
            setAssignment(null);
            setMobileView('MESSAGES');
        }
    }, [selectedFolder]);

    // Load body & automations when message selected
    useEffect(() => {
        if (selectedAccountId && selectedMessageId) {
            loadMessageBody(selectedAccountId, selectedMessageId);
            setMobileView('READING');

            // Load Metadata (Assignment & Settings) based on THREAD ID
            // Ideally we should use a Thread ID provided by backend.
            // Imap-simple usually groups by subject for threads, or we use messageId.
            // For MVP let's assume messageId is unique enough or we use it as threadId proxy.
            // TODO: In future, get Header 'Message-ID' or 'References' to identify thread.
            // Current `EmailMessage` type has `id` (uid). Let's use `uid` + `folder` + `account` hash as threadId?
            // Or just string `${accountId}_${selectedMessageId}` to keep it simple.
            const threadId = `${selectedAccountId}_${selectedMessageId}`; // Simple ID

            EmailService.getThreadSettings(threadId).then(setThreadSettings).catch(() => setThreadSettings({}));
            EmailService.getAssignment(threadId).then(setAssignment).catch(() => setAssignment(null));
        }
    }, [selectedAccountId, selectedMessageId]);

    const loadAccounts = async () => {
        setIsLoadingAccounts(true);
        try {
            const data = await EmailService.getAccounts();
            setAccounts(data);

            // On desktop, auto-select first account if none selected
            // We can check window width, but easier to just let it be or do a simple check
            // For now, we only auto-select if accounts loaded and we are not in valid state
            // But let's avoid auto-navigating on mobile effectively by not auto-setting selectedAccountId here IF we want to start at list
            // However, existing logic was:
            if (data.length > 0 && !selectedAccountId && window.innerWidth >= 768) {
                setSelectedAccountId(data[0].id);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoadingAccounts(false);
        }
    };

    const loadFolders = async (accountId: string) => {
        try {
            const boxes = await EmailService.getFolders(accountId);
            // imap-simple returns object with keys as valid names?
            // Actually getFolders returns `boxes` which is often an object.
            // Let's assume standard array or normalized object.
            // imap-simple getBoxes returns an object where keys are names. 
            // We'll normalize to array of strings for select

            // Backend `getFolders` returns `boxes` directly from `connection.getBoxes()`.
            // The structure is `{ "INBOX": {...}, "Sent": {...} }`.

            const folderNames = Object.keys(boxes);
            setFolders(folderNames);
        } catch (error) {
            console.error("Failed to load folders", error);
            // Fallback to basic
            setFolders(['INBOX', 'Sent', 'Trash', 'Drafts']);
        }
    };

    const loadMessages = async (accountId: string, folder: string) => {
        setIsLoadingMessages(true);
        try {
            const data = await EmailService.getMessages(accountId, folder, 50);
            setMessages(data);
        } catch (error) {
            console.error(error);
            setMessages([]);
        } finally {
            setIsLoadingMessages(false);
        }
    };

    const loadMessageBody = async (accountId: string, uid: number) => {
        setIsLoadingBody(true);
        try {
            const data = await EmailService.getMessageBody(accountId, uid, selectedFolder);
            setMessageBody(data);
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoadingBody(false);
        }
    };

    // Reply State
    const [replyData, setReplyData] = useState<{ to: string, subject: string, body: string } | null>(null);

    const handleReply = () => {
        if (!messageBody) return;

        const replyTo = messageBody.from; // Simplified extraction
        const replySubject = messageBody.subject.startsWith('Re:') ? messageBody.subject : `Re: ${messageBody.subject}`;

        // Create quoted body
        const dateStr = format(new Date(messageBody.date), "dd/MM/yyyy HH:mm", { locale: ptBR });
        const quotedBody = `\n\n\nOn ${dateStr}, ${messageBody.from} wrote:\n> ${messageBody.text?.replace(/\n/g, '\n> ') || 'HTML Content'}`;

        setReplyData({
            to: replyTo,
            subject: replySubject,
            body: quotedBody
        });
        setIsComposerOpen(true);
    };

    const handleSendEmail = async (to: string, subject: string, body: string, attachments: any[]) => {
        if (!selectedAccountId) return;
        await EmailService.sendEmail(selectedAccountId, to, subject, body, attachments);
        alert('Email enviado com sucesso!');
        // Ideally append to Sent folder or refresh if current folder is Sent
        if (selectedFolder === 'Sent' || selectedFolder.toLowerCase().includes('sent')) {
            loadMessages(selectedAccountId, selectedFolder);
        }
    };

    const handleBackToAccounts = () => {
        setSelectedAccountId(null);
        setMobileView('ACCOUNTS');
    };

    const handleBackToMessages = () => {
        setSelectedMessageId(null);
        setMobileView('MESSAGES');
    };

    const handleCloseComposer = () => {
        setIsComposerOpen(false);
        setReplyData(null);
    };

    // Render Logic
    const selectedAccount = accounts.find(a => a.id === selectedAccountId);

    return (
        <div className="flex h-full bg-slate-100 dark:bg-slate-900 overflow-hidden relative">
            {/* Left Sidebar: Accounts */}
            <div className={`
                absolute inset-0 z-30 md:static md:z-auto
                w-full md:w-[280px] flex-none border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950
                transition-transform duration-300 md:translate-x-0
                ${mobileView === 'ACCOUNTS' ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
            `}>
                <EmailAccountList
                    accounts={accounts}
                    selectedAccountId={selectedAccountId}
                    onSelect={setSelectedAccountId}
                    onAddAccount={() => setIsConfigModalOpen(true)}
                    onDeleteAccount={async (id) => {
                        await EmailService.deleteAccount(id);
                        loadAccounts();
                    }}
                />
            </div>

            {/* Middle: Message List */}
            <div className={`
                absolute inset-0 z-20 md:static md:z-auto
                w-full md:w-[400px] flex-none border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col
                transition-transform duration-300 md:translate-x-0
                ${mobileView === 'MESSAGES' ? 'translate-x-0' : (mobileView === 'READING' ? '-translate-x-full md:translate-x-0' : 'translate-x-full md:translate-x-0')}
            `}>
                {selectedAccount ? (
                    <>
                        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-200 dark:border-slate-800 shrink-0 gap-2">
                            {/* Mobile Back Button */}
                            <button
                                onClick={handleBackToAccounts}
                                className="md:hidden p-2 -ml-2 text-slate-500"
                            >
                                <ArrowLeft size={20} />
                            </button>

                            {/* Folder Selector */}
                            <div className="flex-1 min-w-0 relative group">
                                <div className="flex items-center gap-2">
                                    <h2 className="font-bold text-slate-800 dark:text-white truncate">
                                        {selectedFolder}
                                    </h2>
                                    <ChevronDown size={14} className="text-slate-400" />
                                </div>

                                {/* Simple HTML Select Overlay for now, easier than custom dropdown */}
                                <select
                                    className="absolute inset-0 opacity-0 cursor-pointer"
                                    value={selectedFolder}
                                    onChange={(e) => setSelectedFolder(e.target.value)}
                                >
                                    {folders.map(f => (
                                        <option key={f} value={f}>{f}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="flex items-center gap-2">
                                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">
                                    {messages.length}
                                </span>
                                <button
                                    onClick={() => setIsComposerOpen(true)}
                                    className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg p-2 transition-colors"
                                    title="Nova Mensagem"
                                >
                                    <Plus size={20} />
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto">
                            <EmailList
                                messages={messages}
                                selectedMessageId={selectedMessageId}
                                isLoading={isLoadingMessages}
                                onSelect={(msg) => setSelectedMessageId(msg.id)}
                            />
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex items-center justify-center text-slate-400">
                        Selecione uma conta
                    </div>
                )}
            </div>

            {/* Right: Reading Pane */}
            <div className={`
                absolute inset-0 z-10 md:static md:z-auto
                flex-1 bg-white dark:bg-slate-900 flex flex-col min-w-0
                transition-transform duration-300 md:translate-x-0
                ${mobileView === 'READING' ? 'translate-x-0' : 'translate-x-full md:translate-x-0'}
            `}>
                {messageBody ? (
                    <div className="flex flex-col h-full">
                        {/* Header */}
                        <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/30">
                            {/* Toolbar */}
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={handleBackToMessages}
                                        className="md:hidden text-slate-500"
                                    >
                                        <ArrowLeft size={20} />
                                    </button>

                                    {/* Assignment Dropdown */}
                                    <div className="relative group">
                                        <button className="flex items-center gap-2 px-2 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50">
                                            <UserX size={14} />
                                            {assignment ? users.find(u => u.id === assignment)?.login || 'Desconhecido' : 'Atribuir'}
                                            <ChevronDown size={12} />
                                        </button>
                                        <div className="absolute top-full left-0 mt-1 w-48 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg hidden group-hover:block z-50 max-h-60 overflow-y-auto">
                                            <div className="p-1">
                                                <button
                                                    onClick={() => {
                                                        const tid = `${selectedAccountId}_${selectedMessageId}`;
                                                        EmailService.assignThread(tid, null);
                                                        setAssignment(null);
                                                    }}
                                                    className="w-full text-left px-3 py-2 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded"
                                                >
                                                    Ninguém
                                                </button>
                                                {users.map(user => (
                                                    <button
                                                        key={user.id}
                                                        onClick={() => {
                                                            const tid = `${selectedAccountId}_${selectedMessageId}`;
                                                            EmailService.assignThread(tid, user.id);
                                                            setAssignment(user.id);
                                                            toast.success(`Atribuído a ${user.login}`);
                                                        }}
                                                        className="w-full text-left px-3 py-2 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded"
                                                    >
                                                        {user.login}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Auto-Reply Status */}
                                    <button
                                        onClick={() => {
                                            const tid = `${selectedAccountId}_${selectedMessageId}`;
                                            const nextState = !threadSettings?.autoReplyEnabled;
                                            EmailService.updateThreadSettings(tid, { autoReplyEnabled: nextState });
                                            setThreadSettings((p: any) => ({ ...p, autoReplyEnabled: nextState }));
                                            toast.success(nextState ? 'Auto-Resposta Ativada' : 'Auto-Resposta Desativada');
                                        }}
                                        className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-bold transition-colors border ${threadSettings?.autoReplyEnabled
                                            ? 'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800'
                                            : 'bg-slate-100 text-slate-500 border-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
                                            }`}
                                    >
                                        <Bot size={14} />
                                        {threadSettings?.autoReplyEnabled ? 'ON' : 'OFF'}
                                    </button>
                                </div>

                                {/* Context Toggle */}
                                <button
                                    onClick={() => setIsContextOpen(!isContextOpen)}
                                    className={`p-2 rounded-md transition-colors ${isContextOpen ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                                    title="Painel de Contexto"
                                >
                                    {isContextOpen ? <SidebarClose size={20} /> : <SidebarOpen size={20} />}
                                </button>
                            </div>

                            <div className="flex items-start justify-between">
                                <div className="min-w-0 pr-4">
                                    <h1 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white leading-tight break-words mb-2">
                                        {messageBody.subject}
                                    </h1>
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-700 dark:text-blue-300 font-bold text-xs shrink-0">
                                            {messageBody.from?.charAt(0).toUpperCase()}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="font-medium text-slate-900 dark:text-white truncate text-sm">{messageBody.from}</p>
                                            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">para {messageBody.to}</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="text-right shrink-0">
                                    <span className="text-xs text-slate-500 dark:text-slate-400 block mb-2">
                                        {format(new Date(messageBody.date), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                                    </span>
                                    <button
                                        onClick={handleReply}
                                        className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-xs font-bold shadow-sm"
                                    >
                                        <div className="rotate-180 transform"><Send size={12} /></div>
                                        Responder
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Body */}
                        <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar bg-white dark:bg-slate-900">
                            <div
                                className="prose dark:prose-invert max-w-none email-content-reset text-sm md:text-base"
                                dangerouslySetInnerHTML={{ __html: messageBody.html || messageBody.text || '' }}
                            />

                            {messageBody.attachments && messageBody.attachments.length > 0 && (
                                <div className="mt-8 pt-8 border-t border-slate-200 dark:border-slate-800">
                                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Anexos</h4>
                                    <div className="flex flex-wrap gap-2">
                                        {messageBody.attachments.map((att, i) => (
                                            <a
                                                key={i}
                                                href={att.content ? `data:${att.contentType};base64,${att.content}` : '#'}
                                                download={att.filename || 'download'}
                                                className="flex items-center gap-2 p-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                                            >
                                                <Folder size={16} className="text-blue-500" />
                                                <span className="text-sm text-slate-700 dark:text-slate-300 truncate max-w-[200px]">{att.filename}</span>
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 p-8 text-center">
                        {isLoadingBody ? (
                            <div className="animate-pulse">Carregando conteúdo...</div>
                        ) : (
                            <>
                                <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4">
                                    <Inbox size={32} className="text-slate-300 dark:text-slate-600" />
                                </div>
                                <p>Selecione uma mensagem para ler</p>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Context Panel */}
            <EmailContextPanel
                isOpen={isContextOpen && !!messageBody}
                onClose={() => setIsContextOpen(false)}
                contextData={contextData}
                // onNavigate={(view, id) => ...} // Need to pass navigate prop or context
                emailAddress={messageBody?.from}
            />

            {/* Modals */}
            {isConfigModalOpen && (
                <StoreConfigModal
                    onClose={() => setIsConfigModalOpen(false)}
                    onSave={async (data) => {
                        await EmailService.addAccount(data);
                        loadAccounts();
                    }}
                />
            )}

            {isComposerOpen && (
                <EmailComposer
                    onClose={handleCloseComposer}
                    onSend={handleSendEmail}
                    initialTo={replyData?.to}
                    initialSubject={replyData?.subject}
                    initialBody={replyData?.body}
                />
            )}
        </div>
    );
};

export default EmailView;
