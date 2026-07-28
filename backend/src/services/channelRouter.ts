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
 * Erro lançado por `resolveSession` (#1438) quando a sessão primária configurada pelo admin
 * (`uiConfig.whatsappPrimarySessionId`) não está WORKING e a política `whatsappFallbackPolicy`
 * está em 'fail' (default seguro). Tipo distinto para o caller diferenciar "sessão primária
 * indisponível por config" (recusa explícita, sem desvio) de erros do provider (rede, auth,
 * número inválido). Também é lançado quando a primária NÃO está configurada (vazia/whitespace)
 * — antes desta entrega o código caía num fallback legado `'default'` que reintroduzia o
 * problema que o fix tenta eliminar (string mágica no hot path). O admin precisa configurar
 * `whatsappPrimarySessionId` em uiConfig para o canal institucional funcionar.
 *
 * Os três pontos institucionais de envio — validados pelo grep do #1438 — passam TODOS pelo
 * `resolveSession` (não há bypass): basta o caller capturar `instanceof
 * WhatsAppPrimaryUnavailableError` se quiser dar tratamento especial; cair no catch genérico
 * já é suficiente para a recusa ser propagada como falha de envio.
 *
 *   - `backend/src/services/notificationService.ts:224` — `deliverWhatsApp` chama
 *     `channelRouter.sendWhatsApp(chatId, notification.message)` (sem sessionId explícito).
 *   - `backend/src/services/agentActionConfirm.ts:102` — `send_whatsapp.execute` chama
 *     `channelRouter.sendWhatsApp(chatId, msg)` (sem sessionId explícito).
 *   - `backend/src/services/agentTools.ts:1686` — tool `send_whatsapp` chama
 *     `channelRouter.sendWhatsApp(chatId, waMsg)` (sem sessionId explícito).
 */
export class WhatsAppPrimaryUnavailableError extends Error {
    public readonly sessionId: string;
    public readonly policy: 'fail' | 'first-working';
    constructor(sessionId: string, policy: 'fail' | 'first-working', detail?: string) {
        const label = sessionId ? `'${sessionId}'` : '(não configurada)';
        super(
            `Sessão primária ${label} indisponível e política configurada para falhar ` +
            `(não desviamos para outro número)${detail ? ` — ${detail}` : ''}.`
        );
        this.name = 'WhatsAppPrimaryUnavailableError';
        this.sessionId = sessionId;
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

    constructor() {
        // #1410 — antes lia só `FEATURES.WHATSAPP_PROVIDER` (env), o que tornava o setter admin
        // um teatro: mudava em memória, no restart voltava ao env. Agora o getter resolve a cada
        // boot pelo override persistido em `uiConfig.whatsappProvider` (setado pela rota admin/
        // integration) e cai no env só se nada foi persistido.
        this.whatsAppProvider = getEffectiveWhatsAppProvider();
        log.info(`Initialized with WhatsApp provider: ${this.whatsAppProvider}`);
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
     * Sessão default p/ rotas de LEITURA sem sessionId explícito (conversations/messages).
     * Segue a primária persistida (#1438) quando configurada; senão 'default' (compat).
     * NÃO aplica a política de fallback de ENVIO — leitura não deve falhar por política.
     */
    getDefaultSessionId(): string {
        const primary = (uiConfigService.get().whatsappPrimarySessionId || '').trim();
        return primary || 'default';
    }

    /**
     * Resolve a sessão de envio. Tudo é lido AO VIVO do uiConfig persistido — nada é cacheado no
     * boot, então trocas do admin valem sem restart e persistem de verdade em `ui_config.json`
     * (#1438). Regras:
     *   - sessionId explícito é sempre respeitado (caller é soberano; política NUNCA bloqueia);
     *   - senão usa a sessão primária (`uiConfig.whatsappPrimarySessionId`). SEM fallback
     *     mágico: vazia/whitespace → tratada como "indisponível" (análoga a OFFLINE) e o
     *     desvio é decidido PELA POLÍTICA (ver abaixo). Antes desta entrega caía em `'default'`
     *     (string mágica no hot path que o fix tenta eliminar);
     *   - se a primária está WORKING → usa ela, sem ramificar pela política;
     *   - se a primária NÃO está WORKING (ou não está configurada), a política persistida decide:
     *       · 'first-working' → cai na primeira WORKING disponível, logando o desvio
     *         (cuidado: pode enviar de outro número se houver várias sessões);
     *       · 'fail' (default seguro) → LANÇA `WhatsAppPrimaryUnavailableError` (com detail
     *         "não configurado" quando a primária está ausente — caller distingue esse caso
     *         de "primária configurada mas OFFLINE"). Também dispara quando 'first-working'
     *         está setado mas NÃO há nenhuma WORKING (nada pra onde cair) — política
     *         fail-by-default.
     * Antes desta entrega (#1438) a política era ignorada: `resolveSession` SEMPRE fazia
     * 'first-working', contradizendo o default documentado — flag-fantasma agora conectada.
     */
    private resolveSession(sessionId?: string): string {
        if (sessionId) return sessionId;
        // Uma única leitura do config por resolução (primária + política vêm juntas).
        const cfg = uiConfigService.get();
        const rawPrimary = cfg.whatsappPrimarySessionId;
        const primary = (rawPrimary || '').trim();
        const policy = cfg.whatsappFallbackPolicy;
        // #1438 — primária NÃO configurada (vazia/whitespace) é tratada como "indisponível"
        // (análoga a OFFLINE): o fallback mágico 'default' foi removido (string mágica no hot
        // path). O desvio então é decidido PELA POLÍTICA:
        //   - 'first-working' → ainda tenta cair na 1ª WORKING (com warn) — admin optou por
        //     "qualquer WORKING serve" e a config ausente não muda essa intenção;
        //   - 'fail' (default seguro) → LANÇA com detail 'não configurado' para o caller
        //     distinguir esse caso de "primária configurada mas OFFLINE".
        // Só checamos WORKING quando há primária configurada (status de uma sessão inexistente
        // não é WORKING; checá-lo seria ruído).
        if (primary && sessionService.getStatus(primary) === 'WORKING') return primary;
        if (policy === 'first-working') {
            const working = sessionService.getFirstWorkingSessionId();
            if (working && working !== primary) {
                log.warn(`Sessão primária '${primary || '(não configurada)'}' indisponível; política 'first-working' → roteando para a sessão WORKING '${working}'.`);
                return working;
            }
            // first-working mas sem nenhuma WORKING (ou WORKING == primária por race):
            // abaixo ainda cai no throw (não temos pra onde cair — política fail-by-default).
        }
        throw new WhatsAppPrimaryUnavailableError(
            primary,
            policy ?? 'fail',
            primary ? undefined : 'whatsappPrimarySessionId não configurado em uiConfig'
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
                    payload.sessionId,
                    payload.metadata
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
        sessionId?: string,
        metadata?: Record<string, any>
    ): Promise<SendResult> {
        // #1438 — `resolveSession` PODE lançar `WhatsAppPrimaryUnavailableError` quando a primária
        // não está WORKING OU não está configurada, e a política é 'fail'. Diferente dos outros
        // erros (rede, auth, número inválido), esse erro é de CONFIGURAÇÃO e o caller precisa
        // ser capaz de identificá-lo: não engulo no catch genérico, propaga pra cima. Os pontos
        // institucionais de envio validados pelo grep (`notificationService:224`,
        // `agentActionConfirm:102`, `agentTools:1686`) já têm try/catch que converte pra falha
        // legível; basta o caller checar `instanceof WhatsAppPrimaryUnavailableError` se quiser
        // logar diferenciado.
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
                const result = metadata
                    ? await legacyMessageService.sendText(session, recipient, content, metadata)
                    : await legacyMessageService.sendText(session, recipient, content);

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
