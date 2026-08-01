import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const projectFilterLabels: Record<string, string> = {
    all: 'Todos',
    todos: 'Todos',
    open: 'Abertos',
    aberto: 'Abertos',
    abertos: 'Abertos',
    draft: 'Rascunhos',
    rascunho: 'Rascunhos',
    rascunhos: 'Rascunhos',
    closed: 'Fechados',
    fechado: 'Fechados',
    fechados: 'Fechados',
};

export class ProjectListPage {
    protected readonly page: Page;

    constructor(page: Page) {
        this.page = page;
    }

    get newProjectButton(): Locator {
        return this.page.getByRole('button', { name: 'Novo', exact: true }).first();
    }

    projectCard(name: string): Locator {
        return this.page.getByRole('button', { name: new RegExp(escapeRegExp(name)) }).first();
    }

    projectStatus(name: string): Locator {
        return this.projectCard(name).getByText(/^(Aberto|Rascunho|Fechado)$/).first();
    }

    get searchInput(): Locator {
        return this.page.getByRole('textbox', { name: 'Buscar...' }).first();
    }

    async goto(): Promise<void> {
        await this.page.goto('/projects', { waitUntil: 'domcontentloaded' });
        await expect(this.page.getByRole('heading', { name: 'Projetos', level: 1 })).toBeVisible({ timeout: 15000 });
    }

    async createForCustomer(customerId: string): Promise<void> {
        await this.newProjectButton.click();
        const dialog = this.page.getByRole('heading', { name: 'Novo Projeto' });
        await expect(dialog).toBeVisible();
        const select = this.page.locator('select#project-customer');
        await expect(select).toBeVisible({ timeout: 15000 });
        const option = select.locator(`option[value="${customerId}"]`);
        if (await option.count() > 0) {
            await select.selectOption(customerId);
        } else {
            const labelMap: Record<string, string> = { '201': 'Cliente Alpha SA', '202': 'Cliente Beta SA' };
            const label = labelMap[customerId];
            if (!label) throw new Error(`Cliente desconhecido: ${customerId}`);
            await select.selectOption({ label });
        }
    }

    async expectProjectVisible(name: string): Promise<void> {
        await expect(this.projectCard(name)).toBeVisible({ timeout: 15000 });
    }

    async openProject(name: string): Promise<void> {
        await this.projectCard(name).click();
        await expect(this.page.getByRole('heading', { name, level: 1 })).toBeVisible({ timeout: 15000 });
    }

    async filterByStatus(status: string): Promise<void> {
        const normalized = status.trim().toLowerCase();
        const label = projectFilterLabels[normalized];
        if (!label) throw new Error(`Status de projeto desconhecido: ${status}`);
        await this.page.getByRole('button', { name: label, exact: true }).click();
    }
}
