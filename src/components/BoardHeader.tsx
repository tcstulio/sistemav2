import React, { useEffect, useState } from 'react';
import { TaskService } from '../services/taskService';
import { useUiConfig } from '../hooks/useUiConfig';

/** Orçamento diário padrão (fallback) caso config/endpoint não retornem um teto válido. */
export const DEFAULT_DAILY_ROUND_BUDGET = 200;

export type BudgetStatus = 'loading' | 'error' | 'success';
export type BudgetTone = 'green' | 'amber' | 'red';

/** Faixa de cor conforme o consumo (consistente com o chip de rodadas do card). */
export function budgetTone(pct: number): BudgetTone {
    if (pct >= 100) return 'red';
    if (pct >= 70) return 'amber';
    return 'green';
}

const TONE_BAR_CLASSES: Record<BudgetTone, string> = {
    green: 'bg-emerald-500 dark:bg-emerald-400',
    amber: 'bg-amber-500 dark:bg-amber-400',
    red: 'bg-red-500 dark:bg-red-400',
};

const TONE_TEXT_CLASSES: Record<BudgetTone, string> = {
    green: 'text-emerald-600 dark:text-emerald-400',
    amber: 'text-amber-600 dark:text-amber-400',
    red: 'text-red-600 dark:text-red-400',
};

export interface DailyRoundsBudgetBarProps {
    /** Rodadas de opencode já consumidas hoje (valor REAL do backend). */
    used: number;
    /** Teto diário configurado (dailyRoundBudget). */
    budget: number;
    /** Estado de aquisição dos dados. */
    status?: BudgetStatus;
}

/**
 * Barra de progresso do orçamento diário de rodadas do Runner (#1189).
 *
 * Componente PURAMENTE apresentacional — recebe `used`, `budget` e `status` prontos,
 * o que o torna trivialmente testável (render com used/budget → cor esperada).
 *
 * - Verde < 70%, âmbar 70–99%, vermelho ≥ 100%.
 * - `loading`: barra neutra "respirando" (skeleton).
 * - `error`: barra neutra + rótulo "Orçamento indisponível".
 * - Responsivo: em viewports < `sm` esconde o texto e mantém só a barra (com `title`).
 */
export const DailyRoundsBudgetBar: React.FC<DailyRoundsBudgetBarProps> = ({
    used,
    budget,
    status = 'success',
}) => {
    const safeBudget = budget > 0 ? budget : DEFAULT_DAILY_ROUND_BUDGET;
    // Endurece contra `used` ausente/NaN (ex.: GET /api/tasks/status sem dailyRoundsUsed):
    // Math.round(undefined) = NaN vazaria como texto "NaN/300" no rótulo. Coalesce p/ 0.
    const safeUsed = Number.isFinite(used) ? Math.max(0, Math.round(used)) : 0;
    const pct = Math.min(100, Math.round((safeUsed / safeBudget) * 100));
    const tone = budgetTone(pct);

    const label = `Orçamento do dia: ${safeUsed}/${safeBudget} rodadas`;
    const titleText = status === 'error' ? 'Orçamento indisponível' : label;

    const fillClassName =
        status === 'loading'
            ? 'h-full w-1/3 rounded-full bg-slate-300 dark:bg-slate-600 animate-pulse'
            : status === 'error'
                ? 'h-full w-full rounded-full bg-slate-300 dark:bg-slate-600 opacity-60'
                : `h-full rounded-full transition-all ${TONE_BAR_CLASSES[tone]}`;

    return (
        <div
            className="flex items-center gap-2"
            data-testid="daily-rounds-budget-bar"
            data-status={status}
        >
            {/* Texto: oculto em < sm (fica só a barra + tooltip). */}
            <span
                className={`hidden sm:inline text-[11px] font-medium ${
                    status === 'error' ? 'text-slate-400' : TONE_TEXT_CLASSES[tone]
                }`}
                title={titleText}
            >
                {status === 'error' ? 'Orçamento indisponível' : label}
            </span>

            <div
                className="w-24 h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden"
                title={titleText}
                role="progressbar"
                aria-valuenow={status === 'success' ? safeUsed : undefined}
                aria-valuemin={0}
                aria-valuemax={safeBudget}
                aria-label={titleText}
            >
                <div
                    data-testid="daily-rounds-budget-fill"
                    data-tone={status === 'success' ? tone : undefined}
                    className={fillClassName}
                    style={status === 'success' ? { width: `${pct}%` } : undefined}
                />
            </div>
        </div>
    );
};

export interface BoardHeaderProps {
    /**
     * Sinal de atualização do board (ex.: contador incrementado a cada refetch de tasks).
     * Mudanças neste valor re-disparam o GET /api/tasks/status — o BoardHeader NÃO cria
     * polling próprio, apenas acompanha o refetch automático que o board já faz (#1189).
     */
    refreshSignal?: number;
}

/**
 * BoardHeader — cabeçalho do board de tasks. Hoje hospeda a barra de orçamento diário
 * de rodadas; projetado p/ receber mais indicadores no futuro.
 *
 * Orçamento (`dailyRoundBudget`) vem de `useUiConfig().taskAutomation.dailyRoundBudget`;
 * consumo (`dailyRoundsUsed`) vem de `GET /api/tasks/status` (valor real do backend).
 */
export const BoardHeader: React.FC<BoardHeaderProps> = ({ refreshSignal = 0 }) => {
    const { config } = useUiConfig();

    const [used, setUsed] = useState(0);
    const [statusBudget, setStatusBudget] = useState<number | undefined>(undefined);
    // status inicia 'loading' (primeira pintura = skeleton). Nos refetchs NÃO resetamos p/ o
    // estado loading — mantemos o último valor/status p/ evitar flicker a cada 10s; o novo
    // valor chega via os callbacks assíncronos (sem setState síncrono no corpo do effect).
    const [status, setStatus] = useState<BudgetStatus>('loading');

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const data = await TaskService.getStatus();
                if (cancelled) return;
                setUsed(data.dailyRoundsUsed);
                setStatusBudget(data.dailyRoundBudget);
                setStatus('success');
            } catch {
                if (cancelled) return;
                setStatus('error');
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [refreshSignal]);

    const budget = config?.taskAutomation?.dailyRoundBudget ?? statusBudget ?? DEFAULT_DAILY_ROUND_BUDGET;

    return <DailyRoundsBudgetBar used={used} budget={budget} status={status} />;
};

export default BoardHeader;
