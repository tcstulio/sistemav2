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
import { adminAuditService } from '../../services/adminAuditService';

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

    // #1129: kill-switches perigosos (DRY_RUN / FINANCIAL_COMMANDS / CRM_CONTEXT).
    it('#1129: PUT com featureSwitches propaga os 3 flags pro service intactos', async () => {
        const sw = { dryRunMode: true, financialCommands: true, crmContextInjection: false };
        mockUiConfigService.update.mockReturnValueOnce({ featureSwitches: sw });
        const res = await request(app).put('/api/ui-config').send({ featureSwitches: sw });
        expect(res.status).toBe(200);
        expect(mockUiConfigService.update).toHaveBeenCalledWith({ featureSwitches: sw });
        const sent = mockUiConfigService.update.mock.calls[0][0].featureSwitches;
        expect(sent).toEqual({ dryRunMode: true, financialCommands: true, crmContextInjection: false });
        expect(res.body.featureSwitches).toEqual({ dryRunMode: true, financialCommands: true, crmContextInjection: false });
    });

    it('#1129: PUT mudando financialCommands registra auditoria financeira (trilha de quem acionou)', async () => {
        // get() (pré-update) indica financial OFF; update habilita → mudou OFF→ON.
        mockUiConfigService.get.mockReturnValue({ featureSwitches: { financialCommands: false } });
        mockUiConfigService.update.mockReturnValueOnce({
            featureSwitches: { dryRunMode: false, financialCommands: true, crmContextInjection: true },
        });
        const res = await request(app).put('/api/ui-config').send({ featureSwitches: { financialCommands: true } });
        expect(res.status).toBe(200);
        const financialAudit = (adminAuditService.record as any).mock.calls.find(
            (c: any[]) => c[0].action === 'ui-config.feature-switches.financial',
        );
        expect(financialAudit).toBeTruthy();
        expect(financialAudit[0]).toMatchObject({ target: 'financialCommands' });
        expect(financialAudit[0].changes.financialCommands).toEqual({ before: false, after: true });
        expect(financialAudit[0].summary).toContain('HABILITADOS');
    });

    it('#1129: PUT mantendo financialCommands igual NÃO registra auditoria financeira', async () => {
        mockUiConfigService.get.mockReturnValue({ featureSwitches: { financialCommands: true } });
        mockUiConfigService.update.mockReturnValueOnce({
            featureSwitches: { dryRunMode: false, financialCommands: true, crmContextInjection: true },
        });
        const res = await request(app).put('/api/ui-config').send({ featureSwitches: { financialCommands: true } });
        expect(res.status).toBe(200);
        const financialAudit = (adminAuditService.record as any).mock.calls.find(
            (c: any[]) => c[0].action === 'ui-config.feature-switches.financial',
        );
        expect(financialAudit).toBeUndefined();
    });

    it('#1129: PUT sem mexer no financialCommands NÃO registra auditoria financeira', async () => {
        mockUiConfigService.update.mockReturnValueOnce({
            featureSwitches: { dryRunMode: true, financialCommands: false, crmContextInjection: true },
        });
        const res = await request(app).put('/api/ui-config').send({ featureSwitches: { dryRunMode: true } });
        expect(res.status).toBe(200);
        const financialAudit = (adminAuditService.record as any).mock.calls.find(
            (c: any[]) => c[0].action === 'ui-config.feature-switches.financial',
        );
        expect(financialAudit).toBeUndefined();
    });

    it('#1129: PUT com tipo errado em featureSwitches.dryRunMode retorna 400', async () => {
        const res = await request(app).put('/api/ui-config').send({ featureSwitches: { dryRunMode: 'sim' } });
        expect(res.status).toBe(400);
        expect(mockUiConfigService.update).not.toHaveBeenCalled();
    });

    // #1293: política de notificações (cadência/quiet-hours/alertas) — o Zod precisa declarar o
    // objeto p/ os campos sobreviverem ao .parse() e chegarem intactos no service (round-trip).
    it('#1293: PUT com notificationPolicy propaga o bloco inteiro pro service intacto', async () => {
        const policy = {
            cobrancaCadence: { reminderDaysBefore: 5, recobrancaIntervalDays: 4, escalateAfterCobrancas: 6, prazoDeAceiteDays: 2 },
            quietHours: {
                whatsapp: { enabled: true, startHHmm: '21:00', endHHmm: '06:00', weekdaysOnly: true },
                email: { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
                'in-app': { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
            },
            staleHours: 48,
            invoiceDueHorizonDays: 7,
        };
        mockUiConfigService.update.mockReturnValueOnce({ notificationPolicy: policy });
        const res = await request(app).put('/api/ui-config').send({ notificationPolicy: policy });
        expect(res.status).toBe(200);
        expect(mockUiConfigService.update).toHaveBeenCalledWith({ notificationPolicy: policy });
        const sent = mockUiConfigService.update.mock.calls[0][0].notificationPolicy;
        expect(sent).toEqual(policy);
        expect(sent.cobrancaCadence.reminderDaysBefore).toBe(5);
        expect(sent.quietHours.whatsapp.enabled).toBe(true);
        expect(res.body.notificationPolicy).toEqual(policy);
    });

    it('#1293: PUT só com staleHours chega intacto (não estripado pelo Zod)', async () => {
        mockUiConfigService.update.mockReturnValueOnce({ notificationPolicy: { staleHours: 72 } });
        const res = await request(app).put('/api/ui-config').send({ notificationPolicy: { staleHours: 72 } });
        expect(res.status).toBe(200);
        expect(mockUiConfigService.update).toHaveBeenCalledWith({ notificationPolicy: { staleHours: 72 } });
    });

    // #1443: juiz Claude-first (#1411) — o Zod do taskAutomation estripava `judgeModel` (chave
    // não listada no schema) e o save do editor voltava p/ '' (cadeia do chat). Agora `judgeModel`
    // sobrevive ao .parse() e chega intacto no service (round-trip PUT → GET).
    it('#1443: PUT com taskAutomation.judgeModel propaga intacto (não estripado pelo Zod)', async () => {
        const custom = { maxJudgeRounds: 5, judgeModel: 'opus' };
        mockUiConfigService.update.mockReturnValueOnce({ taskAutomation: { ...custom, minMergeScore: 8 } });
        const res = await request(app).put('/api/ui-config').send({ taskAutomation: custom });
        expect(res.status).toBe(200);
        const sent = mockUiConfigService.update.mock.calls[0][0].taskAutomation;
        expect(sent).toMatchObject({ judgeModel: 'opus', maxJudgeRounds: 5 });
        expect(res.body.taskAutomation).toMatchObject({ judgeModel: 'opus' });
    });

    it('#1443: PUT com judgeModel vazio ("") propaga intacto (limpar juiz → cadeia do chat)', async () => {
        const custom = { maxJudgeRounds: 5, judgeModel: '' };
        mockUiConfigService.update.mockReturnValueOnce({ taskAutomation: { ...custom, minMergeScore: 8 } });
        const res = await request(app).put('/api/ui-config').send({ taskAutomation: custom });
        expect(res.status).toBe(200);
        const sent = mockUiConfigService.update.mock.calls[0][0].taskAutomation;
        expect(sent).toMatchObject({ judgeModel: '' });
        expect(res.body.taskAutomation).toMatchObject({ judgeModel: '' });
    });

    it('#1443: PUT com judgeModel > 60 chars NÃO quebra a validação — Zod passa pro service, que trunca p/ 60 (AC#3)', async () => {
        // Padrão do projeto (#1207/#1293): a rota valida só forma/tipos; o cap fica no service.
        // .slice(0, 60) TRUNCA (não rejeita) → put não pode devolver 400 p/ 61 chars.
        const long = 'x'.repeat(61);
        const truncated = 'x'.repeat(60);
        // Mock do update simula o sanitize real: trunca judgeModel > 60 antes de devolver.
        mockUiConfigService.update.mockImplementationOnce((p: any) => ({
            ...p,
            taskAutomation: {
                ...(p.taskAutomation || {}),
                judgeModel: typeof p.taskAutomation?.judgeModel === 'string'
                    ? p.taskAutomation.judgeModel.trim().slice(0, 60)
                    : truncated,
            },
        }));
        const res = await request(app).put('/api/ui-config').send({
            taskAutomation: { judgeModel: long },
        });
        expect(res.status).toBe(200);
        // O Zod passou intacto p/ o service (não estripa + não rejeita).
        expect(mockUiConfigService.update).toHaveBeenCalledWith({ taskAutomation: { judgeModel: long } });
        // O service (mock simulando sanitize real) trunca p/ 60 antes de responder.
        expect(res.body.taskAutomation).toMatchObject({ judgeModel: truncated });
    });

    it('#1443: PUT com judgeModel exatamente 60 chars passa intacto p/ o service', async () => {
        // Sem .max(60) na rota: o cap é responsabilidade do service. 60 chars passa (sanitize é no-op).
        const custom = { judgeModel: 'x'.repeat(60) };
        mockUiConfigService.update.mockReturnValueOnce({ taskAutomation: { ...custom } });
        const res = await request(app).put('/api/ui-config').send({ taskAutomation: custom });
        expect(res.status).toBe(200);
        const sent = mockUiConfigService.update.mock.calls[0][0].taskAutomation;
        expect(sent).toMatchObject({ judgeModel: 'x'.repeat(60) });
    });

    it('#1443: PUT com judgeModel tipo errado (number) retorna 400', async () => {
        const res = await request(app).put('/api/ui-config').send({ taskAutomation: { judgeModel: 123 } });
        expect(res.status).toBe(400);
        expect(mockUiConfigService.update).not.toHaveBeenCalled();
    });

    // #1443: o editor de Automações manda judgeModel junto dos demais campos. Verifica que
    // TODOS os campos de taskAutomation (incluindo judgeModel) sobrevivem ao .parse() sem
    // regredir (round-trip completo).
    it('#1443: PUT com judgeModel + demais campos de taskAutomation propaga TUDO intacto', async () => {
        const custom = {
            autoPlay: true,
            autoMerge: true,
            autoDecompose: false,
            minMergeScore: 8,
            minApproveScore: 9,
            maxJudgeRounds: 5,
            maxGateFixRounds: 4,
            maxRoundsPerTask: 30,
            dailyRoundBudget: 500,
            judgeModel: 'sonnet',
        };
        mockUiConfigService.update.mockReturnValueOnce({ taskAutomation: custom });
        // A rota lê get().taskAutomation.minMergeScore ANTES do save (#1168), então o mock de
        // get() precisa retornar taskAutomation p/ não estourar "Cannot read properties of undefined".
        mockUiConfigService.get.mockReturnValueOnce({ taskAutomation: { minMergeScore: 8 } });
        const res = await request(app).put('/api/ui-config').send({ taskAutomation: custom });
        expect(res.status).toBe(200);
        const sent = mockUiConfigService.update.mock.calls[0][0].taskAutomation;
        expect(sent).toMatchObject(custom);
        expect(res.body.taskAutomation).toMatchObject(custom);
    });

    // #1443: AC#5 — round-trip PUT→GET real (não só nível-rota). Os mocks de get/update
    // compartilham estado via closure 'stored' e o update aplica o sanitize real (trim+slice 60),
    // simulando o uiConfigService de ponta a ponta: PUT grava, GET reflete o que foi persistido.
    it('#1443: round-trip PUT→GET real persiste judgeModel; >60 chars é truncado pelo service (não rejeitado pela rota)', async () => {
        const stored: { taskAutomation: { judgeModel: string; minMergeScore: number } } = {
            taskAutomation: { judgeModel: '', minMergeScore: 8 },
        };
        // get() devolve uma cópia (defesa contra mutação externa do estado).
        mockUiConfigService.get.mockImplementation(() => ({
            taskAutomation: { ...stored.taskAutomation },
        }));
        // update aplica o sanitize real (espelha sanitizeTaskAutomation do uiConfigService):
        // trim + slice(0, 60) para judgeModel. Estado é mutado in-place p/ simular persistência.
        mockUiConfigService.update.mockImplementation((p: any) => {
            const merged = { ...stored.taskAutomation, ...(p.taskAutomation || {}) };
            if (typeof merged.judgeModel === 'string') {
                merged.judgeModel = merged.judgeModel.trim().slice(0, 60);
            }
            stored.taskAutomation = merged;
            return { taskAutomation: { ...stored.taskAutomation } };
        });

        try {
            // 1) AC#1: PUT com judgeModel='opus' → GET subsequente retorna 'opus' (não '').
            const putRes1 = await request(app).put('/api/ui-config').send({
                taskAutomation: { judgeModel: 'opus' },
            });
            expect(putRes1.status).toBe(200);
            const getRes1 = await request(app).get('/api/ui-config');
            expect(getRes1.status).toBe(200);
            expect(getRes1.body.taskAutomation.judgeModel).toBe('opus');

            // 2) AC#3: PUT com judgeModel > 60 chars NÃO quebra (200); service trunca p/ 60.
            //    O GET subsequente deve refletir o valor truncado, não o input original.
            const longModel = 'y'.repeat(75);
            const putRes2 = await request(app).put('/api/ui-config').send({
                taskAutomation: { judgeModel: longModel },
            });
            expect(putRes2.status).toBe(200);
            const getRes2 = await request(app).get('/api/ui-config');
            expect(getRes2.status).toBe(200);
            expect(getRes2.body.taskAutomation.judgeModel.length).toBe(60);
            expect(getRes2.body.taskAutomation.judgeModel).toBe('y'.repeat(60));

            // 3) AC#2: PUT com judgeModel='' (limpar) → GET subsequente persiste '' (volta p/ chat).
            const putRes3 = await request(app).put('/api/ui-config').send({
                taskAutomation: { judgeModel: '' },
            });
            expect(putRes3.status).toBe(200);
            const getRes3 = await request(app).get('/api/ui-config');
            expect(getRes3.status).toBe(200);
            expect(getRes3.body.taskAutomation.judgeModel).toBe('');
        } finally {
            // Restaura o comportamento default dos mocks p/ não vazar p/ testes seguintes.
            mockUiConfigService.get.mockImplementation(() => ({ companyName: 'CoolGroove', logoText: 'D', themeColor: 'indigo' }));
            mockUiConfigService.update.mockImplementation((p: any) => ({ companyName: 'CoolGroove', logoText: 'D', themeColor: 'indigo', ...p }));
        }
    });

    it('#1293: PUT com tipo errado em notificationPolicy.cobrancaCadence retorna 400', async () => {
        const res = await request(app).put('/api/ui-config').send({
            notificationPolicy: { cobrancaCadence: { reminderDaysBefore: 'cinco' } },
        });
        expect(res.status).toBe(400);
        expect(mockUiConfigService.update).not.toHaveBeenCalled();
    });
});
