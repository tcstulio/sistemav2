import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

interface TaskStatusTarget {
    id: 'todo' | 'in_progress' | 'done';
    label: 'To Do' | 'In Progress' | 'Done';
}

const resolveTaskStatus = (status: string): TaskStatusTarget => {
    const normalized = status.trim().toLowerCase().replace(/[\s_-]+/g, '');

    if (['todo', 'afazer', 'pendente'].includes(normalized)) {
        return { id: 'todo', label: 'To Do' };
    }
    if (['inprogress', 'emandamento', 'andamento'].includes(normalized)) {
        return { id: 'in_progress', label: 'In Progress' };
    }
    if (['done', 'concluido', 'concluida'].includes(normalized)) {
        return { id: 'done', label: 'Done' };
    }

    throw new Error(`Status de tarefa desconhecido: ${status}`);
};

export class ProjectDetailPage {
    protected readonly page: Page;

    constructor(page: Page) {
        this.page = page;
    }

    get taskList(): Locator {
        return this.page.locator('[data-testid="task-list"]').first();
    }

    /**
     * Título do projeto renderizado pelo `PageHeader` da `ProjectList.tsx`
     * (`<span data-testid="project-title">`). Exposto como locator REUTILIZÁVEL
     * conforme exigido pela issue (não apenas dentro de `expectLoaded`) —
     * permite asserts diretos como `await expect(detail.projectTitle).toHaveText(name)`.
     */
    get projectTitle(): Locator {
        return this.page.locator('[data-testid="project-title"]').first();
    }

    get tasksTabButton(): Locator {
        return this.page.getByRole('button', { name: /^Tarefas \(\d+\)$/ });
    }

    taskItem(title: string): Locator {
        return this.page
            .locator('[data-testid="task-item"]')
            .filter({ has: this.page.getByRole('heading', { name: title, exact: true }) })
            .first();
    }

    taskStatus(title: string): Locator {
        return this.taskItem(title).locator('[data-testid="task-status"]').first();
    }

    get addTaskButton(): Locator {
        return this.page.locator('[data-testid="add-task-button"]').first();
    }

    taskActionsMenu(title: string): Locator {
        return this.taskItem(title).locator('[data-testid="task-actions-menu"]').first();
    }

    async expectLoaded(name: string): Promise<void> {
        await expect(this.projectTitle).toBeVisible({ timeout: 15000 });
        await expect(this.projectTitle).toHaveText(name, { timeout: 15000 });
    }

    async expectTaskVisible(title: string): Promise<void> {
        await this.openTasksTab();
        await expect(this.taskItem(title)).toBeVisible({ timeout: 15000 });
    }

    async addTask(title: string, description: string): Promise<void> {
        await this.openTasksTab();
        await this.addTaskButton.click();
        await expect(this.page.getByRole('heading', { name: 'Nova Tarefa' })).toBeVisible();
        await this.page.locator('[data-testid="task-title-input"]').fill(title);
        await this.page.locator('[data-testid="task-description-input"]').fill(description);
        await this.page.locator('[data-testid="task-submit-button"]').click();
        await this.expectTaskVisible(title);
    }

    async openTask(title: string): Promise<void> {
        await this.openTasksTab();
        await this.taskItem(title).click();
    }

    async moveTaskTo(title: string, newStatus: string): Promise<void> {
        const target = resolveTaskStatus(newStatus);
        await this.expectTaskVisible(title);
        await this.taskActionsMenu(title).click();
        await this.page.locator(`[data-task-status-target="${target.id}"]`).click();
        await expect(this.taskStatus(title)).toHaveText(target.label, { timeout: 15000 });
    }

    private async openTasksTab(): Promise<void> {
        if (!(await this.addTaskButton.isVisible().catch(() => false))) {
            await this.tasksTabButton.click();
        }
        await expect(this.addTaskButton).toBeVisible({ timeout: 15000 });
    }
}
