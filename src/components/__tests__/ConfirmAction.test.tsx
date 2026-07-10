import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const mockSvc = vi.hoisted(() => ({ describeAction: vi.fn(), executeAction: vi.fn() }));
vi.mock('../../services/agentActionService', () => mockSvc);

import ConfirmAction from '../ConfirmAction';

function renderAt(token: string) {
    return render(
        <MemoryRouter initialEntries={[`/confirm-action?token=${token}`]}>
            <Routes>
                <Route path="/confirm-action" element={<ConfirmAction />} />
                <Route path="/" element={<div>home</div>} />
            </Routes>
        </MemoryRouter>
    );
}

describe('ConfirmAction — tela de confirmação HITL (§8.1)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('mostra o resumo (describe) e NÃO executa até confirmar', async () => {
        mockSvc.describeAction.mockResolvedValue({ ok: true, title: 'Validar fatura', summary: 'Validar a fatura #50.', entityType: 'invoice', entityId: '50' });
        renderAt('abc');
        expect(await screen.findByText('Validar fatura')).toBeInTheDocument();
        expect(screen.getByText(/Validar a fatura #50/)).toBeInTheDocument();
        expect(mockSvc.executeAction).not.toHaveBeenCalled();
    });

    it('confirmar → executa (com o token) e mostra sucesso', async () => {
        mockSvc.describeAction.mockResolvedValue({ ok: true, title: 'Validar fatura', summary: 'x', entityType: 'invoice', entityId: '50' });
        mockSvc.executeAction.mockResolvedValue({ ok: true, action: 'validate_invoice' });
        renderAt('abc');
        fireEvent.click(await screen.findByTestId('confirm-action-btn'));
        await waitFor(() => expect(mockSvc.executeAction).toHaveBeenCalledWith('abc'));
        expect(await screen.findByText('Confirmado')).toBeInTheDocument();
    });

    it('token inválido (describe ok:false) → erro, sem botão de confirmar', async () => {
        mockSvc.describeAction.mockResolvedValue({ ok: false, error: 'Confirmação inválida ou expirada.' });
        renderAt('bad');
        expect(await screen.findByText('Confirmação inválida')).toBeInTheDocument();
        expect(screen.queryByTestId('confirm-action-btn')).toBeNull();
    });

    it('execução falha → mostra o erro do backend', async () => {
        mockSvc.describeAction.mockResolvedValue({ ok: true, title: 'X', summary: 'y', entityType: 'invoice', entityId: '1' });
        mockSvc.executeAction.mockResolvedValue({ ok: false, error: 'Sem permissão para validar invoice.' });
        renderAt('abc');
        fireEvent.click(await screen.findByTestId('confirm-action-btn'));
        expect(await screen.findByText('Não concluído')).toBeInTheDocument();
        expect(screen.getByText(/Sem permissão/)).toBeInTheDocument();
    });

    it('sem token → confirmação inválida', async () => {
        renderAt('');
        expect(await screen.findByText('Confirmação inválida')).toBeInTheDocument();
        expect(mockSvc.describeAction).not.toHaveBeenCalled();
    });
});
