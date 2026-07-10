import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    analyzeTask,
    normalizeText,
    extractKeywords,
    jaccard,
    textSimilarity,
    commitMatchesTask,
    logMatchesTask,
    extractFileHints,
    type PreCheckSources,
    type RawGithubIssue,
    type RawGitCommit,
    type RawOpencodeTask,
} from './taskPreCheck';

/**
 * Factory de fontes mockadas — cada caso de teste sobrescreve só o que precisa.
 * `analyzeTask` recebe as fontes injetadas, então nenhum I/O real (gh/git/fs)
 * roda durante os testes.
 */
function makeSources(overrides: Partial<PreCheckSources> = {}): PreCheckSources {
    return {
        listGithubIssues: vi.fn(async (_state: 'open' | 'closed' | 'all'): Promise<RawGithubIssue[]> => []),
        listOpencodeTasks: vi.fn(async (): Promise<RawOpencodeTask[]> => []),
        gitRecentCommits: vi.fn(async (_limit: number): Promise<RawGitCommit[]> => []),
        readRecentLogs: vi.fn(async (_lines: number): Promise<string[]> => []),
        projectFileExists: vi.fn((_h: string) => false),
        ...overrides,
    };
}

describe('taskPreCheck — helpers puros', () => {
    it('normalizeText remove acentos e caixa', () => {
        expect(normalizeText('Erro ÀÀ çÃo')).toBe('erro aa cao');
    });

    it('extractKeywords filtra stopwords e tokens curtos', () => {
        const kw = extractKeywords('Erro ao salvar o cliente');
        expect(kw.has('erro')).toBe(true);
        expect(kw.has('salvar')).toBe(true);
        expect(kw.has('cliente')).toBe(true);
        expect(kw.has('ao')).toBe(false); // stopword
        expect(kw.has('o')).toBe(false); // stopword + curto
    });

    it('jaccard mede sobreposição de keywords', () => {
        expect(jaccard(extractKeywords('alpha beta gamma'), extractKeywords('alpha beta gamma'))).toBe(1);
        expect(jaccard(extractKeywords('alpha beta gamma'), extractKeywords('xray ypsilon zeta'))).toBe(0);
    });

    it('textSimilarity retorna 1 p/ títulos idênticos e >0 p/ similares', () => {
        expect(textSimilarity('Erro ao salvar cliente', 'Erro ao salvar cliente')).toBe(1);
        expect(textSimilarity('Erro ao salvar cliente', 'salvar cliente')).toBeGreaterThan(0.3);
    });

    it('commitMatchesTask casa mensagem de fix com keywords da task', () => {
        const kw = extractKeywords('Erro ao salvar cliente no cadastro');
        expect(commitMatchesTask('fix: corrigir erro ao salvar cliente (#970)', kw)).toBe(true);
        expect(commitMatchesTask('docs: atualiza readme', kw)).toBe(false);
    });

    it('logMatchesTask casa linha com keyword forte', () => {
        const sig = new Set(['salvar', 'cliente']);
        expect(logMatchesTask('[ERROR] TypeError ao salvar cliente', sig)).toBe(true);
        expect(logMatchesTask('[INFO] backup concluído', sig)).toBe(false);
    });

    it('extractFileHints acha caminhos .ts/.tsx', () => {
        const hints = extractFileHints('ver src/components/Foo.tsx e utils/bar.ts');
        expect(hints).toContain('src/components/Foo.tsx');
        expect(hints).toContain('utils/bar.ts');
    });
});

describe('taskPreCheck.analyzeTask', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('(a) task realmente nova → verdict "ok" + proceed', async () => {
        const title = 'Erro ao salvar cliente no cadastro';
        const sources = makeSources({
            readRecentLogs: vi.fn(async () => [
                '2026-07-09 10:00:00 [ERROR] TypeError ao salvar cliente em /api/customers',
                '2026-07-09 10:01:00 [INFO] request ok',
            ]),
        });

        const report = await analyzeTask({ title, body: 'Falha ao clicar em salvar.' }, sources);

        expect(report.verdict).toBe('ok');
        expect(report.suggestedAction).toBe('proceed');
        expect(report.confidence).toBeGreaterThanOrEqual(0);
        expect(report.confidence).toBeLessThanOrEqual(1);
        expect(report.evidence?.some((e) => e.type === 'log')).toBe(true);
        // não consultou duplicados/resolvidos depois do veredito ok? ao menos chamou logs
        expect(sources.readRecentLogs).toHaveBeenCalled();
    });

    it('(b) task duplicada de issue aberta → verdict "duplicate" + link', async () => {
        const title = 'Erro ao salvar cliente no cadastro';
        const dupe: RawGithubIssue = {
            number: 980,
            title,
            state: 'open',
            url: 'https://github.com/tcstulio/sistemav2/issues/980',
        };
        const sources = makeSources({
            listGithubIssues: vi.fn(async (state) => (state === 'open' ? [dupe] : [])),
        });

        const report = await analyzeTask({ title, body: 'mesmo problema' }, sources);

        expect(report.verdict).toBe('duplicate');
        expect(report.suggestedAction).toBe('ask_user');
        expect(report.originalIssueNumber).toBe(980);
        expect(report.originalUrl).toBe(dupe.url);
        const ev = report.evidence?.find((e) => e.type === 'similar_issue');
        expect(ev?.url).toBe(dupe.url);
        expect(ev?.reference).toBe('#980');
    });

    it('(c) problema já corrigido em commit recente → verdict "already_resolved"', async () => {
        const title = 'Erro ao salvar cliente no cadastro';
        const sources = makeSources({
            gitRecentCommits: vi.fn(async () => [
                { hash: 'abc1234', message: 'fix: corrigir erro ao salvar cliente no cadastro (#970)', date: '2 days ago' },
            ]),
            readRecentLogs: vi.fn(async () => []),
        });

        const report = await analyzeTask({ title, body: 'acontece sempre' }, sources);

        expect(report.verdict).toBe('already_resolved');
        expect(report.suggestedAction).toBe('reject');
        const commitEv = report.evidence?.find((e) => e.type === 'commit');
        expect(commitEv?.reference).toBe('abc1234');
    });

    it('(d) problema sem evidência nos logs/código → verdict "low_evidence"', async () => {
        const title = 'Sincronização de fusos horários falha ao sincronizar';
        const sources = makeSources({
            readRecentLogs: vi.fn(async () => [
                '2026-07-09 [INFO] backup concluído',
                '2026-07-09 [ERROR] timeout em /api/ping',
            ]),
            projectFileExists: vi.fn(() => false),
        });

        const report = await analyzeTask({ title, body: 'não sei o arquivo' }, sources);

        expect(report.verdict).toBe('low_evidence');
        expect(report.suggestedAction).toBe('ask_user');
        expect(report.confidence).toBeLessThan(0.5);
        expect(report.evidence?.length).toBeGreaterThan(0);
    });

    it('(e) referência a arquivo inexistente → verdict "false_report" (extensão do spec)', async () => {
        const title = 'Botão exportar no RelatorioFuturo não funciona';
        const body = 'Acontece em src/components/RelatorioFuturo.tsx ao clicar exportar.';
        const sources = makeSources({
            readRecentLogs: vi.fn(async () => ['[INFO] server ok']),
            projectFileExists: vi.fn(() => false),
        });

        const report = await analyzeTask({ title, body }, sources);

        expect(report.verdict).toBe('false_report');
        expect(report.suggestedAction).toBe('reject');
        expect(report.evidence?.some((e) => e.type === 'missing_file')).toBe(true);
    });

    it('detecta duplicado também via task do board opencode', async () => {
        const title = 'Adicionar exportação CSV na tela de faturas';
        const sources = makeSources({
            listOpencodeTasks: vi.fn(async () => [
                { issueNumber: 555, title, status: 'pending' },
            ]),
        });

        const report = await analyzeTask({ title, body: 'exportar csv' }, sources);

        expect(report.verdict).toBe('duplicate');
        expect(report.originalIssueNumber).toBe(555);
        expect(report.evidence?.some((e) => e.type === 'similar_task')).toBe(true);
    });

    it('fontes que rejeitam não quebram a análise (fallback gracioso)', async () => {
        const sources: PreCheckSources = {
            listGithubIssues: vi.fn(async () => { throw new Error('gh offline'); }),
            listOpencodeTasks: vi.fn(async () => { throw new Error('runner offline'); }),
            gitRecentCommits: vi.fn(async () => { throw new Error('git offline'); }),
            readRecentLogs: vi.fn(async () => ['[ERROR] salvar cliente falhou']),
        };

        const report = await analyzeTask({ title: 'Erro ao salvar cliente', body: '' }, sources);

        // sem duplicado/resolvido (todas caíram no catch) e há log → ok
        expect(report.verdict).toBe('ok');
        expect(report.suggestedAction).toBe('proceed');
    });
});
