import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger';
import { aiService } from './aiService';
import { aiJobService } from './aiJobService';
import { taskRunnerService, type Task } from './taskRunnerService';

const log = logger.child('TaskPlanner');
const execFileAsync = promisify(execFile);
const BIG = 20 * 1024 * 1024;
const REPO = 'tcstulio/sistemav2';

function gh(args: string[], opts?: { timeout?: number }) {
    return execFileAsync('gh', args, { timeout: opts?.timeout || 15000, maxBuffer: BIG });
}

export type PlannerAction = 'go' | 'skip' | 'wait' | 'reorder';

export interface PlannerDecision {
    action: PlannerAction;
    reason: string;
    priority: number;
    blockedBy: number[];
    overlappingFiles: string[];
    alreadyResolved: boolean;
    filesEstimate: string[];
}

interface OpenPR {
    number: number;
    title: string;
    headRefName: string;
    files: string[];
}

async function listOpenPRs(): Promise<OpenPR[]> {
    try {
        const { stdout } = await gh([
            'pr', 'list', '--repo', REPO, '--state', 'open',
            '--json', 'number,title,headRefName', '--limit', '30',
        ]);
        const prs = JSON.parse(stdout);
        const detailed: OpenPR[] = [];
        for (const pr of prs) {
            try {
                const { stdout: diffOut } = await gh([
                    'pr', 'diff', String(pr.number), '--repo', REPO, '--name-only',
                ], { timeout: 15000 });
                const files = diffOut.split('\n').map(l => l.trim()).filter(Boolean);
                detailed.push({ ...pr, files });
            } catch {
                detailed.push({ ...pr, files: [] });
            }
        }
        return detailed;
    } catch (e: any) {
        log.error('listOpenPRs error', e.message);
        return [];
    }
}

async function getFileContextFromMain(issueBody: string): Promise<string> {
    const fileRefs = issueBody.match(/[\w/.-]+\.(ts|tsx|js|jsx|json|css|md)/g) || [];
    if (fileRefs.length === 0) return '';
    const unique = [...new Set(fileRefs)].slice(0, 10);
    const parts: string[] = [];
    for (const f of unique) {
        try {
            const { stdout } = await gh([
                'api', `repos/${REPO}/contents/${f}`, '--jq', '.content',
            ], { timeout: 10000 });
            if (stdout && stdout.length > 20) {
                const decoded = Buffer.from(stdout, 'base64').toString('utf-8');
                parts.push(`--- ${f} (current in main) ---\n${decoded.substring(0, 1500)}`);
            }
        } catch { /* file not found */ }
    }
    return parts.join('\n\n');
}

function fileOverlap(a: string[], b: string[]): string[] {
    const normalize = (f: string) => f.toLowerCase().replace(/\\/g, '/');
    const setA = new Set(a.map(normalize));
    return b.filter(f => setA.has(normalize(f)));
}

export const taskPlannerService = {
    async analyzeTask(task: Task): Promise<PlannerDecision> {
        const decision: PlannerDecision = {
            action: 'go',
            reason: 'Sem conflitos detectados.',
            priority: 0,
            blockedBy: [],
            overlappingFiles: [],
            alreadyResolved: false,
            filesEstimate: [],
        };

        try {
            const openPRs = await listOpenPRs();
            const issueBody = task.body || '';

            const filesInBody = issueBody.match(/[\w/.-]+\.(ts|tsx|js|jsx|json|css|md|sql)/g) || [];
            decision.filesEstimate = [...new Set(filesInBody)];

            const conflictingPRs = openPRs.filter(pr => {
                const overlap = fileOverlap(pr.files, decision.filesEstimate);
                if (overlap.length > 0) {
                    decision.overlappingFiles.push(...overlap);
                    return true;
                }
                return false;
            });

            if (conflictingPRs.length > 0 && !task.prNumber) {
                const prNums = conflictingPRs.map(pr => pr.number);
                decision.blockedBy = prNums;
                const hasRunningTask = prNums.some(prNum => {
                    const t = taskRunnerService.getTask(prNum);
                    return t && (t.status === 'running' || t.status === 'fixing' || t.status === 'pending');
                });

                if (hasRunningTask) {
                    decision.action = 'wait';
                    decision.reason = `Conflito de arquivos com PR(s) em andamento: #${prNums.join(', #')} (overlap: ${decision.overlappingFiles.slice(0, 5).join(', ')}). Aguardando merge.`;
                    decision.priority = 100 + prNums[0];
                    return decision;
                }
            }

            const fileContext = await getFileContextFromMain(issueBody);
            if (fileContext.length > 100 || issueBody.length > 50) {
                const plannerPrompt = this.buildPlannerPrompt(task, fileContext, openPRs, decision.overlappingFiles);
                const llmDecision = await this.queryLLM(plannerPrompt);
                if (llmDecision) {
                    if (llmDecision.action) decision.action = llmDecision.action;
                    if (llmDecision.reason) decision.reason = llmDecision.reason;
                    if (llmDecision.alreadyResolved !== undefined) decision.alreadyResolved = llmDecision.alreadyResolved;
                    if (llmDecision.priority !== undefined) decision.priority = llmDecision.priority;
                    if (llmDecision.blockedBy?.length) decision.blockedBy = llmDecision.blockedBy;
                }
            }

            if (decision.alreadyResolved) {
                decision.action = 'skip';
                decision.reason = decision.reason || 'Issue já resolvida em main.';
                decision.priority = 999;
            }

            log.info(`Planner #${task.issueNumber}: ${decision.action} (priority=${decision.priority}) — ${decision.reason}`);
            return decision;
        } catch (e: any) {
            log.error(`Planner error #${task.issueNumber}`, e.message);
            return decision;
        }
    },

    buildPlannerPrompt(task: Task, fileContext: string, openPRs: OpenPR[], overlappingFiles: string[]): string {
        const prSummary = openPRs.length > 0
            ? openPRs.map(pr => `PR #${pr.number} (${pr.headRefName}): ${pr.title}\n  Files: ${pr.files.slice(0, 15).join(', ')}`).join('\n')
            : 'Nenhum PR aberto.';

        return `You are a Task Queue Planner for a software project. Analyze whether this task should be executed.

## Task (issue #${task.issueNumber}): ${task.title}
${task.body?.substring(0, 3000) || 'No description'}

## Files mentioned in issue
${task.body?.match(/[\w/.-]+\.(ts|tsx|js|jsx|json|css|md|sql)/g)?.join(', ') || 'None explicitly mentioned'}

## Current code in main (snippets)
${fileContext.substring(0, 6000) || 'Not available'}

## Open PRs
${prSummary}

## Overlapping files with open PRs
${overlappingFiles.length > 0 ? overlappingFiles.join(', ') : 'None'}

Return ONLY a JSON:
{
    "action": "go" | "skip" | "wait" | "reorder",
    "reason": "explanation in Portuguese",
    "alreadyResolved": true/false,
    "priority": 0-200,
    "blockedBy": [pr_number_if_waiting],
    "filesEstimate": ["estimated files this task will modify"]
}

Rules:
- "alreadyResolved": true if the issue description is ALREADY fully implemented in the code snippets from main
- "skip" if alreadyResolved is true (waste of time/tokens)
- "wait" if there's a PR that modifies the same files AND is still in progress
- "go" if safe to execute (no conflicts, not already done)
- "reorder" if it can run but should wait for a more urgent task
- priority: 0 = highest urgency, 100+ = blocked/waiting, 999 = skip`;
    },

    async queryLLM(prompt: string): Promise<Partial<PlannerDecision> | null> {
        try {
            const history = [
                { role: 'system' as const, parts: 'You are a task queue planner. Return ONLY valid JSON. Be conservative — only skip if clearly already done.' },
                { role: 'user' as const, parts: prompt },
            ];
            const result = await aiJobService.runAndWait(
                () => aiService.generateReply(history, '', undefined, 'chat'),
                'task-planner',
            );
            const reply = result.text;
            const jsonMatch = reply.match(/\{[\s\S]*\}/);
            if (!jsonMatch) return null;
            const parsed = JSON.parse(jsonMatch[0]);
            return {
                action: ['go', 'skip', 'wait', 'reorder'].includes(parsed.action) ? parsed.action : 'go',
                reason: String(parsed.reason || ''),
                alreadyResolved: !!parsed.alreadyResolved,
                priority: typeof parsed.priority === 'number' ? parsed.priority : 0,
                blockedBy: Array.isArray(parsed.blockedBy) ? parsed.blockedBy : [],
                filesEstimate: Array.isArray(parsed.filesEstimate) ? parsed.filesEstimate : [],
            };
        } catch (e: any) {
            log.error('Planner LLM error', e.message);
            return null;
        }
    },

    async skipAndClose(task: Task, reason: string): Promise<void> {
        log.info(`Skipping task #${task.issueNumber}: ${reason}`);
        task.status = 'cancelled';
        task.error = `Planner: ${reason}`;
        task.updatedAt = new Date().toISOString();
        task.completedAt = new Date().toISOString();

        try {
            await gh([
                'issue', 'comment', String(task.issueNumber), '--repo', REPO,
                '--body', `**Task Runner Planner:** Esta task foi cancelada automaticamente.\n\nMotivo: ${reason}\n\n_Se isso foi um erro, reabra a issue e remova o label opencode-task._`,
            ]);
        } catch { /* best effort */ }

        try {
            await gh([
                'issue', 'close', String(task.issueNumber), '--repo', REPO, '--reason', 'not planned',
            ]);
        } catch { /* best effort */ }
    },

    async reevaluateWaiting(): Promise<PlannerDecision[]> {
        const allTasks = taskRunnerService.getAllTasks();
        const waiting = allTasks.filter(t => t.status === 'pending' && t.queuePriority && t.queuePriority >= 100);
        const results: PlannerDecision[] = [];

        for (const task of waiting) {
            const decision = await this.analyzeTask(task);
            if (decision.action === 'go') {
                task.queuePriority = decision.priority;
                task.planReason = decision.reason;
                task.updatedAt = new Date().toISOString();
                results.push(decision);
            } else {
                results.push(decision);
            }
        }

        return results;
    },
};
