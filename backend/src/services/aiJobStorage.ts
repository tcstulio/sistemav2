import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteSync } from '../utils/atomicWrite';
import { createLogger } from '../utils/logger';

const log = createLogger('AiJobStorage');

// Storage durável do registry de jobs (issue #1012). Um arquivo JSON por job em
// <AI_JOB_STORAGE_DIR>/<id>.json. Write-through atômico (temp + rename) p/ sobreviver a
// kill -9 / restart do nodemon sem truncar arquivos. Sem Redis/DB externa — escopo local.

const DEFAULT_DIR = path.join(__dirname, '../../.data/ai-jobs');

/** Shape persistido em disco (estruturalmente compatível com AiJob do aiJobService). */
export interface PersistedJob {
    id: string;
    status?: string;
    result?: unknown;
    error?: string;
    createdAt?: number;
    finishedAt?: number;
    label?: string;
    /** Expiração (epoch ms). Undefined enquanto o job não termina (sem limite de tempo). */
    expiresAt?: number;
    /** #1011: epoch ms em que o job saiu de queued -> running. */
    startedAt?: number;
    /** #1011: último sinal de vida reportado pelo agente (tool-call/progresso). */
    lastHeartbeat?: number;
    /** #1011: provider atualmente em uso pelo job (ex.: 'gemini','minimax'). */
    currentProvider?: string | null;
    /** #1011: progresso 0..100 reportado pelo agente. */
    progressPct?: number;
}

/**
 * Diretório de dados configurável via `AI_JOB_STORAGE_DIR` (default: backend/.data/ai-jobs).
 * Valores relativos são resolvidos a partir do cwd; absolutos usados como estão.
 */
export function getStorageDir(): string {
    const env = process.env.AI_JOB_STORAGE_DIR;
    if (!env) return DEFAULT_DIR;
    return path.isAbsolute(env) ? env : path.resolve(process.cwd(), env);
}

function jobFilePath(dir: string, id: string): string {
    return path.join(dir, `${id}.json`);
}

function ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** Write-through atômico: grava em <id>.json.tmp e renomeia para <id>.json. */
export function saveJob(job: PersistedJob): void {
    try {
        const dir = getStorageDir();
        ensureDir(dir);
        atomicWriteSync(jobFilePath(dir, job.id), job);
    } catch (e) {
        log.error(`Falha ao persistir job ${job.id}`, e);
    }
}

/** Remove o arquivo do job (idempotente — ignora ausência). */
export function deleteJob(id: string): void {
    try {
        const file = jobFilePath(getStorageDir(), id);
        if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (e) {
        log.error(`Falha ao remover job ${id}`, e);
    }
}

/**
 * Read-on-startup: lê TODOS os arquivos `.json` do diretório de dados e devolve os jobs
 * parseados (sem aplicar TTL — quem chama decide quem expira). Arquivos inválidos são
 * ignorados individualmente para não quebrar o boot.
 */
export function loadAll(): PersistedJob[] {
    try {
        const dir = getStorageDir();
        if (!fs.existsSync(dir)) return [];
        const files = fs.readdirSync(dir);
        const out: PersistedJob[] = [];
        for (const f of files) {
            if (!f.endsWith('.json')) continue;
            try {
                const parsed = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
                if (parsed && typeof parsed.id === 'string') out.push(parsed as PersistedJob);
                else log.warn(`Arquivo de job ignorado (sem id): ${f}`);
            } catch (e) {
                log.warn(`Arquivo de job inválido ignorado: ${f}`);
            }
        }
        return out;
    } catch (e) {
        log.error('Falha no loadAll', e);
        return [];
    }
}
