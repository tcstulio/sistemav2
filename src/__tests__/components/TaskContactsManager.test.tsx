import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockSvc = vi.hoisted(() => ({
    getTaskContacts: vi.fn(),
    setTaskContact: vi.fn().mockResolvedValue({ success: true }),
    removeTaskContact: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../../services/dolibarrService', () => ({ DolibarrService: mockSvc }));
vi.mock('../../utils/logger', () => ({
    logger: { child: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { TaskContactsManager, splitTaskRoles, TaskContactRow } from '../../components/Tasks/TaskContactsManager';

const config = { apiUrl: '', apiKey: '' } as any;
const users = [
    { id: '16', firstname: 'Ana', lastname: 'Lima' },
    { id: '20', firstname: 'Bruno', lastname: 'Souza' },
    { id: '30', firstname: 'Carla', lastname: 'Dias' },
];
const initialContacts: TaskContactRow[] = [
    { id: '637', task_id: '50', user_id: '16', type_id: '45' }, // Responsável
    { id: '700', task_id: '50', user_id: '20', type_id: '46' }, // Interveniente
];

describe('splitTaskRoles', () => {
    it('separa responsável (45) e intervenientes (46)', () => {
        const { responsavel, intervenientes } = splitTaskRoles(initialContacts);
        expect(responsavel?.user_id).toBe('16');
        expect(intervenientes).toHaveLength(1);
        expect(intervenientes[0].user_id).toBe('20');
    });

    it('responsável é null quando não há type 45', () => {
        const { responsavel, intervenientes } = splitTaskRoles([
            { id: '1', task_id: '50', user_id: '20', type_id: '46' },
        ]);
        expect(responsavel).toBeNull();
        expect(intervenientes).toHaveLength(1);
    });
});

describe('TaskContactsManager', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSvc.getTaskContacts.mockResolvedValue(initialContacts);
        mockSvc.setTaskContact.mockResolvedValue({ success: true });
        mockSvc.removeTaskContact.mockResolvedValue({ success: true });
    });

    it('carrega e exibe responsável e interveniente pelo nome', async () => {
        render(<TaskContactsManager config={config} taskId="50" users={users} />);
        expect(mockSvc.getTaskContacts).toHaveBeenCalledWith(config, '50');
        expect(await screen.findByText('Ana Lima')).toBeInTheDocument();
        // Bruno aparece como chip de interveniente (identificado pelo botão de remover)
        expect(screen.getByLabelText('Remover Bruno Souza')).toBeInTheDocument();
    });

    it('remover o responsável chama removeTaskContact com o rowid', async () => {
        render(<TaskContactsManager config={config} taskId="50" users={users} />);
        await screen.findByText('Ana Lima');
        fireEvent.click(screen.getByLabelText('Remover responsável'));
        await waitFor(() => expect(mockSvc.removeTaskContact).toHaveBeenCalledWith(config, '50', '637'));
    });

    it('trocar o responsável remove o antigo e grava o novo como TASKEXECUTIVE', async () => {
        render(<TaskContactsManager config={config} taskId="50" users={users} />);
        await screen.findByText('Ana Lima');
        fireEvent.change(screen.getByLabelText('Definir responsável'), { target: { value: '30' } });
        await waitFor(() => {
            expect(mockSvc.removeTaskContact).toHaveBeenCalledWith(config, '50', '637'); // remove Ana
            expect(mockSvc.setTaskContact).toHaveBeenCalledWith(config, '50', '30', 'TASKEXECUTIVE'); // grava Carla
        });
    });

    it('adicionar interveniente grava como TASKCONTRIBUTOR', async () => {
        render(<TaskContactsManager config={config} taskId="50" users={users} />);
        await screen.findByText('Ana Lima');
        fireEvent.change(screen.getByLabelText('Adicionar colaborador'), { target: { value: '30' } });
        fireEvent.click(screen.getByRole('button', { name: /adicionar/i }));
        await waitFor(() =>
            expect(mockSvc.setTaskContact).toHaveBeenCalledWith(config, '50', '30', 'TASKCONTRIBUTOR'),
        );
    });
});
