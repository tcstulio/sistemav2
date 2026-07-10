import { useState, useEffect, useCallback } from 'react';
import { getUiConfig, UiConfig } from '../services/uiConfigService';

export interface UseUiConfigResult {
    config: UiConfig | null;
    loading: boolean;
    error: Error | null;
    refresh: () => void;
}

/**
 * Hook reativo para a config de UI da organização (#1189). Envolve `getUiConfig`
 * expondo `{ config, loading, error, refresh }` — `config.taskAutomation.dailyRoundBudget`
 * alimenta a barra de orçamento diário do BoardHeader.
 */
export function useUiConfig(): UseUiConfigResult {
    const [config, setConfig] = useState<UiConfig | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [tick, setTick] = useState(0);

    const refresh = useCallback(() => setTick((t) => t + 1), []);

    useEffect(() => {
        let cancelled = false;
        // loading inicia true (useState); nos refetchs mantemos o último config p/ evitar
        // flicker — o novo valor chega via then/finally (callbacks assíncronos, sem setState
        // síncrono no corpo do effect).
        getUiConfig()
            .then((c) => {
                if (cancelled) return;
                setConfig(c);
                setError(null);
            })
            .catch((e) => {
                if (cancelled) return;
                setError(e instanceof Error ? e : new Error(String(e)));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [tick]);

    return { config, loading, error, refresh };
}

export default useUiConfig;
