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
 * #1441 — erro distinto carregando o contexto da decisão de roteamento. Lançado por
 * `resolveSession` quando há uma sessão primária configurada, ela não está WORKING e a política
 * configurada é 'fail' (= default seguro). Carrega primary/policy/status para diagnóstico sem
 * precisar de parsing de string. NÃO é um Error genérico: o caller pode usar `instanceof` para
 * distinguir "primária offline" de outros erros de envio (autenticação, rede, etc.).
 */
export class WhatsAppPrimaryUnavailableError extends Error {
    public readonly primary: string;
    public readonly policy: string;
    public readonly status: string;

    constructor(primary: string, policy: string, status: string) {
        super(
            `WhatsApp primary session '${primary}' indisponível (status: ${status}) — ` +
            `política '${policy}' não permite fallback silencioso. ` +
            `Defina whatsappPrimarySessionId como string vazia para usar o legado, ` +
            `ou corrija o status da sessão antes de enviar.`
        );
        this.name = 'WhatsAppPrimaryUnavailableError';
        this.primary = primary;
        this.policy = policy;
        this.status = status;
    }
}

/**
 * Channel Router
 *
 * Routes messages to the appropriate provider based on configuration.
 */
class ChannelRouter {
    private whatsAppProvider: WhatsAppProvider;
    // #1441 — sem 'default' hardcoded aqui: o default é decidido no construtor (hidrata do
    // uiConfig.whatsappPrimarySessionId) ou pelo legacy fallback em resolveSession. Manter o
    // literal nesse campo levaria o GUARD test a falhar (alguém reintroduzindo o fallback
    // silencioso p/ 'default' pegaria a string em vez de respeitar a config).
    private defaultSessionId: string = '';

    constructor() {
        // #1410 — antes lia só `FEATURES.WHATSAPP_PROVIDER` (env), o que tornava o setter admin
        // um teatro: mudava em memória, no restart voltava ao env. Agora o getter resolve a cada
        // boot pelo override persistido em `uiConfig.whatsappProvider` (setado pela rota admin/
        // integration) e cai no env só se nada foi persistido.
        this.whatsAppProvider = getEffectiveWhatsAppProvider();
        log.info(`Initialized with WhatsApp provider: ${this.whatsAppProvider}`);

        // #1437/#1441 — boot wiring: hidrata `defaultSessionId` a partir do `whatsappPrimarySessionId`
        // persistido em uiConfig. Sem override persistido (string vazia / null / undefined / só
        // espaços) → fallback legado p/ 'default', mantendo compatibilidade com sessões já criadas
        // cujo nome é literalmente 'default'. O hot-reload real mora em `resolveSession`, que
        // relê uiConfig a CADA chamada (sem cache do construtor) — esta hidratação aqui só
        // serve para inicializar o legacy fallback. Log explícito serve de portão de verificação
        // no boot (e de gancho p/ audit quando o admin troca).
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
     * Set default session ID — fallback do caminho LEGADO (sem primary configurada). #1441
     * preserva esta API porque testes e integrações legadas ainda dependem dela; o hot-path
     * de produção lê uiConfig diretamente em `resolveSession`.
     */
    setDefaultSessionId(sessionId: string): void {
        this.defaultSessionId = sessionId;
    }

    /**
     * #1441 — resolve a sessão de envio. Regras:
     *   1. sessionId explícito sempre vence (nunca passa pela policy/legacy).
     *   2. SEM sessionId, lê `uiConfig.whatsappPrimarySessionId` A CADA CHAMADA (sem cache do
     *      construtor) — hot-reload: o admin troca no PUT /api/ui-config e o próximo envio já usa.
     *   3. SEM primary configurada (string vazia/nula/whitespace) → caminho LEGADO:
     *      defaultSessionId se WORKING, senão primeira WORKING (log.warn), senão defaultSessionId.
     *   4. COM primary configurada → consulta `sessionService.getWhatsAppSessions()` (fonte única
     *      da verdade). Se a primary estiver WORKING → usa. Senão, aplica `whatsappFallbackPolicy`:
     *         - 'first-working': pega a primeira sessão WORKING e loga o desvio.
     *         - 'fail' (default seguro): lança `WhatsAppPrimaryUnavailableError` SEM fallback
     *           silencioso para 'default' — o erro fica explícito p/ a rota decidir.
     * O resultado é type-checked em tempo de execução: nunca devolve 'default' como fallback
     * quando há uma primária configurada.
     */
    private resolveSession(sessionId?: string): string {
        if (sessionId) return sessionId;

        // Hot-reload: a config é lida AQUI, não no construtor. Mudanças no PUT /api/ui-config
        // passam a valer no próximo envio sem reinicializar o router.
        const cfg = uiConfigService.get();
        const primaryRaw = (cfg.whatsappPrimarySessionId || '').trim();
        const policy = cfg.whatsappFallbackPolicy || 'fail';

        // Sem primária configurada → caminho legado, compatível com quem nunca tocou em /ui-config.
        if (!primaryRaw) {
            return this.resolveLegacyDefault();
        }

        // Com primária → `getWhatsAppSessions` é a fonte única da verdade. Nada de `getStatus`
        // pontual nem de `getFirstWorkingSessionId` (esses continuam existindo p/ outros usos,
        // mas o roteamento não confia neles).
        const sessions = sessionService.getWhatsAppSessions();
        const primarySession = sessions.find((s) => s.id === primaryRaw);

        if (primarySession && primarySession.status === 'WORKING') {
            return primaryRaw;
        }

        const statusObserved = primarySession?.status || 'STOPPED';

        // 'first-working' só se aplica se EXISTE uma WORKING na lista. Sem WORKING nenhuma
        // → política falha igual a 'fail' (não inventamos sessão).
        if (policy === 'first-working') {
            const working = sessions.find((s) => s.status === 'WORKING');
            if (working) {
                log.warn(
                    `Sessão primária '${primaryRaw}' indisponível (status: ${statusObserved}); ` +
                    `política 'first-working' → roteando para a sessão WORKING '${working.id}'.`
                );
                return working.id;
            }
        }

        // 'fail' (default seguro) ou 'first-working' sem WORKING disponível → erro distinto
        // carregando contexto. NÃO cai em 'default' silenciosamente.
        throw new WhatsAppPrimaryUnavailableError(primaryRaw, policy, statusObserved);
    }

    /**
     * Caminho LEGADO: sem `whatsappPrimarySessionId` configurada. Preserva o comportamento
     * histórico (defaultSessionId WORKING → ela mesma; senão primeira WORKING com warn; senão
     * defaultSessionId mesmo que não-WORKING para o erro "Session X not found" ficar explícito).
     * Mantido separado p/ não misturar com a lógica de policy (#1441).
     */
    private resolveLegacyDefault(): string {
        if (sessionService.getStatus(this.defaultSessionId) === 'WORKING') {
            return this.defaultSessionId;
        }
        const working = sessionService.getFirstWorkingSessionId();
        if (working && working !== this.defaultSessionId) {
            log.warn(
                `Sessão default '${this.defaultSessionId}' indisponível; ` +
                `roteando para a sessão WORKING '${working}'.`
            );
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
