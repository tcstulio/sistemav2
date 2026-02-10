import axios from 'axios';
import { EmailAccount, EmailMessage, EmailBody, EmailTemplate } from '../types/email';
import { config } from '../config';

const API_URL = `${config.API_BASE_URL}/api/email`;

// Helper to get Headers
const getHeaders = () => {
    const savedConfig = localStorage.getItem('coolgroove_config');
    let apiKey = '';
    if (savedConfig) {
        try {
            const parsed = JSON.parse(savedConfig);
            apiKey = parsed.apiKey || '';
        } catch (e) {
            console.error("Failed to parse config for auth header");
        }
    }
    return {
        'Content-Type': 'application/json',
        'DOLAPIKEY': apiKey
    };
};

export const EmailService = {
    // Accounts
    getAccounts: async (): Promise<EmailAccount[]> => {
        const response = await axios.get(`${API_URL}/accounts`, { headers: getHeaders() });
        return response.data;
    },

    addAccount: async (data: any): Promise<{ success: true; id: string }> => {
        const response = await axios.post(`${API_URL}/accounts`, data, { headers: getHeaders() });
        return response.data;
    },

    updateAccount: async (id: string, data: Record<string, unknown>): Promise<void> => {
        await axios.put(`${API_URL}/accounts/${id}`, data, { headers: getHeaders() });
    },

    deleteAccount: async (id: string): Promise<void> => {
        await axios.delete(`${API_URL}/accounts/${id}`, { headers: getHeaders() });
    },

    // Test Connection
    testConnection: async (type: 'imap' | 'smtp', config: { host: string; port: number; user: string; password: string; secure?: boolean; tls?: boolean }, accountId?: string): Promise<{ success: boolean; message: string }> => {
        const response = await axios.post(`${API_URL}/test-connection`, { type, config, accountId }, { headers: getHeaders() });
        return response.data;
    },

    // Operations
    getFolders: async (accountId: string): Promise<any[]> => {
        const response = await axios.get(`${API_URL}/${accountId}/folders`, { headers: getHeaders() });
        return response.data;
    },

    getMessages: async (accountId: string, folder: string = 'INBOX', limit: number = 20): Promise<EmailMessage[]> => {
        const response = await axios.get(`${API_URL}/${accountId}/messages`, {
            params: { folder, limit },
            headers: getHeaders()
        });
        return response.data;
    },

    getMessageBody: async (accountId: string, uid: number, folder: string = 'INBOX'): Promise<EmailBody> => {
        const response = await axios.get(`${API_URL}/${accountId}/messages/${uid}/body`, {
            params: { folder },
            headers: getHeaders()
        });
        return response.data;
    },

    sendEmail: async (accountId: string, to: string, subject: string, htmlBody: string, attachments: any[] = [], cc?: string, bcc?: string): Promise<any> => {
        const response = await axios.post(`${API_URL}/send`, {
            accountId,
            to,
            subject,
            htmlBody,
            attachments,
            cc: cc || undefined,
            bcc: bcc || undefined
        }, { headers: getHeaders() });
        return response.data;
    },

    // Unread Count
    getUnreadCount: async (accountId: string, folder: string = 'INBOX'): Promise<number> => {
        const response = await axios.get(`${API_URL}/${accountId}/unread-count`, {
            params: { folder },
            headers: getHeaders()
        });
        return response.data.count;
    },

    // Search
    searchMessages: async (accountId: string, query: string, folder: string = 'INBOX', searchIn: string = 'all', limit: number = 50): Promise<EmailMessage[]> => {
        const response = await axios.get(`${API_URL}/${accountId}/search`, {
            params: { q: query, folder, searchIn, limit },
            headers: getHeaders()
        });
        return response.data;
    },

    // Flags (Bulk Actions)
    modifyFlags: async (accountId: string, folder: string, uids: number[], action: 'addFlags' | 'delFlags', flags: string[]): Promise<void> => {
        await axios.post(`${API_URL}/${accountId}/flags`, { folder, uids, action, flags }, { headers: getHeaders() });
    },

    // Delete Messages
    deleteMessages: async (accountId: string, folder: string, uids: number[]): Promise<void> => {
        await axios.post(`${API_URL}/${accountId}/delete`, { folder, uids }, { headers: getHeaders() });
    },

    // Move Messages
    moveMessages: async (accountId: string, sourceFolder: string, uids: number[], destinationFolder: string): Promise<void> => {
        await axios.post(`${API_URL}/${accountId}/move`, { sourceFolder, uids, destinationFolder }, { headers: getHeaders() });
    },

    // --- Templates ---

    getTemplates: async (): Promise<EmailTemplate[]> => {
        const response = await axios.get(`${API_URL}/templates`, { headers: getHeaders() });
        return response.data;
    },

    addTemplate: async (data: { name: string; subject: string; body: string }): Promise<{ success: true; id: string }> => {
        const response = await axios.post(`${API_URL}/templates`, data, { headers: getHeaders() });
        return response.data;
    },

    updateTemplate: async (id: string, data: Partial<{ name: string; subject: string; body: string }>): Promise<void> => {
        await axios.put(`${API_URL}/templates/${id}`, data, { headers: getHeaders() });
    },

    deleteTemplate: async (id: string): Promise<void> => {
        await axios.delete(`${API_URL}/templates/${id}`, { headers: getHeaders() });
    },

    // --- Metadata & Automations ---

    assignThread: async (threadId: string, userId: string | null): Promise<void> => {
        await axios.post(`${API_URL}/assign`, { threadId, userId }, { headers: getHeaders() });
    },

    getAssignment: async (threadId: string): Promise<string | null> => {
        const response = await axios.get(`${API_URL}/assign/${threadId}`, { headers: getHeaders() });
        return response.data.userId;
    },

    updateThreadSettings: async (threadId: string, settings: any): Promise<void> => {
        await axios.post(`${API_URL}/settings/thread`, { threadId, settings }, { headers: getHeaders() });
    },

    getThreadSettings: async (threadId: string): Promise<any> => {
        const response = await axios.get(`${API_URL}/settings/thread/${threadId}`, { headers: getHeaders() });
        return response.data;
    },

    updateUserSettings: async (settings: { signature?: string; pollInterval?: number }): Promise<void> => {
        await axios.post(`${API_URL}/settings/user`, settings, { headers: getHeaders() });
    },

    getUserStore: async (): Promise<{ userSettings: any }> => {
        const response = await axios.get(`${API_URL}/store`, { headers: getHeaders() });
        return response.data;
    }
};
