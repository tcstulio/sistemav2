/**
 * Rastreador de uso de LLM por task (#305).
 *
 * Singleton thread-safe: o taskRunner chama `recordUsage(taskId, usage, model)`
 * após cada chamada LLM (judge, planner, opencode) e o endpoint /metrics
 * consome via `getUsageForTask(taskId)`.
 *
 * Mantém:
 *  - tokens input/output/total agregados
 *  - custo USD estimado
 *  - número de chamadas
 *  - modelos usados (lista)
 *  - última timestamp
 *
 * Sem persistência em disco: as métricas são recalculáveis a partir dos
 * events[] persistidos se o backend reiniciar (futuro).
 */

import { TokenUsage } from './aiService';
import { calcCostUsd } from '../config/modelPricing';

interface TaskUsageRecord {
    taskId: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
    calls: number;
    models: string[];
    firstCallAt?: string;
    lastCallAt?: string;
}

const usageMap = new Map<number, TaskUsageRecord>();

export function recordUsage(taskId: number, usage: TokenUsage | undefined, modelName: string | undefined): void {
    if (!taskId || !usage) return;
    const existing = usageMap.get(taskId) || {
        taskId,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        calls: 0,
        models: [] as string[],
    };
    existing.promptTokens += usage.promptTokens || 0;
    existing.completionTokens += usage.completionTokens || 0;
    existing.totalTokens += usage.totalTokens || 0;
    existing.costUsd += calcCostUsd(modelName, usage.promptTokens || 0, usage.completionTokens || 0);
    existing.calls += 1;
    if (modelName && !existing.models.includes(modelName)) existing.models.push(modelName);
    const now = new Date().toISOString();
    if (!existing.firstCallAt) existing.firstCallAt = now;
    existing.lastCallAt = now;
    usageMap.set(taskId, existing);
}

export function getUsageForTask(taskId: number): TaskUsageRecord | null {
    return usageMap.get(taskId) || null;
}

export function getAllUsage(): Record<number, TaskUsageRecord> {
    const out: Record<number, TaskUsageRecord> = {};
    for (const [k, v] of usageMap.entries()) out[k] = v;
    return out;
}

export function clearUsageForTask(taskId: number): void {
    usageMap.delete(taskId);
}

export type { TaskUsageRecord };
