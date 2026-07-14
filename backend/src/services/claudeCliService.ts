import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from '../utils/logger';
import { resolveBash } from '../utils/runOpencode';

const log = logger.child('ClaudeCli');
const BIN = process.env.CLAUDE_CLI_BIN || 'claude';
const BASH = resolveBash();

export interface ClaudeResult {
    text: string;
    costUsd?: number;
    isError: boolean;
    durationMs?: number;
    numTurns?: number;
}

/**
 * Provider do Claude Code CLI (headless, `claude -p --output-format json`) para o TaskRunner.
 * Tier CARO — usar em JUÍZO (judge/adversarial/planejamento) e RESGATE (quando GLM/MiniMax
 * falham ou vêm vazios), NÃO em volume. O prompt vai por ARQUIVO + `"$(cat ...)"` no git-bash,
 * o que evita qualquer problema de escaping com conteúdo arbitrário (aspas, newlines, backticks).
 */
class ClaudeCliService {
    /** true se o CLI parece disponível (permite fallback GLM/MiniMax quando ausente). */
    async available(): Promise<boolean> {
        try {
            const out = await this.runBash(`${BIN} --version`, process.cwd(), 15000);
            return /\d+\.\d+/.test(out);
        } catch { return false; }
    }

    private runBash(command: string, cwd: string, timeoutMs: number): Promise<string> {
        return new Promise((resolve, reject) => {
            const child = spawn(BASH, ['-lc', command], { cwd, windowsHide: true });
            let out = '', err = '';
            child.stdout.on('data', (d) => (out += d.toString()));
            child.stderr.on('data', (d) => (err += d.toString()));
            const timer = setTimeout(() => {
                try { child.kill('SIGKILL'); } catch { /* ignore */ }
                reject(new Error(`claude timeout após ${timeoutMs}ms`));
            }, timeoutMs);
            child.on('error', (e) => { clearTimeout(timer); reject(e); });
            child.on('close', (code) => {
                clearTimeout(timer);
                if (code === 0) resolve(out);
                else {
                    // #1449: anexa o exit code ao erro para o retry decidir de forma robusta
                    // (126/127 = shim npm transitório) em vez de casar string da mensagem.
                    const e: any = new Error(`claude saiu com código ${code}: ${(err || out).slice(0, 400)}`);
                    e.exitCode = code;
                    reject(e);
                }
            });
        });
    }

    /**
     * #1449: o shim npm do `claude` no Windows sai INTERMITENTEMENTE com exit 126/127
     * ("cannot execute" — resolução do node em caminho misto Win/Unix). É transitório e
     * fazia o juiz opus cair no fallback MiniMax por um hiccup do shim, anulando o gate
     * independente. Retenta 1-2x com backoff curto antes de propagar. SÓ 126/127 são
     * retentados; erro real (exit 1 = falha do modelo, timeout, JSON inválido) propaga na hora.
     */
    private async runBashWithRetry(command: string, cwd: string, timeoutMs: number, tries = 3): Promise<string> {
        let lastErr: unknown;
        for (let attempt = 1; attempt <= tries; attempt++) {
            try {
                return await this.runBash(command, cwd, timeoutMs);
            } catch (e: any) {
                lastErr = e;
                const transient = e?.exitCode === 126 || e?.exitCode === 127;
                if (!transient || attempt === tries) throw e;
                log.warn(`claude exit ${e.exitCode} (shim transitório) — retry ${attempt}/${tries - 1} após ${attempt}s`);
                await new Promise((r) => setTimeout(r, attempt * 1000));
            }
        }
        throw lastErr;
    }

    private async run(prompt: string, flags: string[], cwd: string, timeoutMs: number): Promise<ClaudeResult> {
        const tmp = path.join(os.tmpdir(), `claude-prompt-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.txt`);
        fs.writeFileSync(tmp, prompt, 'utf8');
        try {
            // prompt via arquivo -> "$(cat '<tmp>')" entra como UM arg seguro (sem re-parse do conteúdo).
            const cmd = `${BIN} -p "$(cat '${tmp}')" --output-format json ${flags.join(' ')}`;
            const stdout = await this.runBashWithRetry(cmd, cwd, timeoutMs);
            const j = JSON.parse(stdout);
            return {
                text: j.result ?? '',
                costUsd: j.total_cost_usd,
                isError: !!j.is_error,
                durationMs: j.duration_ms,
                numTurns: j.num_turns,
            };
        } finally {
            try { fs.unlinkSync(tmp); } catch { /* ignore */ }
        }
    }

    /**
     * Texto puro — NÃO edita arquivos. Para judge/adversarial/planejamento.
     * Roda num cwd neutro (sem --add-dir), então o Claude só raciocina sobre o que está no prompt.
     */
    async runText(prompt: string, opts?: { model?: string; cwd?: string; timeoutMs?: number }): Promise<ClaudeResult> {
        const flags: string[] = [];
        if (opts?.model) flags.push('--model', opts.model);
        const r = await this.run(prompt, flags, opts?.cwd || os.tmpdir(), opts?.timeoutMs ?? 120000);
        log.info(`runText: ${r.numTurns} turn(s), ${r.durationMs}ms, $${r.costUsd?.toFixed(4)}`);
        return r;
    }

    /**
     * RESGATE — edita arquivos no worktree quando GLM/MiniMax falharam/vieram vazios.
     * Roda no worktree isolado com edições auto-aceitas (mesmo modelo de confiança do opencode:
     * worktree descartável, gate/CI valida depois).
     */
    async runCode(instruction: string, worktree: string, opts?: { model?: string; timeoutMs?: number }): Promise<ClaudeResult> {
        const flags = ['--permission-mode', 'acceptEdits', '--dangerously-skip-permissions'];
        if (opts?.model) flags.push('--model', opts.model);
        const r = await this.run(instruction, flags, worktree, opts?.timeoutMs ?? 30 * 60 * 1000);
        log.info(`runCode(worktree): ${r.numTurns} turn(s), ${r.durationMs}ms, $${r.costUsd?.toFixed(4)}, erro=${r.isError}`);
        return r;
    }
}

export const claudeCliService = new ClaudeCliService();
