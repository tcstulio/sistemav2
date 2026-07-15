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
import { sessionService } from './legacy/sessionService';
import { emailService } from './emailService';
import { uiConfigService, WhatsappFallbackPolicy } from './uiConfigService';
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
 * #1441 — Erro lançado quando a sessão primária do WhatsApp (`whatsappPrimarySessionId`)
 * não está WORKING e a política de fallback configurada é 'fail' (default seguro). Indica
 * que o envio NÃO pode prosseguir silenciosamente por uma sessão alternativa — a operação
 * deve ser tratada pelo caller (re-agendar, escalar, notificar admin). Carrega o id da
 * primária e a policy configurada para que o caller consiga logar/auditar com contexto.
 *
 * Cenários que disparam o throw:
 *   - `defaultSessionId` (= `whatsappPrimarySessionId`) OFFLINE
 *   - existe OUTRA sessão WORKING (i.e., o fallback seria possível)
 *   - `whatsappFallbackPolicy === 'fail'` (default seguro, ou qualquer valor fora do domínio
 *     que o `sanitizeWhatsappFallbackPolicy` já converteu em 'fail')
 *
 * Quando NÃO há outra sessão WORKING, `resolveSession` devolve a default mesmo com
 * policy='fail' — o transportador emite o "Session X not found" explícito. Isso evita
 * mascarar uma falha de infraestrutura (nenhum cliente WhatsApp up) com um erro de
 * "política".
 */
export class WhatsAppPrimaryUnavailableError extends Error {
    public readonly primarySessionId: string;
    public readonly policy: WhatsappFallbackPolicy;

    constructor(primarySessionId: string, policy: WhatsappFallbackPolicy) {
        super(
            `Sessão WhatsApp primária '${primarySessionId}' indisponível e policy='${policy}' impede fallback para outra sessão.`
        );
        this.name = 'WhatsAppPrimaryUnavailableError';
        this.primarySessionId = primarySessionId;
        this.policy = policy;
    }
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
     * Resolve a sessão de envio. sessionId explícito é sempre respeitado. Sem ele, usa a default;
     * e se a default não estiver WORKING, o comportamento depende da `whatsappFallbackPolicy`
     * lida do uiConfig (a cada chamada — sem cache — pra refletir PUTs do admin):
     *   - 'fail' (default seguro, #1441): se houver OUTRA sessão WORKING, lança
     *     `WhatsAppPrimaryUnavailableError` para que o caller decida (NÃO faz fallback
     *     silencioso — evita mandar cobrança pelo número errado). Sem nenhuma outra WORKING,
     *     devolve a default e deixa o transportador emitir "Session X not found" (erro
     *     explícito, não mascara falha de infra com erro de política).
     *   - 'first-working': cai na primeira sessão WORKING disponível (logando o desvio).
     * Sem `whatsappPrimarySessionId` configurado, a default vira 'default' legado
     * (compatibilidade — não força configuração nova em deploys existentes).
     */
    private resolveSession(sessionId?: string): string {
        if (sessionId) return sessionId;
        if (sessionService.getStatus(this.defaultSessionId) === 'WORKING') return this.defaultSessionId;

        // Sanitize aqui também: campo ausente / valor fora do domínio vira 'fail'.
        const rawPolicy = uiConfigService.get().whatsappFallbackPolicy;
        const policy: WhatsappFallbackPolicy = rawPolicy === 'first-working' ? 'first-working' : 'fail';
        const working = sessionService.getFirstWorkingSessionId();

        if (working && working !== this.defaultSessionId) {
            if (policy === 'first-working') {
                log.warn(`Sessão default '${this.defaultSessionId}' indisponível; roteando para a sessão WORKING '${working}'.`);
                return working;
            }
            // policy === 'fail': recusa fallback silencioso — propaga erro com contexto.
            throw new WhatsAppPrimaryUnavailableError(this.defaultSessionId, policy);
        }

        // Sem fallback disponível: devolve a default e deixa o transportador falhar
        // explicitamente. NÃO lança aqui — não há o que decidir.
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
