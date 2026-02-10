import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { EmailService } from '../../services/emailService';
import { EmailAccount, EmailMessage, EmailBody } from '../../types/email';
import { EmailAccountList } from './EmailAccountList';
import { EmailList } from './EmailList';
import { EmailComposer } from './EmailComposer';
import { EmailContextPanel } from './EmailContextPanel';
import { EmailReadingPane } from './EmailReadingPane';
import { StoreConfigModal } from './StoreConfigModal';
import { EmailTemplateManager } from './EmailTemplateManager';
import { MasterDetailLayout } from '../ui';
import { Plus, ChevronDown, ArrowLeft, Search, X, CheckSquare, Mail, MailOpen, Trash2, FolderInput, RefreshCw, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useDolibarr } from '../../context/DolibarrContext';
import { useUsers, useCustomers, useInvoices, useOrders, useTickets } from '../../hooks/dolibarr';
import { toast } from 'sonner';

const POLL_OPTIONS = [
    { label: 'Off', value: 0 },
    { label: '30s', value: 30 },
    { label: '1min', value: 60 },
    { label: '2min', value: 120 },
    { label: '5min', value: 300 },
];

const EmailView: React.FC = () => {
    // State
    const [accounts, setAccounts] = useState<EmailAccount[]>([]);
    const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

    // Folder State
    const [folders, setFolders] = useState<string[]>([]);
    const [selectedFolder, setSelectedFolder] = useState<string>('INBOX');

    const [messages, setMessages] = useState<EmailMessage[]>([]);
    const [selectedMessageId, setSelectedMessageId] = useState<number | null>(null);
    const [messageBody, setMessageBody] = useState<EmailBody | null>(null);

    // UI State
    const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
    const [editingAccount, setEditingAccount] = useState<EmailAccount | null>(null);
    const [isComposerOpen, setIsComposerOpen] = useState(false);
    const [isTemplateManagerOpen, setIsTemplateManagerOpen] = useState(false);
    const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
    const [isLoadingMessages, setIsLoadingMessages] = useState(false);
    const [isLoadingBody, setIsLoadingBody] = useState(false);

    // Search State
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<EmailMessage[] | null>(null);
    const [isSearching, setIsSearching] = useState(false);
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Bulk Actions State
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedUids, setSelectedUids] = useState<Set<number>>(new Set());
    const [showBulkMoveMenu, setShowBulkMoveMenu] = useState(false);

    // Polling State
    const [pollInterval, setPollInterval] = useState(0);
    const [showPollMenu, setShowPollMenu] = useState(false);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Unread Counts
    const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});

    // CRM & Automations Data
    const { config, setNotifications } = useDolibarr();
    const { data: users = [] } = useUsers(config || null, !!config);
    const { data: customers = [] } = useCustomers(config || null, !!config);
    const { data: invoices = [] } = useInvoices(config || null, !!config);
    const { data: orders = [] } = useOrders(config || null, !!config);
    const { data: tickets = [] } = useTickets(config || null, !!config);

    // Automation State
    const [isContextOpen, setIsContextOpen] = useState(false);
    const [threadSettings, setThreadSettings] = useState<any>(null);
    const [assignment, setAssignment] = useState<string | null>(null);

    // Ref to track previous message UIDs for new-email detection
    const prevMessageUidsRef = useRef<Set<number>>(new Set());

    // Initial Load
    useEffect(() => {
        loadAccounts();
        // Load saved poll interval
        EmailService.getUserStore().then(({ userSettings }) => {
            if (userSettings?.pollInterval) setPollInterval(userSettings.pollInterval);
        }).catch(() => {});
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

    // Threading: group messages by conversation
    const threadedMessages = useMemo(() => {
        if (searchResults) return searchResults;

        const threads = new Map<string, EmailMessage[]>();
        const standalone: EmailMessage[] = [];

        for (const msg of messages) {
            const threadKey = normalizeSubject(msg.subject);
            if (!threads.has(threadKey)) {
                threads.set(threadKey, []);
            }
            threads.get(threadKey)!.push(msg);
        }

        const result: EmailMessage[] = [];
        for (const [, group] of threads) {
            if (group.length === 1) {
                result.push(group[0]);
            } else {
                // Sort by date desc within thread, show newest
                group.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                const representative = { ...group[0], threadCount: group.length } as any;
                result.push(representative);
            }
        }

        // Sort all by date desc
        result.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        return result;
    }, [messages, searchResults]);

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
            setSearchQuery('');
            setSearchResults(null);
            setSelectionMode(false);
            setSelectedUids(new Set());
            loadFolders(selectedAccountId);
            loadMessages(selectedAccountId, 'INBOX');
            loadUnreadCount(selectedAccountId);
        }
    }, [selectedAccountId]);

    // Load messages when folder selected
    useEffect(() => {
        if (selectedAccountId) {
            loadMessages(selectedAccountId, selectedFolder);
            setSelectedMessageId(null);
            setMessageBody(null);
            setThreadSettings(null);
            setAssignment(null);
            setSearchQuery('');
            setSearchResults(null);
            setSelectionMode(false);
            setSelectedUids(new Set());
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

    // Polling
    useEffect(() => {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }

        if (pollInterval > 0 && selectedAccountId) {
            pollRef.current = setInterval(() => {
                if (document.visibilityState === 'visible') {
                    loadMessages(selectedAccountId, selectedFolder, true);
                    loadAllUnreadCounts();
                }
            }, pollInterval * 1000);
        }

        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [pollInterval, selectedAccountId, selectedFolder]);

    // Search debounce
    useEffect(() => {
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

        if (!searchQuery.trim()) {
            setSearchResults(null);
            return;
        }

        searchTimeoutRef.current = setTimeout(async () => {
            if (!selectedAccountId || !searchQuery.trim()) return;
            setIsSearching(true);
            try {
                const results = await EmailService.searchMessages(selectedAccountId, searchQuery, selectedFolder);
                setSearchResults(results);
            } catch (error) {
                console.error('Search failed', error);
                setSearchResults([]);
            } finally {
                setIsSearching(false);
            }
        }, 300);

        return () => {
            if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
        };
    }, [searchQuery, selectedAccountId, selectedFolder]);

    const loadAccounts = async () => {
        setIsLoadingAccounts(true);
        try {
            const data = await EmailService.getAccounts();
            setAccounts(data);
            if (data.length > 0 && !selectedAccountId && window.innerWidth >= 768) {
                setSelectedAccountId(data[0].id);
            }
            // Load unread counts for all accounts
            for (const acc of data) {
                EmailService.getUnreadCount(acc.id).then(count => {
                    setUnreadCounts(prev => ({ ...prev, [acc.id]: count }));
                }).catch(() => {});
            }
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoadingAccounts(false);
        }
    };

    const loadAllUnreadCounts = async () => {
        for (const acc of accounts) {
            try {
                const count = await EmailService.getUnreadCount(acc.id);
                setUnreadCounts(prev => ({ ...prev, [acc.id]: count }));
            } catch {}
        }
    };

    const loadUnreadCount = async (accountId: string) => {
        try {
            const count = await EmailService.getUnreadCount(accountId);
            setUnreadCounts(prev => ({ ...prev, [accountId]: count }));
        } catch {}
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

    const loadMessages = async (accountId: string, folder: string, isPolling = false) => {
        if (!isPolling) setIsLoadingMessages(true);
        try {
            const data = await EmailService.getMessages(accountId, folder, 50);

            // Detect new emails for notifications (only during polling, INBOX only)
            if (isPolling && folder === 'INBOX' && prevMessageUidsRef.current.size > 0) {
                const currentUids = new Set(data.map(m => m.id));
                const newEmails = data.filter(m => !prevMessageUidsRef.current.has(m.id));
                if (newEmails.length > 0 && newEmails.length <= 5) {
                    const newNotes = newEmails.map(email => {
                        const from = typeof email.from === 'string' ? email.from : email.from.name || email.from.address;
                        return {
                            id: `email_${email.id}_${Date.now()}`,
                            type: 'email' as const,
                            title: `Novo email de ${from}`,
                            message: email.subject,
                            date: Date.now(),
                            priority: 'low' as const,
                            read: false,
                            linkTo: { view: 'email' as const, id: accountId }
                        };
                    });
                    setNotifications(prev => [...newNotes, ...prev]);
                    toast.info(`${newEmails.length} novo(s) email(s)`);
                }
            }

            prevMessageUidsRef.current = new Set(data.map(m => m.id));
            setMessages(data);
        } catch (error) {
            console.error(error);
            if (!isPolling) setMessages([]);
        } finally {
            if (!isPolling) setIsLoadingMessages(false);
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

    // Reply / Forward State
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

    const handleForward = () => {
        if (!messageBody) return;

        const fwdSubject = messageBody.subject.startsWith('Fwd:') ? messageBody.subject : `Fwd: ${messageBody.subject}`;
        const dateStr = format(new Date(messageBody.date), "dd/MM/yyyy HH:mm", { locale: ptBR });
        const fwdBody = `\n\n\n---------- Mensagem encaminhada ----------\nDe: ${messageBody.from}\nData: ${dateStr}\nAssunto: ${messageBody.subject}\nPara: ${messageBody.to}\n\n${messageBody.text || 'HTML Content'}`;

        setReplyData({
            to: '',
            subject: fwdSubject,
            body: fwdBody
        });
        setIsComposerOpen(true);
    };

    const handleSendEmail = async (to: string, subject: string, body: string, attachments: any[], cc?: string, bcc?: string) => {
        if (!selectedAccountId) return;
        await EmailService.sendEmail(selectedAccountId, to, subject, body, attachments, cc, bcc);
        toast.success('Email enviado com sucesso!');
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

    // Bulk Actions
    const handleToggleSelect = useCallback((uid: number) => {
        setSelectedUids(prev => {
            const next = new Set(prev);
            if (next.has(uid)) next.delete(uid);
            else next.add(uid);
            return next;
        });
    }, []);

    const handleSelectAll = useCallback(() => {
        const displayedMessages = threadedMessages;
        if (selectedUids.size === displayedMessages.length) {
            setSelectedUids(new Set());
        } else {
            setSelectedUids(new Set(displayedMessages.map(m => m.id)));
        }
    }, [threadedMessages, selectedUids]);

    const handleBulkMarkRead = async () => {
        if (!selectedAccountId || selectedUids.size === 0) return;
        try {
            await EmailService.modifyFlags(selectedAccountId, selectedFolder, Array.from(selectedUids), 'addFlags', ['\\Seen']);
            toast.success(`${selectedUids.size} marcado(s) como lido(s)`);
            setSelectionMode(false);
            setSelectedUids(new Set());
            loadMessages(selectedAccountId, selectedFolder);
            loadUnreadCount(selectedAccountId);
        } catch {
            toast.error('Erro ao marcar como lido');
        }
    };

    const handleBulkMarkUnread = async () => {
        if (!selectedAccountId || selectedUids.size === 0) return;
        try {
            await EmailService.modifyFlags(selectedAccountId, selectedFolder, Array.from(selectedUids), 'delFlags', ['\\Seen']);
            toast.success(`${selectedUids.size} marcado(s) como não lido(s)`);
            setSelectionMode(false);
            setSelectedUids(new Set());
            loadMessages(selectedAccountId, selectedFolder);
            loadUnreadCount(selectedAccountId);
        } catch {
            toast.error('Erro ao marcar como não lido');
        }
    };

    const handleBulkDelete = async () => {
        if (!selectedAccountId || selectedUids.size === 0) return;
        if (!window.confirm(`Excluir ${selectedUids.size} mensagem(ns)?`)) return;
        try {
            await EmailService.deleteMessages(selectedAccountId, selectedFolder, Array.from(selectedUids));
            toast.success(`${selectedUids.size} mensagem(ns) excluída(s)`);
            setSelectionMode(false);
            setSelectedUids(new Set());
            setSelectedMessageId(null);
            setMessageBody(null);
            loadMessages(selectedAccountId, selectedFolder);
            loadUnreadCount(selectedAccountId);
        } catch {
            toast.error('Erro ao excluir mensagens');
        }
    };

    const handleBulkMove = async (destinationFolder: string) => {
        if (!selectedAccountId || selectedUids.size === 0) return;
        try {
            await EmailService.moveMessages(selectedAccountId, selectedFolder, Array.from(selectedUids), destinationFolder);
            toast.success(`${selectedUids.size} movida(s) para ${destinationFolder}`);
            setSelectionMode(false);
            setSelectedUids(new Set());
            setShowBulkMoveMenu(false);
            setSelectedMessageId(null);
            setMessageBody(null);
            loadMessages(selectedAccountId, selectedFolder);
        } catch {
            toast.error('Erro ao mover mensagens');
        }
    };

    const handleMoveCurrentMessage = async (destinationFolder: string) => {
        if (!selectedAccountId || !selectedMessageId) return;
        try {
            await EmailService.moveMessages(selectedAccountId, selectedFolder, [selectedMessageId], destinationFolder);
            toast.success(`Movida para ${destinationFolder}`);
            setSelectedMessageId(null);
            setMessageBody(null);
            loadMessages(selectedAccountId, selectedFolder);
        } catch {
            toast.error('Erro ao mover mensagem');
        }
    };

    const handlePollChange = (value: number) => {
        setPollInterval(value);
        setShowPollMenu(false);
        EmailService.updateUserSettings({ pollInterval: value }).catch(() => {});
        if (value === 0) {
            toast.info('Auto-atualização desativada');
        } else {
            toast.success(`Auto-atualização: ${POLL_OPTIONS.find(o => o.value === value)?.label}`);
        }
    };

    const handleManualRefresh = () => {
        if (!selectedAccountId) return;
        loadMessages(selectedAccountId, selectedFolder);
        loadUnreadCount(selectedAccountId);
        toast.info('Atualizando...');
    };

    // List Content for MasterDetail
    const renderListContent = () => {
        const selectedAccount = accounts.find(a => a.id === selectedAccountId);
        if (!selectedAccount) return null;

        const otherFolders = folders.filter(f => f !== selectedFolder);

        return (
            <div className="flex flex-col h-full bg-white dark:bg-slate-900">
                {/* Header */}
                <div className="border-b border-slate-200 dark:border-slate-800 shrink-0">
                    <div className="h-14 flex items-center justify-between px-4 gap-2">
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

                        <div className="flex items-center gap-1.5">
                            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">
                                {threadedMessages.length}
                            </span>

                            {/* Refresh */}
                            <button
                                onClick={handleManualRefresh}
                                className="p-1.5 text-slate-400 hover:text-blue-500 transition-colors"
                                title="Atualizar"
                            >
                                <RefreshCw size={16} />
                            </button>

                            {/* Poll interval */}
                            <div className="relative">
                                <button
                                    onClick={() => setShowPollMenu(!showPollMenu)}
                                    className={`p-1.5 transition-colors ${pollInterval > 0 ? 'text-green-500' : 'text-slate-400 hover:text-slate-600'}`}
                                    title="Auto-atualização"
                                >
                                    <Clock size={16} />
                                </button>
                                {showPollMenu && (
                                    <div className="absolute top-full right-0 mt-1 w-32 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-50">
                                        <div className="p-1">
                                            {POLL_OPTIONS.map(opt => (
                                                <button
                                                    key={opt.value}
                                                    onClick={() => handlePollChange(opt.value)}
                                                    className={`w-full text-left px-3 py-1.5 text-xs rounded ${pollInterval === opt.value
                                                        ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 font-medium'
                                                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                                                    }`}
                                                >
                                                    {opt.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Selection mode toggle */}
                            <button
                                onClick={() => {
                                    setSelectionMode(!selectionMode);
                                    setSelectedUids(new Set());
                                }}
                                className={`p-1.5 transition-colors ${selectionMode ? 'text-blue-500' : 'text-slate-400 hover:text-slate-600'}`}
                                title="Modo seleção"
                            >
                                <CheckSquare size={16} />
                            </button>

                            <button
                                onClick={() => setIsComposerOpen(true)}
                                className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg p-2 transition-colors"
                                title="Nova Mensagem"
                            >
                                <Plus size={18} />
                            </button>
                        </div>
                    </div>

                    {/* Search Bar */}
                    <div className="px-4 pb-3">
                        <div className="relative">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Buscar emails..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="w-full pl-9 pr-8 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-sm text-slate-800 dark:text-white placeholder-slate-400 outline-none focus:ring-2 focus:ring-blue-500/30"
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => { setSearchQuery(''); setSearchResults(null); }}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Bulk Actions Toolbar */}
                    {selectionMode && selectedUids.size > 0 && (
                        <div className="px-4 pb-3 flex items-center gap-2 flex-wrap">
                            <button
                                onClick={handleBulkMarkRead}
                                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700"
                            >
                                <MailOpen size={12} /> Lido
                            </button>
                            <button
                                onClick={handleBulkMarkUnread}
                                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700"
                            >
                                <Mail size={12} /> Não Lido
                            </button>
                            <button
                                onClick={handleBulkDelete}
                                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-md hover:bg-red-100 dark:hover:bg-red-900/40"
                            >
                                <Trash2 size={12} /> Excluir
                            </button>
                            {otherFolders.length > 0 && (
                                <div className="relative">
                                    <button
                                        onClick={() => setShowBulkMoveMenu(!showBulkMoveMenu)}
                                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700"
                                    >
                                        <FolderInput size={12} /> Mover
                                    </button>
                                    {showBulkMoveMenu && (
                                        <div className="absolute top-full left-0 mt-1 w-40 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-50 max-h-40 overflow-y-auto">
                                            <div className="p-1">
                                                {otherFolders.map(f => (
                                                    <button
                                                        key={f}
                                                        onClick={() => handleBulkMove(f)}
                                                        className="w-full text-left px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded"
                                                    >
                                                        {f}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                            <button
                                onClick={() => { setSelectionMode(false); setSelectedUids(new Set()); }}
                                className="ml-auto text-xs text-slate-400 hover:text-slate-600"
                            >
                                Cancelar
                            </button>
                        </div>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto">
                    <EmailList
                        messages={threadedMessages}
                        selectedMessageId={selectedMessageId}
                        isLoading={isLoadingMessages || isSearching}
                        onSelect={(msg) => setSelectedMessageId(msg.id)}
                        selectionMode={selectionMode}
                        selectedUids={selectedUids}
                        onToggleSelect={handleToggleSelect}
                        onSelectAll={handleSelectAll}
                    />
                </div>
            </div>
        );
    };

    return (
        <div className="flex h-full bg-slate-100 dark:bg-slate-900 overflow-hidden relative">
            {/* Left Sidebar: Accounts */}
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
                    onAddAccount={() => { setEditingAccount(null); setIsConfigModalOpen(true); }}
                    onEditAccount={(account) => { setEditingAccount(account); setIsConfigModalOpen(true); }}
                    onDeleteAccount={async (id) => {
                        await EmailService.deleteAccount(id);
                        loadAccounts();
                    }}
                    unreadCounts={unreadCounts}
                />
            </div>

            {/* Main Content: List + Reading (MasterDetail) */}
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
                                onForward={handleForward}
                                folders={folders}
                                selectedFolder={selectedFolder}
                                onMoveMessage={handleMoveCurrentMessage}
                            />
                        }
                        listWidth="2/5"
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
                    onClose={() => { setIsConfigModalOpen(false); setEditingAccount(null); }}
                    editAccount={editingAccount}
                    onSave={async (data) => {
                        if (editingAccount) {
                            await EmailService.updateAccount(editingAccount.id, data);
                        } else {
                            await EmailService.addAccount(data);
                        }
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

            {isTemplateManagerOpen && (
                <EmailTemplateManager
                    onClose={() => setIsTemplateManagerOpen(false)}
                />
            )}
        </div>
    );
};

// Helper: strip Re:/Fwd: prefixes and normalize subject for threading
function normalizeSubject(subject: string): string {
    return subject
        .replace(/^(Re|Fwd|Fw|Enc|Res):\s*/gi, '')
        .replace(/^(Re|Fwd|Fw|Enc|Res)\[\d+\]:\s*/gi, '')
        .trim()
        .toLowerCase();
}

export default EmailView;
