import React, { useState, useEffect } from 'react';
import { EmailService } from '../../services/emailService';
import { EmailAccount, EmailMessage, EmailBody } from '../../types/email';
import { EmailAccountList } from './EmailAccountList';
import { EmailList } from './EmailList';
import { EmailComposer } from './EmailComposer';
import { StoreConfigModal } from './StoreConfigModal';
import { Plus, Folder, Inbox, ChevronDown } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const EmailView: React.FC = () => {
    // State
    const [accounts, setAccounts] = useState<EmailAccount[]>([]);
    const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

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

    // Initial Load
    useEffect(() => {
        loadAccounts();
    }, []);

    // Load folders and messages when account selected
    useEffect(() => {
        if (selectedAccountId) {
            // Reset state
            setSelectedFolder('INBOX');
            setFolders([]);
            setMessages([]);
            setSelectedMessageId(null);
            setMessageBody(null);

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
        }
    }, [selectedFolder]);

    // Load body when message selected
    useEffect(() => {
        if (selectedAccountId && selectedMessageId) {
            loadMessageBody(selectedAccountId, selectedMessageId);
        }
    }, [selectedAccountId, selectedMessageId]);

    const loadAccounts = async () => {
        setIsLoadingAccounts(true);
        try {
            const data = await EmailService.getAccounts();
            setAccounts(data);
            if (data.length > 0 && !selectedAccountId) {
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

    const handleSendEmail = async (to: string, subject: string, body: string) => {
        if (!selectedAccountId) return;
        await EmailService.sendEmail(selectedAccountId, to, subject, body);
        alert('Email enviado com sucesso!');
        // Ideally append to Sent folder or refresh if current folder is Sent
        if (selectedFolder === 'Sent' || selectedFolder.toLowerCase().includes('sent')) {
            loadMessages(selectedAccountId, selectedFolder);
        }
    };

    // Render Logic
    const selectedAccount = accounts.find(a => a.id === selectedAccountId);

    return (
        <div className="flex h-full bg-slate-100 dark:bg-slate-900 overflow-hidden">
            {/* Left Sidebar: Accounts */}
            <div className="w-[280px] flex-none border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
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
            {selectedAccount ? (
                <div className="w-[400px] flex-none border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col">
                    <div className="h-16 flex items-center justify-between px-4 border-b border-slate-200 dark:border-slate-800 shrink-0 gap-2">
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
                </div>
            ) : (
                <div className="flex-1 flex items-center justify-center text-slate-400">
                    Selecione uma conta
                </div>
            )}

            {/* Right: Reading Pane */}
            <div className="flex-1 bg-white dark:bg-slate-900 flex flex-col min-w-0">
                {messageBody ? (
                    <div className="flex flex-col h-full">
                        {/* Header */}
                        <div className="p-6 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/30">
                            <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-4 leading-tight">
                                {messageBody.subject}
                            </h1>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-700 dark:text-blue-300 font-bold text-sm">
                                        {messageBody.from?.charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <p className="font-medium text-slate-900 dark:text-white">{messageBody.from}</p>
                                        <p className="text-sm text-slate-500 dark:text-slate-400">para {messageBody.to}</p>
                                    </div>
                                </div>
                                <div className="text-sm text-slate-500 dark:text-slate-400">
                                    {format(new Date(messageBody.date), "dd 'de' MMMM 'às' HH:mm", { locale: ptBR })}
                                </div>
                            </div>
                        </div>

                        {/* Body */}
                        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                            <div
                                className="prose dark:prose-invert max-w-none email-content-reset"
                                dangerouslySetInnerHTML={{ __html: messageBody.html || messageBody.text || '' }}
                            />

                            {messageBody.attachments && messageBody.attachments.length > 0 && (
                                <div className="mt-8 pt-8 border-t border-slate-200 dark:border-slate-800">
                                    <h4 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Anexos</h4>
                                    <div className="flex flex-wrap gap-2">
                                        {messageBody.attachments.map((att, i) => (
                                            <a
                                                key={i}
                                                href={att.content ? `data:${att.contentType};base64,${att.content}` : '#'}
                                                download={att.filename || 'download'}
                                                className="flex items-center gap-2 p-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                                            >
                                                <Folder size={16} className="text-blue-500" />
                                                <span className="text-sm text-slate-700 dark:text-slate-300">{att.filename}</span>
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400">
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
                    onClose={() => setIsComposerOpen(false)}
                    onSend={handleSendEmail}
                />
            )}
        </div>
    );
};

export default EmailView;
