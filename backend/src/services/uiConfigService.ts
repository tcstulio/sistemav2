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

// #112 — Regra de permissão de tela por entidade (pessoa ou grupo).
// `allowed` = telas explicitamente liberadas (mesmo sem direito Dolibarr, p/ telas de app);
// `hidden` = telas explicitamente ocultadas. Pessoa tem precedência sobre grupo; hidden vence allowed no mesmo escopo.
export interface ScreenRule {
    hidden: string[];
    allowed: string[];
}

export interface ScreenPermissions {
    groups: Record<string, ScreenRule>;  // groupId -> regra
    users: Record<string, ScreenRule>;   // userId -> regra
}

// #113 — Telas customizadas por grupo. Cada página tem blocos e uma allow-list de visibilidade.
export type CustomBlockType = 'richtext' | 'links' | 'widget' | 'embed';

export interface CustomBlock {
    id: string;
    type: CustomBlockType;
    title?: string;                 // cabeçalho opcional do bloco
    html?: string;                  // type=richtext (saneado no cliente ao renderizar)
    links?: { label: string; url: string; external?: boolean }[];  // type=links
    widgetId?: string;              // type=widget (id de um widget reutilizável)
    embedUrl?: string;              // type=embed (iframe https)
    height?: number;                // type=embed — altura em px
}

export interface CustomPageVisibility {
    groups: string[];   // ids de grupo; vazio = todos os logados
    users: string[];    // ids de usuário
}

export interface CustomPage {
    id: string;
    title: string;
    icon?: string;      // nome de ícone lucide
    slug: string;       // rota /p/:slug (URL-safe)
    visibility: CustomPageVisibility;
    blocks: CustomBlock[];
}

// ---- Camada 2 — Notificações de tarefa por papel (matriz evento × papel × canal) ----
export const TASK_NOTIF_EVENTS = ['assigned', 'deadline_reminder', 'overdue', 'stalled', 'completed', 'comment'] as const;
export const TASK_NOTIF_ROLES = ['responsavel', 'interveniente', 'criador'] as const;
export const NOTIF_CHANNELS = ['in-app', 'whatsapp', 'email'] as const;
export type TaskNotifEvent = typeof TASK_NOTIF_EVENTS[number];
export type TaskNotifRole = typeof TASK_NOTIF_ROLES[number];
export type NotifChannel = typeof NOTIF_CHANNELS[number];
// Para cada evento, quais canais cada papel recebe.
export type TaskNotificationsConfig = Record<TaskNotifEvent, Record<TaskNotifRole, NotifChannel[]>>;

export interface UiConfig {
    companyName: string;   // nome exibido no app (antes era hardcoded "CoolGroove")
    logoText: string;      // texto curto/inicial do bloco de logo
    logoUrl?: string;      // URL opcional de imagem de logo
    themeColor: string;    // cor padrão da organização (Tailwind color)
    menu: OrderVisibilityPrefs;       // #110 — ordem/visibilidade do menu lateral (padrão da org)
    dashboard: OrderVisibilityPrefs;  // #111 — ordem/visibilidade dos widgets do painel (padrão da org)
    screenPermissions: ScreenPermissions;  // #112 — permissões de tela por pessoa/grupo
    customPages: CustomPage[];        // #113 — telas customizadas por grupo
    taskNotifications: TaskNotificationsConfig;  // camada 2 — quem recebe o quê por papel em cada evento de tarefa
    taskNotificationsExternalEnabled: boolean;   // trava: WhatsApp/e-mail só saem quando o admin ligar (in-app sempre passa)
}

// Entrada de update: branding parcial + prefs/permissões/páginas parciais (sanitizadas em update()).
export type UiConfigUpdate = Partial<Omit<UiConfig, 'menu' | 'dashboard' | 'screenPermissions' | 'customPages' | 'taskNotifications'>> & {
    menu?: Partial<OrderVisibilityPrefs>;
    dashboard?: Partial<OrderVisibilityPrefs>;
    screenPermissions?: unknown;
    customPages?: unknown;
    taskNotifications?: unknown;
};

// Padrão aprovado: Responsável leva a cobrança; Interveniente acompanha; Criador é avisado do desfecho.
const DEFAULT_TASK_NOTIFICATIONS: TaskNotificationsConfig = {
    assigned:          { responsavel: ['in-app', 'whatsapp'],          interveniente: ['in-app'], criador: [] },
    deadline_reminder: { responsavel: ['in-app', 'whatsapp'],          interveniente: [],         criador: [] },
    overdue:           { responsavel: ['in-app', 'whatsapp', 'email'], interveniente: [],         criador: [] },
    stalled:           { responsavel: ['whatsapp'],                    interveniente: [],         criador: [] },
    completed:         { responsavel: [],                              interveniente: ['in-app'], criador: ['in-app'] },
    comment:           { responsavel: ['in-app'],                      interveniente: ['in-app'], criador: [] },
};

const DEFAULTS: UiConfig = {
    companyName: 'CoolGroove',
    logoText: 'D',
    themeColor: 'indigo',
    menu: { hidden: [], order: [] },
    dashboard: { hidden: [], order: [] },
    screenPermissions: { groups: {}, users: {} },
    customPages: [],
    taskNotifications: DEFAULT_TASK_NOTIFICATIONS,
    taskNotificationsExternalEnabled: false,  // começa travado: só in-app até o admin habilitar WhatsApp/e-mail
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

function sanitizeRule(v: unknown): ScreenRule {
    const r = (v && typeof v === 'object') ? (v as Record<string, unknown>) : {};
    return { hidden: sanitizeIdArray(r.hidden), allowed: sanitizeIdArray(r.allowed) };
}

// ---- #113: saneamento de telas customizadas ----
function str(v: unknown, max: number): string {
    return typeof v === 'string' ? v.slice(0, max) : '';
}

function slugify(v: unknown): string {
    return str(v, 60).toLowerCase().trim()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

function sanitizeBlock(v: unknown, idx: number): CustomBlock | null {
    if (!v || typeof v !== 'object') return null;
    const b = v as Record<string, unknown>;
    const type = b.type;
    if (type !== 'richtext' && type !== 'links' && type !== 'embed' && type !== 'widget') return null;
    const block: CustomBlock = {
        id: str(b.id, 40) || `b${idx}`,
        type,
        title: str(b.title, 120) || undefined,
    };
    if (type === 'richtext') {
        block.html = str(b.html, 20000); // saneado com DOMPurify no cliente ao renderizar
    } else if (type === 'links') {
        const arr = Array.isArray(b.links) ? b.links : [];
        block.links = arr.slice(0, 50).map((l) => {
            const link = (l && typeof l === 'object') ? l as Record<string, unknown> : {};
            return { label: str(link.label, 120), url: str(link.url, 500), external: !!link.external };
        }).filter((l) => l.label && l.url);
    } else if (type === 'widget') {
        block.widgetId = str(b.widgetId, 60);
    } else if (type === 'embed') {
        const url = str(b.embedUrl, 1000);
        block.embedUrl = /^https?:\/\//i.test(url) ? url : ''; // só http(s)
        const h = Number(b.height);
        block.height = Number.isFinite(h) ? Math.min(2000, Math.max(120, Math.round(h))) : 480;
    }
    return block;
}

function sanitizeCustomPages(v: unknown): CustomPage[] {
    if (!Array.isArray(v)) return [];
    const seenSlugs = new Set<string>();
    const out: CustomPage[] = [];
    for (const item of v.slice(0, 100)) {
        if (!item || typeof item !== 'object') continue;
        const p = item as Record<string, unknown>;
        const id = str(p.id, 40);
        const title = str(p.title, 120).trim();
        if (!title) continue;
        let slug = slugify(p.slug) || slugify(title) || `pagina-${out.length + 1}`;
        while (seenSlugs.has(slug)) slug = `${slug}-${out.length + 1}`; // sem colisão
        seenSlugs.add(slug);
        const vis = (p.visibility && typeof p.visibility === 'object') ? p.visibility as Record<string, unknown> : {};
        const blocksRaw = Array.isArray(p.blocks) ? p.blocks : [];
        out.push({
            id: id || `page-${out.length + 1}`,
            title,
            icon: str(p.icon, 40) || undefined,
            slug,
            visibility: { groups: sanitizeIdArray(vis.groups), users: sanitizeIdArray(vis.users) },
            blocks: blocksRaw.slice(0, 50).map((b, i) => sanitizeBlock(b, i)).filter((b): b is CustomBlock => b !== null),
        });
    }
    return out;
}

// Sanitiza o mapa de permissões de tela (groups/users -> regra), limitando o nº de entidades.
function sanitizeScreenPermissions(v: unknown): ScreenPermissions {
    const p = (v && typeof v === 'object') ? (v as Record<string, unknown>) : {};
    const out: ScreenPermissions = { groups: {}, users: {} };
    (['groups', 'users'] as const).forEach((scope) => {
        const m = (p[scope] && typeof p[scope] === 'object') ? (p[scope] as Record<string, unknown>) : {};
        Object.keys(m).slice(0, 500).forEach((key) => {
            const id = String(key).trim().slice(0, 40);
            if (id) out[scope][id] = sanitizeRule(m[key]);
        });
    });
    return out;
}

function sanitizeChannels(v: unknown): NotifChannel[] {
    if (!Array.isArray(v)) return [];
    const out: NotifChannel[] = [];
    for (const x of v) {
        if (typeof x === 'string' && (NOTIF_CHANNELS as readonly string[]).includes(x) && !out.includes(x as NotifChannel)) {
            out.push(x as NotifChannel);
        }
    }
    return out;
}

// Matriz evento×papel×canal: usa o que o admin enviou (respeitando desligamentos) e cai no
// default para eventos/papéis ausentes — assim a config sobrevive a versões antigas do arquivo.
function sanitizeTaskNotifications(v: unknown): TaskNotificationsConfig {
    const p = (v && typeof v === 'object') ? (v as Record<string, any>) : {};
    const out = {} as TaskNotificationsConfig;
    for (const event of TASK_NOTIF_EVENTS) {
        const ev = (p[event] && typeof p[event] === 'object') ? p[event] as Record<string, unknown> : undefined;
        out[event] = {} as Record<TaskNotifRole, NotifChannel[]>;
        for (const role of TASK_NOTIF_ROLES) {
            out[event][role] = (ev && role in ev)
                ? sanitizeChannels(ev[role])
                : [...DEFAULT_TASK_NOTIFICATIONS[event][role]];
        }
    }
    return out;
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
                    screenPermissions: sanitizeScreenPermissions(parsed.screenPermissions),
                    customPages: sanitizeCustomPages(parsed.customPages),
                    taskNotifications: sanitizeTaskNotifications(parsed.taskNotifications),
                    taskNotificationsExternalEnabled: parsed.taskNotificationsExternalEnabled === true,
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
        if (partial.screenPermissions !== undefined) {
            next.screenPermissions = sanitizeScreenPermissions(partial.screenPermissions);
        }
        if (partial.customPages !== undefined) {
            next.customPages = sanitizeCustomPages(partial.customPages);
        }
        if (partial.taskNotifications !== undefined) {
            next.taskNotifications = sanitizeTaskNotifications(partial.taskNotifications);
        }
        if (typeof partial.taskNotificationsExternalEnabled === 'boolean') {
            next.taskNotificationsExternalEnabled = partial.taskNotificationsExternalEnabled;
        }
        this.data = next;
        this.save();
        return this.get();
    }
}

export const uiConfigService = new UiConfigService();
