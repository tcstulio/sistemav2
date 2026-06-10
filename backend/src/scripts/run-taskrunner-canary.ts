/**
 * Teste de INTEGRAÇÃO do TaskRunner (uso único, descartável).
 * Dirige o taskRunnerService direto: sync -> start -> acompanha a issue-canário até terminal.
 * Roda fora do HTTP/auth, mas exercita o caminho real (worktree + opencode + gate + PR).
 *   npx tsx src/scripts/run-taskrunner-canary.ts [issueNumber]
 */
import { taskRunnerService } from '../services/taskRunnerService';

const ISSUE = Number(process.argv[2] || 295);
const TERMINAL = ['approved', 'reviewing', 'failed', 'rejected', 'merged'];

async function main() {
    console.log(`[canary] sincronizando issues (label opencode-task)...`);
    await taskRunnerService.syncTasks();
    if (!taskRunnerService.getTask(ISSUE)) {
        console.error(`[canary] issue #${ISSUE} não encontrada (tem o label opencode-task?)`);
        process.exit(1);
    }
    console.log(`[canary] iniciando task #${ISSUE} (worktree + opencode)...`);
    await taskRunnerService.startTask(ISSUE); // executeTask roda em background no mesmo processo

    const startedAt = Date.now();
    let last = '';
    while (Date.now() - startedAt < 50 * 60 * 1000) {
        const t = taskRunnerService.getTask(ISSUE)!;
        const line = `status=${t.status} pr=${t.prNumber || '-'} judge=${t.judgeScore ?? '-'} err=${t.error || '-'}`;
        if (line !== last) { console.log(`[canary] ${line}`); last = line; }
        if (TERMINAL.includes(t.status)) break;
        await new Promise((r) => setTimeout(r, 8000));
    }

    const f = taskRunnerService.getTask(ISSUE)!;
    console.log('[canary] FINAL: ' + JSON.stringify({ status: f.status, prNumber: f.prNumber, prUrl: f.prUrl, judgeScore: f.judgeScore, error: f.error }));
    process.exit(0);
}

main().catch((e) => { console.error('[canary] erro fatal:', e?.message || e); process.exit(1); });
