/**
 * Testes da ferramenta list_users do agente (#1003).
 * Garante que o celular (phone_mobile) de cada usuário aparece na saída formatada,
 * permitindo ao agente disparar WhatsApp diretamente.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/env', () => ({ config: {} }));
vi.mock('../../services/dolibarrService', () => ({
    dolibarrService: {
        listUsers: vi.fn(),
    },
}));
vi.mock('../../services/scraperService', () => ({ ScraperService: {} }));
vi.mock('../../utils/urlValidation', () => ({ isValidExternalUrl: () => true }));

import { executeTool, TOOLS_PROMPT } from '../../services/agentTools';
import { dolibarrService } from '../../services/dolibarrService';

describe('agentTools — list_users (#1003)', () => {
    it('exibe o celular (phone_mobile) de cada usuário na saída', async () => {
        (dolibarrService.listUsers as any).mockResolvedValue([
            { id: 7, login: 'tulio.silva', firstname: 'Tulio', lastname: 'Silva', email: 'tulio@x.com', job: 'Produtor', phone_mobile: '+55 11 99999-0000' },
            { id: 8, login: 'ana', firstname: 'Ana', lastname: 'Souza', email: 'ana@x.com', job: 'RH', phone_mobile: '11988887777', fax: '1133330001' },
        ]);

        const out = await executeTool('list_users', {});

        expect(out).toContain('Tulio');
        expect(out).toContain('+55 11 99999-0000');
        expect(out).toContain('11988887777');
        expect(out).toContain('1133330001'); // fax também mapeado
    });

    it('usa user_mobile como fallback quando phone_mobile está ausente', async () => {
        (dolibarrService.listUsers as any).mockResolvedValue([
            { id: 9, login: 'bob', firstname: 'Bob', lastname: 'X', user_mobile: '11977776666' },
        ]);
        const out = await executeTool('list_users', {});
        expect(out).toContain('11977776666');
    });

    it('não renderiza bloco de celular quando o usuário não tem nenhum', async () => {
        (dolibarrService.listUsers as any).mockResolvedValue([
            { id: 10, login: 'semcel', firstname: 'Sem', lastname: 'Cel', email: 's@x.com' },
        ]);
        const out = await executeTool('list_users', {});
        expect(out).toContain('Cel Sem');
        expect(out).not.toContain('📱');
    });

    it('passa o termo de busca para dolibarrService.listUsers', async () => {
        (dolibarrService.listUsers as any).mockResolvedValue([]);
        await executeTool('list_users', { search: 'tulio' });
        expect(dolibarrService.listUsers).toHaveBeenCalledWith('tulio');
    });

    it('lida graciosamente com lista vazia', async () => {
        (dolibarrService.listUsers as any).mockResolvedValue([]);
        const out = await executeTool('list_users', {});
        expect(out).toContain('Nenhum usuário');
    });

    it('está documentada no TOOLS_PROMPT', () => {
        expect(TOOLS_PROMPT).toContain('list_users');
    });
});
