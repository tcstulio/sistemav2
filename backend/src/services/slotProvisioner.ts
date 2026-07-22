import { execFile, exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { logger } from '../utils/logger';
import { atomicWriteSync } from '../utils/atomicWrite';
import { getFreeDiskBytes, formatGB } from '../utils/diskSpace';
import { buildJunctionSafeRemovalPlan } from '../utils/gcWorktrees';
import { slotManager, SLOT2_ROOT, SLOT2_XDG } from './slotManager';

const log = logger.child('SlotProvisioner');
const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);
const BIG = 20 * 1024 * 1024;

// PROD = raiz do repo real (backend/src/services → ../../../). O clone do slot-2 SEMPRE parte do
// origin do PROD (nunca de um path local — ver O2), então o REPO_ROOT só é usado p/ ler o remote e
// p/ gravar o receipt em <PROD>/backend/data. Idêntico ao REPO_ROOT do slotManager/taskRunnerService.
const REPO_ROOT = path.resolve(__dirname, '../../../');
// Receipt de telemetria (NÃO é a autoridade do "pronto" — quem manda é o oBoot). Vive em PROD.
const RECEIPT_PATH = path.join(REPO_ROOT, 'backend', 'data', 'slot2-provision.json');
// Seed de auth do opencode (nunca copiamos o opencode.db de 5.2GB — só auth.json + account.json).
const HOME_OC = path.join(os.homedir(), '.local', 'share', 'opencode');
// Gate de disco: exige ≥10 GB livres antes de clonar (clone ~41MB + npm install pesa GBs). R4.
const MIN_FREE_BYTES = 10 * 1024 ** 3;
// origin aceito: só GitHub por HTTPS ou SSH. Qualquer path local (C:\ ou /c/) → ABORT (O2).
const GITHUB_ORIGIN_RE = /^(https:\/\/github\.com\/|git@github\.com:)/;
// Detector de path local no `remote -v` (defesa O2 contra "conserto" manual futuro do remote).
const LOCAL_PATH_RE = /(^|[\s=])([a-zA-Z]:[\\/]|\/[a-zA-Z]\/)/m;

/**
 * I/O injetável (espelha o estilo do gcWorktrees: decisão pura + I/O injetado). Os testes trocam
 * TUDO por mocks para NUNCA tocar disco/rede (senão disparam o hazard de junction em node_modules).
 * A implementação real (`realDeps`) é a única que roda git/npm/fs de verdade.
 */
export interface ProvisionDeps {
    /** git via execFile (array de args, sem quoting de shell). cwd default = REPO_ROOT (PROD). */
    git(args: string[], opts?: { cwd?: string; timeout?: number }): Promise<{ stdout: string; stderr: string }>;
    /** shell (npm/npx) — comandos CONTROLADOS, sem conteúdo de usuário. */
    sh(command: string, cwd: string, timeout: number): Promise<{ stdout: string; stderr: string }>;
    /** espaço livre em bytes no volume de `p` (null = não mediu → PROSSEGUE, não trava). */
    freeDiskBytes(p: string): Promise<number | null>;
    existsSync(p: string): boolean;
    /** lstat SEM seguir link — p/ detectar junction/reparse point no teardown. */
    lstatIsSymlink(p: string): boolean;
    lstatIsDirectory(p: string): boolean;
    isDirectory(p: string): boolean;
    isFileNonEmpty(p: string): boolean;
    mkdirp(p: string): void;
    copyFile(src: string, dest: string): void;
    readdir(p: string): string[];
    rmdirSync(p: string): void;
    rmRecursive(p: string): void;
    writeReceipt(data: unknown): void;
    registerSlot2: typeof slotManager.registerSlot2;
    unregisterSlot2: typeof slotManager.unregisterSlot2;
}

const realDeps: ProvisionDeps = {
    async git(args, opts) {
        return await execFileAsync('git', args, {
            cwd: opts?.cwd || REPO_ROOT,
            timeout: opts?.timeout,
            maxBuffer: BIG,
            windowsHide: true,
        });
    },
    sh(command, cwd, timeout) {
        return execAsync(command, { cwd, timeout, maxBuffer: BIG, windowsHide: true });
    },
    freeDiskBytes: getFreeDiskBytes,
    existsSync: (p) => fs.existsSync(p),
    lstatIsSymlink: (p) => {
        try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; }
    },
    lstatIsDirectory: (p) => {
        try { return fs.lstatSync(p).isDirectory(); } catch { return false; }
    },
    isDirectory: (p) => {
        try { return fs.statSync(p).isDirectory(); } catch { return false; }
    },
    isFileNonEmpty: (p) => {
        try { return fs.statSync(p).size > 0; } catch { return false; }
    },
    mkdirp: (p) => { fs.mkdirSync(p, { recursive: true }); },
    copyFile: (src, dest) => { fs.copyFileSync(src, dest); },
    readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } },
    rmdirSync: (p) => { fs.rmdirSync(p); },
    rmRecursive: (p) => { fs.rmSync(p, { recursive: true, force: true }); },
    writeReceipt: (data) => { atomicWriteSync(RECEIPT_PATH, data); },
    registerSlot2: (slot) => slotManager.registerSlot2(slot),
    unregisterSlot2: () => slotManager.unregisterSlot2(),
};

// ==== Funções PURAS testáveis (decisão, sem I/O) ==========================================

/** O2: um origin é aceito SOMENTE se casa GitHub (https/ssh). Path local (C:\ / /c/) → false. */
export function isAcceptableOrigin(originUrl: string): boolean {
    return GITHUB_ORIGIN_RE.test((originUrl || '').trim());
}

/** O2 (defesa-em-profundidade): a saída de `git remote -v` NÃO pode conter um path local. */
export function remoteVerboseHasLocalPath(remoteVerbose: string): boolean {
    return LOCAL_PATH_RE.test(remoteVerbose || '');
}

/** Gate de disco: null (não mediu) → PROSSEGUE; medido e < 10GB → bloqueia. */
export function diskGateBlocks(freeBytes: number | null): boolean {
    return freeBytes != null && freeBytes < MIN_FREE_BYTES;
}

// ==== Provisionador (executor com deps injetáveis) ========================================

export class SlotProvisioner {
    constructor(private deps: ProvisionDeps = realDeps) {}

    /** Injeta deps (usado pelos testes p/ mockar TODO I/O). */
    withDeps(deps: ProvisionDeps): SlotProvisioner {
        return new SlotProvisioner(deps);
    }

    /**
     * Verificação rápida de boot (R7) — a AUTORIDADE do "pronto" (não a flag, não o receipt).
     * Verde só quando: `.git` é dir + repo válido + origin é GitHub (O2) + `remote -v` sem path
     * local + auth.json seedada (O4) + `.tr-installed` em root/node_modules E backend/node_modules.
     * Qualquer falha → false (o chamador desregistra o slot-2 e re-provisiona).
     */
    async oBoot(): Promise<boolean> {
        const d = this.deps;
        try {
            if (!d.isDirectory(path.join(SLOT2_ROOT, '.git'))) return false;
            // repo íntegro o suficiente p/ o coder rodar
            await d.git(['rev-parse', '--is-inside-work-tree'], { cwd: SLOT2_ROOT, timeout: 30000 });
            // O2 na PROVISÃO E em todo boot: origin nunca aponta p/ prod/path local
            const { stdout: originUrl } = await d.git(['remote', 'get-url', 'origin'], { cwd: SLOT2_ROOT, timeout: 30000 });
            if (!isAcceptableOrigin(originUrl)) return false;
            const { stdout: remoteV } = await d.git(['remote', '-v'], { cwd: SLOT2_ROOT, timeout: 30000 });
            if (remoteVerboseHasLocalPath(remoteV)) return false;
            // O4: auth seedada e não-vazia
            if (!d.isFileNonEmpty(path.join(SLOT2_XDG, 'opencode', 'auth.json'))) return false;
            // deps instaladas (marker por-dir): root + backend
            if (!d.existsSync(path.join(SLOT2_ROOT, 'node_modules', '.tr-installed'))) return false;
            if (!d.existsSync(path.join(SLOT2_ROOT, 'backend', 'node_modules', '.tr-installed'))) return false;
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Sequência P0..P10 da ESPEC 2.2. INERTE em prod: sem `TASKRUNNER_SLOT2=1` retorna no-op no P0,
     * então o sistema é byte-idêntico ao de hoje. NUNCA lança p/ fora (o boot hook faz `.catch`);
     * qualquer ABORT deixa o slot-2 FORA de `slots()` (não registra) → clamp efetivo segue 1.
     */
    async ensureSlot2(): Promise<void> {
        const d = this.deps;
        // P0: gate de env — ÚNICO gatilho. Sem ele, NADA do provisionador roda (byte-safety).
        if (process.env.TASKRUNNER_SLOT2 !== '1') return;

        try {
            // P1: gate de disco (null → prossegue; medido e < 10GB → não provisiona, sem lançar).
            let freeBytes: number | null = null;
            try { freeBytes = await d.freeDiskBytes(SLOT2_ROOT); } catch { freeBytes = null; }
            if (diskGateBlocks(freeBytes)) {
                log.error(`ensureSlot2: disco insuficiente em ${SLOT2_ROOT} — ${formatGB(freeBytes as number)} GB livres (exige ≥ 10 GB); NÃO provisiona`);
                return;
            }

            // P2: se ROOT2 já existe → oBoot. Passou → idempotente (registra e retorna). Falhou → teardown → P3.
            if (d.existsSync(SLOT2_ROOT)) {
                if (await this.oBoot()) {
                    this.register();
                    log.info(`ensureSlot2: slot-2 já provisionado e verificado (idempotente) — ${SLOT2_ROOT}`);
                    return;
                }
                log.warn(`ensureSlot2: slot-2 existe mas oBoot FALHOU — teardown junction-safe e re-provisiona`);
                d.unregisterSlot2();
                this.teardown();
            }

            // P3: origin resolvido POR CONSTRUÇÃO do PROD + ASSERT GitHub. Path local → ABORT (nunca clonar).
            const { stdout: rawOrigin } = await d.git(['remote', 'get-url', 'origin'], { cwd: REPO_ROOT, timeout: 30000 });
            const originUrl = rawOrigin.trim();
            if (!isAcceptableOrigin(originUrl)) {
                log.error(`ensureSlot2: origin do PROD não é GitHub ("${originUrl}") — ABORT (nunca clonar de path local: viraria push-em-prod)`);
                return;
            }

            // P4: clone do GitHub (não worktree, não --local). Origin correto por construção.
            log.info(`ensureSlot2: clonando ${originUrl} → ${SLOT2_ROOT}`);
            await d.git(['clone', originUrl, SLOT2_ROOT], { timeout: 600000 });

            // P5: O1 (integridade) + O2 (origin não é path local). Falhou → teardown + ABORT.
            if (!(await this.verifyClone(originUrl))) {
                log.error('ensureSlot2: oráculos O1/O2 do clone FALHARAM — teardown + ABORT (re-tenta no próximo boot)');
                this.teardown();
                return;
            }

            // P6: XDG — mkdir + seed do auth (NUNCA o db de 5.2GB). auth ausente → ABORT; account ausente → warn.
            if (!this.seedXdg()) {
                log.error('ensureSlot2: seed do XDG (auth.json) FALHOU — teardown + ABORT');
                this.teardown();
                return;
            }

            // P7: deps por slot (npm install --no-audit --no-fund + marker; NÃO npm ci — lição #1379).
            await this.ensureDepsAt(SLOT2_ROOT);
            await this.ensureDepsAt(path.join(SLOT2_ROOT, 'backend'));

            // P8: smoke — 2× tsc --noEmit (backend + root). Exit != 0 em qualquer → ABORT.
            if (!(await this.smoke())) {
                log.error('ensureSlot2: smoke (tsc --noEmit) FALHOU — teardown + ABORT');
                this.teardown();
                return;
            }
            const smokePassedAt = new Date().toISOString();

            // P9: receipt de telemetria (NÃO é a autoridade — quem manda é o oBoot).
            try {
                d.writeReceipt({
                    provisionedAt: new Date().toISOString(),
                    originUrl,
                    smokePassedAt,
                    freeBytes,
                });
            } catch (e: any) {
                log.warn(`ensureSlot2: falha ao gravar receipt (não-fatal): ${e?.message || e}`);
            }

            // P10: registro. O flip p/ maxParallelExec>1 ainda depende de TASKRUNNER_MAX_PARALLEL.
            this.register();
            log.info(`ensureSlot2: slot-2 PROVISIONADO e registrado (${SLOT2_ROOT}); maxParallelExec segue clampado por TASKRUNNER_MAX_PARALLEL (default 1)`);
        } catch (e: any) {
            // Qualquer erro inesperado: o slot-2 fica FORA de slots() (não registramos). Sistema como hoje.
            log.error(`ensureSlot2: ABORT por erro inesperado — ${e?.message || e}`);
            try { this.deps.unregisterSlot2(); } catch { /* ignore */ }
        }
    }

    private register(): void {
        this.deps.registerSlot2({ id: 2, root: SLOT2_ROOT, dataDir: SLOT2_XDG, kind: 'clone' });
    }

    /** O1+O2: clone íntegro (fsck + rev-parse origin/main) E origin==originUrl GitHub sem path local. */
    private async verifyClone(originUrl: string): Promise<boolean> {
        const d = this.deps;
        try {
            // O1: integridade + branch principal resolvível.
            await d.git(['-C', SLOT2_ROOT, 'fsck', '--no-dangling'], { timeout: 120000 });
            await d.git(['-C', SLOT2_ROOT, 'rev-parse', 'origin/main'], { timeout: 30000 });
            // O2: origin do clone == originUrl esperado E é GitHub.
            const { stdout: cloneOrigin } = await d.git(['-C', SLOT2_ROOT, 'remote', 'get-url', 'origin'], { timeout: 30000 });
            if (cloneOrigin.trim() !== originUrl || !isAcceptableOrigin(cloneOrigin)) return false;
            const { stdout: remoteV } = await d.git(['-C', SLOT2_ROOT, 'remote', '-v'], { timeout: 30000 });
            if (remoteVerboseHasLocalPath(remoteV)) return false;
            return true;
        } catch (e: any) {
            log.warn(`verifyClone: ${e?.message || e}`);
            return false;
        }
    }

    /** P6: cria <XDG2>/opencode e semeia auth.json (obrigatório) + account.json (opcional). */
    private seedXdg(): boolean {
        const d = this.deps;
        try {
            const ocDir = path.join(SLOT2_XDG, 'opencode');
            d.mkdirp(ocDir);
            const authSrc = path.join(HOME_OC, 'auth.json');
            if (!d.isFileNonEmpty(authSrc)) {
                log.error(`seedXdg: auth.json AUSENTE/vazio em ${authSrc} — sem ele o coder do slot-2 não autentica`);
                return false;
            }
            d.copyFile(authSrc, path.join(ocDir, 'auth.json'));
            const accountSrc = path.join(HOME_OC, 'account.json');
            if (d.existsSync(accountSrc)) {
                d.copyFile(accountSrc, path.join(ocDir, 'account.json'));
            } else {
                log.warn('seedXdg: account.json ausente (segue — não é obrigatório)');
            }
            // NUNCA copiar opencode.db / -wal / -shm (5.2GB): o db novo é criado no 1º run (cold start).
            return true;
        } catch (e: any) {
            log.error(`seedXdg: ${e?.message || e}`);
            return false;
        }
    }

    /**
     * P7: MESMA receita do ensureWorktree.ensureDeps (taskRunnerService) — `npm install` (NÃO `npm ci`,
     * lição #1379: o lockfile do repo tem drift/deps opcionais por-plataforma que quebram `npm ci`) +
     * marker `.tr-installed` por mtime. Reinstala se node_modules/marker/lock faltam ou o lock é mais novo.
     */
    private async ensureDepsAt(dir: string): Promise<void> {
        const d = this.deps;
        const nm = path.join(dir, 'node_modules');
        const lock = path.join(dir, 'package-lock.json');
        const marker = path.join(nm, '.tr-installed');
        let stale = true;
        try {
            stale = !d.existsSync(nm) || !d.existsSync(marker) || !d.existsSync(lock)
                || fs.statSync(lock).mtimeMs > fs.statSync(marker).mtimeMs;
        } catch { stale = true; }
        if (stale) {
            log.info(`ensureSlot2: deps desatualizadas em ${dir} — rodando npm install`);
            await d.sh('npm install --no-audit --no-fund', dir, 600000);
            try { fs.writeFileSync(marker, new Date().toISOString()); } catch { /* ignore */ }
        }
    }

    /** P8: 2× `npx tsc --noEmit` (backend + root), cwd=ROOT2, 240s cada. Exit != 0 em qualquer → false. */
    private async smoke(): Promise<boolean> {
        const d = this.deps;
        try {
            await d.sh('npx tsc --noEmit -p backend/tsconfig.json', SLOT2_ROOT, 240000);
            await d.sh('npx tsc --noEmit -p tsconfig.json', SLOT2_ROOT, 240000);
            return true;
        } catch (e: any) {
            log.warn(`smoke: ${e?.message || e}`);
            return false;
        }
    }

    /**
     * Teardown JUNCTION-SAFE de SLOT2_ROOT (R8). Reusa buildJunctionSafeRemovalPlan: desliga TODO
     * junction/reparse point (rmdir no link, NÃO segue o alvo) ANTES do rmSync recursivo — senão o
     * rmSync seguiria o junction de node_modules e apagaria o node_modules real (hazard #1170).
     * NUNCA `rm -rf` cego; opera SÓ sob SLOT2_ROOT.
     */
    private teardown(): void {
        const d = this.deps;
        if (!d.existsSync(SLOT2_ROOT)) return;
        const junctions = this.collectJunctions(SLOT2_ROOT);
        const plan = buildJunctionSafeRemovalPlan(junctions, SLOT2_ROOT);
        for (const step of plan.steps) {
            try {
                if (step.kind === 'unlink-junction') {
                    if (d.existsSync(step.path)) d.rmdirSync(step.path); // rmdir no LINK (não segue o alvo)
                } else if (step.kind === 'rmdir') {
                    if (d.existsSync(step.path)) d.rmRecursive(step.path);
                }
            } catch (e: any) {
                log.warn(`teardown: ${step.kind} ${step.path}: ${e?.message || e}`);
            }
        }
    }

    /** Coleta recursiva de junctions/reparse points sob `dir` (espelha collectJunctions do GC). */
    private collectJunctions(dir: string): string[] {
        const d = this.deps;
        const out: string[] = [];
        const walk = (current: string): void => {
            for (const name of d.readdir(current)) {
                const abs = path.join(current, name);
                // node_modules: só checa o TOPO (é um junction ou não); nunca desce (gigante).
                if (name.toLowerCase() === 'node_modules') {
                    if (d.lstatIsSymlink(abs)) out.push(abs);
                    continue;
                }
                if (d.lstatIsSymlink(abs)) out.push(abs);
                else if (d.lstatIsDirectory(abs)) walk(abs);
            }
        };
        walk(dir);
        return out;
    }
}

export const slotProvisioner = new SlotProvisioner();
