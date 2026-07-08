import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((_req: any, _res: any, next: any) => next()));
const mockRequireDolibarrAdmin = vi.hoisted(() => vi.fn((_req: any, _res: any, next: any) => next()));
const mockUiConfigService = vi.hoisted(() => ({
    get: vi.fn(() => ({ companyName: 'CoolGroove', logoText: 'D', themeColor: 'indigo' })),
    update: vi.fn((p: any) => ({ companyName: 'CoolGroove', logoText: 'D', themeColor: 'indigo', ...p })),
}));
const mockOnMinMergeScoreLowered = vi.hoisted(() => vi.fn());

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
    requireDolibarrAdmin: mockRequireDolibarrAdmin,
}));
vi.mock('../../services/uiConfigService', () => ({ uiConfigService: mockUiConfigService }));
// #1168: a rota faz require lazy de taskRunnerService só quando o piso baixa — o mock intercepta o require.
vi.mock('../../services/taskRunnerService', () => ({ taskRunnerService: { onMinMergeScoreLowered: mockOnMinMergeScoreLowered } }));
vi.mock('../../services/adminAuditService', () => ({ adminAuditService: { record: vi.fn(), list: vi.fn(() => []) } }));
vi.mock('../../utils/logger', () => ({
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import uiConfigRoutes from '../../routes/uiConfigRoutes';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/ui-config', uiConfigRoutes);
    return app;
}

describe('uiConfigRoutes', () => {
    let app: express.Application;
    beforeEach(() => { vi.clearAllMocks(); app = createApp(); });

    it('GET retorna a config da organização', async () => {
        const res = await request(app).get('/api/ui-config');
        expect(res.status).toBe(200);
        expect(res.body.companyName).toBe('CoolGroove');
    });

    it('PUT (admin) atualiza e repassa só os campos enviados', async () => {
        const res = await request(app).put('/api/ui-config').send({ companyName: 'ACME', themeColor: 'emerald' });
        expect(res.status).toBe(200);
        expect(mockUiConfigService.update).toHaveBeenCalledWith({ companyName: 'ACME', themeColor: 'emerald' });
    });

    it('PUT valida o corpo (rejeita companyName vazio)', async () => {
        const res = await request(app).put('/api/ui-config').send({ companyName: '' });
        expect(res.status).toBe(400);
        expect(mockUiConfigService.update).not.toHaveBeenCalled();
    });

    it('PUT exige admin (middleware bloqueia)', async () => {
        mockRequireDolibarrAdmin.mockImplementationOnce((_req: any, res: any) => res.status(403).json({ error: 'forbidden' }));
        const res = await request(app).put('/api/ui-config').send({ companyName: 'X' });
        expect(res.status).toBe(403);
        expect(mockUiConfigService.update).not.toHaveBeenCalled();
    });

    it('#1168: PUT baixando minMergeScore chama taskRunnerService.onMinMergeScoreLowered(prev, next)', async () => {
        mockUiConfigService.get.mockReturnValueOnce({ taskAutomation: { minMergeScore: 9 } });
        mockUiConfigService.update.mockReturnValueOnce({ taskAutomation: { minMergeScore: 8 } });
        const res = await request(app).put('/api/ui-config').send({ taskAutomation: { minMergeScore: 8 } });
        expect(res.status).toBe(200);
        expect(mockOnMinMergeScoreLowered).toHaveBeenCalledWith(9, 8);
    });

    it('#1168: PUT subindo/igualando minMergeScore NÃO chama onMinMergeScoreLowered', async () => {
        mockUiConfigService.get.mockReturnValueOnce({ taskAutomation: { minMergeScore: 8 } });
        mockUiConfigService.update.mockReturnValueOnce({ taskAutomation: { minMergeScore: 9 } });
        const res = await request(app).put('/api/ui-config').send({ taskAutomation: { minMergeScore: 9 } });
        expect(res.status).toBe(200);
        expect(mockOnMinMergeScoreLowered).not.toHaveBeenCalled();
    });

    // #1195: o Zod do taskAutomation não listava os 4 campos de rodadas/tetos do #1154 — o .parse()
    // estripava as chaves, então o save do editor RESETAVA maxJudgeRounds/maxGateFixRounds/
    // maxRoundsPerTask/dailyRoundBudget p/ os defaults (3/3/20/200). Round-trip: o que chega em
    // update() precisa ter TODOS os campos intactos (não os defaults).
    it('#1195: PUT com taskAutomation contendo os 4 campos NÃO os estripa (round-trip p/ update)', async () => {
        const custom = {
            autoPlay: true,
            minApproveScore: 6,
            maxJudgeRounds: 7,
            maxGateFixRounds: 8,
            maxRoundsPerTask: 42,
            dailyRoundBudget: 777,
        };
        mockUiConfigService.update.mockReturnValueOnce({ taskAutomation: { ...custom, minMergeScore: 8 } });
        const res = await request(app).put('/api/ui-config').send({ taskAutomation: custom });
        expect(res.status).toBe(200);
        // Nenhum dos 4 campos pode ter caído no default (3/3/20/200) nem o minApproveScore (9).
        expect(mockUiConfigService.update).toHaveBeenCalledWith({ taskAutomation: custom });
        const sent = mockUiConfigService.update.mock.calls[0][0].taskAutomation;
        expect(sent).toMatchObject({
            maxJudgeRounds: 7,
            maxGateFixRounds: 8,
            maxRoundsPerTask: 42,
            dailyRoundBudget: 777,
            minApproveScore: 6,
        });
        // O GET (resposta do PUT) devolve os mesmos valores, não os defaults.
        expect(res.body.taskAutomation).toMatchObject({
            maxJudgeRounds: 7,
            maxGateFixRounds: 8,
            maxRoundsPerTask: 42,
            dailyRoundBudget: 777,
            minApproveScore: 6,
        });
    });

    it('#1195: PUT só com autoPlay preserva a presença do campo (não reseta os 4 ao default por omissão de Zod)', async () => {
        // Mesmo enviando só autoPlay, o Zod não pode descartar chaves PRESENTES no payload;
        // confirma que o schema aceita os 4 campos sem rejeitar/ignorar.
        const res = await request(app).put('/api/ui-config').send({ taskAutomation: { autoPlay: true, maxJudgeRounds: 9 } });
        expect(res.status).toBe(200);
        expect(mockUiConfigService.update).toHaveBeenCalledWith({ taskAutomation: { autoPlay: true, maxJudgeRounds: 9 } });
    });
});
