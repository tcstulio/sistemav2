/**
 * Channel Router
 *
 * Roteador unificado de canais de comunicação.
 * Abstrai a diferença entre providers (legacy vs moltbot).
 *
 * @see docs/MOLTBOT_INTEGRATION_PLAN.md
 */

import { FEATURES, isUsingMoltbot } from '../config/features';
import { moltbotGateway, MessageResult as MoltbotMessageResult } from './moltbotGateway';
import { messageService as legacyMessageService } from './messageService';
import { emailService } from './emailService';

// Types
export type Channel = 'whatsapp' | 'email' | 'sms';
export type WhatsAppProvider = 'legacy' | 'moltbot';

export interface SendResult {
    success: boolean;
    messageId?: string;
    timestamp?: number;
    error?: string;
    provider?: string;
}

export interface MessagePayload {
    channel: Channel;
    recipient: string;      // Phone (with @c.us), email, etc.
    content: string;
    subject?: string;       // For email
    mediaUrl?: string;
    mediaType?: string;
    sessionId?: string;
    metadata?: Record<string, any>;
}

export interface ChannelStatus {
    channel: Channel;
    connected: boolean;
    status: string;
    provider?: string;
    error?: string;
}

/**
 * Channel Router
 *
 * Routes messages to the appropriate provider based on configuration.
 */
class ChannelRouter {
    private whatsAppProvider: WhatsAppProvider;
    private defaultSessionId: string = 'default';

    constructor() {
        this.whatsAppProvider = FEATURES.WHATSAPP_PROVIDER;
        console.log(`[ChannelRouter] Initialized with WhatsApp provider: ${this.whatsAppProvider}`);
    }

    // ========================================
    // CONFIGURATION
    // ========================================

    /**
     * Set WhatsApp provider
     */
    setWhatsAppProvider(provider: WhatsAppProvider): void {
        this.whatsAppProvider = provider;
        console.log(`[ChannelRouter] WhatsApp provider changed to: ${provider}`);
    }

    /**
     * Get current WhatsApp provider
     */
    getWhatsAppProvider(): WhatsAppProvider {
        return this.whatsAppProvider;
    }

    /**
     * Set default session ID
     */
    setDefaultSessionId(sessionId: string): void {
        this.defaultSessionId = sessionId;
    }

    // ========================================
    // UNIFIED SEND
    // ========================================

    /**
     * Send a message via any channel
     */
    async send(payload: MessagePayload): Promise<SendResult> {
        switch (payload.channel) {
            case 'whatsapp':
                return this.sendWhatsApp(
                    payload.recipient,
                    payload.content,
                    payload.sessionId
                );

            case 'email':
                return this.sendEmail(
                    payload.recipient,
                    payload.subject || 'Mensagem',
                    payload.content,
                    payload.sessionId
                );

            case 'sms':
                // SMS not implemented yet
                return {
                    success: false,
                    error: 'SMS channel not implemented'
                };

            default:
                return {
                    success: false,
                    error: `Unknown channel: ${payload.channel}`
                };
        }
    }

    // ========================================
    // WHATSAPP
    // ========================================

    /**
     * Send WhatsApp text message
     */
    async sendWhatsApp(
        recipient: string,
        content: string,
        sessionId?: string
    ): Promise<SendResult> {
        const session = sessionId || this.defaultSessionId;

        // Dry-run mode
        if (FEATURES.DRY_RUN_MODE) {
            console.log(`[ChannelRouter] DRY RUN - WhatsApp to ${recipient}: ${content.substring(0, 50)}...`);
            return {
                success: true,
                messageId: `dry-run-${Date.now()}`,
                provider: 'dry-run'
            };
        }

        try {
            if (this.whatsAppProvider === 'moltbot' && FEATURES.MOLTBOT_ENABLED) {
                // Use Moltbot Gateway
                const result = await moltbotGateway.sendMessage({
                    chatId: recipient,
                    text: content,
                    sessionId: session
                });

                return {
                    success: result.success,
                    messageId: result.messageId,
                    timestamp: result.timestamp,
                    error: result.error,
                    provider: 'moltbot'
                };
            } else {
                // Use legacy whatsapp-web.js
                const result = await legacyMessageService.sendText(session, recipient, content);

                return {
                    success: true,
                    messageId: result.id,
                    timestamp: result.timestamp,
                    provider: 'legacy'
                };
            }
        } catch (error: any) {
            console.error('[ChannelRouter] WhatsApp send failed:', error);
            return {
                success: false,
                error: error.message,
                provider: this.whatsAppProvider
            };
        }
    }

    /**
     * Send WhatsApp file
     */
    async sendWhatsAppFile(
        recipient: string,
        fileData: string | Buffer,
        filename: string,
        caption?: string,
        sessionId?: string
    ): Promise<SendResult> {
        const session = sessionId || this.defaultSessionId;

        if (FEATURES.DRY_RUN_MODE) {
            console.log(`[ChannelRouter] DRY RUN - WhatsApp file to ${recipient}: ${filename}`);
            return { success: true, messageId: `dry-run-${Date.now()}`, provider: 'dry-run' };
        }

        try {
            if (this.whatsAppProvider === 'moltbot' && FEATURES.MOLTBOT_ENABLED) {
                const buffer = Buffer.isBuffer(fileData)
                    ? fileData
                    : Buffer.from(fileData.split(',')[1] || fileData, 'base64');

                const result = await moltbotGateway.sendFile({
                    chatId: recipient,
                    file: buffer,
                    filename,
                    caption,
                    sessionId: session
                });

                return {
                    success: result.success,
                    messageId: result.messageId,
                    error: result.error,
                    provider: 'moltbot'
                };
            } else {
                const dataStr = Buffer.isBuffer(fileData)
                    ? `data:application/octet-stream;base64,${fileData.toString('base64')}`
                    : fileData;

                const result = await legacyMessageService.sendFile(session, recipient, dataStr, filename, caption);

                return {
                    success: true,
                    messageId: result.id,
                    provider: 'legacy'
                };
            }
        } catch (error: any) {
            return { success: false, error: error.message, provider: this.whatsAppProvider };
        }
    }

    /**
     * Send WhatsApp voice message
     */
    async sendWhatsAppVoice(
        recipient: string,
        audioData: string,
        sessionId?: string
    ): Promise<SendResult> {
        const session = sessionId || this.defaultSessionId;

        if (FEATURES.DRY_RUN_MODE) {
            console.log(`[ChannelRouter] DRY RUN - WhatsApp voice to ${recipient}`);
            return { success: true, messageId: `dry-run-${Date.now()}`, provider: 'dry-run' };
        }

        try {
            if (this.whatsAppProvider === 'moltbot' && FEATURES.MOLTBOT_ENABLED) {
                const result = await moltbotGateway.sendVoice(recipient, audioData, session);
                return {
                    success: result.success,
                    messageId: result.messageId,
                    error: result.error,
                    provider: 'moltbot'
                };
            } else {
                const result = await legacyMessageService.sendVoice(session, recipient, audioData);
                return {
                    success: true,
                    messageId: result.id,
                    provider: 'legacy'
                };
            }
        } catch (error: any) {
            return { success: false, error: error.message, provider: this.whatsAppProvider };
        }
    }

    // ========================================
    // EMAIL
    // ========================================

    /**
     * Send email
     */
    async sendEmail(
        recipient: string,
        subject: string,
        body: string,
        accountId?: string
    ): Promise<SendResult> {
        if (FEATURES.DRY_RUN_MODE) {
            console.log(`[ChannelRouter] DRY RUN - Email to ${recipient}: ${subject}`);
            return { success: true, messageId: `dry-run-${Date.now()}`, provider: 'dry-run' };
        }

        try {
            await emailService.sendEmail(accountId || 'default', recipient, subject, body);
            return {
                success: true,
                messageId: `email-${Date.now()}`,
                provider: 'email'
            };
        } catch (error: any) {
            return { success: false, error: error.message, provider: 'email' };
        }
    }

    // ========================================
    // STATUS
    // ========================================

    /**
     * Get channel status
     */
    async getChannelStatus(channel: Channel): Promise<ChannelStatus> {
        switch (channel) {
            case 'whatsapp':
                return this.getWhatsAppStatus();

            case 'email':
                return {
                    channel: 'email',
                    connected: true,
                    status: 'available',
                    provider: 'email'
                };

            default:
                return {
                    channel,
                    connected: false,
                    status: 'unknown',
                    error: `Channel ${channel} not configured`
                };
        }
    }

    /**
     * Get WhatsApp status
     */
    async getWhatsAppStatus(): Promise<ChannelStatus> {
        try {
            if (this.whatsAppProvider === 'moltbot' && FEATURES.MOLTBOT_ENABLED) {
                const status = await moltbotGateway.getWhatsAppStatus();
                return {
                    channel: 'whatsapp',
                    connected: status.connected,
                    status: status.status,
                    provider: 'moltbot',
                    error: status.error
                };
            } else {
                // Legacy: Check via sessionService
                // For now, return a basic status
                return {
                    channel: 'whatsapp',
                    connected: true,
                    status: 'legacy-mode',
                    provider: 'legacy'
                };
            }
        } catch (error: any) {
            return {
                channel: 'whatsapp',
                connected: false,
                status: 'error',
                provider: this.whatsAppProvider,
                error: error.message
            };
        }
    }

    /**
     * Get all channels status
     */
    async getAllChannelsStatus(): Promise<ChannelStatus[]> {
        return Promise.all([
            this.getChannelStatus('whatsapp'),
            this.getChannelStatus('email')
        ]);
    }
}

// Singleton instance
export const channelRouter = new ChannelRouter();

// Export class for custom instances
export { ChannelRouter };
