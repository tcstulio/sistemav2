import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// #1522 — a rota /execute deve resolver o sessionUserId por login/email quando req.user não traz id
// (sessão degradada), espelhando o fallback #300 da emissão — senão o actor-binding recusaria uma
// confirmação legítima. Aqui capturamos o sessionUserId que a rota passa ao executeConfirm.
const mockUser = vi.hoisted(() => ({ current: { login: 'fulano', id: undefined as any } }));
const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, _res: any, next: any) => {
    req.user = mockUser.current;
    req.headers['dolapikey'] = 'key-abc';
    next();
}));
const mockExecuteConfirm = vi.hoisted(() => vi.fn(async () => ({ ok: true, action: 'validate_invoice', result: {} })));
const mockFindUser = vi.hoisted(() => vi.fn(async (_loginOrEmail: string) => ({ id: 77 })));

vi.mock('../../middleware/authMiddleware', () => ({ requireDolibarrLogin: mockRequireDolibarrLogin }));
vi.mock('../../services/agentActionConfirm', () => ({
    executeConfirm: mockExecuteConfirm,
    describeConfirm: vi.fn(() => ({ ok: true })),
}));
vi.mock('../../services/dolibarrService', () => ({ dolibarrService: { findUserByLoginOrEmail: mockFindUser } }));
vi.mock('../../services/agentActivityService', () => ({ agentActivityService: { record: vi.fn() } }));

import agentActionRoutes from '../../routes/agentActionRoutes';

function app() {
    const a = express();
    a.use(express.json());
    a.use('/api/agent-actions', agentActionRoutes);
    return a;
}

describe('agentActionRoutes /execute — #1522 fallback de sessionUserId por login/email', () => {
    beforeEach(() => { vi.clearAllMocks(); mockExecuteConfirm.mockResolvedValue({ ok: true, action: 'validate_invoice', result: {} } as any); });

    it('req.user SEM id (só login) → resolve por login/email e passa o id resolvido ao executeConfirm', async () => {
        mockUser.current = { login: 'fulano', id: undefined };
        await request(app()).post('/api/agent-actions/execute').send({ token: 'tok' });
        expect(mockFindUser).toHaveBeenCalledWith('fulano');
        expect(mockExecuteConfirm).toHaveBeenCalledWith('tok', '77', 'key-abc'); // id resolvido = 77
    });

    it('req.user COM id → NÃO resolve, usa o id direto', async () => {
        mockUser.current = { login: 'fulano', id: 42 } as any;
        await request(app()).post('/api/agent-actions/execute').send({ token: 'tok' });
        expect(mockFindUser).not.toHaveBeenCalled();
        expect(mockExecuteConfirm).toHaveBeenCalledWith('tok', '42', 'key-abc');
    });

    it('sem id E resolve falha → sessionUserId fica vazio (executeConfirm recusa fail-closed)', async () => {
        mockUser.current = { login: 'fulano', id: undefined };
        mockFindUser.mockResolvedValueOnce(null as any);
        await request(app()).post('/api/agent-actions/execute').send({ token: 'tok' });
        expect(mockExecuteConfirm).toHaveBeenCalledWith('tok', '', 'key-abc'); // vazio → o gate de ator recusa
    });
});
