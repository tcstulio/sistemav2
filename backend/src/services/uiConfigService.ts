/**
 * UI Config Service — configuração de UI da ORGANIZAÇÃO (editável por admin).
 *
 * É o padrão (default) org-wide; cada usuário pode sobrescrever localmente no frontend
 * (modelo "admin define o padrão + override do usuário"). Persiste em JSON (mesmo padrão
 * do storeService — atomicWriteSync), então vale para todos e sobrevive a restart.
 *
 * Fase 1 cobre branding (nome/logo/cor). Fase 2 adiciona menu (#110) e dashboard (#111)
 * reusando este store. Permissões de tela (#112) virão na sequência.
 */
import fs from 'fs';
import path from 'path';
import { atomicWriteSync } from '../utils/atomicWrite';
import { logger } from '../utils/logger';

const log = logger.child('UiConfigService');

// Preferência de ordem + visibilidade reutilizada por menu (#110) e dashboard (#111).
// `hidden` = ids escondidos pelo admin (org-wide); `order` = ordem preferida de ids
// (ids fora da lista mantêm a ordem default, depois dos listados).
export interface OrderVisibilityPrefs {
    hidden: string[];
    order: string[];
}

export interface UiConfig {
    companyName: string;   // nome exibido no app (antes era hardcoded "CoolGroove")
    logoText: string;      // texto curto/inicial do bloco de logo
    logoUrl?: string;      // URL opcional de imagem de logo
    themeColor: string;    // cor padrão da organização (Tailwind color)
    menu: OrderVisibilityPrefs;       // #110 — ordem/visibilidade do menu lateral (padrão da org)
    dashboard: OrderVisibilityPrefs;  // #111 — ordem/visibilidade dos widgets do painel (padrão da org)
}

// Entrada de update: branding parcial + prefs parciais (sanitizadas em update()).
export type UiConfigUpdate = Partial<Omit<UiConfig, 'menu' | 'dashboard'>> & {
    menu?: Partial<OrderVisibilityPrefs>;
    dashboard?: Partial<OrderVisibilityPrefs>;
};

const DEFAULTS: UiConfig = {
    companyName: 'CoolGroove',
    logoText: 'D',
    themeColor: 'indigo',
    menu: { hidden: [], order: [] },
    dashboard: { hidden: [], order: [] },
};

// Sanitiza um array de ids vindo do cliente (string curta, sem duplicatas, limite de tamanho).
function sanitizeIdArray(v: unknown, maxItems = 200): string[] {
    if (!Array.isArray(v)) return [];
    const out: string[] = [];
    for (const x of v) {
        if (typeof x === 'string' && x.trim()) {
            const id = x.trim().slice(0, 80);
            if (!out.includes(id)) out.push(id);
        }
        if (out.length >= maxItems) break;
    }
    return out;
}

function sanitizePrefs(v: unknown): OrderVisibilityPrefs {
    const p = (v && typeof v === 'object') ? (v as Record<string, unknown>) : {};
    return { hidden: sanitizeIdArray(p.hidden), order: sanitizeIdArray(p.order) };
}

// Allowlist das cores do Tailwind usadas no tema (evita injeção de classe arbitrária).
export const ALLOWED_THEME_COLORS = [
    'slate', 'gray', 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald',
    'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
];

const DEFAULT_STORE_PATH = path.join(__dirname, '../../data/ui_config.json');

export class UiConfigService {
    private data: UiConfig;
    private storePath: string;

    constructor(storePath: string = DEFAULT_STORE_PATH) {
        this.storePath = storePath;
        this.data = { ...DEFAULTS };
        this.load();
    }

    private load(): void {
        try {
            const dir = path.dirname(this.storePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            if (fs.existsSync(this.storePath)) {
                const parsed = JSON.parse(fs.readFileSync(this.storePath, 'utf-8'));
                this.data = {
                    ...DEFAULTS,
                    ...parsed,
                    // objetos aninhados precisam de merge p/ não perder os defaults quando o arquivo é antigo
                    menu: { ...DEFAULTS.menu, ...(parsed.menu || {}) },
                    dashboard: { ...DEFAULTS.dashboard, ...(parsed.dashboard || {}) },
                };
            }
        } catch (error) {
            log.error('Load Error', error);
        }
    }

    private save(): void {
        try { atomicWriteSync(this.storePath, this.data); } catch (error) { log.error('Save Error', error); }
    }

    get(): UiConfig {
        return { ...this.data };
    }

    /** Aplica apenas campos válidos (sanitiza tamanho e valida a cor). Retorna a config final. */
    update(partial: UiConfigUpdate): UiConfig {
        const next: UiConfig = { ...this.data };
        if (typeof partial.companyName === 'string' && partial.companyName.trim()) {
            next.companyName = partial.companyName.trim().slice(0, 100);
        }
        if (typeof partial.logoText === 'string' && partial.logoText.trim()) {
            next.logoText = partial.logoText.trim().slice(0, 8);
        }
        if (typeof partial.logoUrl === 'string') {
            next.logoUrl = partial.logoUrl.slice(0, 500) || undefined;
        }
        if (typeof partial.themeColor === 'string' && ALLOWED_THEME_COLORS.includes(partial.themeColor)) {
            next.themeColor = partial.themeColor;
        }
        if (partial.menu !== undefined) {
            next.menu = sanitizePrefs(partial.menu);
        }
        if (partial.dashboard !== undefined) {
            next.dashboard = sanitizePrefs(partial.dashboard);
        }
        this.data = next;
        this.save();
        return this.get();
    }
}

export const uiConfigService = new UiConfigService();
