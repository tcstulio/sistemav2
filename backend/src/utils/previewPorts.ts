/**
 * Portas do preview de uma task do TaskRunner.
 *
 * ÚNICA fonte da verdade — usada por `startPreview` (que SERVE o preview persistente),
 * `captureVisualProofPngs` (que sobe um preview EFÊMERO e fotografa) e `runVisualJudge`
 * (que LÊ a porta do preview vivo). Antes as fórmulas divergiam (o Judge montava a URL com
 * `3000 + (n % 1000)` enquanto o preview subia em `5174 + (n % 10)`), então o screenshot "depois"
 * batia numa porta sem servidor e o Judge Visual nunca avaliava o frontend (#374).
 *
 * ── FLIP Degrau 2 PR-C (#1661): POOL/LEASE por-issue ─────────────────────────────────────────
 * A fórmula `5174 + (n % 10)` colide quando DUAS tasks vivas têm `n % 10` igual (ex.: 1612 e 1622):
 * MESMAS portas → EADDRINUSE ou, PIOR, o Judge fotografa a porta de OUTRA task (falso-oráculo, G3).
 * A correção NÃO é offset por-slot (previews são por-ISSUE, persistem além do exec e podem coexistir
 * >2 — offset por-slot colidiria de novo). É um POOL com LEASE por-issue: cada issue viva reserva um
 * slot `k` DISTINTO dentro da MESMA faixa (a fonte da verdade compartilhada com o GC, que ceifa
 * órfãos nessa faixa). A alocação vira lease; a faixa numérica NÃO muda.
 */
import {
    PREVIEW_FRONTEND_PORT_BASE,
    PREVIEW_BACKEND_PORT_BASE,
    PREVIEW_PORT_RANGE,
} from './gcWorktrees';

/**
 * Par de portas do slot `k` (0..RANGE-1) da faixa de preview. Deriva das bases/range de gcWorktrees
 * — fonte ÚNICA — para que o GC (que ceifa processos órfãos na faixa `[BASE, BASE+RANGE)`) e a
 * alocação nunca fiquem fora de sincronia. `k = n % RANGE` reproduz os números de hoje sem colisão.
 */
function portsForSlot(k: number): { frontendPort: number; backendPort: number } {
    return {
        frontendPort: PREVIEW_FRONTEND_PORT_BASE + k,
        backendPort: PREVIEW_BACKEND_PORT_BASE + k,
    };
}

/**
 * HELPER DE PREFERÊNCIA (puro, SEM reservar). Retorna o par do slot preferido `k0 = n % RANGE` —
 * os MESMOS números de sempre. NÃO garante exclusividade: consumidores que sobem servidor REAL
 * (preview persistente, proof efêmero, Judge Visual) DEVEM usar `acquirePreviewPorts` para obter um
 * slot LEASED e exclusivo. Mantido exportado p/ quem só precisa calcular a preferência (e p/ compat
 * de testes que hoje o mockam).
 */
export function previewPortsFor(issueNumber: number): { frontendPort: number; backendPort: number } {
    return portsForSlot(((issueNumber % PREVIEW_PORT_RANGE) + PREVIEW_PORT_RANGE) % PREVIEW_PORT_RANGE);
}

/**
 * Estado do pool (module-level). Mapeia issueNumber → lease {slot k, token}. Um `k` é livre sse
 * nenhum lease o ocupa. Lease é IDEMPOTENTE por-issue (re-acquire da mesma issue devolve o mesmo k)
 * e o `release()` também (liberar duas vezes é no-op). O `token` (contador monotônico) discrimina
 * leases SUCESSIVOS da mesma issue: um release STALE de um lease antigo NÃO derruba um lease NOVO
 * (mesmo que caia no mesmo slot k).
 */
interface Lease {
    k: number;
    token: number;
}
const leaseByIssue = new Map<number, Lease>();
let nextLeaseToken = 1;

/** Slots atualmente ocupados, p/ decidir se um `k` está livre. */
function isSlotFree(k: number): boolean {
    for (const lease of leaseByIssue.values()) {
        if (lease.k === k) return false;
    }
    return true;
}

/**
 * Reserva (LEASE) um par de portas EXCLUSIVO p/ uma issue, dentro da faixa de preview.
 *
 * - IDEMPOTENTE por-issue: re-`acquire` da MESMA issue (sem release) devolve o lease existente
 *   (mesmo par) — cobre proof + preview persistente da mesma task e re-entradas.
 * - Preferência determinística `k0 = issueNumber % RANGE`, varredura CIRCULAR a partir de k0 até
 *   achar um slot livre (mantém os números de hoje quando não há colisão → diff de comportamento
 *   mínimo; só desvia p/ evitar sobreposição com outra issue viva).
 * - Pool esgotado (todos os RANGE slots ocupados por issues distintas) → throw Error claro. NÃO
 *   bloqueia (o chamador decide; hoje = no máx. RANGE previews simultâneos).
 * - `release()` idempotente libera o slot (e a entry do Map) — chamável no stopPreview / finally.
 */
export function acquirePreviewPorts(
    issueNumber: number,
): { frontendPort: number; backendPort: number; release: () => void } {
    // Idempotência por-issue: lease já existente devolve o MESMO par (e o MESMO token).
    const existing = leaseByIssue.get(issueNumber);
    if (existing !== undefined) {
        return { ...portsForSlot(existing.k), release: makeRelease(issueNumber, existing.token) };
    }

    const k0 = ((issueNumber % PREVIEW_PORT_RANGE) + PREVIEW_PORT_RANGE) % PREVIEW_PORT_RANGE;
    for (let i = 0; i < PREVIEW_PORT_RANGE; i++) {
        const k = (k0 + i) % PREVIEW_PORT_RANGE;
        if (isSlotFree(k)) {
            const token = nextLeaseToken++;
            leaseByIssue.set(issueNumber, { k, token });
            return { ...portsForSlot(k), release: makeRelease(issueNumber, token) };
        }
    }

    throw new Error(
        `pool de portas de preview esgotado (RANGE=${PREVIEW_PORT_RANGE}) — ${PREVIEW_PORT_RANGE} previews simultâneos`,
    );
}

/**
 * Fábrica do `release` do lease. Idempotente E imune a stale: só libera se o lease VIVO da issue for
 * ESTE (mesmo `token`). Assim um release tardio de um lease antigo não derruba um lease NOVO da mesma
 * issue — nem quando o novo caiu no mesmo slot `k`.
 */
function makeRelease(issueNumber: number, token: number): () => void {
    return () => {
        const cur = leaseByIssue.get(issueNumber);
        if (cur !== undefined && cur.token === token) {
            leaseByIssue.delete(issueNumber);
        }
    };
}

/** Só p/ teste: limpa o pool (nenhum slot leased). Chamar no beforeEach. */
export function _resetPreviewPortPool(): void {
    leaseByIssue.clear();
    nextLeaseToken = 1;
}
