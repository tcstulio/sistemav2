/**
 * Banner de QUOTA-HOLD / PEAK-HOLD do robô (#1167).
 *
 * O endpoint `GET /api/tasks/quota-status` (getQuotaStatus) já existia no backend mas nada o
 * consumia. Este banner torna visível quando o robô PAROU de despachar por um motivo de
 * orçamento/cota — para o usuário não achar que o robô "travou".
 *
 * Duas causas distintas (podem coexistir):
 *  - quota exhausted: a cota/saldo de LLM esgotou (429/402). O robô aguarda a sonda confirmar
 *    o retorno da API; exibe o `reason` do backend e há quanto tempo começou (`since` → epoch ms).
 *  - peak hold: janela de pico do Z.AI (GLM consome 3x a cota). O robô segura NOVOS dispatches
 *    até o off-peak; a task em execução segue (não é morta).
 *
 * `QuotaHoldBannerContent` é PURAMENTE apresentacional (trivialmente testável); `QuotaHoldBanner`
 * é o container que busca o estado e o re-busca a cada `refreshSignal` (acompanhando o refetch de
 * tasks, sem criar polling próprio — mesmo padrão do BoardHeader).
 */
import React, { useEffect, useState } from 'react';
import { AlertTriangle, Zap } from 'lucide-react';
import { TaskService } from '../services/taskService';

export interface QuotaStatus {
    exhausted: boolean;
    since: number | null;
    reason: string;
    peakHold: boolean;
}

/** True quando há algum hold ativo (banner deve aparecer). */
export function isAnyHoldActive(s: QuotaStatus | null | undefined): boolean {
    return !!(s && (s.exhausted || s.peakHold));
}

/** Formata "há Nmin" / "há Nh" a partir de um epoch ms, para o since do quota exhausted. */
export function formatHoldSince(since: number | null, now: number = Date.now()): string | null {
    if (typeof since !== 'number' || !Number.isFinite(since)) return null;
    const diffMs = Math.max(0, now - since);
    const min = Math.floor(diffMs / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min}min`;
    const h = Math.floor(min / 60);
    const rest = min % 60;
    return rest ? `há ${h}h${rest}min` : `há ${h}h`;
}

/**
 * Parte apresentacional do banner. Recebe o status pronto e decide o que (não) renderizar.
 * Quando nenhum hold está ativo, devolve null (não ocupa espaço no board).
 */
export const QuotaHoldBannerContent: React.FC<{ status: QuotaStatus | null; now?: number }> = ({ status, now }) => {
    if (!isAnyHoldActive(status)) return null;

    return (
        <div
            className="flex flex-col gap-1.5 px-4 py-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-300"
            data-testid="quota-hold-banner"
            data-exhausted={status!.exhausted ? 'true' : 'false'}
            data-peak-hold={status!.peakHold ? 'true' : 'false'}
            role="alert"
        >
            {status!.exhausted && (
                <div className="flex items-start gap-2" data-testid="quota-exhausted-row">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>
                        <strong>Cota de LLM esgotada</strong> — o robô aguarda o retorno da API
                        {formatHoldSince(status!.since, now) ? ` (${formatHoldSince(status!.since, now)})` : ''}.
                        {status!.reason ? <span className="block mt-0.5 text-[11px] text-amber-600 dark:text-amber-400/80">Motivo: {status!.reason}</span> : null}
                    </span>
                </div>
            )}
            {status!.peakHold && (
                <div className="flex items-start gap-2" data-testid="peak-hold-row">
                    <Zap size={14} className="mt-0.5 shrink-0" />
                    <span>
                        <strong>Hold de pico (GLM 3x)</strong> — novos dispatches pausados até o off-peak (~07:00 BRT).
                        A task em execução segue normalmente.
                    </span>
                </div>
            )}
        </div>
    );
};

export interface QuotaHoldBannerProps {
    /**
     * Sinal de atualização do board (ex.: contador incrementado a cada refetch de tasks).
     * Mudanças neste valor re-disparam o GET /api/tasks/quota-status — sem polling próprio.
     */
    refreshSignal?: number;
}

/**
 * Container que busca o estado de quota no backend e repassa ao `QuotaHoldBannerContent`.
 * Falhas de rede deixam o banner oculto (não há dado confiável p/ exibir) — não trava a UI.
 */
export const QuotaHoldBanner: React.FC<QuotaHoldBannerProps> = ({ refreshSignal = 0 }) => {
    const [status, setStatus] = useState<QuotaStatus | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const data = await TaskService.getQuotaStatus();
                if (!cancelled) setStatus(data);
            } catch {
                // Sem dado confiável → mantém o último estado (ou null). Não exibe banner falso.
            }
        })();
        return () => { cancelled = true; };
    }, [refreshSignal]);

    return <QuotaHoldBannerContent status={status} />;
};

export default QuotaHoldBanner;
