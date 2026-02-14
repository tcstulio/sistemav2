import { useState, useEffect, useCallback } from 'react';
import { useWhatsAppContext } from '../../contexts/WhatsAppContext';
import { WhatsAppService } from '../../services/whatsappService';
import { WhatsAppConversation } from '../../types';
import { toast } from 'sonner';
import { logger } from '../../utils/logger';

const log = logger.child('Conversations');

export const useConversations = (sessionId: string = 'default') => {
    const { socket } = useWhatsAppContext();
    const [conversations, setConversations] = useState<WhatsAppConversation[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchConversations = useCallback(async () => {
        setLoading(true);
        try {
            // Support 'all' -> fetch for all connected sessions?
            // For now, let's stick to handling specific session or default.
            // If sessionId is 'all', useWhatsApp tried to fetch all.
            // Let's defer 'all' logic to the view or specific aggregator.
            // We'll assume sessionId passes a valid ID or 'all' to be handled by service if supported.

            // Service supports specific ID.
            if (sessionId === 'all') {
                // Fetch all accounts first? 
                // Let's simplify: View should iterate sessions or Service has a 'getAllChats'?
                // Service doesn't have getAllChats.
                // Replicating useWhatsApp logic:
                const accounts = await WhatsAppService.getAccounts();
                const connected = accounts.filter(a => a.status === 'connected');
                const promises = connected.map(acc => WhatsAppService.getConversations(acc.id));
                const results = await Promise.all(promises);
                const flat = results.flat().sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp);
                setConversations(flat);
            } else {
                const data = await WhatsAppService.getConversations(sessionId);
                setConversations(data.sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp));
            }
        } catch (error) {
            log.error('Failed to fetch', error);
        } finally {
            setLoading(false);
        }
    }, [sessionId]);

    useEffect(() => {
        fetchConversations();
    }, [fetchConversations]);

    // Listen for new messages to update list
    useEffect(() => {
        if (!socket) return;

        const handleMessage = (msg: any) => {
            // msg payload: { sessionId, from, body, timestamp, ... }

            // Filter if we are viewing a specific session
            if (sessionId !== 'all' && msg.sessionId !== sessionId) return;

            const chatId = msg.from; // Or to? If fromMe?
            // If fromMe, we also want to update the conversation (it goes to top)
            const targetChatId = msg.fromMe ? msg.to : msg.from;

            setConversations(prev => {
                const index = prev.findIndex(c => c.id === targetChatId);
                let newConvs = [...prev];

                if (index > -1) {
                    // Update existing
                    const updated = { ...newConvs[index] };
                    updated.lastMessage = msg.body;
                    updated.lastMessageTimestamp = msg.timestamp * 1000;
                    if (!msg.fromMe) {
                        updated.unreadCount = (updated.unreadCount || 0) + 1;
                    }
                    // Move to top
                    newConvs.splice(index, 1);
                    newConvs.unshift(updated);
                } else {
                    // New conversation (or we just don't have it loaded)
                    // We might need to fetch it or create a partial object
                    // For now, let's create a partial one or ignore until page refresh?
                    // Better to fetch:
                    // But we can't await inside setState easily without race conditions.
                    // Let's push a placeholder or rely on optimistic?
                    // useWhatsApp created a partial one.
                    const newConv: WhatsAppConversation = {
                        id: targetChatId,
                        accountId: msg.sessionId,
                        customerName: msg.pushName || msg.senderName || targetChatId.split('@')[0],
                        customerNumber: targetChatId.split('@')[0],
                        lastMessage: msg.body,
                        lastMessageTimestamp: msg.timestamp * 1000,
                        unreadCount: msg.fromMe ? 0 : 1,
                        status: 'open',
                        isGroup: targetChatId.endsWith('@g.us')
                    };
                    newConvs.unshift(newConv);
                }
                return newConvs;
            });
        };

        socket.on('whatsapp_message', handleMessage);
        return () => {
            socket.off('whatsapp_message', handleMessage);
        };
    }, [socket, sessionId]);

    return {
        conversations,
        loading,
        refreshConversations: fetchConversations
    };
};
