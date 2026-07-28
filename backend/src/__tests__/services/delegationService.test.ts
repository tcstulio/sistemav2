import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import { DAY_MS, DEFAULT_CADENCE } from '../../services/delegationFollowUpLogic';

const mockDoli = vi.hoisted(() => ({
    setTaskDelegationState: vi.fn().mockResolvedValue(true),
    listDelegationStates: vi.fn().mockResolvedValue([]),
}));
// #1406 — mock do uiConfigService p/ controlar o `cobrancaCadence.prazoDeAceiteDays` lido
// em runtime. Default devolve a cadência saneada (igual ao DEFAULT_CADENCE) p/ preservar
// o comportamento dos testes existentes que não mexem no dial.
const mockUiConfig = vi.hoisted(() => ({
    getCobrancaCadence: vi.fn(() => ({ ...DEFAULT_CADENCE })),
}));
vi.mock('../../services/dolibarr', () => ({ dolibarrService: mockDoli }));
vi.mock('../../services/uiConfigService', () => ({ uiConfigService: mockUiConfig }));
vi.mock('../../utils/atomicWrite', () => ({ atomicWriteSync: vi.fn() }));
vi.mock('../../utils/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));

import { DelegationService } from '../../services/delegationService';

const noon = (d: number) => d * DAY_MS + DAY_MS / 2;
const STORE = path.join(__dirname, '__delegation_store_unit_test__.json');
const newSvc = () => new DelegationService(STORE);

describe('DelegationService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // #1406 — reset do mock do uiConfig para a cadência default (vi.clearAllMocks não reseta implementação).
        mockUiConfig.getCobrancaCadence.mockReturnValue({ ...DEFAULT_CADENCE });
    });

    it('get retorna undefined para tarefa desconhecida; getAceite idem', () => {
        const svc = newSvc();
        expect(svc.get('999')).toBeUndefined();
        expect(svc.getAceite('999')).toBeUndefined();
    });

    it('requestAcceptance marca pending com deadlineDay = hoje + prazo', () => {
        const svc = newSvc();
        const rec = svc.requestAcceptance('50', { nowMs: noon(10), prazoDeAceiteDays: 1, by: '9' });
        expect(rec.aceite?.status).toBe('pending');
        expect(rec.aceite?.deadlineDay).toBe(11);
        expect(svc.getAceite('50')).toEqual({ status: 'pending', deadlineDay: 11 });
    });

    it('accept marca accepted com quem aceitou', () => {
        const svc = newSvc();
        svc.requestAcceptance('50', { nowMs: noon(10) });
        const rec = svc.accept('50', '16', noon(10));
        expect(rec.aceite?.status).toBe('accepted');
        expect(rec.aceite?.by).toBe('16');
        expect(svc.getAceite('50')?.status).toBe('accepted');
    });

    it('decline marca declined com motivo', () => {
        const svc = newSvc();
        svc.requestAcceptance('50', { nowMs: noon(10) });
        const rec = svc.decline('50', '16', 'já tratei com a equipe', noon(10));
        expect(rec.aceite?.status).toBe('declined');
        expect(rec.aceite?.reason).toBe('já tratei com a equipe');
    });

    it('usa o prazo padrão da cadência quando não informado', () => {
        const svc = newSvc();
        const rec = svc.requestAcceptance('50', { nowMs: noon(10) });
        expect(rec.aceite?.deadlineDay).toBe(11); // DEFAULT_CADENCE.prazoDeAceiteDays = 1
    });

    it('setDoc grava objetivo + critério sem apagar o aceite', () => {
        const svc = newSvc();
        svc.requestAcceptance('50', { nowMs: noon(10) });
        const rec = svc.setDoc('50', { objetivo: 'Contar bebidas', criterio: 'Planilha enviada' });
        expect(rec.objetivo).toBe('Contar bebidas');
        expect(rec.criterio).toBe('Planilha enviada');
        expect(rec.aceite?.status).toBe('pending'); // preservado
    });

    // --- Durabilidade no Dolibarr (#293) ---

    it('espelha o estado no Dolibarr a cada upsert (extrafield options_delegation_state)', () => {
        const svc = newSvc();
        svc.accept('50', '16', noon(10));
        expect(mockDoli.setTaskDelegationState).toHaveBeenLastCalledWith('50', expect.stringContaining('"status":"accepted"'));
    });

    it('hydrateFromDolibarr popula o cache local sem sobrescrever o que já existe', async () => {
        const svc = newSvc();
        svc.setDoc('50', { objetivo: 'local' }); // já existe localmente → não sobrescreve
        mockDoli.listDelegationStates.mockResolvedValueOnce([
            { taskId: '50', state: JSON.stringify({ taskId: '50', objetivo: 'remoto' }) },
            { taskId: '77', state: JSON.stringify({ taskId: '77', criterio: 'remoto77', aceite: { status: 'accepted' } }) },
        ]);
        const n = await svc.hydrateFromDolibarr();
        expect(n).toBe(1); // só a 77 (a 50 já existia)
        expect(svc.get('50')?.objetivo).toBe('local'); // preservado (cache quente vence)
        expect(svc.get('77')?.criterio).toBe('remoto77');
        expect(svc.getAceite('77')?.status).toBe('accepted');
    });

    it('hydrateFromDolibarr ignora estado corrompido e é best-effort', async () => {
        const svc = newSvc();
        mockDoli.listDelegationStates.mockResolvedValueOnce([{ taskId: '88', state: '{corrompido' }]);
        const n = await svc.hydrateFromDolibarr();
        expect(n).toBe(0);
        expect(svc.get('88')).toBeUndefined();
    });
});

// #1406 — TESTE DE ENFORCEMENT para `delegationService.requestAcceptance` (AC#3 da issue).
// Valida que o dial `cobrancaCadence.prazoDeAceiteDays` do uiConfigService é lido em
// RUNTIME (sem restart) e que o deadlineDay reflete EXATAMENTE o valor configurado —
// não os defaults hard-coded.
describe('DelegationService — runtime cobrancaCadence (#1406)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUiConfig.getCobrancaCadence.mockReturnValue({ ...DEFAULT_CADENCE });
    });

    it('enforcement #1406: prazoDeAceiteDays do uiConfigService é respeitado em runtime (sem restart)', () => {
        // Admin setou prazoDeAceiteDays=7 (≠ default 1) via PUT /api/ui-config.
        mockUiConfig.getCobrancaCadence.mockReturnValue({ ...DEFAULT_CADENCE, prazoDeAceiteDays: 7 });
        const svc = newSvc();
        const rec = svc.requestAcceptance('50', { nowMs: noon(10) });
        // dayIndex(noon(10)) + 7 = 10 + 7 = 17 — prova que o valor configurado foi usado.
        expect(rec.aceite?.deadlineDay).toBe(17);
        // helper foi consultado (prova o runtime read, não cache de construção).
        expect(mockUiConfig.getCobrancaCadence).toHaveBeenCalled();
    });

    it('controle #1406: com DEFAULT_CADENCE (prazoDeAceiteDays=1), deadlineDay cai 1 dia após hoje', () => {
        // CONTROLE: com o dial default (sem override), o comportamento histórico é mantido.
        mockUiConfig.getCobrancaCadence.mockReturnValue({ ...DEFAULT_CADENCE }); // prazoDeAceiteDays=1
        const svc = newSvc();
        const rec = svc.requestAcceptance('50', { nowMs: noon(10) });
        expect(rec.aceite?.deadlineDay).toBe(11); // dayIndex(10) + 1
    });

    it('enforcement #1406: prazo explícito no opts vence o config (não há regressão)', () => {
        // Caller pode sobrescrever prazoDeAceiteDays por chamada — comportamento preservado.
        mockUiConfig.getCobrancaCadence.mockReturnValue({ ...DEFAULT_CADENCE, prazoDeAceiteDays: 7 });
        const svc = newSvc();
        const rec = svc.requestAcceptance('50', { nowMs: noon(10), prazoDeAceiteDays: 3 });
        // opts.prazoDeAceiteDays=3 vence o config=7 — não regrediu a API existente.
        expect(rec.aceite?.deadlineDay).toBe(13); // dayIndex(10) + 3
    });
});
