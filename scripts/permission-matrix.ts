// Gera a matriz papel×tela×ação REAL: lê os grupos + direitos do Dolibarr (READ-ONLY, via o backend
// proxy) e aplica as funções PURAS de src/utils/permissionMatrix. O oráculo RBAC "quem-pode-o-quê".
//
// Uso (precisa o backend de pé em :3004 + DOLIBARR_API_KEY no backend/.env):
//   npx tsx scripts/permission-matrix.ts                 # imprime a matriz em Markdown
//   npx tsx scripts/permission-matrix.ts > matriz.md
//
// NÃO muta nada (só GET). A lógica de decisão é testada em src/__tests__/permissionMatrix.test.ts.
import { readFileSync } from 'fs';
import { join } from 'path';
import { deriveScreenMatrix, matrixToMarkdown } from '../src/utils/permissionMatrix';

const BASE = process.env.DOLIBARR_PROXY || 'http://localhost:3004/api/dolibarr';

function readKey(): string {
    if (process.env.DOLIBARR_API_KEY) return process.env.DOLIBARR_API_KEY;
    try {
        const t = readFileSync(join(process.cwd(), 'backend', '.env'), 'utf-8');
        const l = t.split(/\r?\n/).find((x) => x.startsWith('DOLIBARR_API_KEY='));
        return (l ? l.slice('DOLIBARR_API_KEY='.length) : '').trim().replace(/^["']|["']$/g, '');
    } catch { return ''; }
}
const KEY = readKey();

async function customSync(type: string): Promise<any[]> {
    const res = await fetch(`${BASE}/custom_sync.php?type=${type}`, { headers: { dolapikey: KEY } as Record<string, string> });
    if (!res.ok) throw new Error(`custom_sync ${type}: HTTP ${res.status}`);
    const j: any = await res.json();
    return Array.isArray(j) ? j : (j.data || []);
}

// Reconstrói os rights de um grupo — MESMA lógica de getGroupRights (hrAdmin.ts): group_rights (grupo
// -> right_id) + permissions/rights_def (right_id -> module.perm.sub).
function groupRights(links: any[], defs: any[], groupId: string): any {
    const defById = new Map(defs.map((d) => [String(d.id), d]));
    const rights: any = {};
    for (const l of links) {
        if (String(l.fk_usergroup) !== String(groupId)) continue;
        const d: any = defById.get(String(l.fk_id));
        if (!d || !d.module || !d.perms) continue;
        const mod = d.module, perm = d.perms, sub = d.subperms;
        rights[mod] = rights[mod] || {};
        if (sub) { if (typeof rights[mod][perm] !== 'object') rights[mod][perm] = {}; rights[mod][perm][sub] = 1; }
        else if (typeof rights[mod][perm] !== 'object') rights[mod][perm] = 1;
    }
    return rights;
}

(async () => {
    if (!KEY) { console.error('DOLIBARR_API_KEY não encontrada (backend/.env).'); process.exit(1); }
    const [groups, links, defs] = await Promise.all([
        customSync('groups'), customSync('group_rights'), customSync('permissions'),
    ]);
    const stamp = new Date().toISOString().slice(0, 10);
    console.log(`# Matriz papel×tela×ação — ${groups.length} grupos (${stamp})\n`);
    console.log('> Derivada READ-ONLY dos direitos reais dos grupos (getGroupRights) + funções puras.\n');
    for (const g of groups) {
        const gid = String(g.id ?? g.rowid);
        const rights = groupRights(links, defs, gid);
        const matrix = deriveScreenMatrix({ admin: 0, rights });
        console.log(matrixToMarkdown(matrix, `Grupo: ${g.nom ?? g.name ?? gid}`) + '\n');
    }
})().catch((e) => { console.error('ERRO:', e?.message || e); process.exit(1); });
