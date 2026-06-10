import { Router, Request, Response } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { createLogger } from '../utils/logger';

const log = createLogger('GitHub');
const router = Router();
const execFileAsync = promisify(execFile);
const REPO = 'tcstulio/sistemav2';

router.use(requireDolibarrLogin);

async function runGh(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('gh', args, { timeout: 30000 });
    return stdout;
}

// Monta o corpo (markdown) do report a partir do contexto capturado in-app.
function buildIssueBody(description: string, context: any, reporter?: string): string {
    const c = context || {};
    const lines: string[] = [];
    lines.push(description?.trim() || '_(sem descrição)_', '');
    lines.push('---', '', '### Contexto capturado automaticamente', '');
    if (reporter) lines.push(`- **Reportado por:** ${reporter}`);
    if (c.url) lines.push(`- **Tela (URL):** \`${c.url}\``);
    if (c.breadcrumb) lines.push(`- **Onde:** ${c.breadcrumb}`);
    if (c.element) lines.push(`- **Elemento:** \`${c.element}\``);
    if (c.source) lines.push(`- **Fonte (dev):** \`${c.source}\``);
    if (c.viewport) lines.push(`- **Viewport:** ${c.viewport}`);
    if (c.userAgent) lines.push(`- **Navegador:** ${c.userAgent}`);
    if (Array.isArray(c.consoleErrors) && c.consoleErrors.length) {
        lines.push('', '#### Erros de console', '```', ...c.consoleErrors.slice(0, 20), '```');
    }
    if (Array.isArray(c.failedRequests) && c.failedRequests.length) {
        lines.push('', '#### Chamadas de API que falharam', '```', ...c.failedRequests.slice(0, 20), '```');
    }
    lines.push('', '_Reportado pelo botão in-app (Reportar problema)._');
    return lines.join('\n');
}

// Garante que um label existe (best-effort; ignora se já existe).
async function ensureLabel(name: string): Promise<void> {
    try {
        await execFileAsync('gh', ['label', 'create', name, '--repo', REPO, '--color', 'D4C5F9', '--description', 'Reportado pelo app'], { timeout: 15000 });
    } catch { /* já existe — ok */ }
}

// Cria uma issue no GitHub a partir de um report in-app.
// NÃO usa o label opencode-task por padrão (não dispara o TaskRunner automaticamente — triagem humana).
router.post('/issues', async (req: Request, res: Response) => {
    try {
        const { title, description, context, labels } = req.body || {};
        if (!title || !String(title).trim()) {
            return res.status(400).json({ error: 'title é obrigatório' });
        }
        const reporter = (req as any).user?.login || (req as any).user?.firstname;
        const labelList: string[] = Array.isArray(labels) && labels.length ? labels.slice(0, 5) : ['from-app'];
        for (const l of labelList) await ensureLabel(l);

        const body = buildIssueBody(String(description || ''), context, reporter);
        const tmp = path.join(os.tmpdir(), `app-report-${Date.now()}.md`);
        fs.writeFileSync(tmp, body.slice(0, 60000));

        const args = ['issue', 'create', '--repo', REPO, '--title', String(title).trim().slice(0, 250), '--body-file', tmp];
        for (const l of labelList) args.push('--label', l);

        let stdout = '';
        try {
            stdout = await runGh(args);
        } finally {
            fs.rmSync(tmp, { force: true });
        }
        const url = stdout.trim().split('\n').filter(Boolean).pop() || '';
        const m = url.match(/\/issues\/(\d+)/);
        log.info('Issue criada via report in-app', { url, reporter });
        res.json({ ok: true, url, number: m ? Number(m[1]) : undefined });
    } catch (error: any) {
        log.error('Failed to create issue', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

router.get('/issues', async (req: Request, res: Response) => {
    try {
        const { state, label, limit } = req.query;
        const args = [
            'issue', 'list',
            '--repo', 'tcstulio/sistemav2',
            '--json', 'number,title,state,labels,createdAt,closedAt,url,assignees',
            '--limit', String(limit || 30)
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
        const issues = JSON.parse(stdout);

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
