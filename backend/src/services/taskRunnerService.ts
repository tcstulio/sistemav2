import { execFile, exec, ChildProcess, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { atomicWriteSync } from '../utils/atomicWrite';
import { logger } from '../utils/logger';
import { aiService } from './aiService';
import { aiJobService } from './aiJobService';
import { socketService } from './socketService';
import { killTree, isAlive } from '../utils/processTree';
import { screenshotService } from './screenshotService';

const log = logger.child('TaskRunner');
const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);
const BIG = 20 * 1024 * 1024; // maxBuffer p/ saídas grandes (diff, npm, opencode)

const STORE_PATH = path.join(__dirname, '../../data/tasks.json');
const REPO_ROOT = path.resolve(__dirname, '../../../');
// Worktree ISOLADO do TaskRunner — o agente nunca toca o diretório do dev/main.
const WT_ROOT = path.resolve(REPO_ROOT, '..', 'sistemav2-taskrunner-wt');
const PROMPT_FILE = '.taskrunner-prompt.md';
// Timeout por tentativa do opencode. Num repo grande o 1º run (cold start: conexão do modelo +
// indexação do contexto) chega a passar de 15min; 30min cobre o cold start com folga.
const OPENCODE_TIMEOUT_MS = 30 * 60 * 1000;

function git(args: string[], opts?: { timeout?: number; cwd?: string }) {
    return execFileAsync('git', args, { cwd: opts?.cwd || REPO_ROOT, timeout: opts?.timeout, maxBuffer: BIG });
}

function gh(args: string[], opts?: { timeout?: number; cwd?: string }) {
    return execFileAsync('gh', args, { cwd: opts?.cwd || REPO_ROOT, timeout: opts?.timeout, maxBuffer: BIG });
}

// npm/npx rodam via shell padrão (resolvem o .cmd no Windows). Os comandos são strings
// CONTROLADAS (sem conteúdo do usuário) — o prompt detalhado vai num arquivo no worktree.
function sh(command: string, cwd: string, timeout: number) {
    return execAsync(command, { cwd, timeout, maxBuffer: BIG, windowsHide: true });
}

// O opencode lançado via cmd.exe TRAVA no repo grande (ele aninha tsc/vitest no cmd.exe e
// fica ~15min até o timeout); no git-bash roda normal (<5min). Por isso o opencode — e só
// ele — vai por aqui. `-lc` carrega o profile p/ ter o PATH do npm global (onde está o bin).
function resolveBash(): string {
    if (process.platform !== 'win32') return 'bash';
    const candidates = [
        process.env.TASKRUNNER_BASH,
        'C:\\Program Files\\Git\\bin\\bash.exe',
        'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    ].filter(Boolean) as string[];
    return candidates.find((p) => fs.existsSync(p)) || 'bash';
}
const GIT_BASH = resolveBash();
function bash(command: string, cwd: string, timeout: number) {
    return execFileAsync(GIT_BASH, ['-lc', command], { cwd, timeout, maxBuffer: BIG, windowsHide: true });
}

/**
 * Roda o opencode com tracking de PID e observador de kill (issue #304).
 * - Salva childPid na task para que killTask consiga localizar o processo.
 * - Polling a cada 500ms: se task.killRequested virar true, mata a arvore e rejeita.
 * - No Unix usa detached:true para criar novo process group (necessario p/ kill -pid).
 */
function runOpencode(command: string, cwd: string, task: Task, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
        const child: ChildProcess = spawn(GIT_BASH, ['-lc', command], {
            cwd,
            detached: process.platform !== 'win32',
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        task.childPid = child.pid;

        let stdout = '';
        let stderr = '';
        let killed = false;
        child.stdout?.on('data', (b) => { stdout += b.toString(); });
        child.stderr?.on('data', (b) => { stderr += b.toString(); });

        const watcher = setInterval(() => {
            if (task.killRequested && !killed) {
                killed = true;
                const pid = child.pid;
                if (pid) {
                    killTree(pid).catch(() => { /* logged inside */ });
                }
            }
        }, 500);

        const finish = (err?: Error) => {
            clearInterval(watcher);
            if (task.childPid === child.pid) task.childPid = undefined;
            if (err) reject(err);
            else resolve(stdout);
        };

        const killTimer = setTimeout(() => {
            finish(new Error(`opencode timeout (${Math.round(timeoutMs / 1000)}s)`));
            if (child.pid) killTree(child.pid).catch(() => { /* ignore */ });
        }, timeoutMs);

        child.on('exit', (code, signal) => {
            clearTimeout(killTimer);
            if (killed) {
                finish(new Error(`opencode killed (signal=${signal}, code=${code})`));
            } else if (code === 0) {
                finish();
            } else {
                finish(new Error(`opencode exited code=${code} signal=${signal}: ${(stderr || stdout).substring(0, 2000)}`));
            }
        });
        child.on('error', (err) => {
            clearTimeout(killTimer);
            finish(err);
        });
    });
}

export type TaskStatus = 'pending' | 'running' | 'reviewing' | 'approved' | 'fixing' | 'cancelling' | 'cancelled' | 'merged' | 'rejected' | 'failed';

export type TaskEventType =
    | 'task_created'
    | 'task_started'
    | 'task_completed'
    | 'task_failed'
    | 'task_rejected'
    | 'task_killed'
    | 'task_watchdog_timeout'
    | 'worktree_setup_started'
    | 'worktree_setup_completed'
    | 'worktree_cleanup'
    | 'attempt_started'
    | 'attempt_no_changes'
    | 'attempt_completed'
    | 'exploration_completed'
    | 'synthesis_started'
    | 'synthesis_completed'
    | 'attempt_no_changes'
    | 'typecheck_started'
    | 'typecheck_ok'
    | 'typecheck_failed'
    | 'git_committed'
    | 'git_pushed'
    | 'pr_created'
    | 'pr_creation_failed'
    | 'pr_closed'
    | 'pr_merged'
    | 'judge_started'
    | 'judge_score'
    | 'judge_error'
    | 'feedback_received'
    | 'planner_started'
    | 'planner_decision'
    | 'opencode_output'
    | 'error';

export interface TaskEvent {
    ts: string;             // ISO 8601
    type: TaskEventType;
    message: string;        // human-readable (pt-BR)
    meta?: Record<string, any>;
}

export type TaskPhase = 'exploring' | 'synthesizing' | 'judging' | 'done';

export interface AttemptResult {
    index: number;
    phase: TaskPhase;
    diff: string;
    typecheckOk: boolean;
    typecheckErrors?: string;
    filesChanged: string[];
    summary?: string;
}

export interface Task {
    issueNumber: number;
    title: string;
    body: string;
    labels: string[];
    status: TaskStatus;
    branch?: string;
    prNumber?: number;
    prUrl?: string;
    judgeScore?: number;
    judgeReview?: string;
    judgeAttempts?: number;
    visualScore?: number;
    visualReview?: string;
    feedbackHistory: string[];
    startedAt?: string;
    updatedAt: string;
    completedAt?: string;
    error?: string;
    events: TaskEvent[];
    childPid?: number;
    killRequested?: boolean;
    killedAt?: string;
    queuePriority?: number;
    planReason?: string;
    phase: TaskPhase;
    attempts: AttemptResult[];
    synthesisAttempt?: number;
}

interface TaskStore {
    tasks: Record<number, Task>;
}

const REPO = 'tcstulio/sistemav2';

const POLL_INTERVAL_MS = 5 * 60 * 1000;

class TaskRunnerService {
    private store: TaskStore = { tasks: {} };
    private pollTimer: NodeJS.Timeout | null = null;
    private polling = false;
    private notifiedTasks = new Set<number>();
    private deletedIssueNumbers = new Map<number, number>();

    constructor() {
        this.load();
        for (const t of Object.values(this.store.tasks)) {
            if (t.events?.some((e) => e.type === 'task_created')) {
                this.notifiedTasks.add(t.issueNumber);
            }
        }
        setImmediate(() => {
            this.syncWithGitHub().catch((e) => {
                log.warn(`syncWithGitHub no boot falhou: ${e?.message || e}`);
            });
        });
    }

    startPolling() {
        if (this.polling) return;
        this.polling = true;
        const tick = () => {
            this.pollSync().catch((e) => {
                log.warn(`pollSync falhou: ${e?.message || e}`);
            });
        };
        setTimeout(tick, 60 * 1000);
        this.pollTimer = setInterval(tick, POLL_INTERVAL_MS);
        log.info(`TaskRunner polling started (a cada ${POLL_INTERVAL_MS / 60000}min)`);
    }

    stopPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        this.polling = false;
        log.info('TaskRunner polling stopped');
    }

    private async pollSync() {
        const before = new Set(Object.keys(this.store.tasks).map(Number));
        await this.syncWithGitHub();
        const tasks = await this.syncTasks();
        const newTaskNumbers = tasks
            .filter((t) => !before.has(t.issueNumber) && !this.notifiedTasks.has(t.issueNumber))
            .map((t) => t.issueNumber);

        if (newTaskNumbers.length > 0) {
            log.info(`pollSync: ${newTaskNumbers.length} task(s) nova(s) detectada(s): [${newTaskNumbers.join(', ')}]`);
            for (const num of newTaskNumbers) {
                const task = this.store.tasks[num];
                if (!task) continue;
                this.notifiedTasks.add(num);
                this.recordEvent(task, 'task_created', `Nova task detectada via polling: #${num} — ${task.title}`);
                try {
                    const { notificationService } = require('./notificationService');
                    await notificationService.create({
                        event: 'agent.action',
                        title: `Nova task #${num}: ${task.title}`,
                        message: `Issue #${num} com label "opencode-task" detectada. Acesse /tasks para iniciar a execução automática.`,
                        channels: ['in-app'],
                        priority: 'medium',
                        entityType: 'opencode-task',
                        entityId: String(num),
                        senderName: 'TaskRunner',
                    });
                } catch {
                    // notificacao é best-effort
                }
            }
        }
    }

    private emitLog(issueNumber: number, type: string, message: string) {
        socketService.emit(`task:${issueNumber}:log`, { type, message, timestamp: new Date().toISOString() });
    }

    private emitStatus(task: Task) {
        socketService.emit(`task:${task.issueNumber}:status`, {
            status: task.status,
            judgeScore: task.judgeScore,
            judgeReview: task.judgeReview,
            visualScore: task.visualScore,
            visualReview: task.visualReview,
            prNumber: task.prNumber,
            prUrl: task.prUrl,
            error: task.error,
            updatedAt: task.updatedAt,
        });
    }

    /**
     * Persiste um evento na timeline da task e emite via socket. Single source of
     * truth para logs estruturados (resolve o "falta um historico melhor" #306).
     */
    private recordEvent(task: Task, type: TaskEventType, message: string, meta?: Record<string, any>) {
        if (!Array.isArray(task.events)) task.events = [];
        const evt: TaskEvent = { ts: new Date().toISOString(), type, message, meta };
        task.events.push(evt);
        this.save();
        // Mapeia para os tipos visuais que a UI ja conhece (info/success/warn/error/ai).
        const uiType =
            type === 'task_failed' || type === 'error' || type === 'judge_error' ||
            type === 'pr_creation_failed' || type === 'typecheck_failed' || type === 'attempt_no_changes' ||
            type === 'task_watchdog_timeout' ? 'warn'
            : type === 'task_killed' ? 'warn'
            : type === 'typecheck_ok' || type === 'pr_created' || type === 'pr_merged' || type === 'task_completed' ? 'success'
            : type === 'judge_score' || type === 'judge_started' || type === 'planner_decision' ? 'ai'
            : 'info';
        this.emitLog(task.issueNumber, uiType, message);
    }

    private load() {
        try {
            const dir = path.dirname(STORE_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            if (fs.existsSync(STORE_PATH)) {
                const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
                this.store = { tasks: parsed.tasks || {} };
                // Compat: tasks antigas (pre #306) nao tem events[].
                // Cleanup: killRequested=true de um restart anterior (child morreu junto).
                for (const t of Object.values(this.store.tasks)) {
                    if (!Array.isArray(t.events)) t.events = [];
                    if (!t.phase) t.phase = 'done';
                    if (!Array.isArray(t.attempts)) t.attempts = [];
                    if (t.killRequested) {
                        t.killRequested = false;
                        t.childPid = undefined;
                        if (t.status === 'running' || t.status === 'fixing' || t.status === 'cancelling') {
                            t.status = 'failed';
                            t.error = 'Backend reiniciou durante a execução (child morto).';
                            t.completedAt = new Date().toISOString();
                        }
                    }
                }
            }
        } catch (e) {
            log.error('Load error', e);
        }
    }

    private save() {
        try {
            atomicWriteSync(STORE_PATH, this.store);
        } catch (e) {
            log.error('Save error', e);
        }
    }

    async listIssues(state: 'open' | 'closed' | 'all' = 'open'): Promise<any[]> {
        try {
            const { stdout } = await gh([
                'issue', 'list',
                '--repo', REPO,
                '--label', 'opencode-task',
                '--state', state,
                '--limit', '50',
                '--json', 'number,title,body,labels,createdAt,state,closedAt'
            ], { timeout: 15000 });
            return JSON.parse(stdout);
        } catch (e: any) {
            log.error('List issues error', e.message);
            return [];
        }
    }

    async syncTasks(state: 'open' | 'closed' | 'all' = 'open'): Promise<Task[]> {
        const now = Date.now();
        for (const [num, ts] of this.deletedIssueNumbers) {
            if (now - ts > 10 * 60 * 1000) this.deletedIssueNumbers.delete(num);
        }
        const issues = await this.listIssues(state);
        for (const issue of issues) {
            const num = issue.number;
            if (this.deletedIssueNumbers.has(num)) continue;
            if (!this.store.tasks[num]) {
                this.store.tasks[num] = {
                    issueNumber: num,
                    title: issue.title,
                    body: issue.body || '',
                    labels: (issue.labels || []).map((l: any) => l.name || l),
                    status: 'pending',
                    feedbackHistory: [],
                    events: [],
                    updatedAt: new Date().toISOString(),
                    phase: 'done',
                    attempts: [],
                };
            } else if (issue.state === 'CLOSED' && this.store.tasks[num].status === 'pending') {
                this.store.tasks[num].startedAt = undefined;
            }
        }
        this.save();
        return Object.values(this.store.tasks).sort((a, b) => b.issueNumber - a.issueNumber);
    }

    private isTerminalStatus(s: TaskStatus): boolean {
        return s === 'approved' || s === 'merged' || s === 'rejected' || s === 'failed' || s === 'cancelled';
    }

    /**
     * Reconcilia o store local com o estado real do GitHub.
     * - Tasks em estado terminal NAO sao tocadas.
     * - Tasks em running/fixing/reviewing/pending: busca issue e PR.
     *   * Issue CLOSED + PR mergeado  -> merged
     *   * Issue CLOSED + PR fechado    -> rejected
     *   * Issue CLOSED + sem PR        -> failed
     *   * Issue OPEN                    -> mantem (mas limpa startedAt em pending)
     * Idempotente: rodar 2x nao muda estado.
     */
    async syncWithGitHub(): Promise<{ reconciled: number[] }> {
        const reconciled: number[] = [];
        const now = Date.now();
        for (const [numStr, task] of Object.entries(this.store.tasks)) {
            const num = Number(numStr);
            if (this.isTerminalStatus(task.status)) continue;

            // #323: resolve tasks presas em 'cancelling' ha mais de 60s (processo morreu sem completar)
            if (task.status === 'cancelling') {
                const updatedMs = new Date(task.updatedAt).getTime();
                if (now - updatedMs > 60_000) {
                    task.status = 'cancelled';
                    task.error = task.error || 'Auto-resolvido: stuck em cancelling (>60s)';
                    task.completedAt = new Date().toISOString();
                    task.childPid = undefined;
                    task.killRequested = false;
                    this.recordEvent(task, 'task_killed', 'Auto-resolvido: stuck em cancelling (>60s)');
                    reconciled.push(num);
                    log.warn(`Task #${num} auto-resolvida de cancelling -> cancelled`);
                }
                continue;
            }

            let issueData: any;
            try {
                const { stdout } = await gh(['issue', 'view', String(num), '--repo', REPO, '--json', 'state,closedAt'], { timeout: 10000 });
                issueData = JSON.parse(stdout);
            } catch {
                continue; // erro transiente, tenta no proximo boot
            }

            // Issue ainda aberta: garante coerencia local
            if (issueData.state !== 'CLOSED') {
                if (task.status === 'pending' && task.startedAt) {
                    task.startedAt = undefined;
                    reconciled.push(num);
                }
                continue;
            }

            // Issue fechada: deriva status terminal pelo PR
            if (task.prNumber) {
                try {
                    const { stdout: prOut } = await gh(['pr', 'view', String(task.prNumber), '--repo', REPO, '--json', 'state,merged'], { timeout: 10000 });
                    const pr = JSON.parse(prOut);
                    task.status = pr.merged ? 'merged' : 'rejected';
                } catch {
                    task.status = 'failed';
                }
            } else {
                task.status = 'failed';
            }
            task.completedAt = task.completedAt || new Date().toISOString();
            task.updatedAt = new Date().toISOString();
            reconciled.push(num);
        }
        if (reconciled.length) {
            this.save();
            log.info(`syncWithGitHub: reconciliou ${reconciled.length} task(s) -> [${reconciled.join(', ')}]`);
        }
        return { reconciled };
    }

    getTask(issueNumber: number): Task | null {
        return this.store.tasks[issueNumber] || null;
    }

    getAllTasks(): Task[] {
        return Object.values(this.store.tasks).sort((a, b) => b.issueNumber - a.issueNumber);
    }

    async startTask(issueNumber: number): Promise<Task> {
        const task = this.store.tasks[issueNumber];
        if (!task) throw new Error(`Task #${issueNumber} not found`);
        if (task.status === 'running' || task.status === 'fixing') throw new Error(`Task #${issueNumber} is already ${task.status}`);

        const branch = task.branch || `fix-${issueNumber}`;
        task.branch = branch;
        task.error = undefined;
        // Serializa: roda agora se livre, senão entra na FILA.
        this.scheduleExec(task, branch, 'running');
        this.save();
        return task;
    }

    // Fila serial de execução (1 task por vez). O worktree (sistemav2-taskrunner-wt) é COMPARTILHADO,
    // então rodar duas execuções ao mesmo tempo corromperia o git. Tasks extras ficam 'pending' até a vez.
    private pendingExecs = 0;
    private execChain: Promise<void> = Promise.resolve();

    private scheduleExec(task: Task, branch: string, activeStatus: TaskStatus = 'running'): void {
        const willQueue = this.pendingExecs > 0;
        this.pendingExecs++;
        if (willQueue) {
            task.status = 'pending';
            task.updatedAt = new Date().toISOString();
            this.recordEvent(task, 'task_started', 'Na fila — aguardando a task em execução terminar', { queued: true });
            this.save();
            this.emitStatus(task);
        }
        this.execChain = this.execChain.catch(() => { /* isola falha anterior da cadeia */ }).then(async () => {
            try {
                const { taskPlannerService } = require('./taskPlannerService');
                this.recordEvent(task, 'planner_started', 'Planner: analisando viabilidade...');
                this.emitLog(task.issueNumber, 'info', 'Planner: analisando viabilidade da task...');
                const decision = await taskPlannerService.analyzeTask(task);

                task.queuePriority = decision.priority;
                task.planReason = decision.reason;
                this.recordEvent(task, 'planner_decision', `Planner: ${decision.action} — ${decision.reason}`, {
                    action: decision.action,
                    priority: decision.priority,
                    alreadyResolved: decision.alreadyResolved,
                    overlappingFiles: decision.overlappingFiles,
                    blockedBy: decision.blockedBy,
                });

                if (decision.action === 'skip') {
                    await taskPlannerService.skipAndClose(task, decision.reason);
                    this.recordEvent(task, 'task_killed', `Task cancelada pelo Planner: ${decision.reason}`);
                    this.save();
                    this.emitStatus(task);
                    return;
                }

                if (decision.action === 'wait') {
                    task.status = 'pending';
                    task.updatedAt = new Date().toISOString();
                    this.emitLog(task.issueNumber, 'warn', `Planner: aguardando — ${decision.reason}`);
                    this.save();
                    this.emitStatus(task);
                    return;
                }
            } catch (plannerErr: any) {
                log.warn(`Planner error for #${task.issueNumber}, proceeding without planner: ${plannerErr.message}`);
            }

            task.status = activeStatus;
            task.startedAt = new Date().toISOString();
            task.updatedAt = new Date().toISOString();
            this.recordEvent(task, 'task_started', `Execução iniciada no branch ${branch}`, { branch });
            this.save();
            this.emitStatus(task);
            await this.executeTask(task, branch);
        }).catch((e: any) => {
            log.error(`Task #${task.issueNumber} failed`, e);
            task.status = 'failed';
            task.error = e.message;
            task.updatedAt = new Date().toISOString();
            this.recordEvent(task, 'task_failed', `Falha: ${e.message}`, { error: e.message });
            this.save();
            this.emitStatus(task);
        }).finally(() => {
            this.pendingExecs--;
            this.autoPlayNext();
        });
    }

    private getAutomationConfig() {
        try {
            const { uiConfigService } = require('./uiConfigService');
            return uiConfigService.get().taskAutomation;
        } catch {
            return { autoPlay: false, autoMerge: false, minMergeScore: 8 };
        }
    }

    private autoPlayNext() {
        const config = this.getAutomationConfig();
        if (!config.autoPlay) return;
        const queued = this.getQueuedTasks();
        if (queued.length === 0) return;
        const next = queued[0];
        log.info(`Auto-play: iniciando #${next.issueNumber} automaticamente`);
        this.startTask(next.issueNumber).catch((e: any) => {
            log.warn(`Auto-play falhou para #${next.issueNumber}: ${e?.message || e}`);
        });
    }

    /** Garante um worktree git ISOLADO, limpo, no branch fix-N a partir de origin/main. */
    private async ensureWorktree(branch: string): Promise<void> {
        await git(['fetch', 'origin', 'main'], { timeout: 60000 });
        if (!fs.existsSync(WT_ROOT)) {
            await git(['worktree', 'add', '--force', WT_ROOT, 'origin/main'], { timeout: 120000 });
        }
        // Limpa restos de execuções anteriores ANTES de trocar de branch. Sem isto, se uma task
        // anterior deixou o worktree sujo (mudanças não commitadas / arquivos novos), o checkout
        // aborta com "local changes would be overwritten" e a task falha no setup.
        await git(['reset', '--hard'], { timeout: 30000, cwd: WT_ROOT });
        await git(['clean', '-fd'], { timeout: 30000, cwd: WT_ROOT });
        // branch fresco do main mais recente
        await git(['checkout', '-B', branch, 'origin/main'], { timeout: 30000, cwd: WT_ROOT });
        await git(['clean', '-fd'], { timeout: 30000, cwd: WT_ROOT }); // preserva node_modules (ignorado)
        // dependências (uma vez; o worktree persiste entre tasks)
        if (!fs.existsSync(path.join(WT_ROOT, 'node_modules'))) {
            await sh('npm ci', WT_ROOT, 600000);
        }
        if (!fs.existsSync(path.join(WT_ROOT, 'backend', 'node_modules'))) {
            await sh('npm ci', path.join(WT_ROOT, 'backend'), 600000);
        }
    }

    /** Mudanças de CÓDIGO no worktree (ignora node_modules / lock / o arquivo de prompt). */
    private async worktreeChanges(): Promise<string[]> {
        const { stdout } = await git(['status', '--porcelain'], { timeout: 15000, cwd: WT_ROOT });
        return stdout.split('\n')
            .map((l) => l.trim())
            .filter((l) => l && !l.includes('node_modules') && !l.includes('package-lock') && !l.includes(PROMPT_FILE));
    }

    /** Gate de verificação: typecheck backend + frontend + vite build no worktree. */
    private async verify(): Promise<{ ok: boolean; output: string }> {
        try {
            await sh('npx tsc --noEmit -p backend/tsconfig.json', WT_ROOT, 240000);
            await sh('npx tsc --noEmit -p tsconfig.json', WT_ROOT, 240000);
            await sh('npx vite build', WT_ROOT, 300000);
            return { ok: true, output: 'typecheck OK + build OK (backend + frontend)' };
        } catch (e: any) {
            const raw = ((e.stdout || '') + '\n' + (e.stderr || e.message || ''));
            const output = raw.substring(0, 4000);
            if (raw.includes('vite build') || raw.includes('vite v')) {
                return { ok: false, output: 'typecheck OK, mas vite build FALHOU:\n' + output };
            }
            return { ok: false, output };
        }
    }

    private buildPrompt(task: Task, issueData: any): string {
        let p = `# Tarefa (issue #${task.issueNumber}): ${issueData.title}\n\n${issueData.body || ''}\n`;
        if (issueData.comments?.length) {
            p += '\n## Comentários\n';
            for (const c of issueData.comments) p += `- **${c.author?.login || 'user'}**: ${c.body}\n`;
        }
        if (task.feedbackHistory.length) {
            p += '\n## Feedback / correções a ATENDER\n';
            for (const fb of task.feedbackHistory) p += `- ${fb}\n`;
        }
        p += `\n## Instruções\nImplemente a tarefa acima neste repositório (backend: Express+TypeScript em backend/; frontend: React+Vite em src/). Siga as convenções existentes (TypeScript, testes com vitest). Escreva código de produção e os testes correspondentes. Garanta que \`tsc --noEmit\` passe. NÃO altere o arquivo ${PROMPT_FILE}.`;
        return p;
    }

    private buildSynthesisPrompt(task: Task, issueData: any): string {
        let p = `# Tarefa (issue #${task.issueNumber}): ${issueData.title}\n\n${issueData.body || ''}\n`;
        if (issueData.comments?.length) {
            p += '\n## Comentários\n';
            for (const c of issueData.comments) p += `- **${c.author?.login || 'user'}**: ${c.body}\n`;
        }

        const exploreAttempts = task.attempts.filter(a => a.phase === 'exploring');
        if (exploreAttempts.length > 0) {
            p += `\n## Tentativas anteriores de exploração (${exploreAttempts.length})\n`;
            p += 'Foram feitas múltiplas tentativas independentes de implementação. Analise cada uma abaixo e combine os melhores aspectos.\n\n';
            for (const att of exploreAttempts) {
                p += `### Tentativa ${att.index}\n`;
                p += `- **Arquivos modificados** (${att.filesChanged.length}): ${att.filesChanged.join(', ')}\n`;
                p += `- **Typecheck**: ${att.typecheckOk ? '✅ Passou' : '❌ Falhou'}\n`;
                if (att.typecheckErrors) {
                    p += `- **Erros**: \`\`\`\n${att.typecheckErrors.substring(0, 2000)}\n\`\`\`\n`;
                }
                if (att.diff) {
                    const diffPreview = att.diff.length > 8000 ? att.diff.substring(0, 8000) + '\n[... truncado]' : att.diff;
                    p += `- **Diff**:\n\`\`\`diff\n${diffPreview}\n\`\`\`\n`;
                }
                p += '\n';
            }

            p += '## Análise para Síntese\n';
            const okAttempts = exploreAttempts.filter(a => a.typecheckOk);
            const failAttempts = exploreAttempts.filter(a => !a.typecheckOk);
            if (okAttempts.length > 0) {
                p += `- ${okAttempts.length} tentativa(s) passaram no typecheck — priorize as soluções delas.\n`;
            }
            if (failAttempts.length > 0) {
                p += `- ${failAttempts.length} tentativa(s) falharam no typecheck — evite repetir os mesmos erros.\n`;
            }
            p += '\n';
        }

        if (task.feedbackHistory.length) {
            p += '## Feedback / correções a ATENDER\n';
            for (const fb of task.feedbackHistory) p += `- ${fb}\n`;
        }

        p += `\n## Instruções de Síntese\n`;
        p += `Você está na FASE DE SÍNTESE. Foram feitas ${exploreAttempts.length} tentativas de exploração.\n`;
        p += `Combine os MELHORES aspectos de cada tentativa numa implementação final que:\n`;
        p += `1. Resolva TODOS os itens da issue\n`;
        p += `2. Passe no typecheck (tsc --noEmit)\n`;
        p += `3. Siga as convenções do projeto (TypeScript, Express+React+Vite)\n`;
        p += `4. Não repita erros de typecheck das tentativas anteriores\n`;
        p += `5. Inclua testes quando aplicável\n`;
        p += `NÃO altere o arquivo ${PROMPT_FILE}.`;

        return p;
    }

    private async executeTask(task: Task, branch: string): Promise<void> {
        const { issueNumber } = task;
        log.info(`Starting task #${issueNumber} on branch ${branch} (worktree isolado)`);
        this.recordEvent(task, 'task_started', `Iniciando #${issueNumber} em worktree isolado (branch ${branch})`, { branch });

        // 1) Worktree limpo e isolado (nunca toca o dev/main)
        this.recordEvent(task, 'worktree_setup_started', 'Preparando worktree a partir de origin/main...');
        await this.ensureWorktree(branch);
        this.recordEvent(task, 'worktree_setup_completed', 'Worktree pronto', { path: WT_ROOT });

        // 2) Lê a issue
        this.emitLog(issueNumber, 'info', 'Lendo issue do GitHub...');
        const { stdout: issueBody } = await gh(['issue', 'view', String(issueNumber), '--repo', REPO, '--json', 'title,body,labels,comments'], { timeout: 15000 });
        const issueData = JSON.parse(issueBody);

        // 3) Multi-Attempt Synthesis: Fase 1 (exploração 3x) + Fase 2 (síntese 3x)
        const promptPath = path.join(WT_ROOT, PROMPT_FILE);
        let verify = { ok: false, output: 'não verificado' };

        if (!task.attempts) task.attempts = [];
        const hasExploration = task.attempts.filter(a => a.phase === 'exploring').length >= 3;
        task.phase = hasExploration ? 'synthesizing' : 'exploring';
        this.save();

        // === FASE 1: Exploração (3 tentativas independentes) ===
        // Skip se já temos 3 tentativas de exploração (retry inteligente)
        const MAX_EXPLORE = 3;
        if (!hasExploration) {
        for (let attempt = 1; attempt <= MAX_EXPLORE; attempt++) {
            if (task.killRequested) return;
            fs.writeFileSync(promptPath, this.buildPrompt(task, issueData));
            this.recordEvent(task, 'attempt_started', `Fase 1 — Exploração ${attempt}/${MAX_EXPLORE}`, { attempt, phase: 'exploring', maxAttempts: MAX_EXPLORE });

            try {
                const stdout = await runOpencode(
                    `opencode run "Leia o arquivo ${PROMPT_FILE} na raiz do projeto e implemente exatamente o que ele descreve. Nao altere esse arquivo."`,
                    WT_ROOT, task, OPENCODE_TIMEOUT_MS,
                );
                const output = String(stdout);
                this.emitLog(issueNumber, 'ai', output.substring(0, 1500));
                this.recordEvent(task, 'opencode_output', `Exploração ${attempt} — output`, { attempt, phase: 'exploring', output: output.substring(0, 5000) });
            } catch (e: any) {
                if (task.killRequested) {
                    this.recordEvent(task, 'task_killed', 'Task cancelada durante opencode', { attempt, phase: 'exploring' });
                    return;
                }
                this.recordEvent(task, 'error', `opencode erro: ${String(e.message || e).substring(0, 300)}`, { attempt, phase: 'exploring', error: e.message });
            }

            const changes = await this.worktreeChanges();
            if (changes.length === 0) {
                this.recordEvent(task, 'attempt_no_changes', `Exploração ${attempt}: nenhuma mudança`, { attempt, phase: 'exploring' });
                if (attempt < MAX_EXPLORE) {
                    task.feedbackHistory.push('A tentativa anterior não gerou mudanças. Implemente os arquivos pedidos agora.');
                    continue;
                }
                task.status = 'failed';
                task.error = 'O agente não produziu nenhuma mudança após as tentativas.';
                task.updatedAt = new Date().toISOString();
                this.recordEvent(task, 'task_failed', 'Nenhuma mudança após exploração — abortando (sem PR).');
                this.save();
                this.emitStatus(task);
                return;
            }

            // Captura diff e typecheck desta tentativa
            this.recordEvent(task, 'typecheck_started', `Typecheck exploração ${attempt}...`);
            verify = await this.verify();
            const { stdout: diffOut } = await git(['diff'], { timeout: 30000, cwd: WT_ROOT });

            const attemptResult: AttemptResult = {
                index: task.attempts.length + 1,
                phase: 'exploring',
                diff: diffOut.substring(0, 30000),
                typecheckOk: verify.ok,
                typecheckErrors: verify.ok ? undefined : verify.output.substring(0, 4000),
                filesChanged: changes,
            };
            task.attempts.push(attemptResult);

            this.recordEvent(task, 'attempt_completed', `Exploração ${attempt}/${MAX_EXPLORE} — typecheck ${verify.ok ? 'OK' : 'FALHOU'} (${changes.length} arquivos)`, {
                attempt, phase: 'exploring', typecheckOk: verify.ok, filesCount: changes.length,
            });

            // Reset worktree para próxima tentativa (se não for a última)
            if (attempt < MAX_EXPLORE) {
                await git(['checkout', '--', '.'], { timeout: 15000, cwd: WT_ROOT });
                await git(['clean', '-fd', '--', 'src/', 'backend/src/'], { timeout: 15000, cwd: WT_ROOT });
                task.feedbackHistory = [];
            }
        }

        this.recordEvent(task, 'exploration_completed', `${MAX_EXPLORE} tentativas de exploração completas (${task.attempts.filter(a => a.typecheckOk).length}/${MAX_EXPLORE} typecheck OK)`, {
            totalAttempts: task.attempts.length, typecheckOkCount: task.attempts.filter(a => a.typecheckOk).length,
        });
        } else {
            this.recordEvent(task, 'exploration_completed', `Exploração pulada (retry — ${task.attempts.filter(a => a.phase === 'exploring').length} tentativas anteriores reutilizadas)`, { reused: true });
        }

        // === FASE 2: Síntese (até 3 tentativas) ===
        task.phase = 'synthesizing';
        task.synthesisAttempt = 0;
        task.feedbackHistory = [];
        this.save();

        const MAX_SYNTH = 3;
        for (let synthAttempt = 1; synthAttempt <= MAX_SYNTH; synthAttempt++) {
            if (task.killRequested) return;
            task.synthesisAttempt = synthAttempt;
            fs.writeFileSync(promptPath, this.buildSynthesisPrompt(task, issueData));
            this.recordEvent(task, 'synthesis_started', `Fase 2 — Síntese ${synthAttempt}/${MAX_SYNTH}`, { synthAttempt, maxSynth: MAX_SYNTH });

            try {
                const stdout = await runOpencode(
                    `opencode run "Leia o arquivo ${PROMPT_FILE} na raiz do projeto e implemente exatamente o que ele descreve. Nao altere esse arquivo."`,
                    WT_ROOT, task, OPENCODE_TIMEOUT_MS,
                );
                const output = String(stdout);
                this.emitLog(issueNumber, 'ai', output.substring(0, 1500));
                this.recordEvent(task, 'opencode_output', `Síntese ${synthAttempt} — output`, { synthAttempt, phase: 'synthesizing', output: output.substring(0, 5000) });
            } catch (e: any) {
                if (task.killRequested) {
                    this.recordEvent(task, 'task_killed', 'Task cancelada durante síntese', { synthAttempt });
                    return;
                }
                this.recordEvent(task, 'error', `opencode erro na síntese: ${String(e.message || e).substring(0, 300)}`, { synthAttempt, error: e.message });
            }

            const changes = await this.worktreeChanges();
            if (changes.length === 0) {
                if (synthAttempt < MAX_SYNTH) {
                    this.recordEvent(task, 'attempt_no_changes', `Síntese ${synthAttempt}: nenhuma mudança`, { synthAttempt });
                    task.feedbackHistory.push('A síntese não gerou mudanças. Tente novamente combinando as tentativas anteriores.');
                    continue;
                }
                task.status = 'failed';
                task.error = 'Síntese não produziu mudanças após 3 tentativas.';
                task.updatedAt = new Date().toISOString();
                this.recordEvent(task, 'task_failed', 'Síntese sem mudanças — abortando.');
                this.save();
                this.emitStatus(task);
                return;
            }

            // Typecheck gate
            this.recordEvent(task, 'typecheck_started', `Typecheck síntese ${synthAttempt}...`);
            verify = await this.verify();
            const { stdout: synthDiff } = await git(['diff'], { timeout: 30000, cwd: WT_ROOT });

            const synthResult: AttemptResult = {
                index: task.attempts.length + 1,
                phase: 'synthesizing',
                diff: synthDiff.substring(0, 30000),
                typecheckOk: verify.ok,
                typecheckErrors: verify.ok ? undefined : verify.output.substring(0, 4000),
                filesChanged: changes,
            };
            task.attempts.push(synthResult);

            this.recordEvent(task, 'attempt_completed', `Síntese ${synthAttempt}/${MAX_SYNTH} — typecheck ${verify.ok ? 'OK' : 'FALHOU'} (${changes.length} arquivos)`, {
                synthAttempt, typecheckOk: verify.ok, filesCount: changes.length,
            });

            if (verify.ok) {
                this.recordEvent(task, 'synthesis_completed', `Síntese aprovada no typecheck (tentativa ${synthAttempt})`, { synthAttempt, typecheckOk: true });
                break;
            }

            if (synthAttempt < MAX_SYNTH) {
                this.recordEvent(task, 'typecheck_failed', `Typecheck falhou na síntese ${synthAttempt} — corrigindo...`, { synthAttempt, output: verify.output.substring(0, 1000) });
                task.feedbackHistory.push(`Síntese: typecheck falhou. Corrija:\n${verify.output}`);
            } else {
                this.recordEvent(task, 'typecheck_failed', `Typecheck falhou na síntese final (vai no PR marcado p/ revisão)`, { synthAttempt, output: verify.output.substring(0, 1000) });
            }
        }

        // 4) Commit + push (remove o arquivo de prompt antes de commitar)
        fs.rmSync(promptPath, { force: true });
        await git(['add', '-A'], { timeout: 15000, cwd: WT_ROOT });
        let commitSha: string | undefined;
        try {
            const { stdout: commitOut } = await git(['commit', '-m', `feat(#${issueNumber}): ${String(issueData.title).substring(0, 72)}`], { timeout: 20000, cwd: WT_ROOT });
            const shaMatch = commitOut.match(/\[[\w\-/]+ ([a-f0-9]+)\]/);
            commitSha = shaMatch?.[1];
            this.recordEvent(task, 'git_committed', 'Mudanças commitadas', { sha: commitSha });
        } catch {
            task.status = 'failed';
            task.error = 'Nada a commitar após a implementação.';
            this.recordEvent(task, 'task_failed', 'Nada a commitar após a implementação.');
            this.save();
            this.emitStatus(task);
            return;
        }
        await git(['push', 'origin', branch, '--force'], { timeout: 60000, cwd: WT_ROOT });
        this.recordEvent(task, 'git_pushed', 'Push realizado. Criando PR...', { branch });

        // 5) PR (marca o resultado da verificação; NUNCA faz merge — portão humano)
        const verifyTag = verify.ok ? '✅ typecheck OK' : '⚠️ typecheck FALHOU — revisar com atenção';
        const exploreCount = task.attempts.filter(a => a.phase === 'exploring').length;
        const synthCount = task.attempts.filter(a => a.phase === 'synthesizing').length;
        const prBody = `Closes #${issueNumber}\n\nImplementado pelo TaskRunner com Multi-Attempt Synthesis.\n\n**Exploração:** ${exploreCount} tentativas | **Síntese:** ${synthCount} tentativa(s)\n**Verificação:** ${verifyTag}\n\n⚠️ Requer revisão humana antes do merge.`;
        let prNumber: number | undefined;
        let prUrl: string | undefined;
        try {
            const { stdout: prOut } = await gh([
                'pr', 'create', '--repo', REPO, '--head', branch, '--base', 'main',
                '--title', `feat(#${issueNumber}): ${issueData.title}`,
                '--body', prBody,
            ], { timeout: 30000 });
            const match = prOut.match(/\/pull\/(\d+)/);
            if (match) prNumber = parseInt(match[1]);
            prUrl = prOut.trim();
            this.recordEvent(task, 'pr_created', `PR #${prNumber} criado: ${prUrl}`, { prNumber, prUrl, verifyOk: verify.ok });
        } catch (e: any) {
            if (e.message?.includes('already exists')) {
                const { stdout: existingPr } = await gh(['pr', 'list', '--repo', REPO, '--head', branch, '--json', 'number,url', '--limit', '1'], { timeout: 15000 });
                const prs = JSON.parse(existingPr);
                if (prs.length) { prNumber = prs[0].number; prUrl = prs[0].url; }
                this.recordEvent(task, 'pr_created', `PR #${prNumber} ja existia: ${prUrl}`, { prNumber, prUrl, reused: true });
            } else {
                this.recordEvent(task, 'pr_creation_failed', `Falha ao criar PR: ${String(e.message).substring(0, 300)}`, { error: e.message });
            }
        }

        task.prNumber = prNumber;
        task.prUrl = prUrl;
        task.phase = 'judging';
        task.updatedAt = new Date().toISOString();
        this.emitStatus(task);

        if (prNumber) {
            this.emitLog(issueNumber, 'info', 'Executando Judge (revisão automática)...');
            await this.runJudge(task);
        } else {
            task.status = 'reviewing';
            this.save();
        }
    }

    async runJudge(task: Task): Promise<void> {
        if (!task.prNumber) throw new Error('No PR to judge');

        log.info(`Judging PR #${task.prNumber} for task #${task.issueNumber}`);
        task.status = 'reviewing';
        this.emitStatus(task);
        this.recordEvent(task, 'judge_started', `Judge: avaliando PR #${task.prNumber}...`, { prNumber: task.prNumber });

        try {
            const { stdout: diff } = await gh([
                'pr', 'diff', String(task.prNumber),
                '--repo', REPO,
            ], { timeout: 30000 });

            const changedFiles = diff.split('\n')
                .filter(l => l.startsWith('diff --git '))
                .map(l => l.replace(/^diff --git a\/.+ b\//, ''))
                .filter(Boolean);

            const issueBody = task.body || '';
            const mentionedFiles = issueBody.match(/[\w/.-]+\.(ts|tsx|js|jsx|json|css|md|sql)/g) || [];
            const missingFiles = mentionedFiles.filter(f => !changedFiles.some(cf => cf.includes(f)));

            let agentsMd = '';
            try {
                agentsMd = fs.readFileSync(path.join(REPO_ROOT, 'AGENTS.md'), 'utf8');
            } catch { /* não encontrado, segue sem */ }

            const coverageNote = missingFiles.length > 0
                ? `\n**ATENÇÃO:** Arquivos mencionados na issue que NÃO foram modificados: ${missingFiles.join(', ')}. Verifique se a implementação está completa.`
                : '';

            const diffContent = diff.length > 50000
                ? diff.substring(0, 50000) + '\n\n[... diff truncado após 50KB ...]'
                : diff;

            const judgePrompt = `You are a strict senior code reviewer (LLM Judge) for a production system.
Evaluate this PR against the original issue and project conventions.

## Projeto
- Backend: Express + TypeScript (porta 3004), Dolibarr ERP como backend de dados
- Frontend: React + Vite (porta 5173)
- Repo: tcstulio/sistemav2

## Convenções (AGENTS.md)
${agentsMd || 'Não disponível'}

## Issue #${task.issueNumber}: ${task.title}
${issueBody.substring(0, 3000)}
${task.feedbackHistory.length ? `\n## Feedback anterior a atender\n${task.feedbackHistory.map(fb => `- ${fb}`).join('\n')}` : ''}

## Arquivos modificados (${changedFiles.length})
${changedFiles.join('\n')}
${coverageNote}

## PR Diff
${diffContent}

## Rubrica de avaliação (0-10)

### 1. Completude (0-3 pontos)
- Resolve TODOS os itens da issue?
- Todos os arquivos mencionados na issue foram tocados?
- Todos os critérios de aceite foram atendidos?

### 2. Qualidade do código (0-2 pontos)
- Segue padrões existentes (TypeScript, convenções do projeto)?
- Sem duplicação, nomes descritivos, tipos corretos?
- Usa bibliotecas já presentes no projeto (não inventa deps)?

### 3. Robustez (0-2 pontos)
- Error handling adequado (try/catch, fallbacks)?
- Edge cases cobertos?
- Não introduz vazamentos de memória, secrets ou XSS?

### 4. Testes e verificação (0-2 pontos)
- Testes foram escritos ou atualizados?
- tsc --noEmit passaria?
- Lint passaria?

### 5. Convenções do projeto (0-1 ponto)
- Commit message segue padrão "tipo(#issue): descrição"?
- Sem .env ou credenciais no diff?
- Imports e estrutura consistentes?

Return ONLY a JSON:
{"score": <number>, "approved": <boolean>, "review": "<revisão detalhada em português, listando pontos positivos e negativos>", "missing_coverage": ["<arquivo ou critério não atendido>"]}`;

            const history = [
                { role: 'system' as const, parts: 'You are a strict senior code reviewer. Be thorough and objective. Evaluate against ALL criteria. Do not inflate scores.' },
                { role: 'user' as const, parts: judgePrompt },
            ];

            // Roteia pela fila serial do aiJobService (#320 item 3): o listener de
            // tool-calls do aiService é global, então o Judge não pode rodar em
            // paralelo com um job de chat — aqui ele espera a vez dele na fila.
            const judgeResult = await aiJobService.runAndWait(
                () => aiService.generateReply(history, '', undefined, 'chat'),
                `judge-pr-${task.prNumber}`,
            );
            const reply = judgeResult.text;
            const jsonMatch = reply.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const result = JSON.parse(jsonMatch[0]);
                task.judgeScore = result.score;
                task.judgeReview = result.review;
                task.judgeAttempts = (task.judgeAttempts || 0) + 1;

                this.recordEvent(task, 'judge_score', `Judge: ${result.score}/10 — ${result.review?.substring(0, 200) || ''}`, {
                    score: result.score,
                    approved: !!result.approved,
                    review: result.review,
                    missingCoverage: result.missing_coverage || [],
                    attempt: task.judgeAttempts,
                });

                if (result.score >= 8 || task.judgeAttempts >= 3) {
                    task.phase = 'done';
                    task.status = result.score >= 6 ? 'approved' : 'reviewing';
                    this.emitLog(task.issueNumber, 'success', `Judge: ${result.score}/10 — ${result.score >= 8 ? 'auto-aprovado' : result.score >= 6 ? 'aprovado (múltiplas tentativas)' : 'requer revisão humana'}`);
                } else if (result.score >= 6) {
                    task.phase = 'done';
                    task.status = 'reviewing';
                    this.emitLog(task.issueNumber, 'info', `Judge: ${result.score}/10 — aguardando revisão humana`);
                } else {
                    log.info(`Judge score ${result.score}/10, auto-fixing (attempt ${task.judgeAttempts})`);
                    this.emitLog(task.issueNumber, 'warn', `Judge reprovou (${result.score}/10). Auto-corrigindo (tentativa ${task.judgeAttempts})...`);
                    const fixContext = [
                        `Judge (score ${result.score}/10): ${result.review}`,
                        ...(result.missing_coverage?.length ? [`Cobertura faltando: ${result.missing_coverage.join(', ')}`] : []),
                    ].join('\n');
                    task.feedbackHistory.push(fixContext);
                    task.status = 'fixing';
                    this.save();

                    await this.executeTask(task, task.branch || `fix-${task.issueNumber}`);
                    return;
                }
            } else {
                task.status = 'reviewing';
                task.judgeReview = 'Judge failed to evaluate';
                this.recordEvent(task, 'judge_error', 'Judge failed to evaluate (no JSON in reply)');
            }
        } catch (e: any) {
            log.error(`Judge error for #${task.issueNumber}`, e);
            task.status = 'reviewing';
            task.judgeReview = `Judge error: ${e.message}`;
            this.recordEvent(task, 'judge_error', `Judge error: ${e.message}`, { error: e.message });
        }

        task.updatedAt = new Date().toISOString();
        this.save();
        this.emitStatus(task);

        if (task.status === 'approved') {
            const hasFrontend = await this.hasFrontendChanges(task);
            if (hasFrontend && (task.judgeScore || 0) >= 6) {
                this.recordEvent(task, 'judge_started', 'Frontend detectado — executando Judge Visual...');
                this.runVisualJudge(task).catch((e: any) => {
                    log.warn(`Visual Judge falhou para #${task.issueNumber}: ${e?.message || e}`);
                    task.status = 'reviewing';
                    task.visualReview = `Visual Judge failed: ${e?.message || e}`;
                    this.save();
                    this.emitStatus(task);
                });
            } else {
                this.tryAutoMerge(task).catch((e: any) => {
                    log.warn(`Auto-merge falhou para #${task.issueNumber}: ${e?.message || e}`);
                });
            }
        }
    }

    private async hasFrontendChanges(task: Task): Promise<boolean> {
        if (!task.prNumber) return false;
        try {
            const { stdout: files } = await gh([
                'pr', 'diff', String(task.prNumber), '--repo', REPO, '--name-only',
            ], { timeout: 30000 });
            const FRONTEND_PATTERNS = ['src/', '.tsx', '.css', '.scss', 'index.html', 'vite.config', 'tailwind.config'];
            return files.split('\n').filter(Boolean).some(file =>
                FRONTEND_PATTERNS.some(p => file.includes(p))
            );
        } catch {
            return false;
        }
    }

    private async runVisualJudge(task: Task): Promise<void> {
        const issueNumber = task.issueNumber;
        log.info(`Visual Judge: starting for task #${issueNumber}`);
        this.recordEvent(task, 'judge_started', 'Judge Visual: capturando screenshots...');
        this.emitLog(issueNumber, 'info', 'Judge Visual: capturando screenshots antes/depois...');

        try {
            const previewPort = 3000 + (issueNumber % 1000);
            const afterUrl = `http://localhost:${previewPort}`;

            const beforeUrl = 'http://localhost:3003';

            let beforePath: string;
            let afterPath: string;
            try {
                const result = await screenshotService.captureForTask(issueNumber, beforeUrl, afterUrl);
                beforePath = result.beforePath;
                afterPath = result.afterPath;
                this.recordEvent(task, 'judge_started', 'Screenshots capturados. Executando Judge Visual via opencode + MCPs...');
                this.emitLog(issueNumber, 'info', 'Screenshots OK. Enviando para analise visual (zai-vision + minimax)...');
            } catch (e: any) {
                this.recordEvent(task, 'judge_error', `Screenshot falhou: ${e.message}`, { error: e.message });
                this.emitLog(issueNumber, 'warn', `Screenshot falhou (${e.message}). Pulando Judge Visual.`);
                task.visualScore = 0;
                task.visualReview = `Screenshot failed: ${e.message}`;
                task.status = 'reviewing';
                this.save();
                this.emitStatus(task);
                return;
            }

            const prompt = [
                'Voce e um Judge Visual de interfaces de usuario. Analise os screenshots antes/depois de uma mudanca no frontend.',
                '',
                'INSTRUCOES:',
                `1. Use a ferramenta zai-vision_ui_diff_check para comparar os dois screenshots:`,
                `   - Expected (ANTES): ${beforePath}`,
                `   - Actual (DEPOIS): ${afterPath}`,
                `2. Use a ferramenta minimax_understand_image para analisar o screenshot DEPOIS em detalhes: ${afterPath}`,
                '',
                'CRITERIOS DE AVALIACAO (0-10):',
                '- Layout esta correto e alinhado?',
                '- Nenhum texto cortado ou sobreposto?',
                '- Dark mode preservado (se aplicavel)?',
                '- Responsividade mantida?',
                '- Nenhum componente quebrado ou faltando?',
                '- Cores e estilos consistentes com o antes?',
                '',
                'Se os screenshots parecerem identicos ou com mudancas minimas visuais (apenas texto/dados), de score alto (9-10).',
                'Se houver quebras visuais claras (componentes faltando, layout quebrado), de score baixo (0-4).',
                '',
                'Retorne APENAS um JSON:',
                '{"visual_score": <0-10>, "issues": ["lista de problemas visuais"], "summary": "resumo em portugues das mudancas visuais"}',
            ].join('\n');

            const stdout = await runOpencode(
                `opencode run "${prompt.replace(/"/g, '\\"')}"`,
                REPO_ROOT, task, 120_000,
            );

            this.emitLog(issueNumber, 'ai', String(stdout).substring(0, 1500));

            const jsonMatch = String(stdout).match(/\{[\s\S]*"visual_score"[\s\S]*\}/);
            if (jsonMatch) {
                const result = JSON.parse(jsonMatch[0]);
                task.visualScore = result.visual_score;
                task.visualReview = result.summary || '';
                this.recordEvent(task, 'judge_score', `Judge Visual: ${result.visual_score}/10 — ${(result.summary || '').substring(0, 200)}`, {
                    visualScore: result.visual_score,
                    issues: result.issues || [],
                });
                this.emitLog(issueNumber, 'success', `Judge Visual: ${result.visual_score}/10 — ${(result.summary || '').substring(0, 150)}`);

                if ((task.visualScore || 0) >= 8 && (task.judgeScore || 0) >= 8) {
                    task.status = 'approved';
                } else {
                    task.status = 'reviewing';
                }
            } else {
                task.visualScore = 0;
                task.visualReview = 'Judge Visual failed to evaluate (no JSON in output)';
                task.status = 'reviewing';
                this.recordEvent(task, 'judge_error', 'Judge Visual: failed to parse response');
            }
        } catch (e: any) {
            log.error(`Visual Judge error for #${issueNumber}`, e);
            task.visualScore = 0;
            task.visualReview = `Visual Judge error: ${e.message}`;
            task.status = 'reviewing';
            this.recordEvent(task, 'judge_error', `Visual Judge error: ${e.message}`, { error: e.message });
        }

        task.updatedAt = new Date().toISOString();
        this.save();
        this.emitStatus(task);

        if (task.status === 'approved') {
            this.tryAutoMerge(task).catch((e: any) => {
                log.warn(`Auto-merge falhou para #${task.issueNumber}: ${e?.message || e}`);
            });
        }
    }

    private async tryAutoMerge(task: Task): Promise<void> {
        const config = this.getAutomationConfig();
        if (!config.autoMerge) return;
        if ((task.judgeScore || 0) < config.minMergeScore) return;
        if (task.visualScore !== undefined && task.visualScore < config.minMergeScore) {
            this.recordEvent(task, 'task_failed', `Auto-merge bloqueado: visual score ${task.visualScore} < ${config.minMergeScore}`);
            return;
        }

        const issueNumber = task.issueNumber;
        log.info(`Auto-merge: testando gates para #${issueNumber}`);

        try {
            if (task.branch) {
                this.recordEvent(task, 'task_started', 'Auto-merge: rebaseando com main...');
                await git(['fetch', 'origin', 'main'], { timeout: 30000 });
                await git(['checkout', task.branch], { timeout: 15000, cwd: WT_ROOT });
                await git(['rebase', 'origin/main'], { timeout: 60000, cwd: WT_ROOT });
                await git(['push', 'origin', task.branch, '--force'], { timeout: 30000, cwd: WT_ROOT });
                this.recordEvent(task, 'task_started', 'Auto-merge: rebase OK');
            }

            if (task.prNumber) {
                this.recordEvent(task, 'task_started', 'Auto-merge: testando merge (dry-run)...');
                const { stdout: mergeCheck } = await gh(['pr', 'merge', String(task.prNumber), '--repo', REPO, '--squash', '--delete-branch', '--dry-run'], { timeout: 30000 }).catch((e: any) => {
                    throw new Error(`Merge test falhou: ${e?.message || e}`);
                });
                this.recordEvent(task, 'task_started', 'Auto-merge: dry-run OK');
            }

            this.recordEvent(task, 'task_started', 'Auto-merge: rodando typecheck...');
            const verifyOk = await this.verify();
            if (!verifyOk) {
                this.recordEvent(task, 'task_failed', 'Auto-merge abortado: typecheck falhou apos rebase');
                task.status = 'reviewing';
                this.save();
                this.emitStatus(task);
                return;
            }

            this.recordEvent(task, 'task_started', 'Auto-merge: todos os gates passaram. Mergeando...');
            await this.mergeTask(issueNumber);

            const { notificationService } = require('./notificationService');
            await notificationService.create({
                event: 'agent.action',
                title: `Task #${issueNumber} merged automaticamente`,
                message: `Score ${task.judgeScore}/10, todos os gates passaram.`,
                channels: ['in-app'],
                priority: 'low',
                entityType: 'opencode-task',
                entityId: String(issueNumber),
                senderName: 'TaskRunner',
            });

            this.reevaluateAfterMerge();
        } catch (e: any) {
            this.recordEvent(task, 'task_failed', `Auto-merge abortado: ${e?.message || e}`);
            task.status = 'reviewing';
            this.save();
            this.emitStatus(task);
        }
    }

    private reevaluateAfterMerge() {
        try {
            const { taskPlannerService } = require('./taskPlannerService');
            taskPlannerService.reevaluateWaiting().then((results: any[]) => {
                const unblocked = results.filter((r: any) => r.action === 'go');
                if (unblocked.length > 0) {
                    log.info(`Reevaluate: ${unblocked.length} task(s) desbloqueada(s) apos merge`);
                    this.save();
                    this.autoPlayNext();
                }
            }).catch((e: any) => {
                log.warn(`Reevaluate after merge falhou: ${e?.message || e}`);
            });
        } catch { /* planner not available */ }
    }

    async addFeedback(issueNumber: number, feedback: string): Promise<Task> {
        const task = this.store.tasks[issueNumber];
        if (!task) throw new Error(`Task #${issueNumber} not found`);

        task.feedbackHistory.push(feedback);
        task.status = 'fixing';
        task.updatedAt = new Date().toISOString();
        this.recordEvent(task, 'feedback_received', `Feedback recebido: ${feedback.substring(0, 200)}`, { length: feedback.length });
        this.save();

        this.scheduleExec(task, task.branch || `fix-${task.issueNumber}`, 'fixing');

        return task;
    }

    async redoTask(issueNumber: number, instruction?: string): Promise<Task> {
        const task = this.store.tasks[issueNumber];
        if (!task) throw new Error(`Task #${issueNumber} not found`);

        if (task.prNumber) {
            try {
                await gh(['pr', 'close', String(task.prNumber), '--repo', REPO, '--comment', 'Redoing task'], { timeout: 15000 });
                this.recordEvent(task, 'pr_closed', `PR #${task.prNumber} fechado para redo`, { prNumber: task.prNumber, reason: 'redo' });
            } catch { /* PR might not exist */ }
        }

        if (instruction) task.feedbackHistory.push(`Redo: ${instruction}`);
        task.prNumber = undefined;
        task.prUrl = undefined;
        task.judgeScore = undefined;
        task.judgeReview = undefined;
        task.judgeAttempts = 0;
        task.visualScore = undefined;
        task.visualReview = undefined;
        task.phase = 'exploring';
        task.attempts = [];
        task.synthesisAttempt = undefined;
        task.status = 'running';
        task.error = undefined;
        task.updatedAt = new Date().toISOString();
        this.recordEvent(task, 'task_started', `Task refeita${instruction ? `: ${instruction.substring(0, 200)}` : ''}`, { redo: true, instruction });
        this.save();

        this.scheduleExec(task, task.branch || `fix-${task.issueNumber}`, 'running');

        return task;
    }

    async rejectTask(issueNumber: number): Promise<Task> {
        const task = this.store.tasks[issueNumber];
        if (!task) throw new Error(`Task #${issueNumber} not found`);

        if (task.prNumber) {
            try {
                await gh(['pr', 'close', String(task.prNumber), '--repo', REPO, '--comment', 'Rejected'], { timeout: 15000 });
                this.recordEvent(task, 'pr_closed', `PR #${task.prNumber} rejeitado`, { prNumber: task.prNumber, reason: 'rejected' });
            } catch { /* ignore */ }
        }

        task.status = 'rejected';
        task.completedAt = new Date().toISOString();
        task.updatedAt = new Date().toISOString();
        this.recordEvent(task, 'task_rejected', 'Task rejeitada pelo administrador');
        this.save();
        this.emitStatus(task);
        return task;
    }

    async mergeTask(issueNumber: number): Promise<Task> {
        const task = this.store.tasks[issueNumber];
        if (!task) throw new Error(`Task #${issueNumber} not found`);
        if (!task.prNumber) throw new Error('No PR to merge');

        await gh(['pr', 'merge', String(task.prNumber), '--repo', REPO, '--squash', '--delete-branch'], { timeout: 30000 });
        await gh(['issue', 'close', String(issueNumber), '--repo', REPO, '--comment', `Merged via PR #${task.prNumber}`], { timeout: 15000 });

        task.status = 'merged';
        task.completedAt = new Date().toISOString();
        task.updatedAt = new Date().toISOString();
        this.recordEvent(task, 'pr_merged', `PR #${task.prNumber} merged com sucesso`, { prNumber: task.prNumber });
        this.recordEvent(task, 'task_completed', `Task concluída (PR #${task.prNumber} merged)`);
        this.save();
        this.emitStatus(task);
        return task;
    }

    async updateTask(issueNumber: number, updates: Partial<Pick<Task, 'title' | 'body' | 'labels'>>): Promise<Task> {
        const task = this.store.tasks[issueNumber];
        if (!task) throw new Error(`Task #${issueNumber} not found`);

        if (updates.title !== undefined) task.title = updates.title;
        if (updates.body !== undefined) task.body = updates.body;
        if (updates.labels !== undefined) task.labels = updates.labels;
        task.updatedAt = new Date().toISOString();
        this.save();
        return task;
    }

    async createTask(title: string, body: string, labels: string[] = []): Promise<Task> {
        const allLabels = Array.from(new Set(['opencode-task', ...labels]));
        const { stdout } = await gh([
            'issue', 'create',
            '--repo', REPO,
            '--title', title,
            '--body', body || ' ',
            '--label', allLabels.join(','),
        ], { timeout: 30000 });
        const match = stdout.trim().match(/\/issues\/(\d+)/);
        if (!match) throw new Error('Falha ao criar issue');
        const issueNumber = parseInt(match[1]);
        const task: Task = {
            issueNumber,
            title,
            body,
            labels: allLabels,
            status: 'pending',
            feedbackHistory: [],
            events: [],
            updatedAt: new Date().toISOString(),
            phase: 'done',
            attempts: [],
        };
        this.store.tasks[issueNumber] = task;
        this.recordEvent(task, 'task_created', `Task criada via board: #${issueNumber} — ${title}`);
        this.save();
        return task;
    }

    async deleteTask(issueNumber: number): Promise<void> {
        const task = this.store.tasks[issueNumber];
        if (!task) throw new Error(`Task #${issueNumber} not found`);

        // Se estiver em execução (ou presa em 'running'/'fixing'/'cancelling' por um run morto),
        // mata o processo (árvore) antes de deletar — em vez de recusar. Cobre tasks travadas.
        if (task.status === 'running' || task.status === 'fixing' || task.status === 'cancelling') {
            task.killRequested = true;
            if (task.childPid && isAlive(task.childPid)) {
                try { await killTree(task.childPid); } catch { /* ignore */ }
            }
            task.childPid = undefined;
        }

        if (task.prNumber) {
            try {
                await gh(['pr', 'close', String(task.prNumber), '--repo', REPO, '--comment', 'Task deleted'], { timeout: 15000 });
            } catch { /* ignore */ }
        }

        // Remove o label "opencode-task" da issue — senao o syncTasks() recria a task no proximo
        // GET /tasks (ele reconstroi o board a partir das issues abertas com esse label). A issue
        // em si e' mantida no GitHub; ela apenas sai do pipeline do opencode. Sem isto, "deletar"
        // so removia do store e a task reaparecia no sync seguinte ("diz que deletou mas volta").
        try {
            await gh(['issue', 'edit', String(issueNumber), '--repo', REPO, '--remove-label', 'opencode-task'], { timeout: 15000 });
        } catch (e: any) {
            log.warn(`deleteTask #${issueNumber}: falha ao remover label opencode-task (a task pode reaparecer no sync): ${e?.message || e}`);
        }

        delete this.store.tasks[issueNumber];
        this.deletedIssueNumbers.set(issueNumber, Date.now());
        this.save();
    }

    async getDiff(issueNumber: number): Promise<string> {
        const task = this.store.tasks[issueNumber];
        if (!task) throw new Error('Task not found');
        try {
            // O branch vive no worktree/origin — o diff vem do PR (ou do worktree como fallback).
            if (task.prNumber) {
                const { stdout } = await gh(['pr', 'diff', String(task.prNumber), '--repo', REPO], { timeout: 30000 });
                return stdout;
            }
            if (task.branch && fs.existsSync(WT_ROOT)) {
                const { stdout } = await git(['diff', `origin/main...${task.branch}`], { timeout: 15000, cwd: WT_ROOT });
                return stdout;
            }
            return 'Sem PR/branch ainda.';
        } catch {
            return 'Unable to fetch diff';
        }
    }

    /**
     * Cancela uma task em execucao (issue #304).
     * - Seta killRequested=true (o runOpencode watcher mata a arvore em <=500ms).
     * - Tambem mata diretamente o PID atual via processTree (defesa em profundidade).
     * - Idempotente: chamar 2x nao quebra.
     * - Recusa task em estado terminal (merged/rejected/failed/cancelled).
     */
    async killTask(issueNumber: number, reason = 'user requested'): Promise<Task> {
        const task = this.store.tasks[issueNumber];
        if (!task) throw new Error(`Task #${issueNumber} not found`);

        if (this.isTerminalStatus(task.status) || task.status === 'cancelled') {
            throw new Error(`Task #${issueNumber} is already ${task.status}`);
        }
        if (task.status === 'cancelling') {
            return task; // idempotente
        }

        const pid = task.childPid;
        task.killRequested = true;
        task.status = 'cancelling';
        task.updatedAt = new Date().toISOString();
        this.recordEvent(task, 'task_killed', `Cancelamento solicitado: ${reason}`, { pid, reason });
        this.emitStatus(task);

        // Mata direto (nao espera o watcher) + aguarda ate 5s.
        let killResult: { ok: boolean; signal: string; durationMs: number; alreadyDead: boolean } | null = null;
        if (pid && isAlive(pid)) {
            killResult = await killTree(pid);
            this.recordEvent(task, 'task_killed',
                `Process tree killed via ${killResult.signal}${killResult.alreadyDead ? ' (ja estava morto)' : ''}`,
                { pid, ...killResult });
        }

        task.status = 'cancelled';
        task.killedAt = new Date().toISOString();
        task.completedAt = task.killedAt;
        task.error = reason;
        task.childPid = undefined;
        task.killRequested = false;
        task.updatedAt = task.killedAt;
        this.save();
        this.emitStatus(task);
        log.info(`Task #${issueNumber} cancelled (pid=${pid}, signal=${killResult?.signal || 'noop'})`);
        return task;
    }

    reorderTasks(order: number[]): void {
        for (let i = 0; i < order.length; i++) {
            const task = this.store.tasks[order[i]];
            if (task) task.queuePriority = i + 1;
        }
        this.save();
    }

    getQueuedTasks(): Task[] {
        return Object.values(this.store.tasks)
            .filter(t => t.status === 'pending' && !this.isTerminalStatus(t.status))
            .sort((a, b) => (a.queuePriority ?? 999) - (b.queuePriority ?? 999));
    }

    async planWithLLM(): Promise<{ order: number[]; reasons: Record<number, string> }> {
        const queued = this.getQueuedTasks();
        if (queued.length === 0) return { order: [], reasons: {} };
        if (queued.length === 1) return { order: [queued[0].issueNumber], reasons: { [queued[0].issueNumber]: 'Unica task na fila.' } };

        const taskList = queued.map((t, i) => ({
            issueNumber: t.issueNumber,
            title: t.title,
            body: (t.body || '').substring(0, 500),
            labels: t.labels.filter(l => l !== 'opencode-task'),
            currentPriority: i + 1,
        }));

        const prompt = `You are a task planning assistant. Analyze these ${taskList.length} pending tasks and suggest the OPTIMAL execution order.

Tasks (current order):
${taskList.map(t => `#${t.issueNumber}: ${t.title}\n  Labels: ${t.labels.join(', ') || 'none'}\n  Body: ${t.body.substring(0, 200)}`).join('\n\n')}

Consider:
1. Dependencies between tasks (e.g., refactor before feature that depends on it)
2. Risk and complexity (simpler/safer tasks first to unblock)
3. Impact and urgency
4. Potential merge conflicts if done in sequence

Return ONLY a JSON array of objects with this exact format:
[{"issueNumber": <number>, "reason": "<brief reason in Portuguese for this position>"}]

The first element should be the task to execute first.`;

        const history = [
            { role: 'system' as const, parts: 'You are a software project planning expert. Be concise and practical.' },
            { role: 'user' as const, parts: prompt },
        ];

        const result = await aiService.generateReply(history, '', undefined, 'chat');
        const reply = result.text;
        const jsonMatch = reply.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error('LLM retornou formato invalido');

        const plan: Array<{ issueNumber: number; reason: string }> = JSON.parse(jsonMatch[0]);
        const order = plan.map(p => p.issueNumber);
        const reasons: Record<number, string> = {};
        for (const p of plan) {
            reasons[p.issueNumber] = p.reason;
        }

        for (let i = 0; i < order.length; i++) {
            const task = this.store.tasks[order[i]];
            if (task) {
                task.queuePriority = i + 1;
                task.planReason = reasons[order[i]];
            }
        }
        this.save();

        return { order, reasons };
    }

    private activePreviews: Map<number, { pid: number; port: number; startedAt: string }> = new Map();

    async startPreview(issueNumber: number): Promise<{ port: number; frontendUrl: string; backendUrl: string }> {
        const task = this.store.tasks[issueNumber];
        if (!task) throw new Error(`Task #${issueNumber} not found`);
        if (!task.branch) throw new Error('Task não tem branch. Execute a task primeiro.');

        const existing = this.activePreviews.get(issueNumber);
        if (existing && isAlive(existing.pid)) {
            return { port: existing.port, frontendUrl: `http://localhost:${existing.port}`, backendUrl: `http://localhost:${existing.port + 1}` };
        }

        await this.ensureWorktree(task.branch);
        await git(['checkout', task.branch], { timeout: 15000, cwd: WT_ROOT });

        const previewPort = 5174 + (issueNumber % 10);
        const backendPort = 3014 + (issueNumber % 10);

        const previewRoot = WT_ROOT;
        const envContent = `PORT=${backendPort}\nVITE_API_URL=http://localhost:${backendPort}\n`;
        const fsExtra = await import('fs');
        fsExtra.writeFileSync(path.join(previewRoot, 'backend', '.env.preview'), envContent);

        const child = spawn(GIT_BASH, ['-lc', `cd backend && npx nodemon --port ${backendPort} & npx vite --port ${previewPort} --host`], {
            cwd: previewRoot,
            detached: process.platform !== 'win32',
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });

        this.activePreviews.set(issueNumber, { pid: child.pid!, port: previewPort, startedAt: new Date().toISOString() });

        child.unref();

        this.recordEvent(task, 'task_started', `Preview iniciado na porta ${previewPort} (branch ${task.branch})`, { port: previewPort, backendPort, branch: task.branch });

        return { port: previewPort, frontendUrl: `http://localhost:${previewPort}`, backendUrl: `http://localhost:${backendPort}` };
    }

    async stopPreview(issueNumber: number): Promise<void> {
        const preview = this.activePreviews.get(issueNumber);
        if (!preview) return;
        if (isAlive(preview.pid)) {
            await killTree(preview.pid);
        }
        this.activePreviews.delete(issueNumber);
    }
}

export const taskRunnerService = new TaskRunnerService();
