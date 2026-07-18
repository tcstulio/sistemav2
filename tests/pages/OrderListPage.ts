import type { Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { CommercialBasePage } from './CommercialBasePage';

/**
 * Escapa metacaracteres de regex para que `ref` seja casado de forma LITERAL.
 * Necessário porque refs podem (em tese) conter caracteres como `.`, `(`, `*`;
 * sem escape, eles seriam interpretados como regex e causariam matches falsos.
 */
function escapeForRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Page object for the OrderList screen (`/orders` — "Pedidos de Venda").
 *
 * Concrete page object for the sales-order list. Inherits the shared
 * table-filter helpers from {@link CommercialBasePage} and adds order-specific
 * selectors/actions consumed by the commercial E2E suite (`comercial.spec.ts`).
 *
 * DOM mapping (see `src/components/OrderList.tsx`):
 *  - Each order in the list is rendered as a clickable `Card` → `<div role="button">`
 *    (see `src/components/ui/Card.tsx`). Inside its header, the `ref` lives in a
 *    `<span className="font-mono text-xs text-slate-400">{ord.ref}</span>` whose
 *    text content is EXACTLY the ref — this is the anchor used for precise
 *    matching (no prefix collisions, e.g. `PV2601-0001` vs `PV2601-00011`).
 *  - The status badge is a `StatusBadge` (`src/components/ui/StatusBadge.tsx`)
 *    rendered as `<span class="… rounded-full … border …">{icon}{label}</span>`.
 *    Inside a list card it is the ONLY `span.rounded-full.border`, which makes
 *    the fallback selector unambiguous once scoped to the row.
 *  - "Gerar Fatura" lives in the detail panel's *Faturas* tab (inside the
 *    `EmptyState` action) and is rendered only for non-draft orders
 *    (`statut !== '0'`) with no existing invoice. The detail panel's `PageHeader`
 *    renders `<h1>{order.ref}<StatusBadge/></h1>`, so the open order's ref is
 *    verifiable via that heading — used as a guard in {@link convertToInvoice}.
 */
export class OrderListPage extends CommercialBasePage {
    // -------------------------------------------------------------------------
    // Selectors
    // -------------------------------------------------------------------------

    /**
     * The list row/card that represents the order with the given `ref`.
     *
     * Matching strategy (precise, prefix-collision free):
     *  1. Prefer stable `data-testid` hooks carrying `data-ref` (exact attr).
     *  2. Otherwise, locate the ref text node — a `span.font-mono` (Card UI) or
     *     a `td` (table UI) — whose FULL text content equals `ref` (anchored
     *     regex), then keep only the row/card that CONTAINS it. Anchoring on the
     *     ref's own text node means `PV2601-0001` never matches `PV2601-00011`.
     */
    orderRow(ref: string): Locator {
        const exactRef = new RegExp(`^${escapeForRegex(ref)}$`);
        const refText = this.page
            .locator('span.font-mono, td, [data-testid="order-ref"]')
            .filter({ hasText: exactRef });

        return this.page
            .locator(
                [
                    `[data-testid="order-row"][data-ref="${ref}"]`,
                    `[data-testid="order-card"][data-ref="${ref}"]`,
                    `[data-testid="orders-list"] [role="button"]`,
                    `.grid.grid-cols-1.gap-3 [role="button"]`,
                    `[data-testid="table-row"]`,
                    `table tbody tr`,
                ].join(', ')
            )
            .filter({ has: refText })
            .first();
    }

    /**
     * The status badge rendered inside {@link orderRow} for the given `ref`.
     *
     * Scoped to the (already precise) {@link orderRow}, so even though several
     * badges may exist on the page, only the one inside THIS order's card is
     * considered. The `StatusBadge` always carries both `rounded-full` and
     * `border` classes, which disambiguates it from the sibling `.font-mono`
     * ref span (no rounding/border) and from any non-badge rounded element.
     */
    statusBadge(ref: string): Locator {
        return this.orderRow(ref)
            .locator('[data-testid="status-badge"], span.rounded-full.border')
            .first();
    }

    /**
     * The "Gerar Fatura" action button that converts the currently-open order
     * into an invoice. Lives in the detail panel's *Faturas* tab and is only
     * rendered for non-draft orders (`statut !== '0'`) with no existing invoice.
     *
     * Note on `ref`: the UI renders a single detail panel at a time
     * (`MasterDetailLayout` mounts at most one detail), so this button is
     * unique on the page. The `ref` is enforced by the caller via a header
     * guard — see {@link convertToInvoice}, which asserts the open detail's
     * `<h1>` carries `ref` before clicking. Call {@link convertToInvoice}
     * rather than invoking this locator directly.
     */
    convertToInvoiceButton(ref: string): Locator {
        void ref;
        return this.page
            .locator(
                [
                    `[data-testid="convert-to-invoice"]`,
                    `button:has-text("Gerar Fatura")`,
                ].join(', ')
            )
            .first();
    }

    // -------------------------------------------------------------------------
    // Actions
    // -------------------------------------------------------------------------

    /** Navigate to the orders list and wait for the list to settle. */
    async goto(): Promise<void> {
        await this.page.goto('/orders', { waitUntil: 'domcontentloaded' });
        await this.page.waitForLoadState('networkidle');
    }

    /** Assert that an order with `ref` is present (visible) in the list. */
    async expectOrderInList(ref: string): Promise<void> {
        await expect(this.orderRow(ref)).toBeVisible({ timeout: 15000 });
    }

    /**
     * Assert the status badge text of the order identified by `ref`.
     * Pass the displayed Portuguese label, e.g. `Rascunho`, `Validado`,
     * `Em Envio` or `Entregue`.
     */
    async expectStatus(ref: string, status: string): Promise<void> {
        await expect(this.statusBadge(ref)).toHaveText(status, { timeout: 15000 });
    }

    /**
     * Open the order identified by `ref`, switch to its *Faturas* tab and click
     * "Gerar Fatura" — the single action that converts the order into an invoice
     * (the click is itself the confirmation in the current UI). Waits for the
     * resulting request to settle before returning.
     *
     * The `ref` is used twice, actively: first to click the precise card
     * ({@link orderRow}, exact match), then to GUARD that the detail panel that
     * opened is truly the one for this order (its `<h1>` header carries `ref`).
     * The guard is what makes the per-order isolation explicit and catches any
     * race where the wrong detail slides in.
     */
    async convertToInvoice(ref: string): Promise<void> {
        await this.expectOrderInList(ref);
        await this.orderRow(ref).click();

        // Guard: o <h1> do PageHeader do detalhe expõe o ref do pedido aberto.
        await expect(this.detailHeader(ref)).toBeVisible({ timeout: 10000 });

        // A aba "Faturas (N)" só existe no painel de detalhe; o `(N)` a distingue
        // do item de navegação "Faturas" da sidebar. Âncoras (^...$) evitam
        // casar um rótulo maior que por acaso contenha "Faturas (1) ...".
        const invoicesTab = this.page
            .getByRole('button', { name: /^Faturas\s*\(\d+\)$/ })
            .first();
        await invoicesTab.click();

        await this.convertToInvoiceButton(ref).click();
        await this.page.waitForLoadState('networkidle');
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    /**
     * The detail panel's `<h1>` heading, which contains the open order's `ref`
     * as a text node (followed by the `StatusBadge`). Used to guard
     * {@link convertToInvoice}. Substring match is safe here because at most one
     * detail is mounted, so only one order's ref can appear in an `<h1>`.
     */
    protected detailHeader(ref: string): Locator {
        return this.page
            .getByRole('heading', { level: 1 })
            .filter({ hasText: escapeForRegex(ref) });
    }
}
