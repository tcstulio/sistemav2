import fs from 'fs';

// Resolve o App.tsx do frontend em vários contextos (runtime do backend, tsx): tenta o caminho
// relativo ao módulo E ao cwd, e usa o 1º que existir.
function resolveAppTsx(): string {
    const pathMod = require('path') as typeof import('path');
    const candidates: string[] = [];
    try { candidates.push(pathMod.resolve(__dirname, '../../../src/components/App.tsx')); } catch { /* __dirname indef */ }
    candidates.push(pathMod.resolve(process.cwd(), 'src/components/App.tsx'));       // cwd = raiz do repo
    candidates.push(pathMod.resolve(process.cwd(), '..', 'src/components/App.tsx')); // cwd = backend
    for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch { /* noop */ } }
    return candidates[candidates.length - 1];
}

/**
 * PURA — parseia o CONTEÚDO do App.tsx → { NomeDoComponente -> rota BASE }. Cada rota é uma linha
 * `<Route path="/x" element={<ViewWrapper Component={XList} viewId="y" />} />`. Prefere a rota BASE
 * (lista) sobre as de detalhe (/:id, /new, /edit) por componente. Testável sem fs.
 */
export function parseAppRoutes(src: string): Record<string, string> {
    const map: Record<string, string> = {};
    for (const line of src.split('\n')) {
        const pm = line.match(/path="([^"]+)"/);
        const cm = line.match(/Component=\{(\w+)\}/);
        if (!pm || !cm) continue;
        const route = pm[1], comp = cm[1];
        const isDetail = route.includes(':') || /\/(new|edit)$/.test(route);
        if (!isDetail) map[comp] = route;        // base sempre vence
        else if (!map[comp]) map[comp] = route;  // detalhe só se ainda não houver base
    }
    return map;
}

/** Lê o App.tsx e devolve o mapa componente->rota. Best-effort (arquivo ausente → mapa vazio). */
export function buildComponentRouteMap(appTsxPath?: string): Record<string, string> {
    try { return parseAppRoutes(fs.readFileSync(appTsxPath || resolveAppTsx(), 'utf-8')); }
    catch { return {}; }
}

/**
 * PURA — dado o mapa componente->rota, devolve as rotas afetadas pelos arquivos alterados. Mapeia
 * cada `src/components/.../<Comp>.tsx` para a rota do `<Comp>`. Componentes COMPARTILHADOS (sem rota
 * própria — ex.: `ui/Button`) não casam → o chamador decide o fallback (ex.: dashboard).
 */
export function affectedScreensFromMap(changedFiles: string[], compRoute: Record<string, string>): string[] {
    const routes = new Set<string>();
    for (const f of changedFiles) {
        const norm = f.replace(/\\/g, '/');
        if (!norm.endsWith('.tsx')) continue;                              // só componentes React
        if (!norm.startsWith('src/') && !norm.includes('/src/')) continue; // só frontend
        const comp = (norm.split('/').pop() || '').replace(/\.tsx$/, '');
        if (compRoute[comp]) routes.add(compRoute[comp]);
    }
    return [...routes];
}

/** Conveniência: lê o App.tsx e mapeia os arquivos alterados → rotas afetadas. */
export function affectedScreens(changedFiles: string[], appTsxPath?: string): string[] {
    return affectedScreensFromMap(changedFiles, buildComponentRouteMap(appTsxPath));
}
