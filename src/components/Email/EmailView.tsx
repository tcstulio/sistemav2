import React, { useState, useEffect, useMemo } from 'react';
import { EmailService } from '../../services/emailService';
import { EmailAccount, EmailMessage, EmailBody } from '../../types/email';
import { EmailAccountList } from './EmailAccountList';
import { EmailList } from './EmailList';
import { EmailComposer } from './EmailComposer';
import { EmailContextPanel } from './EmailContextPanel';
import { EmailReadingPane } from './EmailReadingPane'; // [ANTIGRAVITY] New
import { StoreConfigModal } from './StoreConfigModal';
import { MasterDetailLayout } from '../ui'; // [ANTIGRAVITY] New
import { Plus, ChevronDown, ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useDolibarr } from '../../context/DolibarrContext';
import { useUsers, useCustomers, useInvoices, useOrders, useTickets } from '../../hooks/dolibarr';

const EmailView: React.FC = () => {
    // State
    const [accounts, setAccounts] = useState<EmailAccount[]>([]);
    const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

    // Folder State
    const [folders, setFolders] = useState<any[]>([]);
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
    const [threadSettings, setThreadSettings] = useState<any>(null);
    const [assignment, setAssignment] = useState<string | null>(null);

    // Initial Load
    useEffect(() => {
        loadAccounts();
    }, []);

    // Derived Context Data
    const contextData = useMemo(() => {
        if (!messageBody?.from) return null;

        const emailMatch = messageBody.from.match(/<(.+)>/) || [null, messageBody.from];
        const email = (emailMatch[1] || emailMatch[0]).trim();

        const customer = customers.find(c => {
            if (c.email && c.email.toLowerCase() === email.toLowerCase()) return true;
            return false;
        });

        if (!customer) return { customer: undefined, invoices: [], orders: [], tickets: [] };

        const custInvoices = invoices.filter(i => String(i.socid) === String(customer.id)).slice(0, 5);
        const custOrders = orders.filter(o => String(o.socid) === String(customer.id)).slice(0, 5);
        const custTickets = tickets.filter(t => String(t.socid) === String(customer.id)).slice(0, 5);

        return { customer, invoices: custInvoices, orders: custOrders, tickets: custTickets };
    }, [messageBody, customers, invoices, orders, tickets]);

    // Load folders and messages when account selected
    useEffect(() => {
        if (selectedAccountId) {
            setSelectedFolder('INBOX');
            setFolders([]);
            setMessages([]);
            setSelectedMessageId(null);
            setMessageBody(null);
            setThreadSettings(null);
            setAssignment(null);
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
        }
    }, [selectedFolder]);

    // Load body & automations when message selected
    useEffect(() => {
        if (selectedAccountId && selectedMessageId) {
            loadMessageBody(selectedAccountId, selectedMessageId);
            const threadId = `${selectedAccountId}_${selectedMessageId}`;
            EmailService.getThreadSettings(threadId).then(setThreadSettings).catch(() => setThreadSettings({}));
            EmailService.getAssignment(threadId).then(setAssignment).catch(() => setAssignment(null));
        }
    }, [selectedAccountId, selectedMessageId]);

    const loadAccounts = async () => {
        setIsLoadingAccounts(true);
        try {
            const data = await EmailService.getAccounts();
            setAccounts(data);
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
            const folderNames = Object.keys(boxes);
            setFolders(folderNames);
        } catch (error) {
            console.error("Failed to load folders", error);
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

        const replyTo = messageBody.from;
        const replySubject = messageBody.subject.startsWith('Re:') ? messageBody.subject : `Re: ${messageBody.subject}`;
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
        if (selectedFolder === 'Sent' || selectedFolder.toLowerCase().includes('sent')) {
            loadMessages(selectedAccountId, selectedFolder);
        }
    };

    const handleBackToAccounts = () => {
        setSelectedAccountId(null);
    };

    const handleCloseComposer = () => {
        setIsComposerOpen(false);
        setReplyData(null);
    };

    // List Content for MasterDetail
    const renderListContent = () => {
        const selectedAccount = accounts.find(a => a.id === selectedAccountId);

        if (!selectedAccount) return null;

        return (
            <div className="flex flex-col h-full bg-white dark:bg-slate-900">
                <div className="h-16 flex items-center justify-between px-4 border-b border-slate-200 dark:border-slate-800 shrink-0 gap-2">
                    {/* Mobile Back Button to Accounts */}
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
            </div>
        );
    };

    return (
        <div className="flex h-full bg-slate-100 dark:bg-slate-900 overflow-hidden relative">
            {/* Left Sidebar: Accounts */}
            {/* Logic: Hidden on mobile if account selected. Visible on desktop always. */}
            <div className={`
                absolute inset-0 z-30 md:static md:z-auto
                w-full md:w-[280px] flex-none border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950
                transition-transform duration-300 md:translate-x-0
                ${!selectedAccountId ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
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

            {/* Main Content: List + Reading (MasterDetail) */}
            {/* Logic: Visible on mobile if account selected. Visible on desktop always (but handles empty state). */}
            <div className={`
                absolute inset-0 z-20 md:static md:z-auto
                flex-1 bg-white dark:bg-slate-900 transition-transform duration-300 md:translate-x-0
                ${selectedAccountId ? 'translate-x-0' : 'translate-x-full md:translate-x-0'}
            `}>
                {selectedAccountId ? (
                    <MasterDetailLayout
                        showDetail={!!selectedMessageId}
                        onCloseDetail={() => setSelectedMessageId(null)}
                        list={renderListContent()}
                        detail={
                            <EmailReadingPane
                                messageBody={messageBody}
                                isLoadingBody={isLoadingBody}
                                onBack={() => setSelectedMessageId(null)}
                                users={users}
                                assignment={assignment}
                                setAssignment={setAssignment}
                                selectedAccountId={selectedAccountId}
                                selectedMessageId={selectedMessageId}
                                threadSettings={threadSettings}
                                setThreadSettings={setThreadSettings}
                                isContextOpen={isContextOpen}
                                setIsContextOpen={setIsContextOpen}
                                onReply={handleReply}
                            />
                        }
                        listWidth="2/5" // Give list a bit more space
                    />
                ) : (
                    <div className="hidden md:flex h-full items-center justify-center text-slate-400">
                        Selecione uma conta para ver as mensagens
                    </div>
                )}
            </div>

            {/* Context Panel (Overlay) */}
            <EmailContextPanel
                isOpen={isContextOpen && !!messageBody}
                onClose={() => setIsContextOpen(false)}
                contextData={contextData}
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
