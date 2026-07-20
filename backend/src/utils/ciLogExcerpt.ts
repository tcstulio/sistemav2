/**
 * #ci-log-feedback (red-team Fable): extrai as linhas ACIONÁVEIS de um log de CI vermelho
 * (`gh run view --log-failed`) para realimentar o coder do TaskRunner — em vez de só o NOME do check.
 *
 * PURO/testável. Validado em 2 logs reais de CI (render/playwright de 267KB com ~200 linhas de ruído
 * ws-proxy; vitest de 294KB cuja falha era um Unhandled Rejection com 2.820 testes VERDES). O maior
 * risco é vazar milhares de linhas de ruído no prompt do coder — daí: normaliza (tira prefixo TSV do
 * gh, BOM, timestamp ISO, ANSI), EXCLUI ruído conhecido, prioriza em 2 tiers (identidade/sumário antes
 * do contexto), DEDUPLICA (playwright repete cada falha 6× por retry×projeto) e RESPEITA um teto DURO.
 */

// Ruído a excluir ANTES de tudo (proxy do webserver, browserslist).
const NOISE = /\[WebServer\]|ECONNREFUSED|ws proxy error|browserslist/i;
// Tier A — identidade da falha + sumário (entra primeiro no overflow).
const TIER_A: RegExp[] = [
    /^\s*\d+\)\s+\[/,                    // "1) [chromium] › ..." (playwright)
    /^\s*(✘|×|✗|❯|FAIL\b)/,             // marcadores de falha
    /error TS\d+/,                       // tsc
    /AssertionError/,
    /Unhandled (Rejection|Error)/,       // o caso que derrubava a CI com testes verdes
    /^\s*(Test Files|Tests|Errors)\s+.*\d/, // sumário do vitest
    /^\s*\d+ (failed|flaky|passed|skipped)\b/, // sumário do playwright
    /##\[error\]/,                       // erro de step do GitHub Actions
];
// Tier B — contexto (asserção, arquivo:linha, timeout).
const TIER_B: RegExp[] = [
    /\bError:/,
    /Timed out|Test timeout/,
    /\bexpect\(/,
    /at .*\.(spec|test)\.[tj]sx?:\d+/,
];

const LINE_CAP = 300; // teto por-linha (a strict-mode-violation do playwright tem 400+ chars)

/** Normaliza uma linha crua do `gh run view --log-failed`. */
function normalizeLine(raw: string): string {
    let s = raw;
    // Prefixo TSV do gh: "job\tstep\t<conteúdo>" (~110 chars). Removê-lo ANTES de truncar é essencial.
    const tsv = s.match(/^[^\t]*\t[^\t]*\t([\s\S]*)$/);
    if (tsv) s = tsv[1];
    s = s.replace(/^﻿/, '');                          // BOM na 1ª linha
    s = s.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z ?/, '');    // timestamp ISO do Actions
    s = s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');           // códigos ANSI de cor
    return s.replace(/\s+$/, '');
}

/** Chave de dedup: colapsa o prefixo "N) " e o "[projeto] › " (retries e projetos do playwright). */
function dedupKey(line: string): string {
    return line.replace(/^\s*\d+\)\s*/, '').replace(/^\s*\[[^\]]+\]\s*›\s*/, '').trim();
}

/**
 * Devolve um excerto ACIONÁVEL do log (≤ maxChars, NUNCA maior). '' se o log for vazio.
 * Nunca lança.
 */
export function extractCiLogExcerpt(rawLog: string, maxChars = 1500): string {
    if (!rawLog) return '';
    const lines = String(rawLog).split(/\r?\n/).map(normalizeLine);

    const seen = new Set<string>();
    const picks: Array<{ line: string; tier: 0 | 1 }> = [];
    for (const l of lines) {
        if (!l.trim() || NOISE.test(l)) continue;
        const isA = TIER_A.some((r) => r.test(l));
        const isB = !isA && TIER_B.some((r) => r.test(l));
        if (!isA && !isB) continue;
        const capped = l.length > LINE_CAP ? l.slice(0, LINE_CAP) + '…' : l;
        const key = dedupKey(capped);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        picks.push({ line: capped, tier: isA ? 0 : 1 });
    }

    if (picks.length > 0) {
        const inOrder = picks.map((p) => p.line).join('\n');
        if (inOrder.length <= maxChars) return inOrder;
        // Overflow: Tier A primeiro, Tier B preenche o resto, até o teto.
        const ordered = [...picks.filter((p) => p.tier === 0), ...picks.filter((p) => p.tier === 1)];
        const acc: string[] = [];
        let len = 0;
        for (const p of ordered) {
            const add = (acc.length ? 1 : 0) + p.line.length;
            if (len + add > maxChars) continue;
            acc.push(p.line);
            len += add;
        }
        if (acc.length) return acc.join('\n').slice(0, maxChars);
    }

    // Fallback: nada acionável casado → tail dos últimos ~800 chars de linhas não-ruído.
    const tail = lines.filter((l) => l.trim() && !NOISE.test(l)).slice(-40).join('\n');
    return tail.slice(-800);
}

/** Extrai os jobIds únicos (máx `cap`) dos checks falhos, via detailsUrl. PURO/testável. */
export function jobIdsFromRollup(
    failedRollup: Array<{ detailsUrl?: string }>,
    cap = 2,
): string[] {
    const ids = (failedRollup || [])
        .map((c) => String(c?.detailsUrl || '').match(/\/runs\/\d+\/job\/(\d+)/)?.[1])
        .filter((x): x is string => !!x);
    return [...new Set(ids)].slice(0, cap);
}
