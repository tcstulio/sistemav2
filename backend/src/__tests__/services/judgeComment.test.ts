import { describe, it, expect } from 'vitest';
import { formatJudgeComment, JUDGE_COMMENT_REVIEW_MAX, JudgeCommentInput } from '../../services/judgeComment';

describe('formatJudgeComment (#1203) — formatador puro do comentário do Judge no PR', () => {
    const base: JudgeCommentInput = {
        score: 8,
        approved: true,
        review: 'Boa implementação.',
        missingCoverage: [],
        attempt: 1,
        issueNumber: 1203,
    };

    it('inclui score X/10, veredito e tentativa', () => {
        const out = formatJudgeComment({ ...base, score: 9, approved: true, attempt: 2 });
        expect(out).toContain('Score: 9/10');
        expect(out).toContain('Aprovado');
        expect(out).toContain('tentativa 2');
    });

    it('traduz approved=false como veto do Juiz', () => {
        const out = formatJudgeComment({ ...base, approved: false });
        expect(out).toContain('Score: 8/10');
        expect(out).toContain('Veto do Juiz');
    });

    it('approved ausente → requer revisão (não assume aprovação)', () => {
        const out = formatJudgeComment({ ...base, approved: undefined });
        expect(out).toMatch(/requer revisão/i);
    });

    it('inclui o resumo do review', () => {
        const out = formatJudgeComment({ ...base, review: 'Cobre todos os critérios de aceite.' });
        expect(out).toContain('Cobre todos os critérios de aceite.');
    });

    it('lista a cobertura faltando (missing_coverage) quando há', () => {
        const out = formatJudgeComment({ ...base, missingCoverage: ['src/foo.ts', 'critério X'] });
        expect(out).toContain('Cobertura faltando');
        expect(out).toContain('- src/foo.ts');
        expect(out).toContain('- critério X');
    });

    it('omite a seção de cobertura quando não há missing_coverage', () => {
        const out = formatJudgeComment({ ...base, missingCoverage: [] });
        expect(out).not.toMatch(/Cobertura faltando/);
    });

    it('trunca o resumo em ~1500 chars e sinaliza o truncamento (defensivo)', () => {
        const long = 'A'.repeat(JUDGE_COMMENT_REVIEW_MAX + 500);
        const out = formatJudgeComment({ ...base, review: long });
        // O corpo do review não excede o limite (truncado).
        const reviewLine = out.split('\n').find((l) => l.startsWith('A')) || '';
        expect(reviewLine.length).toBeLessThanOrEqual(JUDGE_COMMENT_REVIEW_MAX);
        // Sinaliza que houve truncamento.
        expect(out).toMatch(/resumo truncado/i);
        expect(out).toContain(String(JUDGE_COMMENT_REVIEW_MAX));
        // Não contém o "rabo" que foi cortado.
        expect(out).not.toContain('A'.repeat(JUDGE_COMMENT_REVIEW_MAX + 1));
    });

    it('não sinaliza truncamento quando o review é curto', () => {
        const out = formatJudgeComment({ ...base, review: 'curto' });
        expect(out).not.toMatch(/resumo truncado/i);
    });

    it('review vazio → placeholder de sem resumo', () => {
        const out = formatJudgeComment({ ...base, review: '' });
        expect(out).toMatch(/sem resumo/i);
    });

    it('review undefined → placeholder de sem resumo', () => {
        const out = formatJudgeComment({ ...base, review: undefined });
        expect(out).toMatch(/sem resumo/i);
    });

    it('é pura: mesma entrada → mesma saída (sem I/O)', () => {
        const a = formatJudgeComment(base);
        const b = formatJudgeComment(base);
        expect(a).toBe(b);
    });

    it('inclui a referência à issue quando issueNumber é informado', () => {
        const out = formatJudgeComment({ ...base, issueNumber: 42 });
        expect(out).toContain('#42');
    });

    it('não quebra com score 0', () => {
        const out = formatJudgeComment({ ...base, score: 0, approved: false });
        expect(out).toContain('Score: 0/10');
    });
});
