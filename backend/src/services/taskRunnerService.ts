import { execFile, exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { atomicWriteSync } from '../utils/atomicWrite';
import { logger } from '../utils/logger';
import { aiService } from './aiService';
import { socketService } from './socketService';

const log = logger.child('TaskRunner');
const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);
const BIG = 20 * 1024 * 1024; // maxBuffer p/ saídas grandes (diff, npm, opencode)

const STORE_PATH = path.join(__dirname, '../../data/tasks.json');
const REPO_ROOT = path.resolve(__dirname, '../../../');
// Worktree ISOLADO do TaskRunner — o agente nunca toca o diretório do dev/main.
const WT_ROOT = path.resolve(REPO_ROOT, '..', 'sistemav2-taskrunner-wt');
const PROMPT_FILE = '.taskrunner-prompt.md';

function git(args: string[], opts?: { timeout?: number; cwd?: string }) {
    return execFileAsync('git', args, { cwd: opts?.cwd || REPO_ROOT, timeout: opts?.timeout, maxBuffer: BIG });
}

function gh(args: string[], opts?: { timeout?: number; cwd?: string }) {
    return execFileAsync('gh', args, { cwd: opts?.cwd || REPO_ROOT, timeout: opts?.timeout, maxBuffer: BIG });
}

// opencode/npm/npx rodam via shell (resolvem o .cmd no Windows). Os comandos são strings
// CONTROLADAS (sem conteúdo do usuário) — o prompt detalhado vai num arquivo no worktree.
function sh(command: string, cwd: string, timeout: number) {
    return execAsync(command, { cwd, timeout, maxBuffer: BIG, windowsHide: true });
}

export type TaskStatus = 'pending' | 'running' | 'reviewing' | 'approved' | 'fixing' | 'merged' | 'rejected' | 'failed';

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
}

interface TaskStore {
    tasks: Record<number, Task>;
}

const REPO = 'tcstulio/sistemav2';

class TaskRunnerService {
    private store: TaskStore = { tasks: {} };

    constructor() {
        this.load();
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

    private load() {
        try {
            const dir = path.dirname(STORE_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            if (fs.existsSync(STORE_PATH)) {
                const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
                this.store = { tasks: parsed.tasks || {} };
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

    async listIssues(): Promise<any[]> {
        try {
            const { stdout } = await gh([
                'issue', 'list',
                '--repo', REPO,
                '--label', 'opencode-task',
                '--state', 'open',
                '--limit', '50',
                '--json', 'number,title,body,labels,createdAt'
            ], { timeout: 15000 });
            return JSON.parse(stdout);
        } catch (e: any) {
            log.error('List issues error', e.message);
            return [];
        }
    }

    async syncTasks(): Promise<Task[]> {
        const issues = await this.listIssues();
        for (const issue of issues) {
            const num = issue.number;
            if (!this.store.tasks[num]) {
                this.store.tasks[num] = {
                    issueNumber: num,
                    title: issue.title,
                    body: issue.body || '',
                    labels: (issue.labels || []).map((l: any) => l.name || l),
                    status: 'pending',
                    feedbackHistory: [],
                    updatedAt: new Date().toISOString(),
                };
            }
        }
        this.save();
        return Object.values(this.store.tasks).sort((a, b) => b.issueNumber - a.issueNumber);
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
        task.status = 'running';
        task.startedAt = new Date().toISOString();
        task.updatedAt = new Date().toISOString();
        task.error = undefined;
        this.save();

        this.executeTask(task, branch).catch(e => {
            log.error(`Task #${issueNumber} failed`, e);
            task.status = 'failed';
            task.error = e.message;
            task.updatedAt = new Date().toISOString();
            this.save();
        });

        return task;
    }

    /** Garante um worktree git ISOLADO, limpo, no branch fix-N a partir de origin/main. */
    private async ensureWorktree(branch: string): Promise<void> {
        await git(['fetch', 'origin', 'main'], { timeout: 60000 });
        if (!fs.existsSync(WT_ROOT)) {
            await git(['worktree', 'add', '--force', WT_ROOT, 'origin/main'], { timeout: 120000 });
        }
        // branch fresco do main mais recente + remove restos não-rastreados de runs anteriores
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
        this.emitLog(issueNumber, 'info', `Iniciando #${issueNumber} em worktree isolado (branch ${branch})`);

        // 1) Worktree limpo e isolado (nunca toca o dev/main)
        this.emitLog(issueNumber, 'info', 'Preparando worktree a partir de origin/main...');
        await this.ensureWorktree(branch);

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
            this.emitLog(issueNumber, 'info', `Implementando com opencode (tentativa ${attempt}/${MAX_IMPL})...`);
            try {
                const { stdout } = await sh(`opencode run "Leia o arquivo ${PROMPT_FILE} na raiz do projeto e implemente exatamente o que ele descreve. Nao altere esse arquivo."`, WT_ROOT, 900000);
                this.emitLog(issueNumber, 'ai', String(stdout).substring(0, 1500));
            } catch (e: any) {
                this.emitLog(issueNumber, 'warn', `opencode erro: ${String(e.message || e).substring(0, 300)}`);
            }

            // FAIL-FAST: sem mudança de código → tenta de novo (transiente/cold-start) e só
            // aborta na última tentativa. Nunca cria PR vazio.
            const changes = await this.worktreeChanges();
            if (changes.length === 0) {
                if (attempt < MAX_IMPL) {
                    this.emitLog(issueNumber, 'warn', 'Nenhuma mudança gerada — repetindo...');
                    task.feedbackHistory.push('A tentativa anterior não gerou mudanças. Implemente os arquivos pedidos agora.');
                    continue;
                }
                task.status = 'failed';
                task.error = 'O agente não produziu nenhuma mudança após as tentativas.';
                task.updatedAt = new Date().toISOString();
                this.emitLog(issueNumber, 'warn', 'Nenhuma mudança após as tentativas — abortando (sem PR).');
                this.save();
                this.emitStatus(task);
                return;
            }

            // GATE: typecheck
            this.emitLog(issueNumber, 'info', 'Verificando (typecheck back+front)...');
            verify = await this.verify();
            if (verify.ok) { this.emitLog(issueNumber, 'success', 'Typecheck OK'); break; }
            this.emitLog(issueNumber, 'warn', `Typecheck falhou${attempt < MAX_IMPL ? ' — pedindo correção ao opencode...' : ' (vai no PR marcado p/ revisão).'}`);
            if (attempt < MAX_IMPL) task.feedbackHistory.push(`O typecheck falhou. Corrija estes erros:\n${verify.output}`);
        }

        // 4) Commit + push (remove o arquivo de prompt antes de commitar)
        fs.rmSync(promptPath, { force: true });
        await git(['add', '-A'], { timeout: 15000, cwd: WT_ROOT });
        try {
            await git(['commit', '-m', `feat(#${issueNumber}): ${String(issueData.title).substring(0, 72)}`], { timeout: 20000, cwd: WT_ROOT });
            this.emitLog(issueNumber, 'success', 'Mudanças commitadas');
        } catch {
            task.status = 'failed';
            task.error = 'Nada a commitar após a implementação.';
            this.save();
            this.emitStatus(task);
            return;
        }
        await git(['push', 'origin', branch, '--force'], { timeout: 60000, cwd: WT_ROOT });
        this.emitLog(issueNumber, 'info', 'Push realizado. Criando PR...');

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
            this.emitLog(issueNumber, 'success', `PR #${prNumber} criado: ${prUrl}`);
        } catch (e: any) {
            if (e.message?.includes('already exists')) {
                const { stdout: existingPr } = await gh(['pr', 'list', '--repo', REPO, '--head', branch, '--json', 'number,url', '--limit', '1'], { timeout: 15000 });
                const prs = JSON.parse(existingPr);
                if (prs.length) { prNumber = prs[0].number; prUrl = prs[0].url; }
            } else {
                this.emitLog(issueNumber, 'warn', `Falha ao criar PR: ${String(e.message).substring(0, 300)}`);
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
        this.emitLog(task.issueNumber, 'info', `Judge: avaliando PR #${task.prNumber}...`);

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
            }
        } catch (e: any) {
            log.error(`Judge error for #${task.issueNumber}`, e);
            task.status = 'reviewing';
            task.judgeReview = `Judge error: ${e.message}`;
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
        this.save();

        this.executeTask(task, task.branch || `fix-${task.issueNumber}`).catch(e => {
            task.status = 'failed';
            task.error = e.message;
            this.save();
        });

        return task;
    }

    async redoTask(issueNumber: number, instruction?: string): Promise<Task> {
        const task = this.store.tasks[issueNumber];
        if (!task) throw new Error(`Task #${issueNumber} not found`);

        if (task.prNumber) {
            try {
                await gh(['pr', 'close', String(task.prNumber), '--repo', REPO, '--comment', 'Redoing task'], { timeout: 15000 });
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
        this.save();

        this.executeTask(task, task.branch || `fix-${task.issueNumber}`).catch(e => {
            task.status = 'failed';
            task.error = e.message;
            this.save();
        });

        return task;
    }

    async rejectTask(issueNumber: number): Promise<Task> {
        const task = this.store.tasks[issueNumber];
        if (!task) throw new Error(`Task #${issueNumber} not found`);

        if (task.prNumber) {
            try {
                await gh(['pr', 'close', String(task.prNumber), '--repo', REPO, '--comment', 'Rejected'], { timeout: 15000 });
            } catch { /* ignore */ }
        }

        task.status = 'rejected';
        task.completedAt = new Date().toISOString();
        task.updatedAt = new Date().toISOString();
        this.save();
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
        this.save();
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

    async deleteTask(issueNumber: number): Promise<void> {
        const task = this.store.tasks[issueNumber];
        if (!task) throw new Error(`Task #${issueNumber} not found`);

        if (task.status === 'running' || task.status === 'fixing') {
            throw new Error(`Cannot delete task #${issueNumber} while ${task.status}`);
        }

        if (task.prNumber) {
            try {
                await gh(['pr', 'close', String(task.prNumber), '--repo', REPO, '--comment', 'Task deleted'], { timeout: 15000 });
            } catch { /* ignore */ }
        }

        delete this.store.tasks[issueNumber];
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
}

export const taskRunnerService = new TaskRunnerService();
