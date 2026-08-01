import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { seedAuth } from './render/_harness';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { ProjectListPage } from './pages/ProjectListPage';

interface MockProject {
    id: string;
    ref: string;
    title: string;
    socid: string;
    statut: string;
    progress: number;
    description?: string;
    datec: number;
    tms: number;
}

interface MockTask {
    id: string;
    ref: string;
    label: string;
    project_id: string;
    description: string;
    progress: number;
    status: number;
    planned_workload: number;
    duration_effective: number;
    datec: number;
    tms: number;
}

interface ProjectApiState {
    projects: MockProject[];
    tasks: MockTask[];
    customers: Array<Record<string, unknown>>;
}

const createState = (): ProjectApiState => ({
    projects: [
        {
            id: '901',
            ref: 'PROJ-ALPHA',
            title: 'Projeto Alpha',
            socid: '201',
            statut: '1',
            progress: 25,
            description: 'Projeto principal',
            datec: 1750000000,
            tms: 1750000000,
        },
        {
            id: '902',
            ref: 'PROJ-BETA',
            title: 'Projeto Beta',
            socid: '202',
            statut: '0',
            progress: 0,
            datec: 1750000100,
            tms: 1750000100,
        },
    ],
    tasks: [
        {
            id: '701',
            ref: 'TASK-701',
            label: 'Planejamento',
            project_id: '901',
            description: 'Planejar entregas',
            progress: 0,
            status: 0,
            planned_workload: 7200,
            duration_effective: 0,
            datec: 1750000200,
            tms: 1750000200,
        },
    ],
    customers: [
        { id: '201', name: 'Cliente Alpha SA', code_client: 'CU-201', client: '1', status: '1', fournisseur: '0', tms: 1750000000, datec: 1750000000 },
        { id: '202', name: 'Cliente Beta SA', code_client: 'CU-202', client: '1', status: '1', fournisseur: '0', tms: 1750000000, datec: 1750000000 },
    ],
});

const configureProjectApi = async (page: Page, state: ProjectApiState): Promise<void> => {
    let nextProjectId = 1000;
    let nextTaskId = 800;
    let timestamp = 1750010000;
    const admin = { id: '1', login: 'admin', admin: 1, firstname: 'E2E', lastname: 'Admin', rights: {} };

    await page.route(url => url.pathname.startsWith('/api/'), async route => {
        const request = route.request();
        const url = new URL(request.url());
        const method = request.method();
        const respond = (body: unknown, status = 200) => route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(body),
        });

        if (url.pathname.includes('/custom_sync.php')) {
            const type = url.searchParams.get('type');
            if (type === 'projects') return respond(state.projects);
            if (type === 'tasks') return respond(state.tasks);
            if (type === 'thirdparties') return respond(state.customers);
            if (type === 'users') return respond([admin]);
            return respond([]);
        }

        if (url.pathname.endsWith('/api/dolibarr/projects') && method === 'POST') {
            const payload = request.postDataJSON() as Record<string, unknown>;
            const project: MockProject = {
                id: String(nextProjectId++),
                ref: String(payload.ref),
                title: String(payload.title),
                socid: String(payload.socid),
                statut: '0',
                progress: 0,
                description: payload.description ? String(payload.description) : undefined,
                datec: timestamp,
                tms: timestamp++,
            };
            state.projects.push(project);
            return respond(project, 201);
        }

        if (url.pathname.endsWith('/api/dolibarr/tasks') && method === 'POST') {
            const payload = request.postDataJSON() as Record<string, unknown>;
            const task: MockTask = {
                id: String(nextTaskId++),
                ref: `TASK-${nextTaskId - 1}`,
                label: String(payload.label),
                project_id: String(payload.project_id),
                description: String(payload.description || ''),
                progress: 0,
                status: 0,
                planned_workload: Number(payload.planned_workload || 0),
                duration_effective: 0,
                datec: timestamp,
                tms: timestamp++,
            };
            state.tasks.push(task);
            return respond(task, 201);
        }

        const taskMatch = url.pathname.match(/\/api\/dolibarr\/tasks\/([^/]+)$/);
        if (taskMatch && method === 'PUT') {
            const payload = request.postDataJSON() as Record<string, unknown>;
            const task = state.tasks.find(item => item.id === taskMatch[1]);
            if (!task) return respond({ error: 'Tarefa não encontrada' }, 404);
            Object.assign(task, payload, { tms: timestamp++ });
            return respond(task);
        }

        if (url.pathname.endsWith('/api/dolibarr/users') && method === 'GET') return respond([admin]);
        if (/\/api\/dolibarr\/users\/1$/.test(url.pathname) && method === 'GET') return respond(admin);
        if (url.pathname.includes('/ui-config')) {
            return respond({ companyName: 'CoolGroove', taskAutomation: {}, screenPermissions: { groups: {}, users: {} } });
        }

        return respond([]);
    });
};

const arrange = async (
    page: Page,
    context: BrowserContext,
    state: ProjectApiState = createState(),
): Promise<ProjectApiState> => {
    await seedAuth(context);
    await configureProjectApi(page, state);
    return state;
};

test.describe('Projetos — gestão de projetos e tarefas', () => {
    test('listar projetos: página carrega com cards', async ({ page, context }) => {
        await arrange(page, context);
        const projectList = new ProjectListPage(page);

        await projectList.goto();

        await projectList.expectProjectVisible('Projeto Alpha');
        await projectList.expectProjectVisible('Projeto Beta');
        await expect(projectList.projectStatus('Projeto Alpha')).toContainText('Aberto');
        await expect(projectList.searchInput).toBeVisible();
    });

    test('criar projeto: seleciona cliente, informa título e salva', async ({ page, context }) => {
        await arrange(page, context);
        const projectList = new ProjectListPage(page);
        await projectList.goto();

        await projectList.createForCustomer('201');
        await page.locator('[data-testid="project-title-input"]').fill('Projeto E2E');
        await page.locator('[data-testid="create-project-submit"]').click();

        await projectList.expectProjectVisible('Projeto E2E');
    });

    test('abrir projeto: clique navega para os detalhes', async ({ page, context }) => {
        await arrange(page, context);
        const projectList = new ProjectListPage(page);
        const projectDetail = new ProjectDetailPage(page);
        await projectList.goto();

        await projectList.openProject('Projeto Alpha');

        await projectDetail.expectLoaded('Projeto Alpha');
    });

    test('adicionar tarefa ao projeto: título e descrição aparecem na lista', async ({ page, context }) => {
        const state = await arrange(page, context);
        const projectList = new ProjectListPage(page);
        const projectDetail = new ProjectDetailPage(page);
        await projectList.goto();
        await projectList.openProject('Projeto Alpha');

        await projectDetail.addTask('Implementar integração', 'Integrar o projeto ao ERP');

        await projectDetail.expectTaskVisible('Implementar integração');
        expect(state.tasks.some(task => task.label === 'Implementar integração' && task.description === 'Integrar o projeto ao ERP')).toBe(true);
    });

    test('mover tarefa entre status: To Do para In Progress e Done', async ({ page, context }) => {
        await arrange(page, context);
        const projectList = new ProjectListPage(page);
        const projectDetail = new ProjectDetailPage(page);
        await projectList.goto();
        await projectList.openProject('Projeto Alpha');
        await projectDetail.expectTaskVisible('Planejamento');

        await expect(projectDetail.taskStatus('Planejamento')).toHaveText('To Do');
        await projectDetail.moveTaskTo('Planejamento', 'In Progress');
        await projectDetail.moveTaskTo('Planejamento', 'Done');

        await expect(projectDetail.taskItem('Planejamento')).toHaveAttribute('data-task-status', 'done');
    });

    test('editar tarefa: alteração do título é refletida', async ({ page, context }) => {
        await arrange(page, context);
        const projectList = new ProjectListPage(page);
        const projectDetail = new ProjectDetailPage(page);
        await projectList.goto();
        await projectList.openProject('Projeto Alpha');
        await projectDetail.expectTaskVisible('Planejamento');

        await projectDetail.taskActionsMenu('Planejamento').click();
        await page.getByRole('menuitem', { name: 'Editar', exact: true }).click();
        await page.locator('[data-testid="task-title-input"]').fill('Planejamento atualizado');
        await page.locator('[data-testid="task-submit-button"]').click();

        await projectDetail.expectTaskVisible('Planejamento atualizado');
    });

    test('marcar tarefa como concluída: tarefa vai para a coluna Done', async ({ page, context }) => {
        const state = createState();
        state.tasks[0].progress = 50;
        await arrange(page, context, state);
        const projectList = new ProjectListPage(page);
        const projectDetail = new ProjectDetailPage(page);
        await projectList.goto();
        await projectList.openProject('Projeto Alpha');

        await projectDetail.moveTaskTo('Planejamento', 'Done');

        const doneColumn = page.locator('[data-testid="task-column"][data-task-status="done"]');
        await expect(doneColumn.locator('[data-testid="task-item"]')).toContainText('Planejamento');
        await expect(projectDetail.taskStatus('Planejamento')).toHaveText('Done');
    });

    test('validação: criar projeto sem título mostra erro obrigatório', async ({ page, context }) => {
        const state = await arrange(page, context);
        const initialCount = state.projects.length;
        const projectList = new ProjectListPage(page);
        await projectList.goto();

        await projectList.createForCustomer('201');
        await page.locator('[data-testid="create-project-submit"]').click();

        await expect(page.getByRole('alert')).toHaveText('Título é obrigatório');
        await expect(page.locator('[data-testid="project-title-input"]')).toHaveAttribute('aria-invalid', 'true');
        expect(state.projects).toHaveLength(initialCount);
    });
});
