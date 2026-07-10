/**
 * Gate por DELTA (Fase 0 item 2-3, endurecido por análise adversarial de 3 agentes). Lógica PURA
 * e testável (gateDelta.test.ts). Só é BLOQUEANTE um erro de tsc NOVO (vs baseline) POSICIONAL em
 * arquivo que a task TOCOU, ou qualquer erro GLOBAL novo (sem posição). O filtro por arquivo-tocado
 * é o mecanismo primário: impede culpar a task por erro pré-existente / de outro PR / cascata em
 * arquivo que ela nem abriu (os falsos-positivos que a análise adversarial pegou no caminho de merge).
 */

/** Assinatura ESTÁVEL de cada erro POSICIONAL do tsc: `arquivo|TScode|msg`, SEM linha/coluna (imune a shift). */
export function parseTscErrors(raw: string): Map<string, number> {
    const keys = new Map<string, number>();
    // Ex.: "src/components/X.tsx(116,38): error TS2307: Cannot find module 'heic2any'."
    const re = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+?)\s*$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw))) {
        const key = `${m[1].trim().replace(/\\/g, '/')}|${m[4]}|${m[5].trim()}`;
        keys.set(key, (keys.get(key) || 0) + 1);
    }
    return keys;
}

/** Erros GLOBAIS do tsc (SEM posição): TS18003 "No inputs were found", TS6053, `extends` quebrado. */
export function parseGlobalTscErrors(raw: string): string[] {
    const out: string[] = [];
    // Linha que COMEÇA com "error TS" (o erro posicional começa com o caminho do arquivo).
    const re = /^\s*error\s+(TS\d+):\s+(.+?)\s*$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw))) out.push(`${m[1]}|${m[2].trim()}`);
    return out;
}

/** Serializa o multiset p/ persistir no Task (JSON-safe): "count\tchave". */
export function serializeErrors(keys: Map<string, number>): string[] {
    return Array.from(keys.entries()).map(([k, n]) => `${n}\t${k}`);
}

/** Reidrata o multiset persistido. */
export function deserializeErrors(lines: string[] | undefined): Map<string, number> {
    const m = new Map<string, number>();
    for (const line of lines || []) {
        const tab = line.indexOf('\t');
        if (tab > 0) m.set(line.slice(tab + 1), parseInt(line.slice(0, tab), 10) || 1);
        else if (line) m.set(line, 1);
    }
    return m;
}

/** Diferença de multiset: chaves que aparecem MAIS vezes no `current` que no `baseline`. */
export function newErrors(current: Map<string, number>, baseline: Map<string, number>): string[] {
    const out: string[] = [];
    for (const [key, n] of current) {
        const allowed = baseline.get(key) || 0;
        for (let i = allowed; i < n; i++) out.push(key);
    }
    return out;
}

/** Casa caminho do tsc (relativo ao tsconfig OU ao WT_ROOT) com o do git diff, por sufixo. */
export function isTouched(tscFile: string, touched: Set<string>): boolean {
    const f = String(tscFile).replace(/\\/g, '/').replace(/^\.\//, '');
    for (const t0 of touched) {
        const t = String(t0).replace(/\\/g, '/').replace(/^\.\//, '');
        if (f === t || f.endsWith('/' + t) || t.endsWith('/' + f)) return true;
    }
    return false;
}

/**
 * Erros BLOQUEANTES = novos posicionais EM ARQUIVO TOCADO + todos os globais novos. O filtro por
 * arquivo-tocado é o que neutraliza baseline stale / cascata / erro de outro PR: se a task não abriu
 * o arquivo, o erro ali não é culpa dela (e a CI full-repo, que é o portão final, pega o resto).
 */
export function computeBlocking(
    currentPos: Map<string, number>, baselinePos: Map<string, number>,
    currentGlobal: string[], baselineGlobal: string[], touchedFiles: string[],
): string[] {
    const touched = new Set(touchedFiles);
    const posNew = newErrors(currentPos, baselinePos).filter((k) => isTouched(k.split('|')[0], touched));
    const toMs = (a: string[]) => { const m = new Map<string, number>(); for (const g of a) m.set(g, (m.get(g) || 0) + 1); return m; };
    const gNew = newErrors(toMs(currentGlobal), toMs(baselineGlobal)); // globais sempre bloqueiam (repo-level)
    return [...posNew, ...gNew];
}

/**
 * Divide os arquivos tocados por projeto p/ o gate de teste (Fase 4). backend/* roda no vitest do
 * `backend/` (path relativo a ele); src/* roda no vitest da raiz. Fora disso (docs, config) é ignorado.
 */
export function splitTouchedByProject(touched: string[]): { backend: string[]; frontend: string[] } {
    const backend: string[] = [], frontend: string[] = [];
    for (const f0 of touched) {
        const f = String(f0).replace(/\\/g, '/');
        if (f.startsWith('backend/')) backend.push(f.replace(/^backend\//, ''));
        else if (f.startsWith('src/')) frontend.push(f);
    }
    return { backend, frontend };
}
