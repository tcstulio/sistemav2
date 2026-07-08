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

    // #1207: actionGovernance no UpdateSchema — o Zod agora lista o objeto com os 4 campos,
    // então ele sobrevive ao .parse() e chega intacto no service (antes era estripado silenciosamente).
    it('#1207: PUT com actionGovernance aceita e propaga os 4 campos pro service', async () => {
        const gov = {
            irreversibleRequiresApproval: true,
            adminBypassIrreversible: false,
            approvalValueThreshold: 500,
            whatsappDestinationAllowlist: ['5511999999999', '5521888888888'],
        };
        mockUiConfigService.update.mockReturnValueOnce({ actionGovernance: gov });
        const res = await request(app).put('/api/ui-config').send({ actionGovernance: gov });
        expect(res.status).toBe(200);
        expect(mockUiConfigService.update).toHaveBeenCalledWith({ actionGovernance: gov });
        const sent = mockUiConfigService.update.mock.calls[0][0].actionGovernance;
        expect(sent).toMatchObject(gov);
    });

    it('#1207: PUT com actionGovernance.approvalValueThreshold null é aceito', async () => {
        const gov = {
            irreversibleRequiresApproval: false,
            adminBypassIrreversible: true,
            approvalValueThreshold: null,
            whatsappDestinationAllowlist: [],
        };
        mockUiConfigService.update.mockReturnValueOnce({ actionGovernance: gov });
        const res = await request(app).put('/api/ui-config').send({ actionGovernance: gov });
        expect(res.status).toBe(200);
        expect(mockUiConfigService.update).toHaveBeenCalledWith({ actionGovernance: gov });
    });

    it('#1207: PUT com chave desconhecida dentro de actionGovernance é estripada (não chega no service)', async () => {
        const gov = {
            irreversibleRequiresApproval: true,
            adminBypassIrreversible: true,
            approvalValueThreshold: 100,
            whatsappDestinationAllowlist: ['1234567890'],
            evilKey: 'should-be-stripped',
            __proto_injection__: 'should-be-stripped',
        };
        const expected = {
            irreversibleRequiresApproval: true,
            adminBypassIrreversible: true,
            approvalValueThreshold: 100,
            whatsappDestinationAllowlist: ['1234567890'],
        };
        mockUiConfigService.update.mockReturnValueOnce({ actionGovernance: expected });
        const res = await request(app).put('/api/ui-config').send({ actionGovernance: gov });
        expect(res.status).toBe(200);
        expect(mockUiConfigService.update).toHaveBeenCalledWith({ actionGovernance: expected });
        const sent = mockUiConfigService.update.mock.calls[0][0].actionGovernance;
        expect(sent).not.toHaveProperty('evilKey');
        expect(sent).not.toHaveProperty('__proto_injection__');
        expect(Object.keys(sent).sort()).toEqual(
            ['adminBypassIrreversible', 'approvalValueThreshold', 'irreversibleRequiresApproval', 'whatsappDestinationAllowlist'],
        );
    });

    it('#1207: PUT com tipo errado em campo de actionGovernance retorna 400', async () => {
        const res = await request(app).put('/api/ui-config').send({
            actionGovernance: {
                irreversibleRequiresApproval: 'sim',
                adminBypassIrreversible: true,
                approvalValueThreshold: 100,
                whatsappDestinationAllowlist: [],
            },
        });
        expect(res.status).toBe(400);
        expect(mockUiConfigService.update).not.toHaveBeenCalled();
    });

    it('#1207: PUT com approvalValueThreshold como string retorna 400 (tipo errado)', async () => {
        const res = await request(app).put('/api/ui-config').send({
            actionGovernance: {
                irreversibleRequiresApproval: true,
                adminBypassIrreversible: true,
                approvalValueThreshold: '500',
                whatsappDestinationAllowlist: [],
            },
        });
        expect(res.status).toBe(400);
        expect(mockUiConfigService.update).not.toHaveBeenCalled();
    });

    it('#1207: PUT sem actionGovernance não envia actionGovernance pro service (preservado pelo service)', async () => {
        mockUiConfigService.update.mockReturnValueOnce({ companyName: 'X' });
        const res = await request(app).put('/api/ui-config').send({ companyName: 'X' });
        expect(res.status).toBe(200);
        expect(mockUiConfigService.update).toHaveBeenCalledWith({ companyName: 'X' });
    });

    // #1207: faltar um dos 4 campos obrigatórios deve rejeitar (400) — não propagar payload incompleto.
    it('#1207: PUT com actionGovernance sem um dos 4 campos retorna 400', async () => {
        const res = await request(app).put('/api/ui-config').send({
            actionGovernance: {
                irreversibleRequiresApproval: true,
                adminBypassIrreversible: true,
                approvalValueThreshold: 100,
                // whatsappDestinationAllowlist omitido
            },
        });
        expect(res.status).toBe(400);
        expect(mockUiConfigService.update).not.toHaveBeenCalled();
    });

    it('#1207: PUT com whatsappDestinationAllowlist não-array retorna 400', async () => {
        const res = await request(app).put('/api/ui-config').send({
            actionGovernance: {
                irreversibleRequiresApproval: true,
                adminBypassIrreversible: true,
                approvalValueThreshold: null,
                whatsappDestinationAllowlist: '5511,5522',
            },
        });
        expect(res.status).toBe(400);
        expect(mockUiConfigService.update).not.toHaveBeenCalled();
    });

    // #1204: kill-switches de automações de fundo — o Zod precisa declarar o objeto para os
    // flags sobreviverem ao .parse() e chegarem intactos ao service (round-trip).
    it('#1204: PUT com automationSwitches propaga os 2 flags pro service intactos', async () => {
        const sw = { schedulerEnabled: false, alertCronEnabled: false };
        mockUiConfigService.update.mockReturnValueOnce({ automationSwitches: sw });
        const res = await request(app).put('/api/ui-config').send({ automationSwitches: sw });
        expect(res.status).toBe(200);
        expect(mockUiConfigService.update).toHaveBeenCalledWith({ automationSwitches: sw });
        const sent = mockUiConfigService.update.mock.calls[0][0].automationSwitches;
        expect(sent).toEqual({ schedulerEnabled: false, alertCronEnabled: false });
        expect(res.body.automationSwitches).toEqual({ schedulerEnabled: false, alertCronEnabled: false });
    });

    it('#1204: PUT com só um flag (schedulerEnabled) chega intacto (não estripado pelo Zod)', async () => {
        mockUiConfigService.update.mockReturnValueOnce({ automationSwitches: { schedulerEnabled: false, alertCronEnabled: true } });
        const res = await request(app).put('/api/ui-config').send({ automationSwitches: { schedulerEnabled: false } });
        expect(res.status).toBe(200);
        expect(mockUiConfigService.update).toHaveBeenCalledWith({ automationSwitches: { schedulerEnabled: false } });
    });

    it('#1204: PUT com tipo errado em automationSwitches.schedulerEnabled retorna 400', async () => {
        const res = await request(app).put('/api/ui-config').send({ automationSwitches: { schedulerEnabled: 'no' } });
        expect(res.status).toBe(400);
        expect(mockUiConfigService.update).not.toHaveBeenCalled();
    });
});
