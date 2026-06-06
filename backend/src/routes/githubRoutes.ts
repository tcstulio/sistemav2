import { Router, Request, Response } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { createLogger } from '../utils/logger';

const log = createLogger('GitHub');
const router = Router();
const execFileAsync = promisify(execFile);

router.use(requireDolibarrLogin);

async function runGh(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('gh', args, { timeout: 30000 });
    return stdout;
}

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
