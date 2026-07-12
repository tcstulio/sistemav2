/**
 * Catálogo de ações do agente (robô-de-negócio F0 — issue #1234 / plano §8.4).
 *
 * Classifica cada tool por DOMÍNIO, REVERSIBILIDADE e se exige HITL. É a fonte única que
 * alimenta: a trilha de atividade (tag domain/reversible), o kill-switch por domínio
 * (`businessActionsEnabled` — #1370, gate em agentTools), a decisão de HITL (irreversível ⇒
 * deeplink-confirmar) e é a semente do "catálogo de ações" da F4.
 *
 * PRINCÍPIO (fail-safe): tool NÃO classificada é tratada como `business/irreversible/requiresHITL`
 * — o desconhecido é o mais restrito, nunca o mais livre. Classificar reduz atrito; esquecer não abre furo.
 *
 * NOTA: a classificação é por TOOL (não por args). Nuances por-canal (ex.: notify_person in-app
 * vs whatsapp) e por-valor são refinamento futuro (F2/F4) — aqui é a régua grossa.
 */

export type ActionDomain = 'read' | 'business' | 'code' | 'automation';
export type ActionReversibility = 'read' | 'reversible' | 'irreversible';

export interface ActionClass {
    domain: ActionDomain;
    reversibility: ActionReversibility;
    /** Efeito irreversível a terceiro ⇒ exige confirmação humana (deeplink-confirmar / aprovação). */
    requiresHITL: boolean;
}

/** Default seguro para tool não catalogada: o mais restrito. */
export const DEFAULT_ACTION_CLASS: ActionClass = { domain: 'business', reversibility: 'irreversible', requiresHITL: true };

/**
 * Overrides explícitos — efeito DIRETO (não-deeplink) e ferramentas de código, onde o padrão
 * por prefixo não captura o risco corretamente.
 */
const OVERRIDES: Record<string, ActionClass> = {
    // Efeito irreversível no ERP (numeração fiscal etc.) — no registry HITL (agentActionConfirm):
    // com o dial ligado, o gate desvia p/ /confirm-action em vez de executar direto.
    validate_invoice: { domain: 'business', reversibility: 'irreversible', requiresHITL: true },
    validate_order: { domain: 'business', reversibility: 'irreversible', requiresHITL: true },
    validate_proposal: { domain: 'business', reversibility: 'irreversible', requiresHITL: true },
    // Exclusão de proposta — irreversível e SEM defesa-em-profundidade no Dolibarr (o guard de
    // "só rascunho" em agentActionConfirm.delete_proposal é a única proteção). No registry HITL.
    delete_proposal: { domain: 'business', reversibility: 'irreversible', requiresHITL: true },
    // Comunicação externa — mensagem enviada não se desfaz. No registry HITL desde a Fase 2.
    send_whatsapp: { domain: 'business', reversibility: 'irreversible', requiresHITL: true },
    // Notificações internas (in-app/equipe) — reversíveis; o canal externo já é gateado à parte (Fase A).
    notify_person: { domain: 'business', reversibility: 'reversible', requiresHITL: false },
    notify_team: { domain: 'business', reversibility: 'reversible', requiresHITL: false },
    // Domínio de CÓDIGO (TaskRunner) — trilha separada da de negócio.
    create_github_issue: { domain: 'code', reversibility: 'reversible', requiresHITL: false },
    create_bug_report: { domain: 'code', reversibility: 'reversible', requiresHITL: false },
    list_github_issues: { domain: 'code', reversibility: 'read', requiresHITL: false },
    create_opencode_task: { domain: 'code', reversibility: 'reversible', requiresHITL: false },
    start_opencode_task: { domain: 'code', reversibility: 'irreversible', requiresHITL: true },
    merge_opencode_task: { domain: 'code', reversibility: 'irreversible', requiresHITL: true },
};

/**
 * Classifica uma tool. Precedência: override explícito → padrão por prefixo → default seguro.
 */
export function classifyTool(tool: string): ActionClass {
    if (OVERRIDES[tool]) return OVERRIDES[tool];

    // Leitura (sempre livre).
    if (/^(list_|get_|search_|read_|check_)/.test(tool)) {
        return { domain: 'read', reversibility: 'read', requiresHITL: false };
    }
    // Interação com o usuário (sem efeito no mundo).
    if (tool === 'ask_user' || tool === 'pergunta' || tool === 'confirmar' || tool === 'web_search') {
        return { domain: 'read', reversibility: 'read', requiresHITL: false };
    }
    // prepare_* = deeplink: só gera um link pré-preenchido, EFEITO ZERO até o humano confirmar na
    // tela (o HITL é a própria tela, executada com a chave do usuário). Por isso reversível/sem-HITL-aqui.
    if (/^prepare_/.test(tool)) {
        return { domain: 'business', reversibility: 'reversible', requiresHITL: false };
    }

    return DEFAULT_ACTION_CLASS;
}
