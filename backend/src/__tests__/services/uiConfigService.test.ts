import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

// fs é mockado globalmente (setup.ts); mockamos atomicWrite p/ espiar a persistência.
vi.mock('../../utils/atomicWrite', () => ({ atomicWriteSync: vi.fn() }));
import { atomicWriteSync } from '../../utils/atomicWrite';

const mockedFs = vi.mocked(fs);
const mockedWrite = vi.mocked(atomicWriteSync);

import { UiConfigService, sanitizeActionGovernance, sanitizeFeatureSwitches, sanitizeNotificationPolicy, sanitizeWhatsappProvider } from '../../services/uiConfigService';

describe('uiConfigService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedFs.existsSync.mockReturnValue(false); // padrão: sem arquivo
    });

    it('retorna defaults quando não há arquivo', () => {
        const svc = new UiConfigService('ui.json');
        const cfg = svc.get();
        expect(cfg).toMatchObject({
            companyName: 'CoolGroove',
            logoText: 'D',
            themeColor: 'indigo',
            menu: { hidden: [], order: [] },
            dashboard: { hidden: [], order: [] },
            screenPermissions: { groups: {}, users: {} },
            customPages: [],
        });
        // camada 2: matriz de notificações de tarefa com o padrão aprovado
        expect(cfg.taskNotifications.overdue.responsavel).toEqual(['in-app', 'whatsapp', 'email']);
        expect(cfg.taskNotifications.completed.criador).toContain('in-app');
        expect(cfg.taskNotifications.overdue.interveniente).toEqual([]);
        expect(cfg.taskNotificationsExternalEnabled).toBe(false); // canais externos travados por padrão
    });

    it('update sanitiza taskNotifications (canais válidos, respeita desligamento, default p/ ausente)', () => {
        const svc = new UiConfigService('ui.json');
        const out = svc.update({
            taskNotifications: {
                overdue: { responsavel: ['whatsapp', 'invalido', 'whatsapp'], interveniente: [] },
            },
        } as any);
        expect(out.taskNotifications.overdue.responsavel).toEqual(['whatsapp']); // inválido/duplicado removido
        expect(out.taskNotifications.overdue.interveniente).toEqual([]);          // desligamento respeitado
        expect(out.taskNotifications.overdue.criador).toEqual([]);                // papel ausente no evento -> default
        expect(out.taskNotifications.completed.criador).toContain('in-app');      // evento ausente -> default mantido
    });

    it('taskAutomation: defaults incluem as rodadas configuráveis (maxJudgeRounds/maxGateFixRounds = 3)', () => {
        const svc = new UiConfigService('ui.json');
        expect(svc.get().taskAutomation).toMatchObject({ minMergeScore: 8, minApproveScore: 9, maxJudgeRounds: 3, maxGateFixRounds: 3 });
    });

    it('taskAutomation: clampa as rodadas para 1..10 inteiro (0 não trava o loop; >10 sem custo extra)', () => {
        const svc = new UiConfigService('ui.json');
        const out = svc.update({ taskAutomation: { maxJudgeRounds: 0, maxGateFixRounds: 99 } } as any);
        expect(out.taskAutomation.maxJudgeRounds).toBe(1);    // 0 → piso 1
        expect(out.taskAutomation.maxGateFixRounds).toBe(10); // 99 → teto 10
        const out2 = svc.update({ taskAutomation: { maxJudgeRounds: 4.7 } } as any);
        expect(out2.taskAutomation.maxJudgeRounds).toBe(5);   // arredonda
        expect(out2.taskAutomation.maxGateFixRounds).toBe(3); // ausente → default
    });

    it('taskAutomation item 23: teto de custo — defaults 20/200 e clamp (task 1..100, dia 10..5000)', () => {
        const svc = new UiConfigService('ui.json');
        expect(svc.get().taskAutomation).toMatchObject({ maxRoundsPerTask: 20, dailyRoundBudget: 200 });
        const out = svc.update({ taskAutomation: { maxRoundsPerTask: 0, dailyRoundBudget: 99999 } } as any);
        expect(out.taskAutomation.maxRoundsPerTask).toBe(1);     // 0 → piso 1
        expect(out.taskAutomation.dailyRoundBudget).toBe(5000);  // 99999 → teto 5000
        const out2 = svc.update({ taskAutomation: { dailyRoundBudget: 5 } } as any);
        expect(out2.taskAutomation.dailyRoundBudget).toBe(10);   // 5 → piso 10
    });

    it('taskAutomation: judgeModel — default vazio, string trim+cap, tipo errado → default', () => {
        const svc = new UiConfigService('ui.json');
        expect(svc.get().taskAutomation.judgeModel).toBe(''); // default = cadeia do chat
        const out = svc.update({ taskAutomation: { judgeModel: '  sonnet  ' } } as any);
        expect(out.taskAutomation.judgeModel).toBe('sonnet'); // trim
        const out2 = svc.update({ taskAutomation: { judgeModel: 'x'.repeat(200) } } as any);
        expect(out2.taskAutomation.judgeModel.length).toBe(60); // cap
        const out3 = svc.update({ taskAutomation: { judgeModel: 123 } } as any);
        expect(out3.taskAutomation.judgeModel).toBe(''); // tipo errado → default (não quebra)
    });

    it('taskAutomation item 29: piso de nota SANE = 5 (não aceita <5 para aprovar/mergear)', () => {
        const svc = new UiConfigService('ui.json');
        const out = svc.update({ taskAutomation: { minMergeScore: 2, minApproveScore: 1 } } as any);
        expect(out.taskAutomation.minMergeScore).toBe(5);   // 2 → piso 5
        expect(out.taskAutomation.minApproveScore).toBe(5); // 1 → piso 5
    });

    // #1204 — kill-switches de automações de fundo (default true = nada muda).
    it('automationSwitches: defaults schedulerEnabled/alertCronEnabled = true', () => {
        const svc = new UiConfigService('ui.json');
        expect(svc.get().automationSwitches).toEqual({ schedulerEnabled: true, alertCronEnabled: true });
    });

    it('automationSwitches: round-trip do PUT persiste os flags (false sobrevive ao sanitize)', () => {
        const svc = new UiConfigService('ui.json');
        const out = svc.update({ automationSwitches: { schedulerEnabled: false, alertCronEnabled: false } } as any);
        expect(out.automationSwitches).toEqual({ schedulerEnabled: false, alertCronEnabled: false });
        // religar também persiste
        const out2 = svc.update({ automationSwitches: { schedulerEnabled: true, alertCronEnabled: true } } as any);
        expect(out2.automationSwitches).toEqual({ schedulerEnabled: true, alertCronEnabled: true });
    });

    it('automationSwitches: sanitize aceita só booleano explícito; ausente/inválido → default true', () => {
        const svc = new UiConfigService('ui.json');
        // flag ausente → default true
        expect(svc.update({ automationSwitches: { schedulerEnabled: false } } as any).automationSwitches)
            .toEqual({ schedulerEnabled: false, alertCronEnabled: true });
        // valor inválido (string) → default true (não coerção implícita)
        expect(svc.update({ automationSwitches: { schedulerEnabled: 'no', alertCronEnabled: 0 } } as any).automationSwitches)
            .toEqual({ schedulerEnabled: true, alertCronEnabled: true });
        // payload inteiro inválido → defaults
        expect(svc.update({ automationSwitches: 'lixo' } as any).automationSwitches)
            .toEqual({ schedulerEnabled: true, alertCronEnabled: true });
    });

    // #1129 — kill-switches perigosos (DRY_RUN / FINANCIAL_COMMANDS / CRM_CONTEXT).
    it('featureSwitches: defaults dryRun/financial OFF e crmContext ON (secure-default)', () => {
        const svc = new UiConfigService('ui.json');
        expect(svc.get().featureSwitches).toEqual({ dryRunMode: false, financialCommands: false, crmContextInjection: true });
    });

    it('featureSwitches: round-trip do PUT persiste os 3 flags (false sobrevive ao sanitize)', () => {
        const svc = new UiConfigService('ui.json');
        const out = svc.update({ featureSwitches: { dryRunMode: true, financialCommands: true, crmContextInjection: false } } as any);
        expect(out.featureSwitches).toEqual({ dryRunMode: true, financialCommands: true, crmContextInjection: false });
        // como o sanitize substitui o bloco inteiro (mesmo padrão do automationSwitches), religar só o
        // crm mantém o que foi enviado e leva os demais aos defaults (OFF).
        const out2 = svc.update({ featureSwitches: { crmContextInjection: true } } as any);
        expect(out2.featureSwitches).toEqual({ dryRunMode: false, financialCommands: false, crmContextInjection: true });
    });

    it('featureSwitches: sanitize aceita só booleano explícito; ausente/inválido → default', () => {
        // flag ausente → default respectivo
        expect(sanitizeFeatureSwitches({ dryRunMode: true })).toEqual({ dryRunMode: true, financialCommands: false, crmContextInjection: true });
        // valor inválido (string/number) → default (não coerção implícita)
        expect(sanitizeFeatureSwitches({ dryRunMode: 'yes', financialCommands: 1, crmContextInjection: 'false' }))
            .toEqual({ dryRunMode: false, financialCommands: false, crmContextInjection: true });
        // payload inteiro inválido → defaults
        expect(sanitizeFeatureSwitches(null)).toEqual({ dryRunMode: false, financialCommands: false, crmContextInjection: true });
        expect(sanitizeFeatureSwitches('lixo')).toEqual({ dryRunMode: false, financialCommands: false, crmContextInjection: true });
    });

    it('featureSwitches: load() preenche defaults quando o arquivo não tem o bloco', () => {
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(JSON.stringify({ companyName: 'X' }) as any);
        const svc = new UiConfigService('ui.json');
        expect(svc.get().featureSwitches).toEqual({ dryRunMode: false, financialCommands: false, crmContextInjection: true });
    });

    it('update aplica e persiste campos válidos', () => {
        const svc = new UiConfigService('ui.json');
        const out = svc.update({ companyName: 'ACME', logoText: 'A', themeColor: 'emerald' });
        expect(out.companyName).toBe('ACME');
        expect(out.logoText).toBe('A');
        expect(out.themeColor).toBe('emerald');
        expect(mockedWrite).toHaveBeenCalled();
    });

    it('rejeita themeColor fora da allowlist (mantém o atual)', () => {
        const svc = new UiConfigService('ui.json');
        const out = svc.update({ themeColor: 'hackcolor; content:url()' });
        expect(out.themeColor).toBe('indigo');
    });

    it('limita o tamanho de companyName/logoText', () => {
        const svc = new UiConfigService('ui.json');
        const out = svc.update({ companyName: 'x'.repeat(200), logoText: 'ABCDEFGHIJ' });
        expect(out.companyName.length).toBe(100);
        expect(out.logoText.length).toBe(8);
    });

    it('update sanitiza screenPermissions (#112)', () => {
        const svc = new UiConfigService('ui.json');
        const out = svc.update({
            screenPermissions: {
                groups: { '5': { hidden: ['invoices', 'invoices', ''], allowed: ['simulator'] } },
                users: { '12': { hidden: ['orders'] } as any },
            } as any,
        });
        expect(out.screenPermissions.groups['5']).toEqual({ hidden: ['invoices'], allowed: ['simulator'] });
        expect(out.screenPermissions.users['12']).toEqual({ hidden: ['orders'], allowed: [] });
        expect(mockedWrite).toHaveBeenCalled();
    });

    it('update sanitiza customPages (#113): slug seguro, embed só https, blocos válidos', () => {
        const svc = new UiConfigService('ui.json');
        const out = svc.update({
            customPages: [
                {
                    title: 'Portal RH', slug: 'Portal RH!!', icon: 'Users',
                    visibility: { groups: ['3'], users: [] },
                    blocks: [
                        { id: 'a', type: 'richtext', html: '<b>oi</b>' },
                        { id: 'b', type: 'embed', embedUrl: 'javascript:alert(1)', height: 99999 },
                        { id: 'c', type: 'embed', embedUrl: 'https://ok.com', height: 600 },
                        { id: 'd', type: 'links', links: [{ label: 'Site', url: 'https://x.com' }, { label: '', url: '' }] },
                        { type: 'invalid' },
                    ],
                },
                { title: '' }, // descartada (sem título)
            ],
        } as any);
        expect(out.customPages).toHaveLength(1);
        const page = out.customPages[0];
        expect(page.slug).toBe('portal-rh');
        expect(page.visibility).toEqual({ groups: ['3'], users: [] });
        // bloco embed inválido fica com url vazia; height limitado; bloco 'invalid' removido; link vazio removido
        expect(page.blocks.map((b) => b.type)).toEqual(['richtext', 'embed', 'embed', 'links']);
        expect(page.blocks[1].embedUrl).toBe('');
        expect(page.blocks[1].height).toBe(2000);
        expect(page.blocks[2].embedUrl).toBe('https://ok.com');
        expect(page.blocks[3].links).toHaveLength(1);
    });

    it('update aplica menu/dashboard (#110/#111)', () => {
        const svc = new UiConfigService('ui.json');
        const out = svc.update({ menu: { hidden: ['chat'], order: ['dashboard', 'agenda'] } });
        expect(out.menu).toEqual({ hidden: ['chat'], order: ['dashboard', 'agenda'] });
        expect(out.dashboard).toEqual({ hidden: [], order: [] }); // intacto
    });

    it('carrega do arquivo quando existe (preenche defaults faltantes)', () => {
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(JSON.stringify({ companyName: 'Loaded', themeColor: 'rose' }) as any);
        const svc = new UiConfigService('ui.json');
        expect(svc.get().companyName).toBe('Loaded');
        expect(svc.get().themeColor).toBe('rose');
        expect(svc.get().logoText).toBe('D'); // default preenchido
    });
});

describe('sanitizeActionGovernance', () => {
    const PERMISSIVE_DEFAULTS = {
        irreversibleRequiresApproval: false,
        adminBypassIrreversible: true,
        approvalValueThreshold: null,
        whatsappDestinationAllowlist: [],
        businessActionsEnabled: true,
    };

    it('input ausente → defaults permissivos completos', () => {
        expect(sanitizeActionGovernance(undefined)).toEqual(PERMISSIVE_DEFAULTS);
        expect(sanitizeActionGovernance(null)).toEqual(PERMISSIVE_DEFAULTS);
        expect(sanitizeActionGovernance({})).toEqual(PERMISSIVE_DEFAULTS);
    });

    it('businessActionsEnabled (#1370): só booleano explícito; default true', () => {
        expect(sanitizeActionGovernance({ businessActionsEnabled: false }).businessActionsEnabled).toBe(false);
        expect(sanitizeActionGovernance({ businessActionsEnabled: true }).businessActionsEnabled).toBe(true);
        // não-booleano cai no default permissivo (true)
        expect(sanitizeActionGovernance({ businessActionsEnabled: 'no' as any }).businessActionsEnabled).toBe(true);
        expect(sanitizeActionGovernance({ businessActionsEnabled: 0 as any }).businessActionsEnabled).toBe(true);
    });

    it('threshold negativo → null', () => {
        expect(sanitizeActionGovernance({ approvalValueThreshold: -100 }).approvalValueThreshold).toBeNull();
    });

    it('threshold NaN → null', () => {
        expect(sanitizeActionGovernance({ approvalValueThreshold: NaN }).approvalValueThreshold).toBeNull();
    });

    it('threshold 499.6 → 500', () => {
        expect(sanitizeActionGovernance({ approvalValueThreshold: 499.6 }).approvalValueThreshold).toBe(500);
    });

    it('threshold Infinity → null', () => {
        expect(sanitizeActionGovernance({ approvalValueThreshold: Infinity }).approvalValueThreshold).toBeNull();
    });

    it('allowlist com item contendo letras → normalizado p/ só dígitos', () => {
        const out = sanitizeActionGovernance({ whatsappDestinationAllowlist: ['+55 (11) 99999-9999'] });
        expect(out.whatsappDestinationAllowlist).toEqual(['5511999999999']);
    });

    it('allowlist com item < 8 dígitos → descartado', () => {
        const out = sanitizeActionGovernance({ whatsappDestinationAllowlist: ['abc123', '1234567'] });
        expect(out.whatsappDestinationAllowlist).toEqual([]);
    });

    it('allowlist com item > 15 dígitos → descartado', () => {
        const out = sanitizeActionGovernance({ whatsappDestinationAllowlist: ['1234567890123456'] });
        expect(out.whatsappDestinationAllowlist).toEqual([]);
    });

    it('allowlist aceita limites inclusivos (8 e 15 dígitos)', () => {
        const out = sanitizeActionGovernance({ whatsappDestinationAllowlist: ['12345678', '123456789012345'] });
        expect(out.whatsappDestinationAllowlist).toEqual(['12345678', '123456789012345']);
    });

    it('allowlist não-array → []', () => {
        expect(sanitizeActionGovernance({ whatsappDestinationAllowlist: '5511999999999' }).whatsappDestinationAllowlist).toEqual([]);
    });

    it('boolean não-boolean (string "true", number 1) → cai no default', () => {
        const out = sanitizeActionGovernance({
            irreversibleRequiresApproval: 'true',
            adminBypassIrreversible: 1,
        } as any);
        expect(out.irreversibleRequiresApproval).toBe(false); // default
        expect(out.adminBypassIrreversible).toBe(true);       // default (true)
    });

    it('boolean explícito é respeitado', () => {
        const out = sanitizeActionGovernance({
            irreversibleRequiresApproval: true,
            adminBypassIrreversible: false,
        });
        expect(out.irreversibleRequiresApproval).toBe(true);
        expect(out.adminBypassIrreversible).toBe(false);
    });

    it('load() aplica sanitize quando o arquivo não tem o bloco (defaults permissivos)', () => {
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(JSON.stringify({ companyName: 'X' }) as any);
        const svc = new UiConfigService('ui.json');
        expect(svc.get().actionGovernance).toEqual(PERMISSIVE_DEFAULTS);
    });

    it('load() sanitiza actionGovernance inválida do arquivo', () => {
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(JSON.stringify({
            actionGovernance: { irreversibleRequiresApproval: 'sim', approvalValueThreshold: -5, whatsappDestinationAllowlist: ['123'] },
        }) as any);
        const svc = new UiConfigService('ui.json');
        expect(svc.get().actionGovernance).toEqual(PERMISSIVE_DEFAULTS);
    });

    it('update() aplica sanitize antes de gravar', () => {
        const svc = new UiConfigService('ui.json');
        const out = svc.update({
            actionGovernance: {
                irreversibleRequiresApproval: 1,
                adminBypassIrreversible: 0,
                approvalValueThreshold: -50,
                whatsappDestinationAllowlist: ['+55 11 9', '1234567890123456', '+55 (11) 98888-7777'],
            },
        } as any);
        expect(out.actionGovernance).toEqual({
            irreversibleRequiresApproval: false, // default
            adminBypassIrreversible: true,       // default
            approvalValueThreshold: null,
            whatsappDestinationAllowlist: ['5511988887777'], // só o válido
            businessActionsEnabled: true,        // default
        });
        expect(mockedWrite).toHaveBeenCalled();
        // grava exatamente o saneado (não o input cru)
        const written = mockedWrite.mock.calls[mockedWrite.mock.calls.length - 1][1] as any;
        expect(written.actionGovernance).toEqual({
            irreversibleRequiresApproval: false,
            adminBypassIrreversible: true,
            approvalValueThreshold: null,
            whatsappDestinationAllowlist: ['5511988887777'],
            businessActionsEnabled: true,
        });
    });

    it('update() preserva actionGovernance quando ausente do partial', () => {
        const svc = new UiConfigService('ui.json');
        svc.update({ actionGovernance: { irreversibleRequiresApproval: true, approvalValueThreshold: 500 } } as any);
        const out = svc.update({ companyName: 'Novo' });
        expect(out.actionGovernance.irreversibleRequiresApproval).toBe(true);
        expect(out.actionGovernance.approvalValueThreshold).toBe(500);
    });
});

// #1293 — política de notificações (cadência / quiet-hours / alertas).
describe('sanitizeNotificationPolicy', () => {
    const DEFAULTS = {
        cobrancaCadence: { reminderDaysBefore: 1, recobrancaIntervalDays: 2, escalateAfterCobrancas: 3, prazoDeAceiteDays: 1 },
        quietHours: {
            whatsapp: { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
            email: { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
            'in-app': { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
        },
        staleHours: 24,
        invoiceDueHorizonDays: 3,
    };

    it('input ausente/inválido → defaults completos', () => {
        expect(sanitizeNotificationPolicy(undefined)).toEqual(DEFAULTS);
        expect(sanitizeNotificationPolicy(null)).toEqual(DEFAULTS);
        expect(sanitizeNotificationPolicy('lixo')).toEqual(DEFAULTS);
        expect(sanitizeNotificationPolicy({})).toEqual(DEFAULTS);
    });

    it('clampa cadência para as faixas sane (nega vira piso/0, recobranca/escala com piso 1)', () => {
        const out = sanitizeNotificationPolicy({
            cobrancaCadence: { reminderDaysBefore: -3, recobrancaIntervalDays: 0, escalateAfterCobrancas: 99, prazoDeAceiteDays: -1 },
        });
        expect(out.cobrancaCadence).toEqual({ reminderDaysBefore: 0, recobrancaIntervalDays: 1, escalateAfterCobrancas: 30, prazoDeAceiteDays: 0 });
    });

    it('arredonda valores fracionados da cadência', () => {
        const out = sanitizeNotificationPolicy({ cobrancaCadence: { reminderDaysBefore: 2.7, recobrancaIntervalDays: 3.2 } });
        expect(out.cobrancaCadence.reminderDaysBefore).toBe(3);
        expect(out.cobrancaCadence.recobrancaIntervalDays).toBe(3);
    });

    it('clampa staleHours (1..720) e invoiceDueHorizonDays (0..365)', () => {
        const out = sanitizeNotificationPolicy({ staleHours: 0, invoiceDueHorizonDays: 9999 });
        expect(out.staleHours).toBe(1);
        expect(out.invoiceDueHorizonDays).toBe(365);
        const out2 = sanitizeNotificationPolicy({ staleHours: 48.4 });
        expect(out2.staleHours).toBe(48);
    });

    it('valida HH:mm: malformado vira default, válido é preservado', () => {
        const out = sanitizeNotificationPolicy({
            quietHours: {
                whatsapp: { enabled: true, startHHmm: '99:99', endHHmm: '07:00', weekdaysOnly: true },
                email: { enabled: true, startHHmm: '20:30', endHHmm: '06:15' },
            },
        });
        expect(out.quietHours.whatsapp.startHHmm).toBe('22:00'); // inválido → default
        expect(out.quietHours.whatsapp.weekdaysOnly).toBe(true);
        expect(out.quietHours.email.startHHmm).toBe('20:30');
        expect(out.quietHours.email.endHHmm).toBe('06:15');
    });

    it('preserva crossing midnight (end < start) sem rejeitar', () => {
        const out = sanitizeNotificationPolicy({ quietHours: { 'in-app': { enabled: true, startHHmm: '22:00', endHHmm: '07:00' } } });
        expect(out.quietHours['in-app'].startHHmm).toBe('22:00');
        expect(out.quietHours['in-app'].endHHmm).toBe('07:00');
    });

    it('boolean não-boolean cai no default', () => {
        const out = sanitizeNotificationPolicy({ quietHours: { whatsapp: { enabled: 'sim', weekdaysOnly: 1 } } });
        expect(out.quietHours.whatsapp.enabled).toBe(false);
        expect(out.quietHours.whatsapp.weekdaysOnly).toBe(false);
    });

    it('load() preenche defaults quando o arquivo não tem o bloco', () => {
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(JSON.stringify({ companyName: 'X' }) as any);
        const svc = new UiConfigService('ui.json');
        expect(svc.get().notificationPolicy).toEqual(DEFAULTS);
    });

    it('update() aplica sanitize e persiste (round-trip)', () => {
        const svc = new UiConfigService('ui.json');
        const out = svc.update({
            notificationPolicy: {
                cobrancaCadence: { reminderDaysBefore: 5, recobrancaIntervalDays: 4 },
                quietHours: { whatsapp: { enabled: true, startHHmm: '21:00', endHHmm: '06:00' } },
                staleHours: 48,
                invoiceDueHorizonDays: 7,
            },
        } as any);
        expect(out.notificationPolicy).toEqual({
            cobrancaCadence: { reminderDaysBefore: 5, recobrancaIntervalDays: 4, escalateAfterCobrancas: 3, prazoDeAceiteDays: 1 },
            quietHours: {
                whatsapp: { enabled: true, startHHmm: '21:00', endHHmm: '06:00', weekdaysOnly: false },
                email: { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
                'in-app': { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
            },
            staleHours: 48,
            invoiceDueHorizonDays: 7,
        });
        expect(mockedWrite).toHaveBeenCalled();
        const written = mockedWrite.mock.calls[mockedWrite.mock.calls.length - 1][1] as any;
        expect(written.notificationPolicy.cobrancaCadence.reminderDaysBefore).toBe(5);
    });

    it('update() preserva notificationPolicy quando ausente do partial', () => {
        const svc = new UiConfigService('ui.json');
        svc.update({ notificationPolicy: { staleHours: 48 } } as any);
        const out = svc.update({ companyName: 'Novo' });
        expect(out.notificationPolicy.staleHours).toBe(48);
    });

    // #1439 — sessionId primário do WhatsApp (default global p/ scheduler).
    describe('whatsappPrimarySessionId (#1439)', () => {
        it('default vazio = delega ao resolveSession em runtime', () => {
            const svc = new UiConfigService('ui.json');
            expect(svc.get().whatsappPrimarySessionId).toBe('');
        });

        it('round-trip do PUT persiste o valor (trim + cap 80)', () => {
            const svc = new UiConfigService('ui.json');
            const out = svc.update({ whatsappPrimarySessionId: '  sessao-principal  ' } as any);
            expect(out.whatsappPrimarySessionId).toBe('sessao-principal'); // trim
            const out2 = svc.update({ whatsappPrimarySessionId: 'x'.repeat(200) } as any);
            expect(out2.whatsappPrimarySessionId.length).toBe(80); // cap
            const out3 = svc.update({ whatsappPrimarySessionId: '' } as any);
            expect(out3.whatsappPrimarySessionId).toBe(''); // vazio é válido (= resolveSession decide)
        });

        it('load() carrega valor persistido; campo ausente ou tipo errado → vazio', () => {
            // valor válido persistido
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue(JSON.stringify({ whatsappPrimarySessionId: 'v4' }) as any);
            expect(new UiConfigService('ui.json').get().whatsappPrimarySessionId).toBe('v4');

            // campo ausente (arquivo antigo)
            mockedFs.readFileSync.mockReturnValue(JSON.stringify({ companyName: 'X' }) as any);
            expect(new UiConfigService('ui.json').get().whatsappPrimarySessionId).toBe('');

            // tipo errado → string vazia (não quebra)
            mockedFs.readFileSync.mockReturnValue(JSON.stringify({ whatsappPrimarySessionId: 123 }) as any);
            expect(new UiConfigService('ui.json').get().whatsappPrimarySessionId).toBe('');
        });
    });

    // #1410 — override persistente do provider WhatsApp. Sem este sanitize, o "setter fantasma"
    // das rotas admin/integration ficava restrito a mudar em memória (resolveBootWhatsAppProvider
    // só lê o campo, e um valor corrompido/string fora do domínio quebraria o boot).
    describe('sanitizeWhatsappProvider (#1410)', () => {
        it('aceita os dois valores válidos do domínio', () => {
            expect(sanitizeWhatsappProvider('legacy')).toBe('legacy');
            expect(sanitizeWhatsappProvider('moltbot')).toBe('moltbot');
        });

        it('rejeita null/undefined → undefined (cai no env)', () => {
            expect(sanitizeWhatsappProvider(null)).toBeUndefined();
            expect(sanitizeWhatsappProvider(undefined)).toBeUndefined();
        });

        it('rejeita string vazia, número, boolean e strings parecidas mas inválidas', () => {
            expect(sanitizeWhatsappProvider('')).toBeUndefined();
            expect(sanitizeWhatsappProvider('LEGACY')).toBeUndefined();   // case-sensitive
            expect(sanitizeWhatsappProvider('legacy ')).toBeUndefined();  // não trim
            expect(sanitizeWhatsappProvider('legacy\n')).toBeUndefined();
            expect(sanitizeWhatsappProvider('legacy2')).toBeUndefined();
            expect(sanitizeWhatsappProvider('zapi')).toBeUndefined();     // nem é do domínio
            expect(sanitizeWhatsappProvider(0)).toBeUndefined();
            expect(sanitizeWhatsappProvider(1)).toBeUndefined();
            expect(sanitizeWhatsappProvider(true)).toBeUndefined();
            expect(sanitizeWhatsappProvider({})).toBeUndefined();
            expect(sanitizeWhatsappProvider([])).toBeUndefined();
        });
    });

    describe('whatsappProvider (#1410) — persistência do override', () => {
        it('default: campo ausente no arquivo → undefined (cai no env)', () => {
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue(JSON.stringify({ companyName: 'X' }) as any);
            expect(new UiConfigService('ui.json').get().whatsappProvider).toBeUndefined();
        });

        it('load(): valor válido persistido é preservado; valor inválido é descartado', () => {
            // válido
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue(JSON.stringify({ whatsappProvider: 'moltbot' }) as any);
            expect(new UiConfigService('ui.json').get().whatsappProvider).toBe('moltbot');

            // inválido → cai no env (não quebra o boot)
            mockedFs.readFileSync.mockReturnValue(JSON.stringify({ whatsappProvider: 'zapi' }) as any);
            expect(new UiConfigService('ui.json').get().whatsappProvider).toBeUndefined();

            // tipo errado → undefined
            mockedFs.readFileSync.mockReturnValue(JSON.stringify({ whatsappProvider: 42 }) as any);
            expect(new UiConfigService('ui.json').get().whatsappProvider).toBeUndefined();
        });

        it('update(): round-trip persiste o override (e salva no disco via atomicWriteSync)', () => {
            const svc = new UiConfigService('ui.json');
            const out = svc.update({ whatsappProvider: 'moltbot' } as any);
            expect(out.whatsappProvider).toBe('moltbot');
            expect(mockedWrite).toHaveBeenCalled();
            const written = mockedWrite.mock.calls[mockedWrite.mock.calls.length - 1][1] as any;
            expect(written.whatsappProvider).toBe('moltbot');
        });

        it('update(): null/undefined explícito remove o override (volta ao env)', () => {
            const svc = new UiConfigService('ui.json');
            svc.update({ whatsappProvider: 'moltbot' } as any);
            expect(svc.get().whatsappProvider).toBe('moltbot');
            // reset
            const out = svc.update({ whatsappProvider: null } as any);
            expect(out.whatsappProvider).toBeUndefined();
        });

        it('update(): valor inválido é descartado no sanitize (não persiste)', () => {
            const svc = new UiConfigService('ui.json');
            const out = svc.update({ whatsappProvider: 'zapi' } as any);
            expect(out.whatsappProvider).toBeUndefined();
        });

        it('update(): whatsappProvider ausente do partial mantém o valor atual', () => {
            const svc = new UiConfigService('ui.json');
            svc.update({ whatsappProvider: 'moltbot' } as any);
            const out = svc.update({ companyName: 'Outra' });
            expect(out.whatsappProvider).toBe('moltbot'); // preservado
        });
    });
});
