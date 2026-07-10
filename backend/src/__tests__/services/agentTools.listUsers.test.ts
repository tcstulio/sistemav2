/**
 * Testes do agente — list_users exibe o celular (#1003).
 *
 * A ferramenta lista usuários do Dolibarr e, agora, mostra o celular resolvido
 * (phone_mobile || user_mobile) via a utilitária compartilhada `resolveUserMobile`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/env', () => ({ config: {} }));
vi.mock('../../services/scraperService', () => ({ ScraperService: {} }));
vi.mock('../../utils/urlValidation', () => ({ isValidExternalUrl: () => true }));

const { mockListUsers } = vi.hoisted(() => ({ mockListUsers: vi.fn() }));
vi.mock('../../services/dolibarrService', () => ({ dolibarrService: { listUsers: mockListUsers } }));

import { executeTool } from '../../services/agentTools';

describe('agentTools — list_users exibe celular (#1003)', () => {
    beforeEach(() => mockListUsers.mockReset());

    it('mostra 📱 + número quando phone_mobile está presente', async () => {
        mockListUsers.mockResolvedValue([
            { id: '7', login: 'tulio.silva', lastname: 'Silva', firstname: 'Tulio', email: 't@x.com', job: 'Dev', phone_mobile: '+55 11 99999-0000' },
        ]);
        const out = await executeTool('list_users', {});
        expect(out).toContain('📱');
        expect(out).toContain('+55 11 99999-0000');
    });

    it('mostra o celular vindo de user_mobile (fallback)', async () => {
        mockListUsers.mockResolvedValue([
            { id: '1', login: 'a', lastname: 'A', firstname: 'B', email: '', job: '', phone_mobile: '', user_mobile: '+551188888000' },
        ]);
        const out = await executeTool('list_users', {});
        expect(out).toContain('📱');
        expect(out).toContain('+551188888000');
    });

    it('NÃO mostra 📱 quando o usuário não tem celular', async () => {
        mockListUsers.mockResolvedValue([
            { id: '2', login: 'c', lastname: 'C', firstname: 'D', email: 'c@x.com', job: '', phone_mobile: '', user_mobile: '' },
        ]);
        const out = await executeTool('list_users', {});
        expect(out).not.toContain('📱');
    });

    it('retorna aviso quando não há usuários', async () => {
        mockListUsers.mockResolvedValue([]);
        const out = await executeTool('list_users', {});
        expect(out).toMatch(/nenhum usuário encontrado/i);
    });
});
