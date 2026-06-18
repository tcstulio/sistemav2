import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentBootstrapEditor } from '../../components/admin/AgentBootstrapEditor';

vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));

const mockGet = vi.fn();
const mockUpdate = vi.fn();
vi.mock('../../services/agentBootstrapService', () => ({
    getAgentBootstrapConfig: () => mockGet(),
    updateAgentBootstrapConfig: (p: any) => mockUpdate(p),
}));

const cfg = (over = {}) => ({ enabled: true, includeTasks: true, includeAgenda: true, includeFinancial: true, extraInstruction: '', ...over });

describe('AgentBootstrapEditor (#300 item 3)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGet.mockResolvedValue(cfg());
        mockUpdate.mockImplementation((p) => Promise.resolve(cfg(p)));
    });

    it('renders nothing for non-admins', () => {
        const { container } = render(<AgentBootstrapEditor isAdmin={false} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('loads the config and saves changes', async () => {
        const user = userEvent.setup();
        render(<AgentBootstrapEditor isAdmin={true} />);

        // espera carregar (a config chegou e o botão Salvar aparece)
        await screen.findByText('Sessão automática do agente');
        await waitFor(() => expect(mockGet).toHaveBeenCalled());
        const saveBtn = await screen.findByText('Salvar');

        await user.click(saveBtn);
        await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    });

    it('shows an error toast when load fails', async () => {
        const { toast } = await import('sonner');
        mockGet.mockResolvedValue(null);
        render(<AgentBootstrapEditor isAdmin={true} />);
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Falha ao carregar a configuração do agente.'));
    });
});
