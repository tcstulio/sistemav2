import { createLogger } from '../utils/logger';
import { uiConfigService } from '../services/uiConfigService';

const log = createLogger('Features');

/**
 * Feature Flags
 *
 * Controle de funcionalidades para migração gradual e testes A/B.
 * Permite habilitar/desabilitar features sem deploy.
 *
 * @see docs/MOLTBOT_INTEGRATION_PLAN.md
 */

/**
 * #1410 — resolve o provider WhatsApp na ordem:
 *   1. Override persistido em `uiConfig.whatsappProvider` (setado pela rota admin/integration)
 *   2. Senão, cai no env WHATSAPP_PROVIDER (default 'legacy')
 * Roda UMA vez no boot (a partir de uiConfigService, que carrega o JSON persistido) — antes
 * desse ajuste, o setter admin/integration era teatro: mudava em memória e o restart voltava
 * ao env. Agora `FEATURES.WHATSAPP_PROVIDER` já nasce com o valor persistido, então o getter
 * do channelRouter (chamado no construtor) e o `getEffectiveWhatsAppProvider` em featureSwitches
 * sempre leem o valor correto pós-reboot. Decisão documentada no PR (#1410): PERSISTIR.
 */
function resolveBootWhatsAppProvider(): 'legacy' | 'moltbot' {
    const persisted = uiConfigService.get().whatsappProvider;
    if (persisted === 'legacy' || persisted === 'moltbot') return persisted;
    return (process.env.WHATSAPP_PROVIDER || 'legacy') as 'legacy' | 'moltbot';
}

export const FEATURES = {
    // ========================================
    // MOLTBOT INTEGRATION
    // ========================================

    /**
     * WhatsApp provider: 'legacy' (whatsapp-web.js) ou 'moltbot'
     * - legacy: Usa whatsapp-web.js direto (Puppeteer)
     * - moltbot: Usa Moltbot Gateway (recomendado)
     * Resolvido uma vez no boot via `resolveBootWhatsAppProvider()` (#1410) — ver bloco acima.
     */
    WHATSAPP_PROVIDER: resolveBootWhatsAppProvider(),

    /**
     * Habilitar Moltbot Gateway
     */
    MOLTBOT_ENABLED: process.env.MOLTBOT_ENABLED === 'true',

    /**
     * Habilitar integração com Tulipa Server
     */
    TULIPA_ENABLED: process.env.TULIPA_ENABLED === 'true',

    /**
     * Sincronizar eventos com Brain Hub
     */
    SYNC_BRAIN_ENABLED: process.env.SYNC_BRAIN_ENABLED === 'true',

    /**
     * Usar Tulipa para orquestração de tarefas
     */
    TULIPA_TASKS_ENABLED: process.env.TULIPA_TASKS_ENABLED === 'true',

    /**
     * Memory search via Tulipa (embeddings semânticos)
     */
    MEMORY_SEARCH_ENABLED: process.env.MEMORY_SEARCH_ENABLED === 'true',

    /**
     * TaskRunner: ao detectar uma issue 'opencode-task' nova no polling, INICIAR a execução
     * automaticamente (além de notificar). Fluxo "criar issue + label → robô resolve sozinho".
     * O Planner continua filtrando (go/esperar/pular). Default OFF para evitar execução surpresa.
     */
    TASKRUNNER_AUTOSTART: process.env.TASKRUNNER_AUTOSTART === 'true',

    // ========================================
    // WHATSAPP FEATURES
    // ========================================

    /**
     * Auto-resposta com LLM
     */
    AUTO_REPLY_ENABLED: process.env.AUTO_REPLY_ENABLED !== 'false',

    /**
     * Transcrição de áudio
     */
    AUDIO_TRANSCRIPTION_ENABLED: process.env.AUDIO_TRANSCRIPTION_ENABLED !== 'false',

    /**
     * Comandos financeiros via WhatsApp (/pagar, /pix)
     */
    FINANCIAL_COMMANDS_ENABLED: process.env.FINANCIAL_COMMANDS_ENABLED === 'true',

    // ========================================
    // CRM INTEGRATION
    // ========================================

    /**
     * Injetar contexto CRM nas respostas do LLM
     */
    CRM_CONTEXT_INJECTION: process.env.CRM_CONTEXT_INJECTION !== 'false',

    /**
     * Sincronizar pessoas Brain ↔ Dolibarr
     */
    CRM_SYNC_ENABLED: process.env.CRM_SYNC_ENABLED === 'true',

    // ========================================
    // DEVELOPMENT
    // ========================================

    /**
     * Modo debug (mais logs)
     */
    DEBUG_MODE: process.env.DEBUG_MODE === 'true',

    /**
     * Dry-run mode (não envia mensagens reais)
     */
    DRY_RUN_MODE: process.env.DRY_RUN_MODE === 'true',
};

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Check if using Moltbot for WhatsApp
 */
export function isUsingMoltbot(): boolean {
    return FEATURES.MOLTBOT_ENABLED && FEATURES.WHATSAPP_PROVIDER === 'moltbot';
}

/**
 * Check if using legacy whatsapp-web.js
 */
export function isUsingLegacyWhatsApp(): boolean {
    return !isUsingMoltbot();
}

/**
 * Check if Tulipa integration is active
 */
export function isTulipaActive(): boolean {
    return FEATURES.TULIPA_ENABLED;
}

/**
 * Check if Brain sync is enabled
 */
export function isBrainSyncEnabled(): boolean {
    return FEATURES.TULIPA_ENABLED && FEATURES.SYNC_BRAIN_ENABLED;
}

/**
 * Check if CRM context injection is enabled
 */
export function isCRMContextEnabled(): boolean {
    return FEATURES.CRM_CONTEXT_INJECTION;
}

/**
 * Get all feature flags as object (for debugging)
 */
export function getAllFeatures(): typeof FEATURES {
    return { ...FEATURES };
}

/**
 * Log current feature configuration
 */
export function logFeatures(): void {
    log.info('Current configuration', {
        whatsappProvider: FEATURES.WHATSAPP_PROVIDER,
        moltbotEnabled: FEATURES.MOLTBOT_ENABLED,
        tulipaEnabled: FEATURES.TULIPA_ENABLED,
        brainSync: FEATURES.SYNC_BRAIN_ENABLED,
        autoReply: FEATURES.AUTO_REPLY_ENABLED,
        crmContext: FEATURES.CRM_CONTEXT_INJECTION,
        taskrunnerAutostart: FEATURES.TASKRUNNER_AUTOSTART,
        debugMode: FEATURES.DEBUG_MODE,
    });
}

export default FEATURES;
