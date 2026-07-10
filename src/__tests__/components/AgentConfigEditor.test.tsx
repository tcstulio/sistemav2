import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockSvc = vi.hoisted(() => ({
    getAgentPromptConfig: vi.fn(),
    updateAgentPrompt: vi.fn(),
}));
vi.mock('../../services/agentPromptService', () => mockSvc);
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AgentConfigEditor } from '../../components/development/AgentConfigEditor';

const SNAPSHOT = {
    systemPrompt: 'Você é o Marciano.',
    defaultPrompt: 'Padrão original do agente.',
    history: [],
    canEdit: true,
};

describe('AgentConfigEditor — aba Config IA (#1005)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSvc.getAgentPromptConfig.mockResolvedValue({ ...SNAPSHOT });
        mockSvc.updateAgentPrompt.mockResolvedValue({ ...SNAPSHOT });
    });

    it('abre e mostra o prompt atual no textarea', async () => {
        render(<AgentConfigEditor isAdmin={true} />);
        const ta = await screen.findByRole('textbox');
        expect(ta).toHaveValue('Você é o Marciano.');
    });

    it('admin edita, confirma, e salva o novo prompt', async () => {
        const user = userEvent.setup();
        mockSvc.updateAgentPrompt.mockResolvedValue({
            systemPrompt: 'Você é o Marciano. editado',
            defaultPrompt: 'Padrão original do agente.',
            history: [],
            canEdit: true,
        });
        render(<AgentConfigEditor isAdmin={true} />);
        const ta = await screen.findByRole('textbox');

        await user.type(ta, ' editado');
        expect(ta).toHaveValue('Você é o Marciano. editado');
        await user.click(screen.getByText('Salvar'));

        // confirmação com aviso de impacto em todas as sessões
        await screen.findByText('Confirmar alteração');
        expect(screen.getByText(/impacta TODAS as sessões/i)).toBeInTheDocument();
        await user.click(screen.getByText('Confirmar alteração'));

        await waitFor(() =>
            expect(mockSvc.updateAgentPrompt).toHaveBeenCalledWith({ systemPrompt: 'Você é o Marciano. editado' }),
        );
    });

    it('botão Restaurar padrão envia restoreDefault=true', async () => {
        const user = userEvent.setup();
        render(<AgentConfigEditor isAdmin={true} />);
        await screen.findByRole('textbox');

        await user.click(screen.getByText('Restaurar padrão'));
        await user.click(screen.getByText('Confirmar alteração'));

        await waitFor(() =>
            expect(mockSvc.updateAgentPrompt).toHaveBeenCalledWith({ restoreDefault: true }),
        );
    });

    it('não-admin vê em read-only (textarea desabilitada, sem botões de edição)', async () => {
        render(<AgentConfigEditor isAdmin={false} />);
        const ta = await screen.findByRole('textbox');
        expect(ta).toBeDisabled();
        expect(screen.queryByText('Salvar')).not.toBeInTheDocument();
        expect(screen.queryByText('Restaurar padrão')).not.toBeInTheDocument();
        expect(screen.getByText(/read-only/i)).toBeInTheDocument();
    });

    it('presets inserem trecho no textarea', async () => {
        const user = userEvent.setup();
        render(<AgentConfigEditor isAdmin={true} />);
        const ta = await screen.findByRole('textbox');

        await user.click(screen.getByText('Conciso'));
        expect((ta as HTMLTextAreaElement).value).toContain('[PRESET: Conciso]');
    });

    it('histórico mostra quem mudou e o diff do conteúdo anterior', async () => {
        mockSvc.getAgentPromptConfig.mockResolvedValue({
            systemPrompt: 'novo',
            defaultPrompt: 'padrão',
            history: [{
                id: 'h1',
                timestamp: 1700000000000,
                changedBy: { id: 'u1', login: 'admin', name: 'Admin Teste' },
                previousPrompt: 'velho',
                prompt: 'novo',
                action: 'update',
            }],
            canEdit: true,
        });
        const user = userEvent.setup();
        render(<AgentConfigEditor isAdmin={true} />);

        expect(await screen.findByText('Admin Teste')).toBeInTheDocument();
        await user.click(screen.getByText('ver diff'));
        expect(screen.getByText('- velho')).toBeInTheDocument();
        expect(screen.getByText('+ novo')).toBeInTheDocument();
    });
});
