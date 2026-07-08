import { describe, it, expect } from 'vitest';
import { normalizePeriod, withinPeriod, filterIssuesByPeriod, ISSUE_PERIOD_FETCH_LIMIT } from '../../utils/issuePeriodFilter';

// Data de referência fixa para tornar os testes determinísticos: 2024-06-21T16:00:00Z
const NOW = new Date('2024-06-21T16:00:00.000Z');
// Meia-noite local de "hoje" (2024-06-21)
const MIDNIGHT = new Date(NOW);
MIDNIGHT.setHours(0, 0, 0, 0);

describe('normalizePeriod', () => {
    it('aceita valores canônicos válidos', () => {
        expect(normalizePeriod('today')).toBe('today');
        expect(normalizePeriod('1')).toBe('1');
        expect(normalizePeriod('5')).toBe('5');
        expect(normalizePeriod('7')).toBe('7');
        expect(normalizePeriod('30')).toBe('30');
        expect(normalizePeriod('all')).toBe('all');
    });

    it('normaliza valores inválidos/ausentes para "all"', () => {
        expect(normalizePeriod(undefined)).toBe('all');
        expect(normalizePeriod(null)).toBe('all');
        expect(normalizePeriod('')).toBe('all');
        expect(normalizePeriod('xyz')).toBe('all');
        expect(normalizePeriod(5)).toBe('all');
        expect(normalizePeriod(['today'])).toBe('all');
    });
});

describe('withinPeriod', () => {
    it('retorna true para qualquer data quando período = "all"', () => {
        expect(withinPeriod(null, 'all', NOW)).toBe(true);
        expect(withinPeriod('2000-01-01T00:00:00Z', 'all', NOW)).toBe(true);
        expect(withinPeriod(undefined, 'all', NOW)).toBe(true);
    });

    it('"today" inclui apenas o que ocorreu desde a meia-noite do dia atual', () => {
        // Hoje à tarde → dentro
        expect(withinPeriod('2024-06-21T08:00:00.000Z', 'today', NOW)).toBe(true);
        // Ontem à noite → fora (antes da meia-noite de hoje, horário local)
        const yesterday = new Date(MIDNIGHT.getTime() - 60 * 1000).toISOString();
        expect(withinPeriod(yesterday, 'today', NOW)).toBe(false);
    });

    it('"1" usa janela móvel de 24h (rolling window), independente do dia de calendário', () => {
        // 12h atrás → dentro das últimas 24h
        expect(withinPeriod('2024-06-21T04:00:00.000Z', '1', NOW)).toBe(true);
        // 25h atrás → fora
        expect(withinPeriod('2024-06-20T15:00:00.000Z', '1', NOW)).toBe(false);
        // Limite exato de 24h é inclusivo (>= cutoff)
        const exactly24h = new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString();
        expect(withinPeriod(exactly24h, '1', NOW)).toBe(true);
    });

    it('"1" (24h) e "today" (calendário) são DISTINTOS — há datas incluídas por um e não pelo outro', () => {
        // 1 minuto antes da meia-noite local de hoje: dentro das últimas 24h, mas antes do
        // reset de calendário. 'today' exclui (pré-meia-noite); '1' inclui (janela móvel).
        const justBeforeMidnight = new Date(MIDNIGHT.getTime() - 60 * 1000).toISOString();
        expect(withinPeriod(justBeforeMidnight, 'today', NOW)).toBe(false);
        expect(withinPeriod(justBeforeMidnight, '1', NOW)).toBe(true);
    });

    it('"5" usa janela móvel de 5*24h', () => {
        // 3 dias atrás → dentro
        expect(withinPeriod('2024-06-18T16:00:00.000Z', '5', NOW)).toBe(true);
        // 6 dias atrás → fora
        expect(withinPeriod('2024-06-15T16:00:00.000Z', '5', NOW)).toBe(false);
    });

    it('"7" usa janela móvel de 7*24h', () => {
        expect(withinPeriod('2024-06-15T16:00:00.000Z', '7', NOW)).toBe(true);
        expect(withinPeriod('2024-06-13T16:00:00.000Z', '7', NOW)).toBe(false);
    });

    it('"30" usa janela móvel de 30*24h', () => {
        expect(withinPeriod('2024-06-01T16:00:00.000Z', '30', NOW)).toBe(true);
        // 40 dias atrás → fora
        expect(withinPeriod('2024-05-12T16:00:00.000Z', '30', NOW)).toBe(false);
    });

    it('data ausente/nula é excluída para períodos não-"all"', () => {
        expect(withinPeriod(null, 'today', NOW)).toBe(false);
        expect(withinPeriod(undefined, '5', NOW)).toBe(false);
        expect(withinPeriod('', '7', NOW)).toBe(false);
    });

    it('data inválida é excluída', () => {
        expect(withinPeriod('not-a-date', '5', NOW)).toBe(false);
    });

    it('limite exato da janela é inclusivo (>= cutoff)', () => {
        // Exatamente 5 dias atrás no instante de corte
        const cutoff = new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000);
        expect(withinPeriod(cutoff.toISOString(), '5', NOW)).toBe(true);
    });
});

describe('filterIssuesByPeriod', () => {
    const issues = [
        { state: 'OPEN', closedAt: null },                                              // 0 — sempre passa
        { state: 'CLOSED', closedAt: '2024-06-21T08:00:00.000Z' },                     // 1 — hoje
        { state: 'closed', closedAt: '2024-06-18T16:00:00.000Z' },                     // 2 — 3 dias atrás
        { state: 'CLOSED', closedAt: '2024-05-01T00:00:00.000Z' },                     // 3 — antiga
        { state: 'CLOSED', closedAt: null },                                            // 4 — fechada sem data
    ];

    it('período "all" não filtra nada', () => {
        expect(filterIssuesByPeriod(issues, 'all', NOW)).toHaveLength(5);
    });

    it('issues abertas sempre passam, independente do período', () => {
        const result = filterIssuesByPeriod(issues, 'today', NOW);
        const openIssue = result.find((i) => i.state === 'OPEN');
        expect(openIssue).toBeTruthy();
    });

    it('"today" mantém abertas + fechadas de hoje; descarta antigas e sem data', () => {
        const result = filterIssuesByPeriod(issues, 'today', NOW);
        // índice 0 (aberta) + índice 1 (hoje)
        expect(result).toHaveLength(2);
        expect(result.some((i) => i.closedAt === '2024-06-21T08:00:00.000Z')).toBe(true);
    });

    it('"1" mantém abertas + fechadas nas últimas 24h', () => {
        const result = filterIssuesByPeriod(issues, '1', NOW);
        // índice 0 (aberta) + índice 1 (8h atrás) — demais fora da janela de 24h
        expect(result).toHaveLength(2);
        expect(result.some((i) => i.closedAt === '2024-06-21T08:00:00.000Z')).toBe(true);
    });

    it('"5" mantém abertas + fechadas nos últimos 5 dias', () => {
        const result = filterIssuesByPeriod(issues, '5', NOW);
        // índice 0 (aberta) + 1 (hoje) + 2 (3 dias)
        expect(result).toHaveLength(3);
    });

    it('descarta fechadas sem closedAt em qualquer período não-"all"', () => {
        const result = filterIssuesByPeriod(issues, '30', NOW);
        const noDate = result.find((i) => i.closedAt === null && i.state === 'CLOSED');
        expect(noDate).toBeUndefined();
    });

    it('lista vazia retorna vazia', () => {
        expect(filterIssuesByPeriod([], 'today', NOW)).toEqual([]);
    });
});

describe('ISSUE_PERIOD_FETCH_LIMIT', () => {
    it('é um número razoável (> 100) para capturar issues fechadas recentes', () => {
        expect(typeof ISSUE_PERIOD_FETCH_LIMIT).toBe('number');
        expect(ISSUE_PERIOD_FETCH_LIMIT).toBeGreaterThan(100);
    });
});
