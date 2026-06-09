import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockSvc = vi.hoisted(() => ({
    getDelegation: vi.fn(),
    setDelegationDoc: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('../../services/dolibarrService', () => ({ DolibarrService: mockSvc }));
vi.mock('../../utils/logger', () => ({ logger: { child: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));

import { DelegationDocPanel } from '../../components/Tasks/DelegationDocPanel';

const config = { apiUrl: '', apiKey: '' } as any;

describe('DelegationDocPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSvc.getDelegation.mockResolvedValue(null);
    });

    it('vazio: mostra convite para definir o critério', async () => {
        render(<DelegationDocPanel config={config} taskId="50" />);
        expect(await screen.findByText(/Sem documentação/)).toBeInTheDocument();
    });

    it('exibe objetivo e critério carregados', async () => {
        mockSvc.getDelegation.mockResolvedValue({ taskId: '50', objetivo: 'Contar bebidas', criterio: 'Planilha enviada' });
        render(<DelegationDocPanel config={config} taskId="50" />);
        expect(await screen.findByText('Contar bebidas')).toBeInTheDocument();
        expect(screen.getByText('Planilha enviada')).toBeInTheDocument();
    });

    it('editar + salvar chama setDelegationDoc', async () => {
        render(<DelegationDocPanel config={config} taskId="50" />);
        await screen.findByText(/Sem documentação/);
        fireEvent.click(screen.getByText('Editar'));
        fireEvent.change(screen.getByPlaceholderText('O que é esperado desta delegação?'), { target: { value: 'Contar bebidas' } });
        fireEvent.change(screen.getByPlaceholderText('Como sabemos que terminou?'), { target: { value: 'Planilha enviada' } });
        fireEvent.click(screen.getByText('Salvar'));
        await waitFor(() => expect(mockSvc.setDelegationDoc).toHaveBeenCalledWith(config, '50', { objetivo: 'Contar bebidas', criterio: 'Planilha enviada' }));
    });
});
