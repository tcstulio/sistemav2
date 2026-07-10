import { describe, it, expect } from 'vitest';
import { normalizeIssueTitle, titleSimilarity, findSimilarIssue } from '../../utils/issueDedup';

describe('normalizeIssueTitle', () => {
    it('minúsculas, sem acento e sem pontuação', () => {
        expect(normalizeIssueTitle('Ação: Notificações & Permissões!')).toBe('acao notificacoes permissoes');
    });

    it('remove prefixo conventional-commit (com e sem escopo)', () => {
        expect(normalizeIssueTitle('feat(#1187): Backend: expor dailyRoundsToday()')).toBe('backend expor dailyroundstoday');
        expect(normalizeIssueTitle('fix: corrigir race')).toBe('corrigir race');
    });

    it('colapsa espaços', () => {
        expect(normalizeIssueTitle('  a   b\tc ')).toBe('a b c');
    });
});

describe('titleSimilarity', () => {
    it('1 para títulos iguais módulo formatação', () => {
        expect(titleSimilarity('Backend: expor dailyRoundsToday!', 'backend expor dailyroundstoday')).toBe(1);
    });

    it('alta para variações triviais do mesmo título', () => {
        const a = 'Backend: expor dailyRoundsToday() via rota admin ou campo em /api/tasks/status';
        const b = 'feat: expor dailyRoundsToday via rota admin (campo em /api/tasks/status)';
        expect(titleSimilarity(a, b)).toBeGreaterThanOrEqual(0.8);
    });

    it('baixa para títulos de assuntos diferentes', () => {
        const a = 'Backend: expor dailyRoundsToday() via rota admin';
        const b = 'Frontend: corrigir race de criação de sessão no VirtualAssistant';
        expect(titleSimilarity(a, b)).toBeLessThan(0.3);
    });

    it('0 quando um dos lados não tem tokens', () => {
        expect(titleSimilarity('', 'qualquer coisa')).toBe(0);
    });
});

describe('findSimilarIssue', () => {
    const issues = [
        { number: 10, title: 'Backend: expor dailyRoundsToday() via rota admin ou campo em /api/tasks/status' },
        { number: 11, title: 'Frontend: chip de rodadas + chip de cooldown do Planner no TaskCard' },
        { number: 12, title: 'UI: allowlist de destino WhatsApp no GovernanceEditor' },
    ];

    it('acha o melhor match acima do limiar', () => {
        const m = findSimilarIssue('feat: expor dailyRoundsToday via rota admin — campo em /api/tasks/status', issues);
        expect(m?.number).toBe(10);
        expect(m!.score).toBeGreaterThanOrEqual(0.8);
    });

    it('título normalizado idêntico casa mesmo curto (score 1)', () => {
        const m = findSimilarIssue('UI: allowlist de destino WhatsApp no GovernanceEditor', issues);
        expect(m?.number).toBe(12);
        expect(m?.score).toBe(1);
    });

    it('null quando nada passa do limiar', () => {
        expect(findSimilarIssue('Investigar memory leak no sessionService do WhatsApp', issues)).toBeNull();
    });

    it('lista vazia → null', () => {
        expect(findSimilarIssue('qualquer', [])).toBeNull();
    });

    it('threshold customizado permite matches mais frouxos', () => {
        const m = findSimilarIssue('chip de rodadas no TaskCard', issues, 0.5);
        expect(m?.number).toBe(11);
    });
});
