
import { AppView } from './common';

// WHATSAPP TYPES
export interface WhatsAppAccount {
    id: string;
    name: string;
    phoneNumber: string; // E.164
    status: 'connected' | 'disconnected' | 'qr_code';
    platform: 'META' | 'WAHA' | 'TWILIO';
}

export interface WhatsAppProfile {
    name: string;
    number: string;
    about: string;
    profilePicUrl: string;
    status: string; // Connection status
}

export interface WhatsAppMessage {
    id: string;
    conversationId: string;
    text: string;
    sender: 'user' | 'agent' | 'system';
    senderName?: string;
    timestamp: number;
    status: 'sent' | 'delivered' | 'read' | 'failed';
    attachments?: {
        type: 'image' | 'file' | 'audio' | 'video';
        url: string;
        name: string;
        mimeType?: string;
    }[];
}

export interface WhatsAppConversation {
    id: string;
    accountId: string;
    customerName: string;
    customerNumber: string;
    lastMessage?: string;
    lastMessageTimestamp: number;
    unreadCount: number;
    status: 'open' | 'closed' | 'snoozed';
    assignedUserId?: string; // ID of the Dolibarr User
    tags?: string[];
    // CRM Context link
    customer_id?: string;
    isGroup?: boolean;
    lastResponderId?: string;
}

// WAHA (WhatsApp HTTP API) RAW TYPES for internal mapping
export interface WahaSession {
    id: string;
    status: 'STOPPED' | 'STARTING' | 'SCAN_QR_CODE' | 'WORKING' | 'FAILED';
    me?: {
        id: string;
        pushName: string;
    };
}

export interface WahaChat {
    id: {
        _serialized: string;
        user: string;
    };
    name?: string;
    pushname?: string;
    timestamp?: number;
    unreadCount?: number;
}

export interface WahaMessage {
    id: string; // Serialized ID from backend
    body: string;
    fromMe: boolean;
    timestamp: number;
    hasMedia: boolean;
    ack: number; // 0=pending, 1=sent, 2=received, 3=read
    type: string; // 'chat', 'image', 'ptt', 'document'
    mimetype?: string;
    sender?: string;
    senderName?: string;
    status?: string;
}
