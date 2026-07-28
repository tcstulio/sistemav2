import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecFile = vi.hoisted(() => vi.fn());

vi.mock('child_process', async () => {
    return {
        execFile: (...args: any[]) => mockExecFile(...args),
        default: { execFile: (...args: any[]) => mockExecFile(...args) },
    };
});

// promisify wrapper: o código usa `promisify(execFile)` que retorna uma função
// que internamente chama execFile com callback. Aqui simulamos isso retornando
// uma Promise resolvida da callback.
function makeExecFileAsync(stderrOut = '') {
    return vi.fn((_cmd: string, _args: string[], _opts: any, cb: any) => {
        // promisify(execFile) chama com callback (err, {stdout, stderr}).
        if (typeof _opts === 'function') {
            cb = _opts;
            _opts = undefined;
        }
        cb(null, { stdout: stderrOut, stderr: '' });
    });
}

beforeEach(() => {
    mockExecFile.mockReset();
});

describe('utils/githubIssue — createGitHubIssue', () => {
    it('executa gh issue create com title, body e labels e devolve URL parseada', async () => {
        mockExecFile.mockImplementation((_c: string, _a: string[], _o: any, cb: any) => {
            cb(null, { stdout: 'https://github.com/tcstulio/sistemav2/issues/123\n', stderr: '' });
        });

        const { createGitHubIssue } = await import('../../utils/githubIssue');
        const result = await createGitHubIssue({
            title: 'Bug teste',
            body: 'descrição',
            labels: ['bug', 'from-app'],
        });
        expect(result.url).toContain('/issues/123');
        expect(result.number).toBe(123);

        // ensureGitHubLabel é chamado ANTES de `gh issue create` — pega a ÚLTIMA
        // call (que é a do `issue create` propriamente dito).
        const calls = mockExecFile.mock.calls;
        const issueCall = calls[calls.length - 1];
        const args = issueCall[1] as string[];
        expect(args[0]).toBe('issue');
        expect(args[1]).toBe('create');
        expect(args).toContain('--title');
        expect(args).toContain('Bug teste');
        expect(args).toContain('--body');
        expect(args).toContain('descrição');
        expect(args).toContain('--label');
        expect(args).toContain('bug');
        expect(args).toContain('from-app');
    });

    it('propaga erro do gh com mensagem legível', async () => {
        mockExecFile.mockImplementation((_c: string, _a: string[], _o: any, cb: any) => {
            cb(new Error('exit code 4'));
        });

        const { createGitHubIssue } = await import('../../utils/githubIssue');
        await expect(createGitHubIssue({ title: 'x', body: 'y' }))
            .rejects.toThrow(/gh issue create failed/);
    });

    it('trunca title para 250 chars', async () => {
        mockExecFile.mockImplementation((_c: string, _a: string[], _o: any, cb: any) => {
            cb(null, { stdout: 'https://github.com/x/y/issues/1\n', stderr: '' });
        });
        const { createGitHubIssue } = await import('../../utils/githubIssue');
        await createGitHubIssue({
            title: 'a'.repeat(500),
            body: 'body',
        });
        const args = mockExecFile.mock.calls[0][1] as string[];
        const titleIdx = args.indexOf('--title');
        expect((args[titleIdx + 1] as string).length).toBeLessThanOrEqual(250);
    });
});

describe('utils/githubIssue — ensureGitHubLabel', () => {
    it('tenta criar label (best-effort; ignora falha)', async () => {
        mockExecFile.mockImplementation((_c: string, _a: string[], _o: any, cb: any) => {
            // Simula "label já existe" — gh retorna exit-code != 0 com stderr.
            cb(new Error('already exists'), { stdout: '', stderr: 'already exists' });
        });
        const { ensureGitHubLabel } = await import('../../utils/githubIssue');
        await expect(ensureGitHubLabel('from-app')).resolves.toBeUndefined();
    });

    it('succeeds when label creation succeeds', async () => {
        mockExecFile.mockImplementation((_c: string, _a: string[], _o: any, cb: any) => {
            cb(null, { stdout: '', stderr: '' });
        });
        const { ensureGitHubLabel } = await import('../../utils/githubIssue');
        await expect(ensureGitHubLabel('new-label')).resolves.toBeUndefined();
    });
});

describe('utils/githubIssue — runGh', () => {
    it('retorna stdout em caso de sucesso', async () => {
        mockExecFile.mockImplementation((_c: string, _a: string[], _o: any, cb: any) => {
            cb(null, { stdout: 'ok-stdout', stderr: '' });
        });
        const { runGh } = await import('../../utils/githubIssue');
        const out = await runGh(['issue', 'list']);
        expect(out).toBe('ok-stdout');
    });

    it('lança erro legível em caso de falha', async () => {
        mockExecFile.mockImplementation((_c: string, _a: string[], _o: any, cb: any) => {
            cb(new Error('exit code 4: auth required'));
        });
        const { runGh } = await import('../../utils/githubIssue');
        await expect(runGh(['issue', 'list'])).rejects.toThrow(/auth required/);
    });
});
