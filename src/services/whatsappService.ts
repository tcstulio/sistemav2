
import axios, { AxiosError } from 'axios';
import {
    WhatsAppAccount,
    WhatsAppConversation,
    WhatsAppMessage,
    WahaSession,
    WahaChat,
    WahaMessage,
    WhatsAppProfile
} from '../types';
import { config } from '../config';
import { safeStorage } from '../utils/safeStorage';
import { logger } from '../utils/logger';

const log = logger.child('WhatsApp');

// #envelope-fix: o backend padronizou as respostas de /api/whatsapp p/ `{ success, data }` (#1568).
// Este service lia `response.data` CRU → quebrou (ex.: `.map` num objeto → catch → lista vazia; a UI
// de sessões/conversas ficou em branco). `unwrapWa` desembrulha SE for o envelope; senão devolve o
// payload cru — compatível com respostas ainda não-envelopadas (nenhuma regressão em qualquer forma).
function unwrapWa<T = any>(response: { data: any }): T {
    const b = response?.data;
    return (b && typeof b === 'object' && !Array.isArray(b) && 'success' in b && 'data' in b) ? b.data : b;
}

// Helper to convert File to Base64
const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const result = reader.result as string;
            resolve(result);
        };
        reader.onerror = error => reject(error);
    });
};

const handleApiError = (context: string, error: unknown) => {
    if (axios.isAxiosError(error)) {
        log.error(`${context}: ${error.message}`, error.response?.data);
    } else {
        log.error(context, error);
    }
    throw error;
};

// Helper to get Headers
const getHeaders = () => {
    const parsed = safeStorage.getJSON<{ apiKey?: string }>('coolgroove_config', {});
    const apiKey = parsed.apiKey || '';
    return {
        'Content-Type': 'application/json',
        'DOLAPIKEY': apiKey
    };
};

export const WhatsAppService = {
    startSession: async (sessionId: string = 'default', name?: string): Promise<any> => {
        try {
            const response = await axios.post(`${config.WHATSAPP_API_URL}/start`, { sessionId, name }, { headers: getHeaders() });
            return response.data;
        } catch (e) {
            handleApiError(`Failed to start session ${sessionId}`, e);
        }
    },

    getQrCode: async (sessionId: string = 'default'): Promise<Blob | null> => {
        try {
            const response = await axios.get(`${config.WHATSAPP_API_URL}/qrcode?sessionId=${sessionId}`, {
                responseType: 'blob',
                headers: getHeaders()
            });
            return response.data;
        } catch (e) {
            // QR might not be ready
            return null;
        }
    },

    getAccounts: async (): Promise<WhatsAppAccount[]> => {
        try {
            const response = await axios.get<WahaSession[]>(`${config.WHATSAPP_API_URL}/sessions`, { headers: getHeaders() });
            const sessions = unwrapWa<WahaSession[]>(response);

            return sessions.map((s) => ({
                id: s.id,
                name: (s as any).name || s.me?.pushName || (s.id === 'default' ? 'Sessão Principal' : `Sessão ${s.id}`),
                phoneNumber: s.me?.id ? s.me.id.split('@')[0] : '---',
                status: s.status === 'WORKING' ? 'connected' : 'disconnected',
                platform: 'WAHA'
            }));
        } catch (e) {
            log.error('Failed to get sessions', e);
            return [];
        }
    },

    createSession: async (sessionId: string): Promise<void> => {
        await WhatsAppService.startSession(sessionId);
    },

    deleteSession: async (sessionId: string): Promise<void> => {
        try {
            await axios.delete(`${config.WHATSAPP_API_URL}/sessions/${sessionId}`, { headers: getHeaders() });
        } catch (e) {
            handleApiError(`Failed to delete session ${sessionId}`, e);
        }
    },

    getConversations: async (sessionId: string = 'default'): Promise<WhatsAppConversation[]> => {
        try {
            const response = await axios.get<WahaChat[]>(`${config.WHATSAPP_API_URL}/conversations?sessionId=${sessionId}`, { headers: getHeaders() });
            const rawChats = unwrapWa<any[]>(response);

            return rawChats.map((c: any) => {
                const serializedId = typeof c.id === 'object' ? c.id._serialized : c.id;
                const userNumber = typeof c.id === 'object' ? c.id.user : (c.id.includes('@') ? c.id.split('@')[0] : c.id);

                return {
                    id: serializedId,
                    accountId: sessionId,
                    customerName: c.name || c.pushname || c.phoneNumber || userNumber,
                    customerNumber: c.phoneNumber || userNumber,
                    lastMessage: c.lastMessage || '',
                    lastMessageTimestamp: c.timestamp ? c.timestamp * 1000 : Date.now(),
                    unreadCount: c.unreadCount || 0,
                    status: 'open',
                    isGroup: c.isGroup,
                    assignedUserId: c.assignedUserId, // [ANTIGRAVITY] Fix: Propagate assignment
                    lastResponderId: c.lastResponderId // [ANTIGRAVITY] Fix: Propagate last responder
                };
            });
        } catch (e) {
            log.error(`Failed to fetch conversations for ${sessionId}`, e);
            return [];
        }
    },

    getMessages: async (conversationId: string, sessionId: string = 'default'): Promise<WhatsAppMessage[]> => {
        try {
            const encodedChatId = encodeURIComponent(conversationId);
            const response = await axios.get<WahaMessage[]>(`${config.WHATSAPP_API_URL}/messages/${encodedChatId}?sessionId=${sessionId}`, { headers: getHeaders() });
            const rawMsgs = unwrapWa<WahaMessage[]>(response);

            return rawMsgs.map((m) => {
                const isAgent = m.fromMe;
                let attachmentType: 'image' | 'video' | 'audio' | 'file' = 'file';
                const msgType = m.type;
                const mime = m.mimetype || '';

                if (msgType === 'image' || mime.startsWith('image/')) attachmentType = 'image';
                else if (msgType === 'video' || mime.startsWith('video/')) attachmentType = 'video';
                else if (msgType === 'ptt' || msgType === 'audio' || mime.startsWith('audio/')) attachmentType = 'audio';

                const mediaUrl = `${config.WHATSAPP_API_URL}/messages/${m.id}/media?sessionId=${sessionId}`;

                return {
                    id: m.id,
                    conversationId: conversationId,
                    text: m.body || (m.hasMedia ? (attachmentType === 'audio' ? '🎤 Áudio' : '📎 Anexo') : ''),
                    sender: isAgent ? 'agent' : 'user',
                    senderName: m.senderName,
                    timestamp: m.timestamp * 1000,
                    status: m.ack >= 2 ? 'read' : (m.ack === 1 ? 'delivered' : 'sent'),
                    attachments: m.hasMedia ? [{
                        type: attachmentType,
                        url: mediaUrl,
                        name: 'Media'
                    }] : undefined
                };
            });
        } catch (e) {
            log.error('Failed to fetch messages', e);
            return [];
        }
    },

    sendMessage: async (conversationId: string, text: string, sessionId: string = 'default'): Promise<WhatsAppMessage> => {
        try {
            const response = await axios.post(`${config.WHATSAPP_API_URL}/send`, { chatId: conversationId, text, sessionId }, { headers: getHeaders() });
            const data = response.data;
            // Normalize ID: WWebJS returns an object { fromMe, remote, id, _serialized }
            const msgId = (typeof data.id === 'object' && data.id._serialized) ? data.id._serialized : (data.id || `temp_${Date.now()}`);

            return {
                id: msgId,
                conversationId,
                text,
                sender: 'agent',
                timestamp: Date.now(),
                status: 'sent'
            };
        } catch (e) {
            handleApiError('Failed to send message', e);
            throw e;
        }
    },

    sendAudioMessage: async (conversationId: string, audioBlob: Blob, sessionId: string = 'default'): Promise<WhatsAppMessage> => {
        try {
            const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.readAsDataURL(audioBlob);
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = reject;
            });

            const data = unwrapWa<any>(await axios.post(`${config.WHATSAPP_API_URL}/send-voice`, {
                chatId: conversationId,
                fileData: base64,
                sessionId
            }, { headers: getHeaders() }));

            const msgId = (typeof data.id === 'object' && data.id._serialized) ? data.id._serialized : (data.id || `temp_${Date.now()}`);

            return {
                id: msgId,
                conversationId,
                text: '🎤 Áudio',
                sender: 'agent',
                timestamp: Date.now(),
                status: 'sent',
                attachments: [{ type: 'audio', url: '', name: 'voice.ogg' }]
            };
        } catch (e) {
            handleApiError('Failed to send audio', e);
            throw e;
        }
    },

    sendFileMessage: async (conversationId: string, file: File, mockUrl: string, sessionId: string = 'default'): Promise<WhatsAppMessage> => {
        try {
            const base64 = await fileToBase64(file);

            const data = unwrapWa<any>(await axios.post(`${config.WHATSAPP_API_URL}/send-file`, {
                chatId: conversationId,
                fileData: base64,
                filename: file.name,
                sessionId
            }, { headers: getHeaders() }));

            const msgId = (typeof data.id === 'object' && data.id._serialized) ? data.id._serialized : (data.id || `temp_${Date.now()}`);

            return {
                id: msgId,
                conversationId,
                text: file.name,
                sender: 'agent',
                timestamp: Date.now(),
                status: 'sent',
                attachments: [{ type: 'file', url: mockUrl, name: file.name }]
            };
        } catch (e) {
            handleApiError('Failed to send file', e);
            throw e;
        }
    },

    assignConversation: async (conversationId: string, userId: string | null) => {
        try {
            await axios.post(`${config.WHATSAPP_API_URL}/assign`, { chatId: conversationId, userId }, { headers: getHeaders() });
        } catch (e) {
            handleApiError('Failed to assign conversation', e);
            throw e;
        }
    },

    getUserSettings: async () => {
        try {
            const response = await axios.get(`${config.WHATSAPP_API_URL}/store`, { headers: getHeaders() });
            return unwrapWa<any>(response)?.mySettings || {};
        } catch (e) {
            log.error('Failed to get user settings', e);
            throw e;
        }
    },

    getSessionSettings: async (sessionId: string) => {
        try {
            const response = await axios.get(`${config.WHATSAPP_API_URL}/settings/session/${sessionId}`, { headers: getHeaders() });
            return unwrapWa(response);
        } catch (e) {
            log.error('Failed to get session settings', e);
            throw e;
        }
    },

    getChatSettings: async (chatId: string) => {
        try {
            // Encode chatID!
            const encoded = encodeURIComponent(chatId);
            const response = await axios.get(`${config.WHATSAPP_API_URL}/settings/chat/${encoded}`, { headers: getHeaders() });
            return unwrapWa(response);
        } catch (e) {
            log.error('Failed to get chat settings', e);
            throw e;
        }
    },

    updateUserSettings: async (settings: any) => {
        await axios.post(`${config.WHATSAPP_API_URL}/settings/user`, settings, { headers: getHeaders() });
    },

    updateSessionSettings: async (sessionId: string, settings: any) => {
        await axios.post(`${config.WHATSAPP_API_URL}/settings/session`, { sessionId, ...settings }, { headers: getHeaders() });
    },

    updateChatSettings: async (chatId: string, settings: any) => {
        await axios.post(`${config.WHATSAPP_API_URL}/settings/chat`, { chatId, ...settings }, { headers: getHeaders() });
    },

    // Profile Settings
    getProfile: async (sessionId: string = 'default'): Promise<WhatsAppProfile> => {
        try {
            const response = await axios.get(`${config.WHATSAPP_API_URL}/profile?sessionId=${sessionId}`, { headers: getHeaders() });
            return unwrapWa(response);
        } catch (e) {
            handleApiError('Failed to get profile', e);
            throw e;
        }
    },

    setProfilePicture: async (file: File, sessionId: string = 'default') => {
        try {
            const base64 = await fileToBase64(file); // Reuse existing helper
            await axios.post(`${config.WHATSAPP_API_URL}/profile/picture`, {
                sessionId,
                fileData: base64,
                mimetype: file.type,
                filename: file.name
            }, { headers: getHeaders() });
        } catch (e) {
            handleApiError('Failed to set profile picture', e);
            throw e;
        }
    },

    deleteProfilePicture: async (sessionId: string = 'default') => {
        try {
            await axios.delete(`${config.WHATSAPP_API_URL}/profile/picture?sessionId=${sessionId}`, { headers: getHeaders() });
        } catch (e) {
            handleApiError('Failed to delete profile picture', e);
            throw e;
        }
    },

    setDisplayName: async (name: string, sessionId: string = 'default') => {
        try {
            await axios.post(`${config.WHATSAPP_API_URL}/profile/name`, { sessionId, name }, { headers: getHeaders() });
        } catch (e) {
            handleApiError('Failed to set display name', e);
            throw e;
        }
    },

    setAbout: async (status: string, sessionId: string = 'default') => {
        try {
            await axios.post(`${config.WHATSAPP_API_URL}/profile/status`, { sessionId, status }, { headers: getHeaders() });
        } catch (e) {
            handleApiError('Failed to set status/about', e);
            throw e;
        }
    },

    setPresence: async (presence: 'online' | 'offline', sessionId: string = 'default') => {
        try {
            await axios.post(`${config.WHATSAPP_API_URL}/profile/presence`, { sessionId, presence }, { headers: getHeaders() });
        } catch (e) {
            handleApiError('Failed to set presence', e);
            throw e;
        }
    },

    checkNumber: async (phoneNumber: string, sessionId: string = 'default'): Promise<{ number: string; isRegistered: boolean; chatId: string }> => {
        try {
            const response = await axios.get(
                `${config.WHATSAPP_API_URL}/check-number/${phoneNumber}?sessionId=${sessionId}`,
                { headers: getHeaders() }
            );
            return unwrapWa(response);
        } catch (e) {
            handleApiError('Failed to check number', e);
            throw e;
        }
    }
};