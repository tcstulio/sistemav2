import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { atomicWriteSync } from '../utils/atomicWrite';
import { logger } from '../utils/logger';
import { aiService } from './aiService';
import { socketService } from './socketService';

const log = logger.child('TaskRunner');
const execFileAsync = promisify(execFile);

const STORE_PATH = path.join(__dirname, '../../data/tasks.json');

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
            const { stdout } = await execFileAsync('gh', [
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

    private async executeTask(task: Task, branch: string): Promise<void> {
        const { issueNumber } = task;
        log.info(`Starting task #${issueNumber} on branch ${branch}`);
        this.emitLog(issueNumber, 'info', `Iniciando task #${issueNumber} no branch ${branch}`);

        this.emitLog(issueNumber, 'info', 'Baixando alterações do main...');
        await execFileAsync('git', ['fetch', 'origin', 'main'], { timeout: 30000 });
        try {
            await execFileAsync('git', ['branch', '-D', branch], { timeout: 10000 });
        } catch { /* branch might not exist */ }
        await execFileAsync('git', ['checkout', '-b', branch, 'origin/main'], { timeout: 15000 });
        await execFileAsync('git', ['push', 'origin', branch, '--force'], { timeout: 30000 });

        this.emitLog(issueNumber, 'info', 'Lendo issue do GitHub...');
        const { stdout: issueBody } = await execFileAsync('gh', [
            'issue', 'view', String(issueNumber),
            '--repo', REPO,
            '--json', 'title,body,labels,comments'
        ], { timeout: 15000 });
        const issueData = JSON.parse(issueBody);

        this.emitLog(issueNumber, 'info', 'Gerando plano de implementação...');

        let prompt = `## Issue #${issueNumber}: ${issueData.title}\n\n${issueData.body || ''}`;
        if (issueData.comments?.length) {
            prompt += '\n\n## Comments:\n';
            for (const c of issueData.comments) {
                prompt += `\n- **${c.author?.login || 'user'}**: ${c.body}\n`;
            }
        }
        if (task.feedbackHistory.length) {
            prompt += '\n\n## Feedback anterior:\n';
            for (const fb of task.feedbackHistory) {
                prompt += `\n- ${fb}\n`;
            }
        }

        let agentsMd = '';
        try {
            const agentsPath = path.join(__dirname, '../../../AGENTS.md');
            if (fs.existsSync(agentsPath)) {
                agentsMd = fs.readFileSync(agentsPath, 'utf-8');
            }
        } catch { /* ignore */ }

        let repoTree = '';
        try {
            const { stdout: treeOut } = await execFileAsync('git', ['ls-tree', '-r', '--name-only', 'HEAD', '--', 'src/', 'backend/src/'], { timeout: 10000 });
            repoTree = treeOut.substring(0, 4000);
        } catch { /* ignore */ }

        const { stdout: diff } = await execFileAsync('git', ['diff', 'main', '--stat'], { timeout: 15000 });

        const planPrompt = `You are a senior developer working on a full-stack ERP system. Analyze this GitHub issue and implement the solution.

## Project Context
- Backend: Express + TypeScript (port 3004), restarts via nodemon
- Frontend: React + Vite (port 5173), uses Tailwind CSS + shadcn-style UI components
- Data backend: Dolibarr ERP (REST API)
- Database: JSON files in backend/data/ for local state
- \`npm run dev:all\` starts both via concurrently

## Tech Stack
- React Router for routing (App.tsx defines all routes)
- UI components in src/components/ui/ (PageHeader, Card, Button, Modal, Tabs, etc.)
- Hooks in src/hooks/dolibarr.ts for data fetching (useInvoices, useTasks, etc.)
- Services in src/services/ for API calls
- Backend services in backend/src/services/
- Backend routes in backend/src/routes/

${agentsMd ? `## Project Conventions (AGENTS.md)\n${agentsMd}\n` : ''}
## Repository Structure (directories)
${repoTree || 'Unable to read'}

## Current Changes
${diff || 'No changes yet'}

${prompt}

Respond with a concise plan listing:
1. Files to modify/create
2. Key changes per file
3. Any tests to write

Then implement the changes. Be thorough and follow existing code patterns.`;

        const history = [
            { role: 'system' as const, parts: 'You are an expert full-stack developer (Express + React + TypeScript). Implement the solution based on the issue description. Write clean, production-quality code. Follow existing patterns in the codebase. Use the project conventions from AGENTS.md. Respond in Portuguese for user-facing text.' },
            { role: 'user' as const, parts: planPrompt },
        ];

        const reply = await aiService.generateReply(history, '', undefined, 'chat');
        log.info(`Task #${issueNumber} plan generated`);
        this.emitLog(issueNumber, 'success', 'Plano gerado. Implementando mudanças...');
        this.emitLog(issueNumber, 'ai', reply.substring(0, 2000));

        await execFileAsync('git', ['add', '-A'], { timeout: 10000 });
        try {
            await execFileAsync('git', ['commit', '-m', `feat(#${issueNumber}): ${issueData.title.substring(0, 72)}`], { timeout: 15000 });
            this.emitLog(issueNumber, 'success', 'Mudanças commitadas');
        } catch {
            log.warn(`Task #${issueNumber} nothing to commit`);
            this.emitLog(issueNumber, 'warn', 'Nada a commitar');
        }
        await execFileAsync('git', ['push', 'origin', branch], { timeout: 30000 });
        this.emitLog(issueNumber, 'info', 'Push realizado. Criando PR...');

        let prNumber: number | undefined;
        let prUrl: string | undefined;
        try {
            const { stdout: prOut } = await execFileAsync('gh', [
                'pr', 'create',
                '--repo', REPO,
                '--head', branch,
                '--base', 'main',
                '--title', `feat(#${issueNumber}): ${issueData.title}`,
                '--body', `Closes #${issueNumber}\n\nImplemented by opencode task runner.\n\n${reply.substring(0, 500)}`,
            ], { timeout: 20000 });
            const match = prOut.match(/\/pull\/(\d+)/);
            if (match) prNumber = parseInt(match[1]);
            prUrl = prOut.trim();
            this.emitLog(issueNumber, 'success', `PR #${prNumber} criado: ${prUrl}`);
        } catch (e: any) {
            if (e.message?.includes('already exists')) {
                const { stdout: existingPr } = await execFileAsync('gh', [
                    'pr', 'list',
                    '--repo', REPO,
                    '--head', branch,
                    '--json', 'number,url',
                    '--limit', '1'
                ], { timeout: 15000 });
                const prs = JSON.parse(existingPr);
                if (prs.length) {
                    prNumber = prs[0].number;
                    prUrl = prs[0].url;
                }
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
            const { stdout: diff } = await execFileAsync('gh', [
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

            const reply = await aiService.generateReply(history, '', undefined, 'chat');
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
                await execFileAsync('gh', ['pr', 'close', String(task.prNumber), '--repo', REPO, '--comment', 'Redoing task'], { timeout: 15000 });
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
                await execFileAsync('gh', ['pr', 'close', String(task.prNumber), '--repo', REPO, '--comment', 'Rejected'], { timeout: 15000 });
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

        await execFileAsync('gh', ['pr', 'merge', String(task.prNumber), '--repo', REPO, '--squash', '--delete-branch'], { timeout: 30000 });
        await execFileAsync('gh', ['issue', 'close', String(issueNumber), '--repo', REPO, '--comment', `Merged via PR #${task.prNumber}`], { timeout: 15000 });

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
                await execFileAsync('gh', ['pr', 'close', String(task.prNumber), '--repo', REPO, '--comment', 'Task deleted'], { timeout: 15000 });
            } catch { /* ignore */ }
        }

        delete this.store.tasks[issueNumber];
        this.save();
    }

    async getDiff(issueNumber: number): Promise<string> {
        const task = this.store.tasks[issueNumber];
        if (!task?.branch) throw new Error('No branch for this task');

        try {
            const { stdout } = await execFileAsync('git', ['diff', 'main...', task.branch], { timeout: 15000 });
            return stdout;
        } catch {
            return 'Unable to fetch diff';
        }
    }
}

export const taskRunnerService = new TaskRunnerService();
