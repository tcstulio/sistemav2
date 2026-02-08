import React, { useState } from 'react';
import { X, Send, Phone, Users } from 'lucide-react';
import { WhatsAppAccount } from '../../types';
import { ThirdParty, Contact } from '../../types/crm';
import { ContactPicker, CRMContactEntry } from './ContactPicker';

interface NewConversationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onStartConversation: (phoneNumber: string, sessionId: string, initialMessage?: string) => void;
    sessions: WhatsAppAccount[];
    selectedSessionId: string;
    customers: ThirdParty[];
    contacts: Contact[];
    suppliers: ThirdParty[];
    users: any[];
}

const normalizePhone = (phone: string): string => {
    let digits = phone.replace(/\D/g, '');
    // Brazilian numbers: if 10-11 digits, prepend country code 55
    if (digits.length >= 10 && digits.length <= 11) {
        digits = '55' + digits;
    }
    return digits;
};

export const NewConversationModal: React.FC<NewConversationModalProps> = ({
    isOpen,
    onClose,
    onStartConversation,
    sessions,
    selectedSessionId,
    customers,
    contacts,
    suppliers,
    users
}) => {
    const [tab, setTab] = useState<'phone' | 'contacts'>('phone');
    const [phone, setPhone] = useState('');
    const [message, setMessage] = useState('');
    const [sessionId, setSessionId] = useState(selectedSessionId !== 'all' ? selectedSessionId : (sessions[0]?.id || 'default'));
    const [selectedContactName, setSelectedContactName] = useState('');

    if (!isOpen) return null;

    const connectedSessions = sessions.filter(s => s.status === 'connected' || (s.status as any) === 'WORKING');

    const handleSend = () => {
        const normalized = normalizePhone(phone);
        if (!normalized || normalized.length < 10) return;
        onStartConversation(normalized, sessionId, message.trim() || undefined);
        setPhone('');
        setMessage('');
        setSelectedContactName('');
    };

    const handleContactSelect = (entry: CRMContactEntry) => {
        const normalized = normalizePhone(entry.phone);
        setPhone(entry.phone);
        setSelectedContactName(entry.name);
        setTab('phone');
        // Auto-fill for quick send if there's already a message
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && e.ctrlKey) {
            handleSend();
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
            <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-700 relative max-h-[90vh] overflow-y-auto">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors"
                >
                    <X size={24} />
                </button>

                <div className="text-center mb-5">
                    <h3 className="text-2xl font-bold text-slate-800 dark:text-white mb-1">Nova Conversa</h3>
                    <p className="text-slate-500 dark:text-slate-400 text-sm">
                        Envie uma mensagem para qualquer numero ou selecione um contato do CRM
                    </p>
                </div>

                {/* Tabs */}
                <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl mb-5">
                    <button
                        onClick={() => setTab('phone')}
                        className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all flex items-center justify-center gap-2 ${tab === 'phone' ? 'bg-white dark:bg-slate-700 shadow text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                    >
                        <Phone size={16} /> Numero
                    </button>
                    <button
                        onClick={() => setTab('contacts')}
                        className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all flex items-center justify-center gap-2 ${tab === 'contacts' ? 'bg-white dark:bg-slate-700 shadow text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                    >
                        <Users size={16} /> Contatos CRM
                    </button>
                </div>

                {tab === 'contacts' ? (
                    <ContactPicker
                        customers={customers}
                        contacts={contacts}
                        suppliers={suppliers}
                        users={users}
                        onSelect={handleContactSelect}
                    />
                ) : (
                    <div className="space-y-4" onKeyDown={handleKeyDown}>
                        {/* Selected contact indicator */}
                        {selectedContactName && (
                            <div className="flex items-center gap-2 px-3 py-2 bg-green-50 dark:bg-green-900/20 rounded-xl border border-green-200 dark:border-green-800">
                                <span className="text-sm text-green-700 dark:text-green-300 font-medium">{selectedContactName}</span>
                                <button
                                    onClick={() => { setSelectedContactName(''); setPhone(''); }}
                                    className="ml-auto text-green-600 hover:text-green-800"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        )}

                        {/* Phone number input */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                                Numero de Telefone
                            </label>
                            <div className="flex gap-2">
                                <span className="flex items-center px-3 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-sm text-slate-600 dark:text-slate-400 shrink-0">
                                    +55
                                </span>
                                <input
                                    type="tel"
                                    value={phone}
                                    onChange={(e) => setPhone(e.target.value)}
                                    placeholder="11 99999-8888"
                                    className="flex-1 p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:ring-2 focus:ring-green-500 outline-none text-sm"
                                    autoFocus
                                />
                            </div>
                            <p className="text-xs text-slate-400 mt-1">DDD + numero (com 9). Ex: 11 99999-8888</p>
                        </div>

                        {/* Session selector */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                                Enviar de
                            </label>
                            <select
                                className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm dark:text-white focus:ring-2 focus:ring-green-500 outline-none"
                                value={sessionId}
                                onChange={(e) => setSessionId(e.target.value)}
                            >
                                {connectedSessions.length > 0 ? (
                                    connectedSessions.map(s => (
                                        <option key={s.id} value={s.id}>
                                            {s.name}{s.phoneNumber && s.phoneNumber !== '---' ? ` (${s.phoneNumber})` : ''}
                                        </option>
                                    ))
                                ) : (
                                    sessions.map(s => (
                                        <option key={s.id} value={s.id}>
                                            {s.name} ({s.status})
                                        </option>
                                    ))
                                )}
                            </select>
                        </div>

                        {/* Message input */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                                Mensagem (opcional)
                            </label>
                            <textarea
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                placeholder="Digite a primeira mensagem..."
                                rows={3}
                                className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:ring-2 focus:ring-green-500 outline-none text-sm resize-none"
                            />
                            <p className="text-xs text-slate-400 mt-1">Ctrl+Enter para enviar</p>
                        </div>

                        {/* Send button */}
                        <button
                            onClick={handleSend}
                            disabled={!normalizePhone(phone) || normalizePhone(phone).length < 10}
                            className="w-full py-3 bg-green-600 hover:bg-green-700 disabled:bg-slate-500 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
                        >
                            <Send size={18} />
                            {message.trim() ? 'Enviar Mensagem' : 'Abrir Conversa'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
