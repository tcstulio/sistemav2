import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../utils/logger';
import { atomicWriteSync } from '../utils/atomicWrite';

const log = createLogger('LlmCallLog');

/**
 * Log durável e consultável de chamadas de LLM do backend (#710).
 *
 * Problema que resolve: erros, timeout e latência das chamadas LLM eram fragmentados
 * e efêmeros (só console). Aqui fica um registro persistido (data/llm_calls.json) de
 * QUAL modelo respondeu, se houve FALLBACK, quanto DEMOROU e se deu ERRO — base para
 * decidir cota/fallback e diagnosticar "o GLM às vezes demora".
 */
export interface LlmCallEntry {
    id: string;
    ts: number;
    model: string;          // modelo que efetivamente respondeu (ou que foi tentado, em erro)
    primaryModel: string;   // modelo primário configurado
    fellBack: boolean;      // true se respondeu pelo fallback (ex.: MiniMax M3)
    ok: boolean;            // true = sucesso; false = erro/timeout
    latencyMs: number;
    origin?: string;        // judge | planner | chat | analise | ... (quando conhecido)
    errorCode?: string;     // status HTTP ou code (ex.: '429', 'ETIMEDOUT')
    errorDetail?: string;   // detalhe truncado do erro
    totalTokens?: number;
    chain?: string[];       // cadeia completa tentada pelo runWithChain (opcional)
    activeIndex?: number;   // índice do provider que respondeu na cadeia (opcional)
}

interface Store { entries: LlmCallEntry[]; }

const STORE_PATH = path.join(__dirname, '../../data/llm_calls.json');
const MAX_ENTRIES = 1000;

class LlmCallLogService {
    private data: Store = { entries: [] };

    constructor() {
        this.load();
    }

    private load() {
        try {
            const dir = path.dirname(STORE_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            if (fs.existsSync(STORE_PATH)) {
                this.data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
            }
        } catch (e) {
            log.error('Load error', e);
            this.data = { entries: [] };
        }
    }

    private save() {
        try {
            const dir = path.dirname(STORE_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            atomicWriteSync(STORE_PATH, this.data);
        } catch (e) {
            log.error('Save error', e);
        }
    }

    /** Registra uma chamada de LLM. NUNCA lança (observabilidade não pode quebrar a chamada). */
    record(entry: Omit<LlmCallEntry, 'id' | 'ts'>): void {
        try {
            const e: LlmCallEntry = {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                ts: Date.now(),
                ...entry,
            };
            this.data.entries.unshift(e);
            if (this.data.entries.length > MAX_ENTRIES) {
                this.data.entries.length = MAX_ENTRIES;
            }
            this.save();
        } catch (err) {
            log.error('record error', err);
        }
    }

    /** Lista entradas (mais recentes primeiro). Filtros: só erros, por modelo, desde, limite. */
    list(opts: { limit?: number; onlyErrors?: boolean; model?: string; since?: number } = {}): LlmCallEntry[] {
        let entries = this.data.entries;
        if (opts.onlyErrors) entries = entries.filter((e) => !e.ok);
        if (opts.model) entries = entries.filter((e) => e.model === opts.model);
        if (opts.since) entries = entries.filter((e) => e.ts >= opts.since!);
        const limit = Math.min(Math.max(opts.limit ?? 100, 1), MAX_ENTRIES);
        return entries.slice(0, limit);
    }

    /** Resumo agregado: total, erros, latência média/p95 e contagem de fallback por modelo. */
    summary(): { total: number; errors: number; fallbacks: number; avgLatencyMs: number; byModel: Record<string, { count: number; errors: number }> } {
        const entries = this.data.entries;
        const total = entries.length;
        const errors = entries.filter((e) => !e.ok).length;
        const fallbacks = entries.filter((e) => e.fellBack).length;
        const avgLatencyMs = total ? Math.round(entries.reduce((s, e) => s + (e.latencyMs || 0), 0) / total) : 0;
        const byModel: Record<string, { count: number; errors: number }> = {};
        for (const e of entries) {
            const m = e.model || 'unknown';
            if (!byModel[m]) byModel[m] = { count: 0, errors: 0 };
            byModel[m].count++;
            if (!e.ok) byModel[m].errors++;
        }
        return { total, errors, fallbacks, avgLatencyMs, byModel };
    }
}

export const llmCallLogService = new LlmCallLogService();
