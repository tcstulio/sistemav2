import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockSvc = vi.hoisted(() => ({
    createTask: vi.fn().mockResolvedValue({ id: 'new' }),
    updateTask: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../services/dolibarrService', () => ({ DolibarrService: mockSvc }));
vi.mock('../../utils/logger', () => ({ logger: { child: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));

import { DelegationStepsPanel } from '../../components/Tasks/DelegationStepsPanel';

const config = { apiUrl: '', apiKey: '' } as any;
const tasks = [
    { id: 'a', fk_parent: '50', label: 'Passo A', progress: 100 },
    { id: 'b', fk_parent: '50', label: 'Passo B', progress: 0 },
];

describe('DelegationStepsPanel', () => {
    beforeEach(() => vi.clearAllMocks());

    it('mostra barra agregada (50%) e lista os passos', () => {
        render(<DelegationStepsPanel config={config} taskId="50" projectId="7" tasks={tasks} />);
        expect(screen.getByText('50%')).toBeInTheDocument();
        expect(screen.getByText('Passo A')).toBeInTheDocument();
        expect(screen.getByText('Passo B')).toBeInTheDocument();
    });

    it('adicionar passo cria sub-tarefa com fk_task_parent', async () => {
        const onChanged = vi.fn();
        render(<DelegationStepsPanel config={config} taskId="50" projectId="7" tasks={tasks} onChanged={onChanged} />);
        fireEvent.change(screen.getByPlaceholderText('Novo passo…'), { target: { value: 'Passo C' } });
        fireEvent.click(screen.getByText('Adicionar'));
        await waitFor(() => expect(mockSvc.createTask).toHaveBeenCalledWith(config, { label: 'Passo C', project_id: '7', fk_task_parent: '50' }));
        await waitFor(() => expect(onChanged).toHaveBeenCalled());
    });

    it('concluir um passo marca progresso 100', async () => {
        render(<DelegationStepsPanel config={config} taskId="50" projectId="7" tasks={tasks} />);
        fireEvent.click(screen.getByLabelText('Concluir Passo B'));
        await waitFor(() => expect(mockSvc.updateTask).toHaveBeenCalledWith(config, 'b', { progress: 100 }));
    });

    it('sem passos: mostra convite para decompor', () => {
        render(<DelegationStepsPanel config={config} taskId="50" projectId="7" tasks={[]} />);
        expect(screen.getByText(/Nenhum passo ainda/)).toBeInTheDocument();
    });
});
