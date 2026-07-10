/**
 * Dedup determinístico de issues por similaridade de TÍTULO (#1279 — issues órfãs de
 * decomposição duplicada geram re-work do robô).
 *
 * Por que título e não corpo: o modo de falha real é a MESMA leva criada 2x (decompose
 * re-rodado, retry do agente, plano re-decomposto) — títulos idênticos ou quase. Duplicatas
 * SEMÂNTICAS (outra leva, outro título) ficam com o Planner LLM (alreadyResolved), que
 * recebe contexto de PRs mergeados p/ isso — aqui é a régua barata e determinística.
 *
 * Util PURO (sem imports de services) — usável por agentTools e taskRunnerService sem ciclo.
 */

/** Normaliza p/ comparação: minúsculas, sem acento, sem prefixo conventional-commit, sem pontuação. */
export function normalizeIssueTitle(title: string): string {
    return String(title || '')
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos
        .replace(/^\s*(feat|fix|chore|test|docs|refactor|perf|build|ci)\s*(\([^)]*\))?\s*[:!-]\s*/, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Tokens significativos (≥3 chars) do título normalizado. */
export function titleTokens(title: string): Set<string> {
    return new Set(normalizeIssueTitle(title).split(' ').filter(t => t.length >= 3));
}

/** Similaridade Jaccard [0..1] entre os conjuntos de tokens de dois títulos. */
export function titleSimilarity(a: string, b: string): number {
    const ta = titleTokens(a);
    const tb = titleTokens(b);
    if (ta.size === 0 || tb.size === 0) return 0;
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter++;
    return inter / (ta.size + tb.size - inter);
}

export interface SimilarIssueMatch {
    number: number;
    title: string;
    score: number;
}

/**
 * Melhor issue com título similar acima do limiar. Default 0.75: pega variações triviais do
 * mesmo título (prefixo feat:/Backend: trocado ≈ 3-de-4 tokens), enquanto pares vizinhos reais
 * do backlog ("chip de rodadas" vs "chip de cooldown" no mesmo card) ficam em ~0.6. O custo é
 * assimétrico: falso positivo = mensagem "use a issue existente" (barato, recuperável); falso
 * negativo = issue duplicada e re-work do robô (caro).
 * Título normalizado IDÊNTICO conta como score 1 mesmo com poucos tokens.
 */
export function findSimilarIssue(
    title: string,
    issues: Array<{ number: number; title: string }>,
    threshold = 0.75,
): SimilarIssueMatch | null {
    const norm = normalizeIssueTitle(title);
    let best: SimilarIssueMatch | null = null;
    for (const iss of issues) {
        const score = normalizeIssueTitle(iss.title) === norm ? 1 : titleSimilarity(title, iss.title);
        if (score >= threshold && (!best || score > best.score)) {
            best = { number: iss.number, title: iss.title, score };
        }
    }
    return best;
}
