/**
 * Feature Switches — resolvers de RUNTIME para kill-switches perigosos (#1129).
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
