import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Base page object for the commercial flows (proposals, orders, invoices).
 *
 * Provides reusable selectors and helpers for tables-with-filters UIs used by the
 * ProposalList, OrderList and InvoiceList screens. Concrete page objects
 * (ProposalListPage, OrderListPage, InvoiceListPage) should extend this class
 * to inherit the table-filter helpers without re-implementing them.
 *
 * Conventions:
 *  - Primary selectors target stable `data-testid` hooks that the corresponding
 *    list screens expose (e.g. `data-testid="filter-form"`, `data-testid="table-row"`).
 *  - Each getter falls back to a role/text/CSS selector so the base works even
 *    when a screen has not yet adopted the test-id convention — child pages can
 *    override any getter to narrow the scope.
 *  - Methods use Playwright's `expect` (auto-wait + retry) and explicit `Locator`
 *    signatures so failures carry actionable messages.
 */
export class CommercialBasePage {
    protected readonly page: Page;

    constructor(page: Page) {
        this.page = page;
    }

    // -------------------------------------------------------------------------
    // Selectors — overridable in subclasses to narrow scope per screen.
    // -------------------------------------------------------------------------

    /** Root of the commercial filter form (input, selects, apply/clear actions). */
    get filterForm(): Locator {
        return this.page.locator(
            '[data-testid="filter-form"], [data-testid="commercial-filters"], form[aria-label*="filter" i]'
        ).first();
    }

    /** Input inside {@link filterForm} identified by its `name` attribute. */
    filterInput(name: string): Locator {
        return this.filterForm.locator(`input[name="${name}"]`);
    }

    /** `<select>` inside {@link filterForm} identified by its `name` attribute. */
    filterSelect(name: string): Locator {
        return this.filterForm.locator(`select[name="${name}"]`);
    }

    /** Button that submits the current filter values. */
    get applyFilterButton(): Locator {
        return this.filterForm.locator(
            '[data-testid="apply-filter"], button[type="submit"]'
        ).first();
    }

    /** Button that clears the active filters and reloads the unfiltered list. */
    get clearFiltersButton(): Locator {
        return this.page.locator(
            '[data-testid="clear-filters"], button:has-text("Limpar"), button:has-text("Limpar filtros")'
        ).first();
    }

    /** All rows of the commercial table (data + skeleton/loading rows). */
    get tableRows(): Locator {
        // #render-fix (red-team): as telas comerciais (Propostas/Pedidos) renderizam LINHAS-CARD
        // (data-testid="proposal-row"/"order-row"), não <table>. O `cell/expectRowVisible` herdado só
        // olhava tabela → 0 elementos. Inclui os testids das linhas-Card mantendo o suporte a tabela.
        return this.page.locator(
            '[data-testid="table-row"], [data-testid="proposal-row"], [data-testid="order-row"], table tbody tr'
        );
    }

    /** First row of {@link tableRows} that contains the given text in any cell. */
    cell(text: string): Locator {
        return this.tableRows.filter({ hasText: text }).first();
    }

    // -------------------------------------------------------------------------
    // Methods — the public API consumed by concrete page objects and specs.
    // -------------------------------------------------------------------------

    /**
     * Fill the named filter field (input OR select) and submit the filter form.
     * Waits for the resulting network to settle so the caller can read the
     * updated table on the next line.
     *
     * @param name  `name` attribute of the input/select inside {@link filterForm}.
     * @param value Value to type (input) or select (option's value/label).
     */
    async applyFilter(name: string, value: string): Promise<void> {
        const input = this.filterInput(name);
        const select = this.filterSelect(name);

        const inputCount = await input.count();
        const selectCount = await select.count();

        if (inputCount > 0) {
            await input.fill(value);
        } else if (selectCount > 0) {
            await select.selectOption(value);
        } else {
            throw new Error(
                `CommercialBasePage.applyFilter: no input[name="${name}"] or select[name="${name}"] found inside the filter form.`
            );
        }

        await this.applyFilterButton.click();
        await this.page.waitForLoadState('networkidle');
    }

    /** Click the clear-filters button and wait for the list to reload. */
    async clearFilters(): Promise<void> {
        await this.clearFiltersButton.click();
        await this.page.waitForLoadState('networkidle');
    }

    /**
     * Assert that exactly `n` rows are visible in the commercial table.
     * Uses Playwright's auto-retrying `expect.toHaveCount` so it tolerates
     * loading/skeleton flicker before the final row count stabilises.
     */
    async expectRowCount(n: number): Promise<void> {
        await expect(this.tableRows).toHaveCount(n);
    }

    /**
     * Assert that there is at least one visible row containing `text` in any cell.
     * Matches against the entire row text (cell content concatenated), which is
     * what callers usually want from "row containing X".
     */
    async expectRowVisible(text: string): Promise<void> {
        await expect(this.cell(text)).toBeVisible();
    }
}