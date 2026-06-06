import { useState, useEffect, useCallback, useRef } from 'react';
import { useWhatsAppContext } from '../../contexts/WhatsAppContext';
import { WhatsAppService } from '../../services/whatsappService';
import { WhatsAppMessage } from '../../types';
import { useDolibarr } from '../../context/DolibarrContext';
import { toast } from 'sonner';
import { logger } from '../../utils/logger';

const log = logger.child('Messages');

export const useMessages = (sessionId: string, chatId: string | null) => {
    const { socket } = useWhatsAppContext();
    const { config } = useDolibarr();
    const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
    const [loading, setLoading] = useState(false);
    const chatIdRef = useRef(chatId);

    useEffect(() => { chatIdRef.current = chatId; }, [chatId]);

    const fetchMessages = useCallback(async () => {
        if (!chatId || !sessionId) return;
        setLoading(true);
        try {
            const data = await WhatsAppService.getMessages(chatId, sessionId);
            // Deduplication on fetch? Usually not needed if backend returns unique.
            setMessages(data || []);
        } catch (error) {
            log.error('Failed to fetch', error);
            toast.error('Erro ao carregar mensagens');
        } finally {
            setLoading(false);
        }
    }, [chatId, sessionId]);

    useEffect(() => {
        if (chatId) {
            fetchMessages();
        } else {
            setMessages([]);
        }
    }, [chatId, fetchMessages]);

    // Socket Events
    useEffect(() => {
        if (!socket) return;

        const handleMessage = (msg: any) => {
            // Check session
            if (sessionId !== 'all' && msg.sessionId !== sessionId) return;

            // Check Chat (From or To)
            // If fromMe, msg.to should match chatId.
            // If !fromMe, msg.from should match chatId.
            const msgChatId = msg.fromMe ? msg.to : msg.from;

            // Current Ref check is safer than dependency closure for callbacks
            if (msgChatId !== chatIdRef.current) return;

            const newMsg: WhatsAppMessage = {
                id: msg.id,
                conversationId: msgChatId,
                text: msg.body,
                sender: msg.fromMe ? 'agent' : 'user',
                senderName: msg.senderName || msg.pushName,
                timestamp: msg.timestamp * 1000,
                status: 'delivered', // Incoming is delivered to us
                attachments: msg.hasMedia ? [{
                    type: msg.mimetype?.startsWith('audio') ? 'audio' : 'file', // Simplified
                    url: config ? `${config.WHATSAPP_API_URL}/messages/${msg.id}/media?sessionId=${msg.sessionId}` : "",
                    name: 'Media'
                }] : undefined
            };

            setMessages(prev => {
                // Deduplication Logic
                const existingIndex = prev.findIndex(m => m.id === newMsg.id);
                if (existingIndex > -1) {
                    // If message exists, check if we need to update it (e.g. status changed or text changed/signature added)
                    const existingMsg = prev[existingIndex];
                    if (existingMsg.status !== newMsg.status || existingMsg.text !== newMsg.text) {
                        const updated = [...prev];
                        updated[existingIndex] = newMsg;
                        return updated;
                    }
                    return prev;
                }

                if (newMsg.sender === 'agent') {
                    // Heuristic: Check for optimistic message
                    // Find 'sent' message with similar text within last 10 seconds
                    const now = newMsg.timestamp;
                    const matchIndex = prev.findIndex(m =>
                        m.sender === 'agent' &&
                        m.status === 'sent' && // Optimistic status
                        (m.id.startsWith('temp_') || m.id.includes('temp')) && // Ensure we only replace temps
                        (newMsg.text?.includes(m.text || '') || m.text === newMsg.text) && // Allow signature append
                        (now - m.timestamp) < 20000 // 20s window 
                    );

                    if (matchIndex > -1) {
                        // Replace optimistic with real
                        const updated = [...prev];
                        updated[matchIndex] = { ...newMsg, status: 'sent' }; 
                        return updated;
                    }
                }

                return [...prev, newMsg];
            });
        };

        const handleAck = (data: { sessionId: string, messageId: string, ack: number, status: string }) => {
            if (sessionId !== 'all' && data.sessionId !== sessionId) return;

            setMessages(prev => prev.map(m => {
                if (m.id === data.messageId) {
                    return { ...m, status: data.status as any };
                }
                return m;
            }));
        };

        socket.on('whatsapp_message', handleMessage);
        socket.on('whatsapp_ack', handleAck);

        return () => {
            socket.off('whatsapp_message', handleMessage);
            socket.off('whatsapp_ack', handleAck);
        };
    }, [socket, sessionId]); // Depend on sessionId. chatId is handled via Ref.

    // Actions
    const sendMessage = async (text: string) => {
        if (!chatId) return;

        // Optimistic Update
        const tempId = `temp_${Date.now()}`;
        const optimisticMsg: WhatsAppMessage = {
            id: tempId,
            conversationId: chatId,
            text,
            sender: 'agent',
            timestamp: Date.now(),
            status: 'sent'
        };
        setMessages(prev => [...prev, optimisticMsg]);

        try {
            const result = await WhatsAppService.sendMessage(chatId, text, sessionId);
            // Result has the real ID (or a better temp ID).
            // But we ignore result usually and wait for socket? 
            // Or update immediately?
            // Update immediately to link the ID.
            setMessages(prev => prev.map(m => m.id === tempId ? { ...m, id: result.id } : m));
        } catch (e) {
            log.error('Failed to send message', e);
            toast.error('Erro ao enviar mensagem');
            setMessages(prev => prev.filter(m => m.id !== tempId)); // Remove optimistic on fail
        }
    };

    // Add sendVoice, sendFile similarly...

    return {
        messages,
        loading,
        sendMessage
    };
};
