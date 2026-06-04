import { useState, useEffect } from 'react';
import { getUiConfig, UiConfig } from '../services/uiConfigService';

// Cache em módulo + pub/sub: a config da organização é buscada uma vez e compartilhada;
// quando o admin salva (Settings), setOrgBranding atualiza todos os consumidores na hora.
let cache: UiConfig | null = null;
const listeners = new Set<(c: UiConfig) => void>();

export function setOrgBranding(c: UiConfig): void {
    cache = c;
    listeners.forEach((l) => l(c));
}

export function getCachedBranding(): UiConfig | null {
    return cache;
}

export function useOrgBranding(): UiConfig | null {
    const [cfg, setCfg] = useState<UiConfig | null>(cache);
    useEffect(() => {
        const listener = (c: UiConfig) => setCfg(c);
        listeners.add(listener);
        if (!cache) {
            getUiConfig().then((c) => { if (c) setOrgBranding(c); }).catch(() => { /* mantém defaults */ });
        }
        return () => { listeners.delete(listener); };
    }, []);
    return cfg;
}
