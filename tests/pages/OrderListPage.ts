import type { Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { CommercialBasePage } from './CommercialBasePage';

/**
 * Page object for the OrderList screen (`/orders` — "Pedidos de Venda").
 *
 * Concrete page object for the sales-order list. Inherits the shared
 * table-filter helpers from {@link CommercialBasePage} and adds order-specific
 * selectors/actions consumed by the commercial E2E suite (`comercial.spec.ts`).
 *
 * DOM mapping (see `src/components/OrderList.tsx`):
 *  - Each order is rendered as a clickable `Card` → `<div role="button">`
 *    whose text contains the order `ref`. Selectors prefer stable
 *    `data-testid` hooks (`order-row`/`order-card` + `data-ref`) but fall back
 *    to the card grid so the page object works against the current UI even
 *    before test-ids are introduced.
 *  - The status badge is a `StatusBadge` `<span class="rounded-full …">`.
 *  - "Convert to invoice" lives in the detail panel's *Faturas* tab as the
 *    "Gerar Fatura" button (only for non-draft orders, i.e. `statut !== '0'`).
 */
export class OrderListPage extends CommercialBasePage {
    // -------------------------------------------------------------------------
    // Selectors
    // -------------------------------------------------------------------------

    /**
     * The list row/card that represents the order with the given `ref`.
     * Matches the clickable card by text content; resilient to wrapper changes.
     */
    orderRow(ref: string): Locator {
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
            .filter({ hasText: ref })
            .first();
    }

    /**
     * The status badge rendered inside {@link orderRow}.
     * `StatusBadge` always applies `rounded-full`, which disambiguates it from
     * the sibling `ref` span inside the card header.
     */
    statusBadge(ref: string): Locator {
        return this.orderRow(ref)
            .locator('[data-testid="status-badge"], span.rounded-full')
            .first();
    }

    /**
     * The "Gerar Fatura" action button that converts the currently-open order
     * into an invoice. Lives in the detail panel's *Faturas* tab and is only
     * rendered for non-draft orders (`statut !== '0'`) with no existing
     * invoice. Call {@link convertToInvoice} to open the order first.
     */
    convertToInvoiceButton(ref: string): Locator {
        return this.page
            .locator(
                [
                    `[data-testid="convert-to-invoice"][data-ref="${ref}"]`,
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
     */
    async convertToInvoice(ref: string): Promise<void> {
        await this.expectOrderInList(ref);
        await this.orderRow(ref).click();

        // The Faturas tab label carries a count ("Faturas (0)") which avoids
        // colliding with the sidebar "Faturas" nav item.
        const invoicesTab = this.page
            .getByRole('button', { name: /Faturas\s*\(\d+\)/ })
            .first();
        await invoicesTab.click();

        await this.convertToInvoiceButton(ref).click();
        await this.page.waitForLoadState('networkidle');
    }
}
