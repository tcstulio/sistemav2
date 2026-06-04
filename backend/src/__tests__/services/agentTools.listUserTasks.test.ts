import { describe, it, expect, vi } from 'vitest';

// #116: ferramenta list_user_tasks (tarefas atribuídas a uma pessoa, não só por projeto).
vi.mock('../../config/env', () => ({ config: { deeplinkSecret: 'test-secret-user-tasks' } }));
vi.mock('../../services/dolibarrService', () => ({
    dolibarrService: {
        listUserTasks: vi.fn(),
    },
}));
vi.mock('../../services/scraperService', () => ({ ScraperService: {} }));
vi.mock('../../utils/urlValidation', () => ({ isValidExternalUrl: () => true }));

import { executeTool, TOOLS_PROMPT } from '../../services/agentTools';
import { dolibarrService } from '../../services/dolibarrService';

describe('agentTools — list_user_tasks (#116)', () => {
    it('chama dolibarrService.listUserTasks com o userId e formata a saída', async () => {
        (dolibarrService.listUserTasks as any).mockResolvedValue([
            { ref: 'TK01', label: 'Revisar proposta', progress: 50, dateo: '2025-06-01' },
            { ref: 'TK02', label: 'Ligar para cliente', progress: 0, dateo: '2025-06-02' },
        ]);

        const out = await executeTool('list_user_tasks', { userId: '7' });

        expect(dolibarrService.listUserTasks).toHaveBeenCalledWith('7');
        expect(out).toContain('TK01');
        expect(out).toContain('Revisar proposta');
        expect(out).toContain('Ligar para cliente');
    });

    it('exige userId', async () => {
        await expect(executeTool('list_user_tasks', {})).rejects.toThrow();
    });

    it('lida graciosamente com lista vazia', async () => {
        (dolibarrService.listUserTasks as any).mockResolvedValue([]);
        const out = await executeTool('list_user_tasks', { userId: '99' });
        expect(out).toContain('[]');
    });

    it('está documentada no TOOLS_PROMPT', () => {
        expect(TOOLS_PROMPT).toContain('list_user_tasks');
    });
});
