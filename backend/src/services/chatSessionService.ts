import fs from 'fs';
import path from 'path';
import { atomicWriteSync } from '../utils/atomicWrite';
import { logger } from '../utils/logger';

const log = logger.child('ChatSessionService');

export interface ChatSessionMessage {
    role: 'user' | 'model' | 'system';
    content: string;
    timestamp: number;
    metadata?: {
        hasImage?: boolean;
        toolCalls?: {
            tool: string;
            args: Record<string, any>;
            result?: string;
            duration?: number;
        }[];
        provider?: string;
        model?: string;
        usage?: {
            promptTokens: number;
            completionTokens: number;
            totalTokens: number;
        };
        // issue #1151: marca msgs de erro persistidas quando o job do assistente falha
        // (para a sessão não ficar "muda" — turno preservado).
        error?: boolean;
    };
}

export interface ChatSession {
    id: string;
    userId: string;
    title: string;
    messages: ChatSessionMessage[];
    createdAt: number;
    updatedAt: number;
    messageCount: number;
    lastPreview: string;
}

interface ChatSessionStore {
    sessions: ChatSession[];
}

const STORE_PATH = path.join(__dirname, '../../data/chat_sessions.json');
const MAX_SESSIONS = 200;
const MAX_MESSAGES_PER_SESSION = 500;
const PREVIEW_LENGTH = 80;

class ChatSessionService {
    private data: ChatSessionStore;

    constructor() {
        this.data = { sessions: [] };
        this.load();
    }

    private load() {
        try {
            const dir = path.dirname(STORE_PATH);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            if (fs.existsSync(STORE_PATH)) {
                const content = fs.readFileSync(STORE_PATH, 'utf-8');
                const parsed = JSON.parse(content);
                this.data = {
                    sessions: parsed.sessions || []
                };
                log.info(`Loaded ${this.data.sessions.length} chat sessions`);
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

    private trimSessions() {
        if (this.data.sessions.length > MAX_SESSIONS) {
            this.data.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
            this.data.sessions = this.data.sessions.slice(0, MAX_SESSIONS);
        }
    }

    createSession(userId: string, firstMessage?: string): ChatSession {
        const session: ChatSession = {
            id: `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            userId,
            title: firstMessage
                ? firstMessage.slice(0, 50) + (firstMessage.length > 50 ? '...' : '')
                : 'Nova conversa',
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messageCount: 0,
            lastPreview: ''
        };

        this.data.sessions.unshift(session);
        this.trimSessions();
        this.save();

        log.info(`Created session ${session.id} for user ${userId}`);
        return session;
    }

    addMessage(sessionId: string, msg: Omit<ChatSessionMessage, 'timestamp'>): ChatSessionMessage | null {
        const session = this.data.sessions.find(s => s.id === sessionId);
        if (!session) return null;

        const chatMsg: ChatSessionMessage = {
            ...msg,
            timestamp: Date.now()
        };

        session.messages.push(chatMsg);

        if (session.messages.length > MAX_MESSAGES_PER_SESSION) {
            session.messages = session.messages.slice(-MAX_MESSAGES_PER_SESSION);
        }

        session.messageCount = session.messages.length;
        session.updatedAt = Date.now();
        session.lastPreview = msg.content.slice(0, PREVIEW_LENGTH) + (msg.content.length > PREVIEW_LENGTH ? '...' : '');

        if (session.title === 'Nova conversa' && msg.role === 'user' && msg.content.trim()) {
            session.title = msg.content.slice(0, 50) + (msg.content.length > 50 ? '...' : '');
        }

        this.save();
        return chatMsg;
    }

    // issue #1151: fonte autoritativa do contexto do LLM. Retorna cópia das mensagens
    // da sessão (ordem de ENVIO/persistência), nunca a referência interna.
    getMessages(sessionId: string): ChatSessionMessage[] {
        const session = this.data.sessions.find(s => s.id === sessionId);
        return session ? session.messages.map(m => ({ ...m })) : [];
    }

    getSession(id: string): ChatSession | undefined {
        return this.data.sessions.find(s => s.id === id);
    }

    getSessions(userId?: string, limit?: number): ChatSession[] {
        let result = [...this.data.sessions];

        if (userId) {
            result = result.filter(s => s.userId === userId);
        }

        result.sort((a, b) => b.updatedAt - a.updatedAt);

        if (limit) {
            result = result.slice(0, limit);
        }

        return result;
    }

    deleteSession(id: string): boolean {
        const idx = this.data.sessions.findIndex(s => s.id === id);
        if (idx >= 0) {
            this.data.sessions.splice(idx, 1);
            this.save();
            log.info(`Deleted session ${id}`);
            return true;
        }
        return false;
    }

    deleteSessionsByUser(userId: string): number {
        const before = this.data.sessions.length;
        this.data.sessions = this.data.sessions.filter(s => s.userId !== userId);
        const deleted = before - this.data.sessions.length;
        if (deleted > 0) {
            this.save();
            log.info(`Deleted ${deleted} sessions for user ${userId}`);
        }
        return deleted;
    }

    deleteAllSessions(): number {
        const count = this.data.sessions.length;
        this.data.sessions = [];
        this.save();
        log.info(`Deleted all sessions (${count})`);
        return count;
    }

    getStats() {
        return {
            totalSessions: this.data.sessions.length,
            totalMessages: this.data.sessions.reduce((sum, s) => sum + s.messageCount, 0),
            oldestSession: this.data.sessions.length > 0
                ? new Date(Math.min(...this.data.sessions.map(s => s.createdAt))).toISOString()
                : null,
            newestSession: this.data.sessions.length > 0
                ? new Date(Math.max(...this.data.sessions.map(s => s.createdAt))).toISOString()
                : null
        };
    }
}

export const chatSessionService = new ChatSessionService();
