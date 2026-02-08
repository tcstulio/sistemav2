import fs from 'fs';
import path from 'path';
import { atomicWriteSync } from '../utils/atomicWrite';
import { logger } from '../utils/logger';

const log = logger.child('StoreService');

interface WhatsAppStore {
    // Per-User (Signature preferences for manual messages - optional/legacy)
    user_settings: {
        [userId: string]: {
            // Deprecated for bot, but keeping for manual per-user personalization if needed
            signatureName?: string;
        };
    };
    // Per-Session (Account Auto-Reply defaults & Bot Identity)
    session_settings: {
        [sessionId: string]: {
            autoReply: boolean;
            autoReplyContext?: string;
            signatureName?: string; // Bot Signature for this account
            name?: string; // Friendly Name for the Session (e.g. "Vendas", "Suporte")
            historyLimit?: number; // Number of messages to send to LLM (default: 10)
        };
    };
    // Per-Chat (Specific Overrides)
    chat_settings: {
        [chatId: string]: {
            autoReplyEnabled?: boolean; // If defined, overrides session
            // Group Specific Settings
            groupSettings?: {
                llmEnabled?: boolean;
                responseFrequency?: { value: number; unit: 'minutes' | 'hours' | 'days' }; // Wait X time before next reply
                burstHandling?: { enabled: boolean; threshold: number }; // Wait X messages before reply
                // State Tracking
                lastRepliedAt?: number;
                messageCounter?: number;
            };
        };
    };
    // Assignments
    conversation_assignments: {
        [chatId: string]: {
            userId?: string;
            assignedAt: number;
            lastResponderId?: string; // Implicit assignment tracking
        };
    };
}

const STORE_PATH = path.join(__dirname, '../../data/whatsapp_store.json');

class StoreService {
    private data: WhatsAppStore;

    constructor() {
        this.data = {
            user_settings: {},
            session_settings: {},
            chat_settings: {},
            conversation_assignments: {}
        };
        this.load();
    }

    private load() {
        try {
            // Ensure dir exists
            const dir = path.dirname(STORE_PATH);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            if (fs.existsSync(STORE_PATH)) {
                const content = fs.readFileSync(STORE_PATH, 'utf-8');
                const parsed = JSON.parse(content);
                // Merge with default structure to ensure new keys exist if loading old file
                this.data = {
                    user_settings: parsed.user_settings || {},
                    session_settings: parsed.session_settings || {},
                    chat_settings: parsed.chat_settings || {},
                    conversation_assignments: parsed.conversation_assignments || {}
                };
            }
        } catch (error) {
            log.error('Load Error', error);
        }
    }

    private save() {
        try {
            atomicWriteSync(STORE_PATH, this.data);
        } catch (error) {
            log.error('Save Error', error);
        }
    }

    // --- User Settings (Signatures for Manual) ---

    getUserSettings(userId: string) {
        return this.data.user_settings[userId] || {};
    }

    updateUserSettings(userId: string, settings: { signatureName?: string }) {
        this.data.user_settings[userId] = {
            ...this.getUserSettings(userId),
            ...settings
        };
        this.save();
    }

    // --- Session Settings (Account Bot) ---

    getSessionSettings(sessionId: string) {
        return this.data.session_settings[sessionId] || { autoReply: false };
    }

    updateSessionSettings(sessionId: string, settings: { autoReply?: boolean; autoReplyContext?: string; signatureName?: string; name?: string; historyLimit?: number }) {
        const current = this.getSessionSettings(sessionId);

        // Remove undefined keys to prevent overwriting existing data with undefined
        const cleanSettings = Object.entries(settings).reduce((acc, [key, value]) => {
            if (value !== undefined) {
                acc[key] = value;
            }
            return acc;
        }, {} as any);

        this.data.session_settings[sessionId] = {
            ...current,
            ...cleanSettings
        };
        this.save();
    }

    // --- Chat Settings (Overrides) ---

    getChatSettings(chatId: string) {
        return this.data.chat_settings[chatId] || {};
    }

    updateChatSettings(chatId: string, settings: {
        autoReplyEnabled?: boolean;
        groupSettings?: {
            llmEnabled?: boolean;
            responseFrequency?: { value: number; unit: 'minutes' | 'hours' | 'days' };
            burstHandling?: { enabled: boolean; threshold: number };
            lastRepliedAt?: number;
            messageCounter?: number;
        }
    }) {
        const current = this.data.chat_settings[chatId] || {};
        // If generic undefined passed, we might want to delete, but for now just merge
        this.data.chat_settings[chatId] = {
            ...current,
            ...settings,
            // If groupSettings is partial, we need to merge it carefully
            groupSettings: settings.groupSettings ? {
                ...(current.groupSettings || {}),
                ...settings.groupSettings
            } : current.groupSettings
        };
        this.save();
    }

    // --- Assignments ---

    getAssignment(chatId: string) {
        return this.data.conversation_assignments[chatId];
    }

    /**
     * Set explicit assignment
     */
    assignConversation(chatId: string, userId: string | null) {
        const current = this.data.conversation_assignments[chatId] || {};

        if (userId === null) {
            // Unassign: Keep lastResponderId but clear explicit userId
            this.data.conversation_assignments[chatId] = {
                ...current,
                userId: undefined,
                assignedAt: Date.now()
            };
        } else {
            // Assign
            this.data.conversation_assignments[chatId] = {
                ...current,
                userId,
                assignedAt: Date.now()
            };
        }
        this.save();
    }

    /**
     * Update "Last Responder" (Implicit Assignment)
     */
    updateLastResponder(chatId: string, userId: string) {
        const current = this.data.conversation_assignments[chatId] || { assignedAt: 0, userId: undefined, lastResponderId: undefined };
        this.data.conversation_assignments[chatId] = {
            ...current,
            lastResponderId: userId,
            assignedAt: current.assignedAt || Date.now() // Keep original assignment time if exists
        };
        this.save();
    }

    /**
     * Resolve effective user for a chat
     * Priority: Explicit Assignment > Last Responder
     */
    resolveUser(chatId: string): string | undefined {
        const data = this.data.conversation_assignments[chatId];
        if (!data) return undefined;
        return data.userId || data.lastResponderId;
    }

    /**
     * Resolves the signature for a given user object.
     */
    resolveSignature(user: any): string | null {
        if (!user || !user.id) return null;

        const userSettings = this.getUserSettings(user.id);

        // Smart Name Extraction
        let defaultName = user.firstname;
        if (!defaultName || /^\d+$/.test(defaultName.replace(/\s/g, ''))) {
            defaultName = user.lastname || user.login;
        }

        return userSettings.signatureName || defaultName || null;
    }

    /**
     * Formats a message content by appending the user's signature.
     */
    formatMessageWithSignature(text: string, user: any): string {
        const signature = this.resolveSignature(user);
        if (signature) {
            return `${text}\n\n~ ${signature}`;
        }
        return text;
    }
}

export const storeService = new StoreService();
