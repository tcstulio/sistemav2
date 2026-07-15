/**
 * Channel Router
 *
 * Roteador unificado de canais de comunicação.
 * Abstrai a diferença entre providers (legacy vs moltbot).
 *
 * @see docs/MOLTBOT_INTEGRATION_PLAN.md
 */

import { FEATURES } from '../config/features';
import { getEffectiveWhatsAppProvider, isDryRunEnabled } from '../config/featureSwitches';
import { moltbotGateway, MessageResult as MoltbotMessageResult } from './moltbotGateway';
import { messageService as legacyMessageService } from './legacy/messageService';
import { getWhatsAppSessions } from './legacy/sessionService';
import { emailService } from './emailService';
import { uiConfigService } from './uiConfigService';
import { createLogger } from '../utils/logger';

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
 * Erro lançado por `channelRouter.resolveSession` quando a sessão primária do WhatsApp
 * (definida em `uiConfig.whatsappPrimarySessionId`) está OFFLINE/ausente e a política
 * configurada em `uiConfig.whatsappFallbackPolicy` é `'fail'`. Tipo distinto para que o
 * caller (notificationService, agentActionConfirm, etc.) possa tratar explicitamente
 * — em vez de receber um erro genérico do transportador após o envio "silencioso" ter
 * acontecido do número errado (#1398 / #1438 / #1441).
 */
export class WhatsAppPrimaryUnavailableError extends Error {
    public readonly primarySessionId: string;
    public readonly policy: 'fail' | 'first-working';
    public readonly primaryStatus: string;

    constructor(primarySessionId: string, policy: 'fail' | 'first-working', primaryStatus: string) {
        super(
            `Sessão primária '${primarySessionId}' indisponível (status: ${primaryStatus || 'ausente'}) ` +
            `e política '${policy}' configurada — não desvia para outro número.`
        );
        this.name = 'WhatsAppPrimaryUnavailableError';
        this.primarySessionId = primarySessionId;
        this.policy = policy;
        this.primaryStatus = primaryStatus;
    }
}

/**
 * Channel Router
 *
 * Routes messages to the appropriate provider based on configuration.
 */
class ChannelRouter {
    private whatsAppProvider: WhatsAppProvider;
    // #1438 — sem default hardcoded; o construtor hidrata a partir do uiConfig. Estado vazio
    // significa "boot ainda não ocorreu" e `resolveSession` consulta o uiConfig em runtime,
    // então mesmo um boot com falha de leitura da config não trava o envio: a config é relida
    // a cada chamada.
    private defaultSessionId: string = '';

    constructor() {
        // #1410 — antes lia só `FEATURES.WHATSAPP_PROVIDER` (env), o que tornava o setter admin
        // um teatro: mudava em memória, no restart voltava ao env. Agora o getter resolve a cada
        // boot pelo override persistido em `uiConfig.whatsappProvider` (setado pela rota admin/
        // integration) e cai no env só se nada foi persistido.
        this.whatsAppProvider = getEffectiveWhatsAppProvider();
        log.info(`Initialized with WhatsApp provider: ${this.whatsAppProvider}`);

        // #1437 — conserta o setter órfão de `setDefaultSessionId`: hidrata o defaultSessionId
        // a partir do `whatsappPrimarySessionId` persistido em uiConfig. Sem override persistido
        // (string vazia / null / undefined / só espaços) → fallback legado p/ 'default', mantendo
        // compatibilidade com sessões já criadas cujo nome é literalmente 'default'. Log explícito
        // serve de portão de verificação no boot (e de gancho p/ audit quando o admin troca).
        const persisted = uiConfigService.get().whatsappPrimarySessionId;
        const effective = (persisted && persisted.trim()) ? persisted.trim() : 'default';
        this.setDefaultSessionId(effective);
        log.info(`defaultSessionId set to ${effective}`);
    }

    // ========================================
    // CONFIGURATION
    // ========================================

    /**
     * Set WhatsApp provider — atualiza em memória E persiste via uiConfigService (#1410).
     * Falha de persistência é logada mas não derruba o estado em memória (fail-soft: o provider
     * continua válido até o restart; a próxima reinicialização cai no env).
     */
    setWhatsAppProvider(provider: WhatsAppProvider): void {
        this.whatsAppProvider = provider;
        log.info(`WhatsApp provider changed to: ${provider}`);
        try {
            uiConfigService.update({ whatsappProvider: provider });
        } catch (err: any) {
            log.error('Failed to persist WhatsApp provider', { error: err?.message || String(err) });
        }
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

    /**
     * Resolve a sessão de envio. sessionId explícito é sempre respeitado (sem checagem de policy).
     * Sem ele, consulta `uiConfig.whatsappPrimarySessionId` e `uiConfig.whatsappFallbackPolicy`:
     *
     *   - **Sem primária configurada** (legado, p/ retrocompat): se 'default' estiver WORKING,
     *     usa 'default'. Senão, cai na primeira sessão WORKING. Se nenhuma estiver WORKING,
     *     devolve 'default' (o erro "Session X not found" fica explícito no envio).
     *   - **Com primária configurada e WORKING**: usa a primária, ignora policy.
     *   - **Com primária configurada e OFFLINE/ausente + `policy = 'fail'`** (default seguro,
     *     #1438): lança `WhatsAppPrimaryUnavailableError`. NUNCA desvia silenciosamente.
     *   - **Com primária configurada e OFFLINE/ausente + `policy = 'first-working'`**: log.warn
     *     e usa a primeira sessão WORKING. Se nenhuma existir, lança `WhatsAppPrimaryUnavailableError`
     *     (caller trata; nunca cai em fallback mudo).
     *
     * A primária é 100% determinada pelo uiConfig (não há literal 'default' hardcoded no hot path).
     */
    private resolveSession(sessionId?: string): string {
        if (sessionId) return sessionId;

        const sessions = getWhatsAppSessions();
        const config = uiConfigService.get();
        const primary = (config.whatsappPrimarySessionId || '').trim();
        const policy = config.whatsappFallbackPolicy;

        if (!primary) {
            // Legado: sem primária configurada. Preserva o comportamento histórico — 'default'
            // tem precedência como destino canônico, e a primeira WORKING é o fallback. Erro
            // explícito (não WORKING) continua chegando pelo transportador, não pelo roteador.
            const defaultSess = sessions.find((s) => s.id === 'default');
            if (defaultSess && defaultSess.status === 'WORKING') return 'default';
            const firstWorking = sessions.find((s) => s.status === 'WORKING');
            if (firstWorking) return firstWorking.id;
            return 'default';
        }

        const primarySess = sessions.find((s) => s.id === primary);
        if (primarySess && primarySess.status === 'WORKING') return primary;

        // Primária OFFLINE/ausente — aplica a policy. O branch abaixo NUNCA retorna uma outra
        // sessão sem registrar/logar/throw, conforme a policy configurada.
        if (policy === 'fail') {
            throw new WhatsAppPrimaryUnavailableError(
                primary,
                policy,
                primarySess?.status || 'ausente'
            );
        }

        // policy === 'first-working' — log.warn explícito e usa a primeira WORKING diferente
        // da primária. Se não houver outra WORKING, propaga o erro (caller trata; nunca
        // silenciosamente).
        const firstWorking = sessions.find((s) => s.status === 'WORKING');
        if (firstWorking && firstWorking.id !== primary) {
            log.warn(
                `Sessão primária '${primary}' indisponível (policy 'first-working'); ` +
                `roteando para a primeira WORKING '${firstWorking.id}'.`
            );
            return firstWorking.id;
        }
        throw new WhatsAppPrimaryUnavailableError(
            primary,
            policy,
            primarySess?.status || 'ausente'
        );
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
