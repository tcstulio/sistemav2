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
 * Accessible name da aba *Faturas* do painel de detalhe. Em `OrderDetail`
 * (`src/components/OrderList.tsx`) o rótulo é renderizado como `Faturas ({N})`,
 * onde `N` é o número de faturas do pedido. A regex ancorada (`^...$`) e o
 * grupo `(\d+)` distinguem-na do item de navegação "Faturas" da sidebar (sem
 * contagem) e de qualquer rótulo maior que por acaso contenha a palavra.
 * Usado como `name` de `getByRole('button', ...)` (cada `Tab` é um `<button>`).
 */
const INVOICES_TAB_NAME = /^Faturas \(\d+\)$/;

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
     * The "Gerar Fatura" action button that converts the order identified by
     * `ref` into an invoice. Lives in the detail panel's *Faturas* tab and is
     * only rendered for non-draft orders (`statut !== '0'`) with no existing
     * invoice.
     *
     * The `ref` is honoured actively: the button is scoped to the detail panel
     * whose `<h1>` carries `ref` (see {@link detailPanel}). So even if the UI
     * ever evolves to mount more than one detail at a time, we always click the
     * button belonging to THIS order — never a neighbouring panel's. Prefer
     * {@link convertToInvoice}, which also opens the order and switches to the
     * *Faturas* tab before the button is rendered.
     */
    convertToInvoiceButton(ref: string): Locator {
        return this.detailPanel(ref)
            .locator('[data-testid="convert-to-invoice"], button:has-text("Gerar Fatura")')
            .first();
    }

    // -------------------------------------------------------------------------
    // Actions
    // -------------------------------------------------------------------------

    /** Navigate to the orders list and wait for the screen shell to mount. */
    async goto(): Promise<void> {
        await this.page.goto('/orders', { waitUntil: 'domcontentloaded' });
        // Deterministic "screen mounted" marker: the list PageHeader's <h1>.
        // Preferred over `waitForLoadState('networkidle')` — this app polls
        // (React Query refetches, notification/session heartbeats), so the
        // network rarely goes idle and `networkidle` becomes a flakiness/timeout
        // source. Row presence is `expectOrderInList`'s job (own auto-wait).
        await expect(
            this.page.getByRole('heading', { name: 'Pedidos de Venda' })
        ).toBeVisible({ timeout: 15000 });
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
        await this.detailPanel(ref).getByRole('button', { name: INVOICES_TAB_NAME }).click();

        // O clique É a confirmação da conversão no fluxo atual; o efeito
        // observável (toast "Fatura criada com sucesso") é assertado pelo caller.
        await this.convertToInvoiceButton(ref).click();
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    /**
     * The detail panel container (the MasterDetailLayout detail slot) scoped to
     * the order identified by `ref`. Used as the resolution scope for in-detail
     * controls — the *Faturas* tab and the *Gerar Fatura* button — so they
     * never bleed into the list or the sidebar.
     *
     * Anchor strategy: the detail's `PageHeader` renders an `<h1>` whose text
     * carries `ref` (see {@link detailHeader}). We resolve the panel as the
     * outermost `div` that CONTAINS that heading. In the current UI at most one
     * detail is mounted at a time, so the `<h1>` anchor is unambiguous; the
     * downstream locators themselves (anchored tab label
     * {@link INVOICES_TAB_NAME}, exact button text "Gerar Fatura") are unique
     * to the detail, which keeps the scope robust even if the wrapping `div`
     * ever nests deeper or the MasterDetailLayout classes change.
     */
    protected detailPanel(ref: string): Locator {
        return this.page
            .locator('div')
            .filter({ has: this.detailHeader(ref) })
            .last();
    }

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
