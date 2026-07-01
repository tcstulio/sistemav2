import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TimeAnalysisDashboard } from '../../components/Tasks/TimeAnalysisDashboard';
import { TaskTimeLog, Project, Task, DolibarrUser } from '../../types';

// ── hoisted mocks ──────────────────────────────────────────────────────────
vi.mock('recharts', () => ({
    BarChart: ({ children }: any) => <div>{children}</div>,
    Bar: ({ children }: any) => <>{children}</>,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
    Cell: () => null,
    PieChart: ({ children }: any) => <div>{children}</div>,
    Pie: ({ children }: any) => <>{children}</>,
    ReferenceLine: () => null,
}));

vi.mock('../../components/Tasks/TaskAssistantModal', () => ({
    TaskAssistantModal: () => <div data-testid="task-assistant-modal" />,
}));

// ── fixtures ───────────────────────────────────────────────────────────────

const makeProject = (id: string, title: string): Project => ({
    id,
    ref: `PROJ-${id}`,
    title,
    statut: '1',
    socid: '0',
    progress: 0,
    date_start: 0,
    date_end: 0,
});

const makeTask = (id: string, projectId: string): Task => ({
    id,
    ref: `T-${id}`,
    label: `Tarefa ${id}`,
    project_id: projectId,
    progress: 0,
});

const makeLog = (
    id: string,
    taskId: string,
    userId: string,
    durationSeconds: number
): TaskTimeLog => ({
    id,
    task_id: taskId,
    user_id: userId,
    date: new Date('2026-06-01').getTime(),
    duration: durationSeconds,
    date_modification: Date.now(),
});

const makeUser = (id: string, firstname: string): DolibarrUser => ({
    id,
    login: `user${id}`,
    firstname,
    statut: '1',
});

// ── many projects with long names ──────────────────────────────────────────
const LONG_PROJECT_NAMES = [
    'Desenvolvimento de Plataforma Digital Integrada',
    'Implementação de Sistema ERP Customizado',
    'Projeto de Migração Cloud AWS Enterprise',
    'Integração com APIs de Terceiros e Parceiros',
    'Redesign Completo da Interface do Usuário',
    'Automação de Processos de Negócio',
    'Análise e Modelagem de Dados Avançados',
    'Sem Projeto',
];

const manyProjects: Project[] = LONG_PROJECT_NAMES.slice(0, 7).map((title, i) =>
    makeProject(`p${i + 1}`, title)
);

const manyTasks: Task[] = manyProjects.map((p, i) => makeTask(`t${i + 1}`, p.id));

// Add a task with no project (maps to "Sem Projeto")
manyTasks.push(makeTask('t8', 'unknown'));

const manyLogs: TaskTimeLog[] = manyTasks.map((t, i) =>
    makeLog(`log${i + 1}`, t.id, 'u1', (i + 1) * 3600)
);

const singleUser: DolibarrUser[] = [makeUser('u1', 'Ana')];

const defaultProps = {
    logs: manyLogs,
    projects: manyProjects,
    tasks: manyTasks,
    users: singleUser,
};

// ── tests ──────────────────────────────────────────────────────────────────

describe('TimeAnalysisDashboard — card "Por Projeto"', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // As fixtures usam datas de 2026-06; o componente filtra pelo MÊS ATUAL
        // (startOfMonth/endOfMonth de `new Date()`). Fixamos "hoje" em junho para o teste
        // não quebrar na virada de mês — o CI rodando em 1º de julho encontrava lista vazia
        // (logs de junho fora do range) e a legenda "project-legend" não renderizava.
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-06-15T12:00:00'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renderiza o card "Por Projeto"', () => {
        render(<TimeAnalysisDashboard {...defaultProps} />);
        expect(screen.getByText('Por Projeto')).toBeInTheDocument();
    });

    it('exibe a legenda externa com todos os projetos presentes', () => {
        render(<TimeAnalysisDashboard {...defaultProps} />);
        const legend = screen.getByTestId('project-legend');
        expect(legend).toBeInTheDocument();

        // Each project title (or its truncated version) must appear as a list item
        LONG_PROJECT_NAMES.forEach(fullName => {
            // The display name may be truncated; check for the title attribute (full name)
            const item = legend.querySelector(`[title="${fullName}"]`);
            expect(item, `Projeto "${fullName}" não encontrado na legenda`).not.toBeNull();
        });
    });

    it('aplica truncamento em nomes longos: atributo title contém o nome completo', () => {
        render(<TimeAnalysisDashboard {...defaultProps} />);
        const legend = screen.getByTestId('project-legend');

        LONG_PROJECT_NAMES.slice(0, 7).forEach(fullName => {
            if (fullName.length > 28) {
                const span = legend.querySelector(`[title="${fullName}"]`);
                expect(span, `title ausente para "${fullName}"`).not.toBeNull();
                // Visible text must be shorter than or equal to the full name
                const visibleText = span?.textContent || '';
                expect(visibleText.length).toBeLessThanOrEqual(fullName.length);
            }
        });
    });

    it('exibe "Sem Projeto" na legenda quando há logs sem projeto vinculado', () => {
        render(<TimeAnalysisDashboard {...defaultProps} />);
        const legend = screen.getByTestId('project-legend');
        const semProjeto = legend.querySelector('[title="Sem Projeto"]');
        expect(semProjeto).not.toBeNull();
    });

    it('exibe mensagem vazia quando não há logs no período', () => {
        render(<TimeAnalysisDashboard {...defaultProps} logs={[]} />);
        expect(screen.getByText('Nenhum dado no período')).toBeInTheDocument();
        expect(screen.queryByTestId('project-legend')).not.toBeInTheDocument();
    });

    it('renderiza métricas e seções principais', () => {
        render(<TimeAnalysisDashboard {...defaultProps} />);
        expect(screen.getByText('Horas')).toBeInTheDocument();
        expect(screen.getByText('Carga Diária')).toBeInTheDocument();
        expect(screen.getByText('Por Projeto')).toBeInTheDocument();
        expect(screen.getByText('Apontamentos')).toBeInTheDocument();
    });
});
