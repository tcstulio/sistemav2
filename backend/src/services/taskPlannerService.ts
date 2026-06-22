import { execFile } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';
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
    isEpic: boolean;       // tarefa grande demais p/ 1 run → deve ser decomposta em sub-tasks
    epicReason: string;
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

// --- Cache de decisões do Planner (#712) -------------------------------------
// Analisar uma task é caro: gh (PRs/diffs) + 1 chamada de LLM. A decisão é
// determinística para o MESMO corpo de issue (mesma issue → mesma análise), então
// `POST /planner/analyze/:n` clicado N vezes não precisa de N chamadas de LLM.
// Chave: issueNumber. Invalida quando o corpo muda (hash diferente) ou por TTL.
// `reevaluateWaiting` (pós-merge) força análise fresca via { noCache: true } — o
// conjunto de PRs abertos muda com merges, então re-checar é o objetivo lá.
const PLANNER_CACHE_TTL_MS = Number(process.env.PLANNER_CACHE_TTL_MS) || 60 * 60 * 1000; // 1h
// Teto de tasks LLM-reanalisadas por chamada de reevaluateWaiting (com ~95 na fila,
// re-analisar todas a cada merge multiplica chamadas de LLM). 0/negativo = sem teto.
const PLANNER_REEVAL_MAX = Number(process.env.PLANNER_REEVAL_MAX ?? 20);

interface CacheEntry { bodyHash: string; ts: number; decision: PlannerDecision; }
const plannerCache = new Map<number, CacheEntry>();

function hashBody(body: string): string {
    return createHash('sha1').update(body || '').digest('hex');
}
function cloneDecision(d: PlannerDecision): PlannerDecision {
    return {
        ...d,
        blockedBy: [...d.blockedBy],
        overlappingFiles: [...d.overlappingFiles],
        filesEstimate: [...d.filesEstimate],
    };
}

/** Invalida o cache do Planner — uma issue específica ou tudo. Chamável após merges/edições. */
export function invalidatePlannerCache(issueNumber?: number): void {
    if (issueNumber === undefined) plannerCache.clear();
    else plannerCache.delete(issueNumber);
}

export const taskPlannerService = {
    async analyzeTask(task: Task, opts?: { noCache?: boolean }): Promise<PlannerDecision> {
        const decision: PlannerDecision = {
            action: 'go',
            reason: 'Sem conflitos detectados.',
            priority: 0,
            blockedBy: [],
            overlappingFiles: [],
            alreadyResolved: false,
            filesEstimate: [],
            isEpic: false,
            epicReason: '',
        };

        // Cache (#712): mesma issue + mesmo corpo, dentro do TTL → reaproveita (sem gh/LLM).
        const bodyHash = hashBody(task.body || '');
        if (!opts?.noCache) {
            const hit = plannerCache.get(task.issueNumber);
            if (hit && hit.bodyHash === bodyHash && Date.now() - hit.ts < PLANNER_CACHE_TTL_MS) {
                log.info(`Planner #${task.issueNumber}: cache hit (${hit.decision.action}) — sem nova chamada de LLM.`);
                return cloneDecision(hit.decision);
            }
        }
        const store = (d: PlannerDecision): PlannerDecision => {
            plannerCache.set(task.issueNumber, { bodyHash, ts: Date.now(), decision: cloneDecision(d) });
            return d;
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
                    return store(decision);
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
                    if (llmDecision.isEpic !== undefined) { decision.isEpic = !!llmDecision.isEpic; decision.epicReason = llmDecision.epicReason || ''; }
                }
            }

            // Detecção de épica: o LLM sinaliza acima; uma estimativa alta de arquivos é a rede de
            // segurança (caso o LLM subestime). Tarefa grande demais p/ 1 run do opencode → decompor.
            if (!decision.isEpic && decision.filesEstimate.length >= 5) {
                decision.isEpic = true;
                decision.epicReason = `Estimativa de ${decision.filesEstimate.length} arquivos — grande demais para um único run`;
            }

            if (decision.alreadyResolved) {
                decision.action = 'skip';
                decision.reason = decision.reason || 'Issue já resolvida em main.';
                decision.priority = 999;
            }

            log.info(`Planner #${task.issueNumber}: ${decision.action} (priority=${decision.priority}) — ${decision.reason}`);
            return store(decision);
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
    "filesEstimate": ["estimated files this task will modify"],
    "isEpic": true/false,
    "epicReason": "explanation in Portuguese if isEpic"
}

Rules:
- "alreadyResolved": true if the issue description is ALREADY fully implemented in the code snippets from main
- "skip" if alreadyResolved is true (waste of time/tokens)
- "wait" if there's a PR that modifies the same files AND is still in progress
- "go" if safe to execute (no conflicts, not already done)
- "reorder" if it can run but should wait for a more urgent task
- priority: 0 = highest urgency, 100+ = blocked/waiting, 999 = skip
- "isEpic": true if this task is TOO BIG for a single opencode run — i.e. it realistically needs more than ~2-3 files changed, OR covers multiple independent concerns/features that should be split into smaller sub-tasks. A focused single-file/single-concern change is NOT an epic. When in doubt for a clearly large/multi-file refactor, mark isEpic true.`;
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
                isEpic: !!parsed.isEpic,
                epicReason: String(parsed.epicReason || ''),
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
        const waiting = allTasks
            .filter(t => t.status === 'pending' && t.queuePriority && t.queuePriority >= 100)
            // Mais prioritárias (menor queuePriority) primeiro — o teto corta a cauda.
            .sort((a, b) => (a.queuePriority ?? 0) - (b.queuePriority ?? 0));
        const results: PlannerDecision[] = [];

        // Teto (#712): re-analisar TODAS as bloqueadas a cada merge multiplica chamadas de LLM.
        const batch = PLANNER_REEVAL_MAX > 0 ? waiting.slice(0, PLANNER_REEVAL_MAX) : waiting;
        if (batch.length < waiting.length) {
            log.info(`reevaluateWaiting: ${waiting.length} bloqueadas, re-analisando as ${batch.length} mais prioritárias (teto PLANNER_REEVAL_MAX=${PLANNER_REEVAL_MAX}).`);
        }

        for (const task of batch) {
            // noCache: pós-merge o conjunto de PRs abertos mudou — re-checar é o objetivo aqui.
            const decision = await this.analyzeTask(task, { noCache: true });
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

    async decomposeEpic(task: Task): Promise<import('./taskRunnerService').DecompositionPlan> {
        log.info(`Decomposing epic #${task.issueNumber}: ${task.title}`);

        const prompt = `You are a senior software architect decomposing an epic into small, independent sub-tasks.

## Epic #${task.issueNumber}: ${task.title}

${task.body}

## Project Context
- Backend: Express + TypeScript (backend/)
- Frontend: React + Vite (src/)
- Database: Dolibarr ERP (REST API)

## Rules
1. Each sub-task should be completable in ONE opencode run (max 1-2 files changed)
2. Sub-tasks must have clear, testable acceptance criteria
3. List specific files to modify
4. Define dependencies between sub-tasks (which must finish before which)
5. Keep it practical — don't over-decompose. 2-5 sub-tasks is ideal.
6. Write everything in Portuguese (Brazilian)

Return ONLY valid JSON:
{
  "subTasks": [
    {
      "title": "Short descriptive title",
      "body": "Detailed description with acceptance criteria",
      "filesEstimate": ["path/to/file.ts"],
      "dependsOn": [0],
      "complexity": "low"
    }
  ]
}

dependsOn uses 0-based indices (0 = first sub-task, empty array = no dependencies).`;

        try {
            const history = [
                { role: 'system' as const, parts: 'You are a senior software architect. Decompose epics into small, independent sub-tasks. Return ONLY valid JSON.' },
                { role: 'user' as const, parts: prompt },
            ];
            const result = await aiJobService.runAndWait(
                () => aiService.generateReply(history, '', undefined, 'chat'),
                `epic-decompose-${task.issueNumber}`,
            );
            const reply = result.text;
            const jsonMatch = reply.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('LLM did not return valid JSON');

            const parsed = JSON.parse(jsonMatch[0]);
            if (!Array.isArray(parsed.subTasks) || parsed.subTasks.length === 0) {
                throw new Error('No sub-tasks generated');
            }

            const plan: import('./taskRunnerService').DecompositionPlan = {
                subTasks: parsed.subTasks.map((st: any, i: number) => ({
                    title: String(st.title || `Sub-task ${i + 1}`),
                    body: String(st.body || ''),
                    filesEstimate: Array.isArray(st.filesEstimate) ? st.filesEstimate : [],
                    dependsOn: Array.isArray(st.dependsOn) ? st.dependsOn : [],
                    complexity: ['low', 'medium', 'high'].includes(st.complexity) ? st.complexity : 'medium',
                })),
                createdAt: new Date().toISOString(),
            };

            log.info(`Decomposed epic #${task.issueNumber} into ${plan.subTasks.length} sub-tasks`);
            return plan;
        } catch (e: any) {
            log.error(`Decompose epic #${task.issueNumber} failed: ${e.message}`);
            throw e;
        }
    },
};
