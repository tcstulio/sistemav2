import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { CommercialBasePage } from './CommercialBasePage';

/**
 * Escapa metacaracteres de regex para que `ref` seja casado de forma LITERAL.
 * Necessário porque refs podem (em tese) conter caracteres como `.`, `(`, `*`;
 * sem escape, eles seriam interpretados como regex e causariam matches falsos.
 * Espelhado de `OrderListPage.ts` para manter o mesmo contrato de precisão.
 */
function escapeForRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Converte um texto formatado em BRL (`R$ 2.390,50`) para número (`2390.5`).
 *
 * O `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })` usado
 * por `formatCurrency` produz `R$` seguido de **narrow no-break space** (U+202F)
 * em Node/ICU moderno, ou **no-break space** (U+00A0) em runtimes mais antigos.
 * Este parser tolera ambos (e whitespace comum), remove o separador de milhares
 * (`.`) e troca o separador decimal (`,`) pelo ponto anglo-saxão antes de
 * `parseFloat`. Retorna `0` para texto vazio/inválido — coerção segura que evita
 * `NaN` propagar para somatórios (#1581 adota o mesmo princípio numérico).
 */
function parseCurrencyBRL(raw: string | null | undefined): number {
    if (!raw) return 0;
    const cleaned = raw
        .replace(/R\$/g, '')
        // U+00A0 = no-break space, U+202F = narrow no-break space (ICU pt-BR currency).
        .replace(/[\s\u00A0\u202F\u2009]/g, '')
        .trim();
    if (cleaned === '' || cleaned === '-') return 0;
    // pt-BR: "." agrupa milhares, "," é o decimal. Normaliza para o formato EN.
    const normalized = cleaned.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(normalized);
    return Number.isFinite(n) ? n : 0;
}

/**
 * Page object para a tela de listagem de Faturas (`/invoices`).
 *
 * Estende {@link CommercialBasePage} para herdar os helpers compartilhados de
 * "tabela + filtros" (`applyFilter`, `clearFilters`, `expectRowCount`,
 * `expectRowVisible`, …) e adiciona seletores/métodos específicos de faturas
 * consumidos pela suite comercial (`tests/comercial.spec.ts`,
 * `tests/render/invoices.render.spec.ts`).
 *
 * Estratégia de seletores (mesma convenção documentada em
 * {@link CommercialBasePage}):
 *  - Primários: ganchos estáveis `data-testid` que `InvoiceList.tsx` expõe
 *    (`invoice-row`, `invoice-ref`, `invoice-amount`, `list-total-value`…).
 *  - Fallback: seletores de role/CSS/classe que casam com o **UI atual baseado
 *    em Card** (`ClickTarget` → `<div>`, `ClickTargetPrimary` → `<button>`),
 *    de modo que o page object já funciona hoje, antes da adoção dos test-ids.
 *
 * DOM mapping (ver `src/components/InvoiceList.tsx`):
 *  - Cada fatura é renderizada como um `ClickTarget` (`<div class="group
 *    relative bg-white… border rounded-xl">`) cujo `ClickTargetPrimary`
 *    (`<button class="font-mono text-xs text-slate-400…">`) carrega o `ref`
 *    como text node (precedido de `<FileText/>`). A âncora de texto usa regex
 *    ancorada (`^\s*REF\s*$`) para casar o ref de forma EXATA — evitando
 *    colisão de prefixo (`FA2601-0001` vs `FA2601-00011`).
 *  - O valor da fatura é o último `<span class="font-bold text-slate-800
 *    dark:text-white">` do card → `formatCurrency(total_ttc)`.
 *  - O total da lista é o `ListTotalBar` → `<span data-testid="list-total-value">`
 *    que renderiza `formatCurrency(Σ paginatedInvoices.total_ttc)`.
 *  - Os filtros de status/intervalo são expostos via `<form data-testid="filter-form">`
 *    com `select[name="status"]` / `input[name="date_from"]` / `input[name="date_to"]`
 *    (contrato forward-compatible; o `applyFilter` herdado resolved por `name`).
 */
export class InvoiceListPage extends CommercialBasePage {
    constructor(page: Page) {
        super(page);
    }

    // -------------------------------------------------------------------------
    // Selectors
    // -------------------------------------------------------------------------

    /**
     * `<select name="status">` dentro do formulário de filtros. Usado por
     * {@link filterByStatus} via `applyFilter('status', …)`. O `option value`
     * esperado é um de: `'paid' | 'unpaid' | 'draft'` (mesmo vocabulário do
     * `filterStatus` do `InvoiceList.tsx`).
     */
    get statusFilter(): Locator {
        return this.filterSelect('status');
    }

    /** `input[name="date_from"]` (início do intervalo) dentro do filter form. */
    get dateFromFilter(): Locator {
        return this.filterInput('date_from');
    }

    /** `input[name="date_to"]` (fim do intervalo) dentro do filter form. */
    get dateToFilter(): Locator {
        return this.filterInput('date_to');
    }

    /**
     * Linha/card que representa a fatura cuja referência é `ref`.
     *
     * Estratégia (precisa, livre de colisão de prefixo — idêntica à do
     * `OrderListPage.orderRow`):
     *  1. Preferência: ganchos `data-testid` com `data-ref` exato.
     *  2. Caso contrário, localiza o nó de texto do ref — um `button.font-mono`
     *     (UI em Card), `span.font-mono`/`td`/`[data-testid="invoice-ref"]`
     *     (layouts futuros) — cujo text content IGUALE `ref` (regex ancorada,
     *     tolerando whitespace do JSX), e fica só com a linha que O CONTÉM.
     *     Ancorar no próprio nó de texto do ref faz `FA2601-0001` nunca casar
     *     com `FA2601-00011`.
     */
    invoiceRow(ref: string): Locator {
        const exactRef = new RegExp(`^\\s*${escapeForRegex(ref)}\\s*$`);
        const refText = this.page
            .locator(
                'button.font-mono, span.font-mono, td, [data-testid="invoice-ref"]'
            )
            .filter({ hasText: exactRef });

        return this.page
            .locator(
                [
                    `[data-testid="invoice-row"][data-ref="${ref}"]`,
                    `[data-testid="invoices-list"] [role="button"]`,
                    // UI atual: cada fatura é um ClickTarget (<div.group.relative…>).
                    `.grid.grid-cols-1.gap-3 .group.relative`,
                    `[data-testid="table-row"]`,
                    `table tbody tr`,
                ].join(', ')
            )
            .filter({ has: refText })
            .first();
    }

    /**
     * Coluna de valor (por linha): todos os `<span>` que renderizam
     * `formatCurrency(inv.total_ttc)` dentro dos cards de fatura. Em UI futuro
     * baseado em tabela, casa a última `<td>` de cada linha. Usado por
     * {@link getTotalAmount} para somar a coluna diretamente do DOM.
     */
    get amountColumn(): Locator {
        return this.page.locator(
            [
                '[data-testid="invoice-amount"]',
                // Card atual: <span class="font-bold text-slate-800 dark:text-white">.
                // `text-slate-800` (não `text-slate-900` do detalhe) desambigua.
                '.grid.grid-cols-1.gap-3 .group.relative span.font-bold.text-slate-800',
                'table tbody tr td:last-of-type',
            ].join(', ')
        );
    }

    /**
     * Célula de total geral exibida pelo `ListTotalBar`
     * (`<span data-testid="list-total-value">`). Forward-compatible com um
     * `<tfoot>` futuro. Expõe o valor já calculado pelo app — útil para
     * asserções de exibição complementares à soma calculada por
     * {@link getTotalAmount}.
     */
    get totalAmountCell(): Locator {
        return this.page.locator(
            '[data-testid="list-total-value"], tfoot td.font-bold.text-emerald-600'
        ).first();
    }

    // -------------------------------------------------------------------------
    // Métodos
    // -------------------------------------------------------------------------

    /**
     * Navega para `/invoices` e aguarda o marker determinístico de "tela
     * montada" (o `<h1>` do `PageHeader`, valor "Faturas"). Prefira isso a
     * `waitForLoadState('networkidle')` — este app faz polling (React Query
     * refetch / heartbeats), então a rede raramente fica idle e o `networkidle`
     * vira fonte de flakiness (mesma decisão de `OrderListPage.goto`).
     */
    async goto(): Promise<void> {
        await this.page.goto('/invoices', { waitUntil: 'domcontentloaded' });
        await expect(
            this.page.getByRole('heading', { name: 'Faturas', level: 1 })
        ).toBeVisible({ timeout: 15000 });
    }

    /**
     * Seleciona o `status` no filtro e aplica o formulário. Delega ao
     * `applyFilter('status', …)` herdado, que resolve o `<select name="status">`
     * dentro do filter form, submete e aguarda a rede estabilizar.
     *
     * @param status Um de `'paid' | 'unpaid' | 'draft'` (vocabulário espelhado
     *   ao `filterStatus` do `InvoiceList.tsx`: paid=statut 2, unpaid=statut 1,
     *   draft=statut 0).
     */
    async filterByStatus(status: 'paid' | 'unpaid' | 'draft'): Promise<void> {
        await this.applyFilter('status', status);
    }

    /**
     * Preenche `date_from` e `date_to` e aplica o intervalo de datas. Cada
     * chamada a `applyFilter` preenche UM campo e submete — o formulário retém
     * o valor anterior, então a segunda submissão aplica ambos os limites.
     *
     * @param from Data de início em `YYYY-MM-DD` (formato `input[type=date]`).
     * @param to   Data de fim em `YYYY-MM-DD`.
     */
    async filterByDateRange(from: string, to: string): Promise<void> {
        await this.applyFilter('date_from', from);
        await this.applyFilter('date_to', to);
    }

    /**
     * Afirma que uma fatura com referência `ref` está presente (visível) na
     * listagem. Usa `expect(…).toBeVisible` (auto-retry do Playwright) para
     * tolerar o flicker de skeleton/loading antes da linha estabilizar.
     */
    async expectInvoiceInList(ref: string): Promise<void> {
        await expect(this.invoiceRow(ref)).toBeVisible({ timeout: 15000 });
    }

    /**
     * Soma a coluna de valores (por linha) diretamente do DOM e retorna o
     * total como número. Lê cada célula de {@link amountColumn}, faz o parse
     * BRL→número via `parseCurrencyBRL` e acumula.
     *
     * Oráculo: o resultado deve igualar o `totalAmountCell` exibido pelo app
     * (ambos somam `total_ttc` das faturas da página corrente). Use um ou
     * outro em asserções conforme a conveniência — este método é a fonte de
     * verdade calculada (independe do `ListTotalBar` existir), enquanto o
     * `totalAmountCell` valida a saída renderizada.
     */
    async getTotalAmount(): Promise<number> {
        const count = await this.amountColumn.count();
        let sum = 0;
        for (let i = 0; i < count; i++) {
            const text = await this.amountColumn.nth(i).textContent();
            sum += parseCurrencyBRL(text);
        }
        return sum;
    }
}
