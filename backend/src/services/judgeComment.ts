/**
 * Formatador PURO do comentário do Judge no PR do GitHub (#1203 / Fase D2).
 *
 * Hoje o racional do Judge (score, crítica, missing_coverage) vive só em `task.events`
 * (cap 500) + WebSocket — quem olha o PR no GitHub não vê POR QUE foi aprovado/segurado.
 * Este módulo converte o veredito do Judge em um comentário Markdown legível no PR.
 *
 * Puro (sem I/O, sem deps) p/ permitir teste unitário isolado. O POST em si é best-effort
 * (falha nunca bloqueia o pipeline) e vive no taskRunnerService.
 *
 * Segurança: o review é sobre o diff PÚBLICO, mas truncamos defensivamente (~1500 chars)
 * p/ não estourar o comentário nem refletir conteúdo eventualmente grande.
 */

export interface JudgeCommentInput {
    /** Score 0-10 devolvido pelo Judge. */
    score: number;
    /** Aval final do Judge: true=pronto p/ produção, false=veto, undefined=inconclusivo/revisão. */
    approved?: boolean;
    /** Revisão detalhada em português (pode ser longa — será truncada defensivamente). */
    review?: string;
    /** Itens de cobertura/critério não atendidos (missing_coverage do JSON do Judge). */
    missingCoverage?: string[];
    /** Número da tentativa de julgamento (judgeAttempts). */
    attempt: number;
    /** Número da task/issue (contexto opcional no cabeçalho). */
    issueNumber?: number;
}

/** Limite defensivo p/ o resumo. ~1500 chars conforme spec (#1203). */
export const JUDGE_COMMENT_REVIEW_MAX = 1500;

/**
 * Monta o corpo (Markdown) do comentário do Judge no PR.
 * Função pura — não realiza I/O nem lança.
 */
export function formatJudgeComment(input: JudgeCommentInput): string {
    const { score, approved, review, missingCoverage, attempt, issueNumber } = input;

    const verdict =
        approved === true ? 'Aprovado'
            : approved === false ? 'Veto do Juiz (approved=false)'
                : 'Aguardando definição (requer revisão)';

    const rawReview = (review || '').trim();
    const truncated = rawReview.length > JUDGE_COMMENT_REVIEW_MAX;
    const reviewText = rawReview.slice(0, JUDGE_COMMENT_REVIEW_MAX);

    const lines: string[] = [
        `### Judge automático — tentativa ${attempt}`,
        ...(issueNumber ? [`Task/issue #${issueNumber}`] : []),
        '',
        `**Score: ${score}/10** — ${verdict}`,
        '',
        '**Resumo da revisão:**',
        reviewText || '_sem resumo_',
    ];
    if (truncated) {
        lines.push('', `_(resumo truncado em ${JUDGE_COMMENT_REVIEW_MAX} caracteres — detalhe completo na timeline da task)_`);
    }
    if (missingCoverage && missingCoverage.length > 0) {
        lines.push('', '**Cobertura faltando:**', ...missingCoverage.map((c) => `- ${c}`));
    }
    lines.push('', '---', '_Comentário gerado automaticamente pelo TaskRunner (best-effort). Falhas aqui não afetam o pipeline._');
    return lines.join('\n');
}
