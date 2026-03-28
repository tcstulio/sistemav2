/**
 * Moltbot Gateway Service
 *
 * Comunicação com o Moltbot/OpenClaw Gateway para operações de WhatsApp.
 * Substitui gradualmente o whatsapp-web.js direto.
 *
 * @see docs/MOLTBOT_INTEGRATION_PLAN.md
 */

import http from 'http';

// Configuration
interface MoltbotConfig {
    host: string;
    port: number;
    token: string;
    timeout: number;
}

const DEFAULT_CONFIG: MoltbotConfig = {
    host: process.env.MOLTBOT_HOST || 'localhost',
    port: parseInt(process.env.MOLTBOT_PORT || '18789', 10),
    token: process.env.MOLTBOT_TOKEN || '',
    timeout: parseInt(process.env.MOLTBOT_TIMEOUT || '10000', 10),
};

// Types
export interface WhatsAppStatus {
    connected: boolean;
    status: 'ready' | 'connecting' | 'disconnected' | 'error' | 'unknown';
    phone: string | null;
    uptime?: number;
    checkedAt: number;
    error?: string;
}

export interface GatewayStatus {
    healthy: boolean;
    uptime?: number;
    channels?: {
        whatsapp?: WhatsAppStatus;
        [key: string]: any;
    };
}

export interface SendMessageParams {
    chatId: string;
    text: string;
    sessionId?: string;
}

export interface SendFileParams {
    chatId: string;
    file: Buffer;
    filename: string;
    caption?: string;
    mimetype?: string;
    sessionId?: string;
}

export interface MessageResult {
    success: boolean;
    messageId?: string;
    timestamp?: number;
    error?: string;
}

export interface Chat {
    id: string;
    name: string;
    isGroup: boolean;
    unreadCount: number;
    lastMessage?: string;
    timestamp?: number;
}

export interface Message {
    id: string;
    body: string;
    fromMe: boolean;
    timestamp: number;
    hasMedia: boolean;
    type: string;
    sender?: string;
    senderName?: string;
}

/**
 * Moltbot Gateway Client
 */
class MoltbotGateway {
    private config: MoltbotConfig;

    constructor(config?: Partial<MoltbotConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Low-level API call to Moltbot Gateway
     */
    private async callAPI<T = any>(
        path: string,
        method: string = 'GET',
        body?: any
    ): Promise<T> {
        return new Promise((resolve, reject) => {
            const options: http.RequestOptions = {
                hostname: this.config.host,
                port: this.config.port,
                path: `/api${path}`,
                method,
                timeout: this.config.timeout,
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.config.token && {
                        'Authorization': `Bearer ${this.config.token}`
                    })
                }
            };

            const req = http.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        // Check for HTML response (wrong endpoint)
                        const contentType = res.headers['content-type'] || '';
                        if (contentType.includes('text/html')) {
                            reject(new Error('Gateway returned HTML - wrong endpoint?'));
                            return;
                        }

                        const json = JSON.parse(data);
                        resolve(json as T);
                    } catch (e) {
                        reject(new Error(`JSON parse failed: ${data.substring(0, 100)}`));
                    }
                });
            });

            req.on('error', (err) => {
                reject(new Error(`Gateway connection failed: ${err.message}`));
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Gateway request timeout'));
            });

            if (body) {
                req.write(JSON.stringify(body));
            }
            req.end();
        });
    }

    /**
     * Check if gateway is enabled
     */
    isEnabled(): boolean {
        return process.env.MOLTBOT_ENABLED === 'true';
    }

    /**
     * Get gateway status
     */
    async getStatus(): Promise<GatewayStatus> {
        try {
            const status = await this.callAPI<any>('/status');
            return {
                healthy: true,
                uptime: status.uptime,
                channels: status.channels
            };
        } catch (error: any) {
            return {
                healthy: false,
                channels: {
                    whatsapp: {
                        connected: false,
                        status: 'error',
                        phone: null,
                        checkedAt: Date.now(),
                        error: error.message
                    }
                }
            };
        }
    }

    /**
     * Get WhatsApp connection status
     */
    async getWhatsAppStatus(): Promise<WhatsAppStatus> {
        try {
            const status = await this.getStatus();
            const wa = status.channels?.whatsapp;

            if (!wa) {
                return {
                    connected: false,
                    status: 'unknown',
                    phone: null,
                    checkedAt: Date.now()
                };
            }

            return {
                connected: wa.status === 'ready' || wa.connected === true,
                status: wa.status || 'unknown',
                phone: wa.phone || null,
                uptime: status.uptime,
                checkedAt: Date.now()
            };
        } catch (error: any) {
            return {
                connected: false,
                status: 'error',
                phone: null,
                checkedAt: Date.now(),
                error: error.message
            };
        }
    }

    /**
     * Send a text message
     */
    async sendMessage(params: SendMessageParams): Promise<MessageResult> {
        try {
            const result = await this.callAPI<any>('/whatsapp/send', 'POST', {
                chatId: params.chatId,
                text: params.text,
                sessionId: params.sessionId
            });

            return {
                success: true,
                messageId: result.id || result.messageId,
                timestamp: result.timestamp
            };
        } catch (error: any) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Send a file
     */
    async sendFile(params: SendFileParams): Promise<MessageResult> {
        try {
            const base64 = params.file.toString('base64');
            const result = await this.callAPI<any>('/whatsapp/send-file', 'POST', {
                chatId: params.chatId,
                fileData: base64,
                filename: params.filename,
                caption: params.caption,
                mimetype: params.mimetype,
                sessionId: params.sessionId
            });

            return {
                success: true,
                messageId: result.id || result.messageId,
                timestamp: result.timestamp
            };
        } catch (error: any) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Send a voice message
     */
    async sendVoice(chatId: string, audioData: string, sessionId?: string): Promise<MessageResult> {
        try {
            const result = await this.callAPI<any>('/whatsapp/send-voice', 'POST', {
                chatId,
                fileData: audioData,
                sessionId
            });

            return {
                success: true,
                messageId: result.id || result.messageId,
                timestamp: result.timestamp
            };
        } catch (error: any) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get list of chats/conversations
     */
    async getChats(sessionId?: string): Promise<Chat[]> {
        try {
            const result = await this.callAPI<any>(`/whatsapp/chats${sessionId ? `?sessionId=${sessionId}` : ''}`);
            return result.chats || result || [];
        } catch (error) {
            console.error('[MoltbotGateway] Failed to get chats:', error);
            return [];
        }
    }

    /**
     * Get messages from a chat
     */
    async getMessages(chatId: string, limit: number = 50): Promise<Message[]> {
        try {
            const result = await this.callAPI<any>(`/whatsapp/messages/${encodeURIComponent(chatId)}?limit=${limit}`);
            return result.messages || result || [];
        } catch (error) {
            console.error('[MoltbotGateway] Failed to get messages:', error);
            return [];
        }
    }

    /**
     * Start a session
     */
    async startSession(sessionId: string): Promise<{ status: string }> {
        try {
            return await this.callAPI<any>('/whatsapp/start', 'POST', { sessionId });
        } catch (error: any) {
            return { status: 'error' };
        }
    }

    /**
     * Stop a session
     */
    async stopSession(sessionId: string): Promise<{ status: string }> {
        try {
            return await this.callAPI<any>(`/whatsapp/sessions/${sessionId}`, 'DELETE');
        } catch (error: any) {
            return { status: 'error' };
        }
    }

    /**
     * Get QR code for session
     */
    async getQRCode(sessionId: string): Promise<string | null> {
        try {
            const result = await this.callAPI<any>(`/whatsapp/qrcode?sessionId=${sessionId}`);
            return result.qr || result.qrCode || null;
        } catch (error) {
            return null;
        }
    }
}

// Singleton instance
export const moltbotGateway = new MoltbotGateway();

// Export class for custom instances
export { MoltbotGateway };
