import { Router, Request, Response } from 'express';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { createLogger } from '../utils/logger';
import { normalizePeriod, filterIssuesByPeriod, ISSUE_PERIOD_FETCH_LIMIT } from '../utils/issuePeriodFilter';
import { buildIssueBody } from '../utils/issueBodyBuilder';
import {
    createGitHubIssue,
    runGh,
    ensureGitHubLabel,
    GITHUB_REPO,
} from '../utils/githubIssue';

const log = createLogger('GitHub');
const router = Router();

router.use(requireDolibarrLogin);

// Monta o corpo (markdown) do report a partir do contexto capturado in-app.
// (Reexportado de utils/issueBodyBuilder para compat; novos testes devem importar de lá.)
export { buildIssueBody } from '../utils/issueBodyBuilder';

// Cria uma issue no GitHub a partir de um report in-app.
// NÃO usa o label opencode-task por padrão (não dispara o TaskRunner automaticamente — triagem humana).
// #1561: delega ao helper compartilhado `createGitHubIssue` (utils/githubIssue.ts).
router.post('/issues', async (req: Request, res: Response) => {
    try {
        const { title, description, context, labels } = req.body || {};
        if (!title || !String(title).trim()) {
            return res.status(400).json({ error: 'title é obrigatório' });
        }
        const reporter = (req as any).user?.login || (req as any).user?.firstname;
        const labelList: string[] = Array.isArray(labels) && labels.length ? labels.slice(0, 5) : ['from-app'];
        const body = buildIssueBody(String(description || ''), context, reporter);
        const result = await createGitHubIssue({
            title: String(title).trim(),
            body: body.slice(0, 60000),
            labels: labelList,
        });
        log.info('Issue criada via report in-app', { url: result.url, reporter });
        res.json({ ok: true, url: result.url, number: result.number });
    } catch (error: any) {
        log.error('Failed to create issue', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

// Adiciona um label a uma issue (#315 "Virar Task": label opencode-task). Só rotula — não executa.
router.post('/issues/:number/labels', async (req: Request, res: Response) => {
    try {
        const num = Number(req.params.number);
        const { label } = req.body || {};
        if (!num || !label) return res.status(400).json({ error: 'number e label são obrigatórios' });
        await ensureGitHubLabel(String(label));
        await runGh(['issue', 'edit', String(num), '--repo', GITHUB_REPO, '--add-label', String(label)]);
        log.info('Label adicionado à issue', { number: num, label });
        res.json({ ok: true, number: num, label });
    } catch (error: any) {
        log.error('Failed to add label', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

// Fechar/reabrir uma issue pela tela (gestão in-app). reason='not planned' p/ duplicadas/wontfix.
router.post('/issues/:number/state', async (req: Request, res: Response) => {
    try {
        const num = Number(req.params.number);
        const { state, reason } = req.body || {};
        if (!num || !['open', 'closed'].includes(state)) {
            return res.status(400).json({ error: "number e state ('open'|'closed') são obrigatórios" });
        }
        if (state === 'closed') {
            const args = ['issue', 'close', String(num), '--repo', GITHUB_REPO];
            if (reason === 'not planned') args.push('--reason', 'not planned');
            await runGh(args);
        } else {
            await runGh(['issue', 'reopen', String(num), '--repo', GITHUB_REPO]);
        }
        log.info('Issue state alterado', { number: num, state, reason });
        res.json({ ok: true, number: num, state });
    } catch (error: any) {
        log.error('Failed to set issue state', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

router.get('/issues', async (req: Request, res: Response) => {
    try {
        const { state, label } = req.query;
        // #983: filtro de período (Hoje / N dias / Tudo). Padrão do front é "Hoje".
        // Quando ativo, ampliamos o --limit para capturar issues fechadas recentemente
        // antes de filtrar por closedAt (evita acúmulo de milhares de concluídas).
        const period = normalizePeriod(req.query.period);
        const requestedLimit = Number(req.query.limit) || 0;
        const effectiveLimit = period !== 'all'
            ? Math.max(requestedLimit, ISSUE_PERIOD_FETCH_LIMIT)
            : (requestedLimit || 30);

        const args = [
            'issue', 'list',
            '--repo', 'tcstulio/sistemav2',
            '--json', 'number,title,state,labels,createdAt,closedAt,url,assignees',
            '--limit', String(effectiveLimit)
        ];

        if (state && state !== 'all') {
            args.push('--state', state as string);
        } else if (!state) {
            args.push('--state', 'all');
        }

        if (label) {
            args.push('--label', label as string);
        }

        const stdout = await runGh(args);
        const fetched = JSON.parse(stdout);
        // #983: filtra por período server-side (issues abertas sempre passam).
        const issues = filterIssuesByPeriod(fetched, period);

        res.json({ count: issues.length, data: issues });
    } catch (error: any) {
        log.error('Failed to list issues', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

router.get('/issues/stats', async (req: Request, res: Response) => {
    try {
        const [openRaw, closedRaw] = await Promise.all([
            runGh(['issue', 'list', '--repo', 'tcstulio/sistemav2', '--state', 'open', '--json', 'number,title,labels,createdAt', '--limit', '100']),
            runGh(['issue', 'list', '--repo', 'tcstulio/sistemav2', '--state', 'closed', '--json', 'number,title,labels,closedAt,createdAt', '--limit', '100']),
        ]);

        const open = JSON.parse(openRaw);
        const closed = JSON.parse(closedRaw);

        const byLabel: Record<string, { open: number; closed: number }> = {};
        const all = [...open, ...closed];
        for (const issue of all) {
            const labels: Array<{ name: string }> = issue.labels || [];
            for (const l of labels) {
                if (!byLabel[l.name]) byLabel[l.name] = { open: 0, closed: 0 };
                if (issue.state === 'OPEN') byLabel[l.name].open++;
                else byLabel[l.name].closed++;
            }
        }

        const recentClosed = closed
            .sort((a: any, b: any) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime())
            .slice(0, 10);

        res.json({
            totalOpen: open.length,
            totalClosed: closed.length,
            byLabel,
            recentClosed
        });
    } catch (error: any) {
        log.error('Failed to get issue stats', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

export default router;
