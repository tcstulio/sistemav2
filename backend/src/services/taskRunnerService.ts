import { execFile, exec, ChildProcess, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { atomicWriteSync } from '../utils/atomicWrite';
import { logger } from '../utils/logger';
import { aiService } from './aiService';
import { socketService } from './socketService';
import { killTree, isAlive } from '../utils/processTree';

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
    | 'error';

export interface TaskEvent {
    ts: string;             // ISO 8601
    type: TaskEventType;
    message: string;        // human-readable (pt-BR)
    meta?: Record<string, any>;
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
    feedbackHistory: string[];
    startedAt?: string;
    updatedAt: string;
    completedAt?: string;
    error?: string;
    events: TaskEvent[];        // timeline persistida (issue #306)
    childPid?: number;          // PID do opencode em execucao (issue #304)
    killRequested?: boolean;    // flag de cancelamento solicitado
    killedAt?: string;          // quando o kill foi processado
    queuePriority?: number;     // ordem na fila (menor = primeiro) — issue #331
    planReason?: string;        // justificativa do LLM Planner — issue #331
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
            : type === 'judge_score' || type === 'judge_started' ? 'ai'
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
        for (const [numStr, task] of Object.entries(this.store.tasks)) {
            const num = Number(numStr);
            if (this.isTerminalStatus(task.status)) continue;

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

    /** Gate de verificação: typecheck backend + frontend no worktree. */
    private async verify(): Promise<{ ok: boolean; output: string }> {
        try {
            await sh('npx tsc --noEmit -p backend/tsconfig.json', WT_ROOT, 240000);
            await sh('npx tsc --noEmit -p tsconfig.json', WT_ROOT, 240000);
            return { ok: true, output: 'typecheck OK (backend + frontend)' };
        } catch (e: any) {
            return { ok: false, output: ((e.stdout || '') + '\n' + (e.stderr || e.message || '')).substring(0, 4000) };
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

        // 3) Implementa com opencode (com 1 retry guiado pelo typecheck)
        const promptPath = path.join(WT_ROOT, PROMPT_FILE);
        let verify = { ok: false, output: 'não verificado' };
        const MAX_IMPL = 2;
        for (let attempt = 1; attempt <= MAX_IMPL; attempt++) {
            fs.writeFileSync(promptPath, this.buildPrompt(task, issueData));
            this.recordEvent(task, 'attempt_started', `Implementando com opencode (tentativa ${attempt}/${MAX_IMPL})`, { attempt, maxAttempts: MAX_IMPL });
            try {
                // runOpencode faz tracking de PID e mata a arvore se killRequested for setado
                // durante a execucao (#304).
                const stdout = await runOpencode(
                    `opencode run "Leia o arquivo ${PROMPT_FILE} na raiz do projeto e implemente exatamente o que ele descreve. Nao altere esse arquivo."`,
                    WT_ROOT, task, OPENCODE_TIMEOUT_MS,
                );
                this.emitLog(issueNumber, 'ai', String(stdout).substring(0, 1500));
            } catch (e: any) {
                // Se foi kill solicitado, sai do loop silenciosamente.
                if (task.killRequested) {
                    this.recordEvent(task, 'task_killed', `Task cancelada durante opencode`, { attempt, pid: task.childPid });
                    return;
                }
                this.recordEvent(task, 'error', `opencode erro: ${String(e.message || e).substring(0, 300)}`, { attempt, error: e.message });
            }

            // FAIL-FAST: sem mudança de código → tenta de novo (transiente/cold-start) e só
            // aborta na última tentativa. Nunca cria PR vazio.
            const changes = await this.worktreeChanges();
            if (changes.length === 0) {
                if (attempt < MAX_IMPL) {
                    this.recordEvent(task, 'attempt_no_changes', 'Nenhuma mudança gerada — repetindo...', { attempt });
                    task.feedbackHistory.push('A tentativa anterior não gerou mudanças. Implemente os arquivos pedidos agora.');
                    continue;
                }
                task.status = 'failed';
                task.error = 'O agente não produziu nenhuma mudança após as tentativas.';
                task.updatedAt = new Date().toISOString();
                this.recordEvent(task, 'task_failed', 'Nenhuma mudança após as tentativas — abortando (sem PR).');
                this.save();
                this.emitStatus(task);
                return;
            }

            // GATE: typecheck
            this.recordEvent(task, 'typecheck_started', 'Verificando (typecheck back+front)...');
            verify = await this.verify();
            if (verify.ok) {
                this.recordEvent(task, 'typecheck_ok', 'Typecheck OK', { attempt });
                break;
            }
            this.recordEvent(task, 'typecheck_failed', `Typecheck falhou${attempt < MAX_IMPL ? ' — pedindo correção ao opencode...' : ' (vai no PR marcado p/ revisão).'}`, { attempt, output: verify.output.substring(0, 1000) });
            if (attempt < MAX_IMPL) task.feedbackHistory.push(`O typecheck falhou. Corrija estes erros:\n${verify.output}`);
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
        let prNumber: number | undefined;
        let prUrl: string | undefined;
        try {
            const { stdout: prOut } = await gh([
                'pr', 'create', '--repo', REPO, '--head', branch, '--base', 'main',
                '--title', `feat(#${issueNumber}): ${issueData.title}`,
                '--body', `Closes #${issueNumber}\n\nImplementado pelo TaskRunner (opencode) em worktree isolado.\n\n**Verificação:** ${verifyTag}\n\n⚠️ Requer revisão humana antes do merge.`,
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

            const judgePrompt = `You are a code reviewer (LLM Judge). Evaluate this PR against the original issue.

Issue #${task.issueNumber}: ${task.title}
${task.body.substring(0, 1000)}

PR Diff:
${diff.substring(0, 15000)}

Rate this PR on a scale of 0-10 based on:
1. Does it solve the issue? (0-4 points)
2. Code quality and patterns? (0-2 points)  
3. Error handling? (0-2 points)
4. Tests? (0-2 points)

Return ONLY a JSON: {"score": <number>, "approved": <boolean>, "review": "<brief review in Portuguese>"}`;

            const history = [
                { role: 'system' as const, parts: 'You are a strict code reviewer. Be objective.' },
                { role: 'user' as const, parts: judgePrompt },
            ];

            const judgeResult = await aiService.generateReply(history, '', undefined, 'chat');
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
                    attempt: task.judgeAttempts,
                });

                if (result.score >= 7 || task.judgeAttempts >= 3) {
                    task.status = 'approved';
                    this.emitLog(task.issueNumber, 'success', `Judge aprovou com score ${result.score}/10`);
                } else {
                    log.info(`Judge score ${result.score}/10, auto-fixing (attempt ${task.judgeAttempts})`);
                    this.emitLog(task.issueNumber, 'warn', `Judge reprovou (${result.score}/10). Auto-corrigindo (tentativa ${task.judgeAttempts})...`);
                    task.feedbackHistory.push(`Judge (score ${result.score}/10): ${result.review}`);
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
}

export const taskRunnerService = new TaskRunnerService();
