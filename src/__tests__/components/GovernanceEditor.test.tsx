import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mockSvc = vi.hoisted(() => ({ getUiConfig: vi.fn(), updateUiConfig: vi.fn() }));
vi.mock('../../services/uiConfigService', () => mockSvc);
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { GovernanceEditor } from '../../components/admin/GovernanceEditor';

const GOV = { irreversibleRequiresApproval: false, adminBypassIrreversible: true, approvalValueThreshold: null, whatsappDestinationAllowlist: [] };

describe('GovernanceEditor — toggle do HITL (§8.1)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSvc.getUiConfig.mockResolvedValue({ actionGovernance: { ...GOV } });
        mockSvc.updateUiConfig.mockResolvedValue({ actionGovernance: { ...GOV, irreversibleRequiresApproval: true } });
    });

    it('não-admin: não renderiza nada', () => {
        const { container } = render(<GovernanceEditor isAdmin={false} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('admin: carrega o config e mostra os dois toggles', async () => {
        render(<GovernanceEditor isAdmin={true} />);
        expect(await screen.findByText(/Exigir confirmação para ações irreversíveis/)).toBeInTheDocument();
        expect(screen.getByText(/Admin dispensa a confirmação/)).toBeInTheDocument();
        expect(mockSvc.getUiConfig).toHaveBeenCalled();
    });

    it('ligar "exigir confirmação" + salvar → updateUiConfig com irreversibleRequiresApproval=true', async () => {
        render(<GovernanceEditor isAdmin={true} />);
        await screen.findByText(/Exigir confirmação para ações irreversíveis/);
        const toggles = screen.getAllByRole('checkbox');
        fireEvent.click(toggles[0]); // o 1º é "exigir confirmação"
        fireEvent.click(screen.getByText('Salvar governança'));
        await waitFor(() => expect(mockSvc.updateUiConfig).toHaveBeenCalledWith(expect.objectContaining({
            actionGovernance: expect.objectContaining({ irreversibleRequiresApproval: true }),
        })));
    });
});
