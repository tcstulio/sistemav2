import axios from 'axios';
import { EmailAccount, EmailMessage, EmailBody } from '../types/email';
import { config } from '../config';

const API_URL = `${config.API_BASE_URL}/api/email`;

// Helper to get Headers
const getHeaders = () => {
    const savedConfig = localStorage.getItem('doligen_config');
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

    deleteAccount: async (id: string): Promise<void> => {
        await axios.delete(`${API_URL}/accounts/${id}`, { headers: getHeaders() });
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

    sendEmail: async (accountId: string, to: string, subject: string, htmlBody: string, attachments: any[] = []): Promise<any> => {
        const response = await axios.post(`${API_URL}/send`, {
            accountId,
            to,
            subject,
            htmlBody,
            attachments
        }, { headers: getHeaders() });
        return response.data;
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

    updateUserSettings: async (settings: { signature?: string }): Promise<void> => {
        await axios.post(`${API_URL}/settings/user`, settings, { headers: getHeaders() });
    },

    getUserStore: async (): Promise<{ userSettings: any }> => {
        const response = await axios.get(`${API_URL}/store`, { headers: getHeaders() });
        return response.data;
    }
};
