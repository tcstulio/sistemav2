import { createLogger } from '../utils/logger';

const log = createLogger('Features');

/**
 * Feature Flags
 *
 * Controle de funcionalidades para migração gradual e testes A/B.
 * Permite habilitar/desabilitar features sem deploy.
 *
 * @see docs/MOLTBOT_INTEGRATION_PLAN.md
 */

export const FEATURES = {
    // ========================================
    // MOLTBOT INTEGRATION
    // ========================================

    /**
     * WhatsApp provider: 'legacy' (whatsapp-web.js) ou 'moltbot'
     * - legacy: Usa whatsapp-web.js direto (Puppeteer)
     * - moltbot: Usa Moltbot Gateway (recomendado)
     */
    WHATSAPP_PROVIDER: (process.env.WHATSAPP_PROVIDER || 'legacy') as 'legacy' | 'moltbot',

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
        debugMode: FEATURES.DEBUG_MODE,
    });
}

export default FEATURES;
