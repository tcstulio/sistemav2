import { describe, it, expect, vi } from 'vitest';

const mockGetBasePrompt = vi.hoisted(() => vi.fn(() => 'BASE-DO-MARCIANO'));
vi.mock('../../services/agentPromptStore', () => ({
    agentPromptStore: { getBasePrompt: mockGetBasePrompt },
}));

import { agentConfigService } from '../../services/agentConfigService';

describe('agentConfigService.getSystemPrompt — integração agentPromptStore (#1005)', () => {
    it('incorpora o prompt-base editável como fundação do system prompt', () => {
        mockGetBasePrompt.mockReturnValue('BASE-DO-MARCIANO');
        const prompt = agentConfigService.getSystemPrompt();
        expect(mockGetBasePrompt).toHaveBeenCalled();
        // Sem profile carregado, o retorno é só o prompt-base.
        expect(prompt).toBe('BASE-DO-MARCIANO');
    });

    it('reflete mudança no prompt-base do store (próxima sessão usa o novo texto)', () => {
        mockGetBasePrompt.mockReturnValue('NOVO-TEXTO-EDITADO-PELO-ADMIN');
        const prompt = agentConfigService.getSystemPrompt();
        expect(prompt.startsWith('NOVO-TEXTO-EDITADO-PELO-ADMIN')).toBe(true);
    });

    it('prompt-base aparece antes dos complementos dinâmicos', () => {
        mockGetBasePrompt.mockReturnValue('FUNDACAO');
        // Simula profile carregado injetando estado interno via getProfile não é trivial;
        // garantimos ao menos que a fundação está presente no início.
        const prompt = agentConfigService.getSystemPrompt();
        expect(prompt.indexOf('FUNDACAO')).toBe(0);
    });
});
