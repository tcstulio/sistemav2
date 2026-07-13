/**
 * Channel Router
 *
 * Roteador unificado de canais de comunicação.
 * Abstrai a diferença entre providers (legacy vs moltbot).
 *
 * @see docs/MOLTBOT_INTEGRATION_PLAN.md
 */

import { FEATURES, isUsingMoltbot } from '../config/features';
import { isDryRunEnabled } from '../config/featureSwitches';
import { moltbotGateway, MessageResult as MoltbotMessageResult } from './moltbotGateway';
import { messageService as legacyMessageService } from './legacy/messageService';
import { sessionService } from './legacy/sessionService';
import { emailService } from './emailService';
import { createLogger } from '../utils/logger';
import { uiConfigService, QuietHoursChannel } from './uiConfigService';
import fs from 'fs';
import path from 'path';
import { atomicWriteSync } from '../utils/atomicWrite';

const log = createLogger('ChannelRouter');

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
    // #1397 (Dials 5 e 6) — store durável em `data/channel_router.json` para que
    // `setWhatsAppProvider` e `setDefaultSessionId` (chamados pelas rotas admin/integration)
    // NÃO se percam no restart. Antes as rotas só mudavam em memória (config-teatro da
    // auditoria #1124).
    private readonly storePath: string;

    constructor(storePath?: string) {
        this.storePath = storePath || path.join(__dirname, '../../data/channel_router.json');
        // Hidrata do .env como fallback; o rehidrata do store sobrescreve se o arquivo existe.
        this.whatsAppProvider = FEATURES.WHATSAPP_PROVIDER;
        this.defaultSessionId = 'default';
        this.loadPersisted();
        log.info(`Initialized with WhatsApp provider: ${this.whatsAppProvider} (defaultSession=${this.defaultSessionId})`);
    }

    /**
     * Carrega o estado persistido (whatsAppProvider + defaultSessionId) do disco. Arquivo
     * corrompido → ignora (cai no fallback do env). Exportado p/ teste determinístico.
     */
    private loadPersisted(): { whatsAppProvider?: WhatsAppProvider; defaultSessionId?: string } {
        try {
            const dir = path.dirname(this.storePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            if (!fs.existsSync(this.storePath)) return {};
            const parsed = JSON.parse(fs.readFileSync(this.storePath, 'utf-8'));
            if (parsed && typeof parsed === 'object') {
                if (parsed.whatsAppProvider === 'legacy' || parsed.whatsAppProvider === 'moltbot') {
                    this.whatsAppProvider = parsed.whatsAppProvider;
                }
                if (typeof parsed.defaultSessionId === 'string' && parsed.defaultSessionId.trim()) {
                    this.defaultSessionId = parsed.defaultSessionId;
                }
                return parsed;
            }
            return {};
        } catch (e: any) {
            log.warn(`Falha ao carregar ${this.storePath}: ${e?.message || e} — usando defaults`);
            return {};
        }
    }

    /** Persiste o estado atual no disco (atomicWriteSync p/ não corromper em crash). */
    private persist(): void {
        try {
            const dir = path.dirname(this.storePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            atomicWriteSync(this.storePath, {
                whatsAppProvider: this.whatsAppProvider,
                defaultSessionId: this.defaultSessionId,
            });
        } catch (e: any) {
            log.error(`Falha ao persistir ${this.storePath}: ${e?.message || e}`);
        }
    }

    // ========================================
    // CONFIGURATION
    // ========================================

    /**
     * Set WhatsApp provider — também PERSISTE em disco (#1397 Dial 6).
     */
    setWhatsAppProvider(provider: WhatsAppProvider): void {
        this.whatsAppProvider = provider;
        this.persist();
        log.info(`WhatsApp provider changed to: ${provider} (persistido em ${this.storePath})`);
    }

    /**
     * Get current WhatsApp provider
     */
    getWhatsAppProvider(): WhatsAppProvider {
        return this.whatsAppProvider;
    }

    /**
     * Set default session ID (#1397 Dial 5) — também PERSISTE em disco.
     * Rejeita string vazia/whitespace (preserva o valor anterior).
     */
    setDefaultSessionId(sessionId: string): void {
        const trimmed = String(sessionId || '').trim();
        if (!trimmed) return; // ignora vazio — setter só valida em runtime
        this.defaultSessionId = trimmed;
        this.persist();
        log.info(`Default session changed to: ${trimmed} (persistido)`);
    }

    /**
     * Get current default session ID (#1397 Dial 5).
     */
    getDefaultSessionId(): string {
        return this.defaultSessionId;
    }

    /**
     * Resolve a sessão de envio. sessionId explícito é sempre respeitado. Sem ele, usa a default;
     * e se a default não estiver WORKING (ex.: a única sessão conectada tem outro nome, como 'v4'),
     * cai na primeira sessão WORKING — logando o desvio (cuidado se houver várias sessões: pode
     * enviar de outro número; follow-up = sessão primária configurável). Sem nenhuma sessão pronta,
     * devolve a default para o erro "Session X not found" ficar explícito.
     */
    private resolveSession(sessionId?: string): string {
        if (sessionId) return sessionId;
        if (sessionService.getStatus(this.defaultSessionId) === 'WORKING') return this.defaultSessionId;
        const working = sessionService.getFirstWorkingSessionId();
        if (working && working !== this.defaultSessionId) {
            log.warn(`Sessão default '${this.defaultSessionId}' indisponível; roteando para a sessão WORKING '${working}'.`);
            return working;
        }
        return this.defaultSessionId;
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
        const session = this.resolveSession(sessionId);

        // Dry-run mode
        if (isDryRunEnabled()) {
            log.info(`DRY RUN - WhatsApp to ${recipient}: ${content.substring(0, 50)}...`);
            return {
                success: true,
                messageId: `dry-run-${Date.now()}`,
                provider: 'dry-run'
            };
        }

        // #1397 (Dial 2) — quiet-hours do canal whatsapp. Se o canal está silenciado AGORA,
        // NÃO envia (devolve erro explícito para o caller decidir reagendar/logar).
        if (this.isChannelSilenced('whatsapp')) {
            log.info(`WhatsApp silenciado por quiet-hours (recipient=${recipient})`);
            return {
                success: false,
                error: 'Canal WhatsApp em quiet-hours (silenciado pelo dial notificationPolicy.quietHours).',
                provider: this.whatsAppProvider,
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
            log.error('WhatsApp send failed', { error: error.message });
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
        const session = this.resolveSession(sessionId);

        if (isDryRunEnabled()) {
            log.info(`DRY RUN - WhatsApp file to ${recipient}: ${filename}`);
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
        const session = this.resolveSession(sessionId);

        if (isDryRunEnabled()) {
            log.info(`DRY RUN - WhatsApp voice to ${recipient}`);
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
        if (isDryRunEnabled()) {
            log.info(`DRY RUN - Email to ${recipient}: ${subject}`);
            return { success: true, messageId: `dry-run-${Date.now()}`, provider: 'dry-run' };
        }

        // #1397 (Dial 2) — quiet-hours do canal email.
        if (this.isChannelSilenced('email')) {
            log.info(`Email silenciado por quiet-hours (recipient=${recipient})`);
            return {
                success: false,
                error: 'Canal email em quiet-hours (silenciado pelo dial notificationPolicy.quietHours).',
                provider: 'email',
            };
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

    /**
     * #1397 (Dial 2) — checa quiet-hours do canal (injetável p/ teste).
     * Retorna true se o canal deve ser silenciado NESTE instante.
     */
    isChannelSilenced(channel: QuietHoursChannel, at?: Date): boolean {
        try {
            return uiConfigService.isInQuietHours(channel, at);
        } catch {
            return false;
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
