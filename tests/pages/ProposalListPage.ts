import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { CommercialBasePage } from './CommercialBasePage';

/**
 * Page object for the commercial Proposal list screen (`/proposals`).
 *
 * Extends {@link CommercialBasePage} to reuse the shared table-filter helpers
 * (`applyFilter`, `clearFilters`, `expectRowCount`, `expectRowVisible`, …) and
 * adds proposal-specific selectors and actions consumed by the commercial spec
 * (`tests/comercial.spec.ts`).
 *
 * Selector strategy follows the same convention documented on
 * {@link CommercialBasePage}: primary selectors target stable `data-testid`
 * hooks exposed by `ProposalList.tsx`; each getter falls back to a
 * role/text/CSS selector so the page object already works against the current
 * Card-based UI before/without the test-id hooks.
 *
 * Status labels referenced by `expectStatus` are the ones rendered by the
 * `StatusBadge` config in `ProposalList.tsx`:
 *   `Rascunho` | `Aberta` | `Assinada` | `Recusada` | `Faturada`.
 */
export class ProposalListPage extends CommercialBasePage {
    constructor(page: Page) {
        super(page);
    }

    // -------------------------------------------------------------------------
    // Selectors
    // -------------------------------------------------------------------------

    /** Primary "Nova" action in the page header (opens the create form). */
    get newProposalButton(): Locator {
        return this.page.locator(
            '[data-testid="new-proposal"], button:has-text("Nova")'
        ).first();
    }

    /**
     * The clickable Card representing the proposal whose reference equals
     * `ref`. Matches the row in either the list or kanban view.
     */
    proposalRow(ref: string): Locator {
        // #render-fix (red-team): o `.or(byRole)` antigo casava DOIS elementos aninhados (o
        // div[data-testid="proposal-row"] E o Card role="button" DENTRO dele) → strict-mode
        // violation ("resolved to 2 elements"). O DOM real sempre emite data-testid="proposal-row"
        // com data-ref, então o byTestId sozinho já identifica a linha (1 elemento). O 3º seletor
        // cobre a variante em tabela. `.first()` mantém a robustez.
        return this.page.locator(
            `[data-testid="proposal-row"][data-ref="${ref}"], ` +
            `[data-testid="proposal-row"]:has(span:text-is("${ref}")), ` +
            `[data-testid="table-row"]:has-text("${ref}")`
        ).first();
    }

    /**
     * The status badge rendered inside the row identified by `ref`.
     * `StatusBadge` renders as `<span class="inline-flex … rounded-full …">`.
     */
    statusBadge(ref: string): Locator {
        return this.proposalRow(ref).locator(
            '[data-testid="status-badge"], span.inline-flex.rounded-full'
        ).first();
    }

    /**
     * The "Criar Pedido" (convert to order) action for the proposal identified
     * by `ref`. In the current UI this button lives in the detail panel action
     * bar shown for signed proposals; it is returned regardless of whether the
     * detail panel is currently open (the {@link convertToOrder} method takes
     * care of opening the detail first).
     */
    convertToOrderButton(ref: string): Locator {
        return this.page.locator(
            `[data-testid="convert-to-order"][data-ref="${ref}"], ` +
            `[data-testid="convert-to-order"]:has-text("Criar Pedido"), ` +
            `button:has-text("Criar Pedido")`
        ).first();
    }

    // -------------------------------------------------------------------------
    // Private form helpers (used by createForCustomer)
    // -------------------------------------------------------------------------

    /** Trigger div of the customer `SearchableSelect` (placeholder text). */
    private get customerSelectTrigger(): Locator {
        return this.page
            .locator('div:has-text("Selecione o Cliente...")')
            .first();
    }

    /** Selectable option of the customer dropdown matching `customerId`. */
    private customerOption(customerId: string): Locator {
        return this.page
            .locator(`[data-value="${customerId}"]`)
            .first();
    }

    /** Submit button of the create/edit form ("Criar Proposta" / "Salvar Alterações"). */
    private get formSubmitButton(): Locator {
        return this.page.locator(
            'button[type="submit"]:has-text("Criar Proposta"), ' +
            'button[type="submit"]:has-text("Salvar Alterações")'
        ).first();
    }

    // -------------------------------------------------------------------------
    // Methods
    // -------------------------------------------------------------------------

    /** Navigate to the proposals list and wait for it to settle. */
    async goto(): Promise<void> {
        await this.page.goto('/proposals');
        await this.page.waitForLoadState('networkidle');
    }

    /**
     * Open the "Nova proposta" form, pick the customer identified by
     * `customerId` and submit, returning to the list once it reloads.
     *
     * NOTE: requires the customer `SearchableSelect` to expose
     * `data-value={id}` on its options (added alongside this page object).
     */
    async createForCustomer(customerId: string): Promise<void> {
        await this.newProposalButton.click();
        await this.customerSelectTrigger.click();
        await this.customerOption(customerId).click();
        await this.formSubmitButton.click();
        await this.page.waitForLoadState('networkidle');
    }

    /** Assert a proposal with reference `ref` is visible in the list. */
    async expectProposalInList(ref: string): Promise<void> {
        await expect(this.proposalRow(ref)).toBeVisible();
    }

    /**
     * Assert the status badge of the proposal identified by `ref` shows the
     * given `status` label (e.g. "Aberta", "Assinada").
     */
    async expectStatus(ref: string, status: string): Promise<void> {
        await expect(this.statusBadge(ref)).toContainText(status);
    }

    /**
     * Open the proposal identified by `ref`, click "Criar Pedido" and confirm
     * the conversion. The confirm step is best-effort: it clicks the dialog's
     * confirm button only if a confirmation dialog appears (today the screen
     * converts directly, but this keeps the helper forward-compatible).
     */
    async convertToOrder(ref: string): Promise<void> {
        await this.proposalRow(ref).click();
        await this.convertToOrderButton(ref).click();

        const confirmButton = this.page.locator(
            '[role="dialog"] button:has-text("Confirmar"), ' +
            '[role="dialog"] button:has-text("Sim"), ' +
            '[role="dialog"] button.bg-indigo-600, ' +
            '[role="dialog"] button.bg-rose-600'
        ).first();
        try {
            await confirmButton.waitFor({ state: 'visible', timeout: 1500 });
            await confirmButton.click();
        } catch {
            // No confirmation dialog present — conversion proceeded directly.
        }

        await this.page.waitForLoadState('networkidle');
    }
}
