import { describe, it, expect } from 'vitest';
import { Task, TaskContact } from '../../types';

function canLogTimeOnTask(task: Task, userId: string | undefined, taskContacts: TaskContact[] | undefined): boolean {
    if (!userId) return false;
    if (Number(task.status || task.statut || 0) >= 2) return false;
    if (task.fk_user_assign === userId) return true;
    return !!taskContacts?.some((tc: TaskContact) =>
        tc.task_id === task.id &&
        (tc.user_id === userId || (tc.contact_id && tc.contact_id === userId))
    );
}

const makeTask = (overrides: Partial<Task> = {}): Task => ({
    id: '1',
    ref: 'T1',
    label: 'Test Task',
    project_id: 'p1',
    progress: 0,
    status: 0,
    ...overrides,
});

const makeContact = (overrides: Partial<TaskContact> = {}): TaskContact => ({
    id: 'c1',
    task_id: '1',
    type_id: 'CONTRIBUTOR',
    date_modification: 0,
    ...overrides,
});

describe('canLogTimeOnTask', () => {
    it('retorna false se userId for undefined', () => {
        expect(canLogTimeOnTask(makeTask(), undefined, [])).toBe(false);
    });

    it('retorna false se a tarefa está concluída (status >= 2)', () => {
        const task = makeTask({ fk_user_assign: 'user1', status: 2 });
        expect(canLogTimeOnTask(task, 'user1', [])).toBe(false);
    });

    it('retorna false se a tarefa está concluída via statut', () => {
        const task = makeTask({ fk_user_assign: 'user1', status: undefined, statut: '2' as any });
        expect(canLogTimeOnTask(task, 'user1', [])).toBe(false);
    });

    it('retorna true se o usuário está atribuído e a tarefa não está concluída', () => {
        const task = makeTask({ fk_user_assign: 'user1', status: 0 });
        expect(canLogTimeOnTask(task, 'user1', [])).toBe(true);
    });

    it('retorna true se o usuário é participante direto (user_id)', () => {
        const task = makeTask({ id: 't1', fk_user_assign: 'other' });
        const contacts = [makeContact({ task_id: 't1', user_id: 'user1' })];
        expect(canLogTimeOnTask(task, 'user1', contacts)).toBe(true);
    });

    it('retorna true se o usuário é participante via contact_id', () => {
        const task = makeTask({ id: 't1', fk_user_assign: 'other' });
        const contacts = [makeContact({ task_id: 't1', contact_id: 'user1' })];
        expect(canLogTimeOnTask(task, 'user1', contacts)).toBe(true);
    });

    it('retorna false se o usuário não está atribuído nem é participante', () => {
        const task = makeTask({ fk_user_assign: 'other', status: 0 });
        expect(canLogTimeOnTask(task, 'user1', [])).toBe(false);
    });

    it('retorna false se taskContacts for undefined', () => {
        const task = makeTask({ fk_user_assign: 'other' });
        expect(canLogTimeOnTask(task, 'user1', undefined)).toBe(false);
    });

    it('retorna true para status 1 (em andamento)', () => {
        const task = makeTask({ fk_user_assign: 'user1', status: 1 });
        expect(canLogTimeOnTask(task, 'user1', [])).toBe(true);
    });
});

describe('canLogTimeOnTask — ordenação', () => {
    it('tarefa com canLog=true vem antes de canLog=false', () => {
        const userId = 'user1';
        const contacts: TaskContact[] = [];

        const taskA = makeTask({ id: 'a', fk_user_assign: userId, status: 0, priority: 1 });
        const taskB = makeTask({ id: 'b', fk_user_assign: 'other', status: 0, priority: 3 });

        const sorted = [taskA, taskB].sort((a, b) => {
            const aCanLog = canLogTimeOnTask(a, userId, contacts);
            const bCanLog = canLogTimeOnTask(b, userId, contacts);
            if (aCanLog !== bCanLog) return aCanLog ? -1 : 1;
            const prioA = Number(a.priority || 0);
            const prioB = Number(b.priority || 0);
            if (prioA !== prioB) return prioB - prioA;
            return 0;
        });

        expect(sorted[0].id).toBe('a');
    });

    it('tarefas com canLog=true são ordenadas por prioridade entre si', () => {
        const userId = 'user1';
        const contacts: TaskContact[] = [];

        const taskLow = makeTask({ id: 'low', fk_user_assign: userId, status: 0, priority: 1 });
        const taskHigh = makeTask({ id: 'high', fk_user_assign: userId, status: 0, priority: 3 });

        const sorted = [taskLow, taskHigh].sort((a, b) => {
            const aCanLog = canLogTimeOnTask(a, userId, contacts);
            const bCanLog = canLogTimeOnTask(b, userId, contacts);
            if (aCanLog !== bCanLog) return aCanLog ? -1 : 1;
            const prioA = Number(a.priority || 0);
            const prioB = Number(b.priority || 0);
            if (prioA !== prioB) return prioB - prioA;
            return 0;
        });

        expect(sorted[0].id).toBe('high');
    });

    it('tarefas concluídas com canLog=false ficam no final', () => {
        const userId = 'user1';
        const contacts: TaskContact[] = [];

        const openAssigned = makeTask({ id: 'open', fk_user_assign: userId, status: 0 });
        const completed = makeTask({ id: 'done', fk_user_assign: userId, status: 2 });
        const notAssigned = makeTask({ id: 'other', fk_user_assign: 'x', status: 0 });

        const sorted = [notAssigned, completed, openAssigned].sort((a, b) => {
            const aCanLog = canLogTimeOnTask(a, userId, contacts);
            const bCanLog = canLogTimeOnTask(b, userId, contacts);
            if (aCanLog !== bCanLog) return aCanLog ? -1 : 1;
            return 0;
        });

        expect(sorted[0].id).toBe('open');
        expect(sorted[1].id).toBe('other');
        expect(sorted[2].id).toBe('done');
    });
});
