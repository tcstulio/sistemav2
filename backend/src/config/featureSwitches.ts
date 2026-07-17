/**
 * Feature Switches — resolvers de RUNTIME para kill-switches perigosos (#1129) + override
 * persistente do provider WhatsApp (#1410).
 *
 * Os flags em `features.ts` (FEATURES.*) são lidos do .env UMA vez no boot. Para acionar
 * em incidente sem redeploy, expomos os mesmos flags como toggles de admin persistidos em
 * `uiConfig.featureSwitches` (card "Integrações/Segurança"). Estes resolvers combinam as
 * duas fontes a cada chamada — mesmo padrão do TASKRUNNER_AUTOSTART (env-como-fallback +
 * toggle de UI lido em runtime).
 *
 *   - dryRunMode / financialCommands (default OFF): env OU toggle ligam (OR). Secure-default OFF.
 *   - crmContextInjection (default ON): só fica ativo se env E toggle não desligarem (AND),
 *     preservando o comportamento histórico e permitindo ao admin desligar a injeção no LLM.
 *
 * #1410 — `getEffectiveWhatsAppProvider()` delega para `FEATURES.WHATSAPP_PROVIDER`, que já
 * é resolvido no boot em `features.ts` (override persistido em `uiConfig.whatsappProvider`
 * tem precedência sobre o env WHATSAPP_PROVIDER). Wrapper mantido para preservar a API
 * consumida por `channelRouter` no construtor. Sem essa cadeia, `setWhatsAppProvider` só
 * mexia em memória e o restart voltava pro env (#1410).
 */
import { FEATURES } from './features';
import { uiConfigService } from '../services/uiConfigService';

function toggleDryRun(): boolean {
    const sw = uiConfigService.get().featureSwitches;
    return sw?.dryRunMode === true;
}

function toggleFinancial(): boolean {
    const sw = uiConfigService.get().featureSwitches;
    return sw?.financialCommands === true;
}

function toggleCrm(): boolean {
    const sw = uiConfigService.get().featureSwitches;
    return sw?.crmContextInjection !== false;
}

function toggleEmployeeElevation(): boolean {
    const sw = uiConfigService.get().featureSwitches;
    return sw?.whatsappEmployeeElevation === true;
}

/** DRY_RUN ativo (env DRY_RUN_MODE=true OU toggle de UI). Impede envio real de mensagens. */
export function isDryRunEnabled(): boolean {
    return FEATURES.DRY_RUN_MODE === true || toggleDryRun();
}

/** Comandos financeiros (/pagar, /pix) habilitados (env OU toggle de UI). */
export function isFinancialCommandsEnabled(): boolean {
    return FEATURES.FINANCIAL_COMMANDS_ENABLED === true || toggleFinancial();
}

/** Injeção de contexto CRM no LLM ativa (env não 'false' E toggle não desligado). */
export function isCrmContextInjectionEnabled(): boolean {
    return FEATURES.CRM_CONTEXT_INJECTION !== false && toggleCrm();
}

/** Elevação de funcionário no bot WhatsApp (env OU toggle de UI). Secure-default OFF. */
export function isWhatsappEmployeeElevationEnabled(): boolean {
    return FEATURES.WHATSAPP_EMPLOYEE_ELEVATION === true || toggleEmployeeElevation();
}

/** #1410 — provider WhatsApp efetivo (override persistido > env). O valor já é resolvido
 *  no boot em `features.ts`; aqui só devolvemos o que está em `FEATURES` p/ preservar a
 *  API consumida pelo construtor do `channelRouter`. */
export function getEffectiveWhatsAppProvider(): 'legacy' | 'moltbot' {
    return FEATURES.WHATSAPP_PROVIDER;
}
