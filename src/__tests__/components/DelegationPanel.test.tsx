import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockSvc = vi.hoisted(() => ({
    getDelegation: vi.fn(),
    requestDelegationAcceptance: vi.fn().mockResolvedValue({ success: true }),
    acceptDelegation: vi.fn().mockResolvedValue({ success: true }),
    declineDelegation: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('../../services/dolibarrService', () => ({ DolibarrService: mockSvc }));
vi.mock('../../utils/logger', () => ({ logger: { child: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));

import { DelegationPanel } from '../../components/Tasks/DelegationPanel';

const config = { apiUrl: '', apiKey: '' } as any;
const task = { id: '50', fk_user_creat: '9', label: 'Relatório', ref: 'TK50' };

describe('DelegationPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSvc.getDelegation.mockResolvedValue(null);
    });

    it('sem aceite: oferece "Solicitar aceite" e dispara a solicitação', async () => {
        render(<DelegationPanel config={config} taskId="50" task={task} currentUserId="9" />);
        const btn = await screen.findByText('Solicitar aceite');
        fireEvent.click(btn);
        await waitFor(() => expect(mockSvc.requestDelegationAcceptance).toHaveBeenCalledWith(config, '50', task, undefined, '9'));
    });

    it('pendente: mostra "Aguardando aceite" e Aceitar grava com o usuário atual', async () => {
        mockSvc.getDelegation.mockResolvedValue({ taskId: '50', aceite: { status: 'pending', deadlineDay: 20000 } });
        render(<DelegationPanel config={config} taskId="50" task={task} currentUserId="16" />);
        expect(await screen.findByText('Aguardando aceite')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Aceitar'));
        await waitFor(() => expect(mockSvc.acceptDelegation).toHaveBeenCalledWith(config, '50', '16'));
    });

    it('pendente: recusar com motivo escala ao solicitante', async () => {
        mockSvc.getDelegation.mockResolvedValue({ taskId: '50', aceite: { status: 'pending', deadlineDay: 20000 } });
        render(<DelegationPanel config={config} taskId="50" task={task} currentUserId="16" />);
        await screen.findByText('Aguardando aceite');
        fireEvent.click(screen.getByText('Recusar'));
        fireEvent.change(screen.getByPlaceholderText('Motivo da recusa (opcional)'), { target: { value: 'já tratei' } });
        fireEvent.click(screen.getByText('Confirmar recusa'));
        await waitFor(() => expect(mockSvc.declineDelegation).toHaveBeenCalledWith(config, '50', '16', 'já tratei', task));
    });

    it('aceita: mostra estado "Aceita"', async () => {
        mockSvc.getDelegation.mockResolvedValue({ taskId: '50', aceite: { status: 'accepted', by: '16', at: '2026-06-09T00:00:00Z' } });
        render(<DelegationPanel config={config} taskId="50" task={task} currentUserId="16" />);
        expect(await screen.findByText('Aceita')).toBeInTheDocument();
    });

    it('recusada: mostra estado "Recusada" + escalada', async () => {
        mockSvc.getDelegation.mockResolvedValue({ taskId: '50', aceite: { status: 'declined', reason: 'fora do escopo' } });
        render(<DelegationPanel config={config} taskId="50" task={task} currentUserId="16" />);
        expect(await screen.findByText('Recusada')).toBeInTheDocument();
        expect(screen.getByText(/fora do escopo/)).toBeInTheDocument();
    });
});
