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
import { createLogger } from '../utils/logger';

// createLogger (não logger.child) p/ casar com o padrão de mock dos testes (todos mockam createLogger).
const log = createLogger('UiConfigService');

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
export const TASK_NOTIF_EVENTS = ['assigned', 'acceptance_pending', 'acceptance_overdue', 'deadline_reminder', 'overdue', 'stalled', 'completed', 'comment'] as const;
export const TASK_NOTIF_ROLES = ['responsavel', 'interveniente', 'criador'] as const;
export const NOTIF_CHANNELS = ['in-app', 'whatsapp', 'email'] as const;
export type TaskNotifEvent = typeof TASK_NOTIF_EVENTS[number];
export type TaskNotifRole = typeof TASK_NOTIF_ROLES[number];
export type NotifChannel = typeof NOTIF_CHANNELS[number];
// Para cada evento, quais canais cada papel recebe.
export type TaskNotificationsConfig = Record<TaskNotifEvent, Record<TaskNotifRole, NotifChannel[]>>;

export interface TaskAutomationConfig {
    autoPlay: boolean;
    autoMerge: boolean;
    autoDecompose: boolean;
    minMergeScore: number;
    /** Piso de nota do Judge (0-10) p/ APROVAR uma task (default 9). Abaixo dele → revisão humana. #1125 */
    minApproveScore: number;
    /** Máx. de rodadas de AUTO-FIX do Judge (score baixo) antes de escalar p/ revisão humana (default 3, 1-10). #1154 */
    maxJudgeRounds: number;
    /** Máx. de rodadas de SELF-HEAL de gate (regressão de testes / veto do Juiz / CI vermelha) antes de escalar (default 3, 1-10). #1154 */
    maxGateFixRounds: number;
    /** Teto de rodadas de opencode POR TASK antes de escalar p/ revisão humana (default 20, 1-100). #1154 item 23 */
    maxRoundsPerTask: number;
    /** Teto GLOBAL de rodadas de opencode POR DIA — atingido, segura novos dispatches até a virada do dia (default 200, 10-5000). #1154 item 23 */
    dailyRoundBudget: number;
    /** Modelo do JUIZ (LLM-as-judge que gateia o auto-merge). Vazio = usa a cadeia do chat (aiService,
     * hoje MiniMax). Setado (ex.: 'sonnet', 'opus', 'haiku', ou ID completo) = o juiz roda no Claude
     * Code CLI com esse modelo PRIMEIRO (família diferente do coder = gate independente, evita
     * auto-julgamento), com FALLBACK pra cadeia do chat se o Claude falhar/estiver indisponível. */
    judgeModel: string;
}

export interface ActionGovernanceConfig {
    irreversibleRequiresApproval: boolean;
    adminBypassIrreversible: boolean;
    approvalValueThreshold: number | null;
    whatsappDestinationAllowlist: string[];
    /** Kill-switch por domínio (#1370): false = recusa TODA tool de domínio 'business' (cotação,
     * fatura, validação…). Default true (não altera comportamento). O admin desliga num clique. */
    businessActionsEnabled: boolean;
}

// #1204 — Kill-switches globais das automações de fundo na UI. Permitem pausar o scheduler
// de mensagens (WhatsApp/e-mail agendados) e/ou os alertas cron (faturas/estoque/tickets/
// análise financeira) SEM derrubar o backend. Default true = nada muda. Cada serviço checa
// a config a CADA tick (sem cache) — religar o switch retoma no próximo ciclo, sem restart.
export interface AutomationSwitchesConfig {
    schedulerEnabled: boolean;
    alertCronEnabled: boolean;
}

// #1129 — Kill-switches perigosos expostos como toggles de admin (Integrações/Segurança).
// Mesmo padrão do TASKRUNNER_AUTOSTART: env-como-fallback + toggle de UI lido em runtime.
// dryRunMode/financialCommands default OFF (secure-default); crmContextInjection default ON
// (preserva o comportamento histórico de injeção de contexto no LLM).
export interface FeatureSwitchesConfig {
    dryRunMode: boolean;          // impede envio real de mensagens (anti-spam de incidente)
    financialCommands: boolean;   // habilita /pagar e /pix (movimentam dinheiro real)
    crmContextInjection: boolean; // injeta dados do cliente no LLM (privacidade)
}

// ---- Política de notificações (#1293): cadência de cobrança, quiet-hours por canal e horizontes
// de alerta. 4 blocos: cobrancaCadence, quietHours, staleHours, invoiceDueHorizonDays. ----
export type QuietHoursChannel = 'whatsapp' | 'email' | 'in-app';

export interface QuietHoursRule {
    enabled: boolean;
    startHHmm: string;   // "HH:mm" (24h)
    endHHmm: string;     // "HH:mm" (24h); endHHmm < startHHmm = janela que cruza a meia-noite
    weekdaysOnly: boolean;
}

export type QuietHoursConfig = Record<QuietHoursChannel, QuietHoursRule>;

export interface CobrancaCadenceConfig {
    reminderDaysBefore: number;     // janela do lembrete antes do prazo (dias)
    recobrancaIntervalDays: number; // intervalo entre re-cobranças (dias)
    escalateAfterCobrancas: number; // nº de cobranças sem progresso antes de escalar
    prazoDeAceiteDays: number;      // prazo (dias) p/ o responsável aceitar antes de escalar
}

export interface NotificationPolicyConfig {
    cobrancaCadence: CobrancaCadenceConfig;
    quietHours: QuietHoursConfig;
    staleHours: number;            // ticket stale threshold (horas) — alerta de ticket parado
    invoiceDueHorizonDays: number; // fatura a vencer (dias) — horizonte do alerta de vencimento
}

export interface UiConfig {
    companyName: string;
    logoText: string;
    logoUrl?: string;
    themeColor: string;
    menu: OrderVisibilityPrefs;
    dashboard: OrderVisibilityPrefs;
    screenPermissions: ScreenPermissions;
    customPages: CustomPage[];
    taskNotifications: TaskNotificationsConfig;
    taskNotificationsExternalEnabled: boolean;
    taskAutomation: TaskAutomationConfig;
    actionGovernance: ActionGovernanceConfig;
    automationSwitches: AutomationSwitchesConfig;
    featureSwitches: FeatureSwitchesConfig;
    notificationPolicy: NotificationPolicyConfig;
    // Concorrência otimista (#central-permissões): incrementa a cada save. A Central envia
    // o version que leu; o backend rejeita (409) se mudou no meio — evita last-write-wins.
    version: number;
    // Id do grupo Dolibarr usado pela automação "Habilitar acesso ao app". Deve ser um grupo
    // que carrega o direito user->self->creer (342) — assim a Chave de API do usuário nasce no
    // 1º /login. Configurado na Central (aba "Acesso ao App"). undefined = automação desligada.
    appAccessGroupId?: string;
}

// Limites expostos p/ a UI mostrar (em vez de truncar em silêncio).
export const UI_CONFIG_LIMITS = { maxEntities: 500, maxIdsPerRule: 200, maxIdLen: 80 };

// Entrada de update: branding parcial + prefs/permissões/páginas parciais (sanitizadas em update()).
export type UiConfigUpdate = Partial<Omit<UiConfig, 'menu' | 'dashboard' | 'screenPermissions' | 'customPages' | 'taskNotifications' | 'actionGovernance' | 'automationSwitches' | 'featureSwitches' | 'notificationPolicy'>> & {
    menu?: Partial<OrderVisibilityPrefs>;
    dashboard?: Partial<OrderVisibilityPrefs>;
    screenPermissions?: unknown;
    customPages?: unknown;
    taskNotifications?: unknown;
    taskAutomation?: unknown;
    actionGovernance?: unknown;
    automationSwitches?: unknown;
    featureSwitches?: unknown;
    notificationPolicy?: unknown;
};

// Padrão aprovado: Responsável leva a cobrança; Interveniente acompanha; Criador é avisado do desfecho.
const DEFAULT_TASK_NOTIFICATIONS: TaskNotificationsConfig = {
    assigned:           { responsavel: ['in-app', 'whatsapp'],          interveniente: ['in-app'], criador: [] },
    acceptance_pending: { responsavel: ['in-app', 'whatsapp'],          interveniente: [],         criador: [] },
    acceptance_overdue: { responsavel: [],                              interveniente: [],         criador: ['in-app', 'whatsapp'] },
    deadline_reminder:  { responsavel: ['in-app', 'whatsapp'],          interveniente: [],         criador: [] },
    overdue:           { responsavel: ['in-app', 'whatsapp', 'email'], interveniente: [],         criador: [] },
    stalled:           { responsavel: ['whatsapp'],                    interveniente: [],         criador: ['in-app', 'whatsapp'] },
    completed:         { responsavel: [],                              interveniente: ['in-app'], criador: ['in-app'] },
    comment:           { responsavel: ['in-app'],                      interveniente: ['in-app'], criador: [] },
};

// ---- Política de notificações (#1293) ----
// Cadência espelha DEFAULT_CADENCE do delegationFollowUpLogic (1/2/3/1). Quiet-hours padrão
// DESLIGADO p/ todos os canais (não silenciar nada por padrão). staleHours=24 e invoiceDueHorizon=3
// acompanham os limiares históricos do alertCronService (ticket parado +24h, fatura vencendo em 3 dias).
export const DEFAULT_COBRANCA_CADENCE: CobrancaCadenceConfig = {
    reminderDaysBefore: 1,
    recobrancaIntervalDays: 2,
    escalateAfterCobrancas: 3,
    prazoDeAceiteDays: 1,
};

function defaultQuietHours(): QuietHoursConfig {
    const rule = (): QuietHoursRule => ({ enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false });
    return { whatsapp: rule(), email: rule(), 'in-app': rule() };
}

export const DEFAULT_NOTIFICATION_POLICY: NotificationPolicyConfig = {
    cobrancaCadence: { ...DEFAULT_COBRANCA_CADENCE },
    quietHours: defaultQuietHours(),
    staleHours: 24,
    invoiceDueHorizonDays: 3,
};

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function sanitizeHHmm(v: unknown, dflt: string): string {
    return typeof v === 'string' && HHMM_RE.test(v) ? v : dflt;
}

function intIn(v: unknown, min: number, max: number, dflt: number): number {
    const n = typeof v === 'number' ? v : NaN;
    if (!Number.isFinite(n)) return dflt;
    return Math.max(min, Math.min(max, Math.round(n)));
}

export const QUIET_HOURS_CHANNELS: readonly QuietHoursChannel[] = ['whatsapp', 'email', 'in-app'];

// Exportado p/ teste unitário direto (mesmo espírito das demais sanitize).
export function sanitizeCobrancaCadence(v: unknown): CobrancaCadenceConfig {
    const d = DEFAULT_COBRANCA_CADENCE;
    const c = (v && typeof v === 'object') ? v as Record<string, unknown> : {};
    return {
        reminderDaysBefore: intIn(c.reminderDaysBefore, 0, 90, d.reminderDaysBefore),
        recobrancaIntervalDays: intIn(c.recobrancaIntervalDays, 1, 90, d.recobrancaIntervalDays),
        escalateAfterCobrancas: intIn(c.escalateAfterCobrancas, 1, 30, d.escalateAfterCobrancas),
        prazoDeAceiteDays: intIn(c.prazoDeAceiteDays, 0, 90, d.prazoDeAceiteDays),
    };
}

// Exportado p/ teste unitário direto (mesmo espírito das demais sanitize).
export function sanitizeQuietHours(v: unknown): QuietHoursConfig {
    const d = DEFAULT_NOTIFICATION_POLICY.quietHours;
    const src = (v && typeof v === 'object') ? v as Record<string, unknown> : {};
    const out = {} as QuietHoursConfig;
    for (const ch of QUIET_HOURS_CHANNELS) {
        const r = (src[ch] && typeof src[ch] === 'object') ? src[ch] as Record<string, unknown> : {};
        out[ch] = {
            enabled: typeof r.enabled === 'boolean' ? r.enabled : d[ch].enabled,
            startHHmm: sanitizeHHmm(r.startHHmm, d[ch].startHHmm),
            endHHmm: sanitizeHHmm(r.endHHmm, d[ch].endHHmm),
            weekdaysOnly: typeof r.weekdaysOnly === 'boolean' ? r.weekdaysOnly : d[ch].weekdaysOnly,
        };
    }
    return out;
}

// Exportado p/ teste unitário direto (mesmo espírito das demais sanitize).
export function sanitizeNotificationPolicy(v: unknown): NotificationPolicyConfig {
    const d = DEFAULT_NOTIFICATION_POLICY;
    if (!v || typeof v !== 'object') {
        return {
            cobrancaCadence: { ...d.cobrancaCadence },
            quietHours: sanitizeQuietHours(d),
            staleHours: d.staleHours,
            invoiceDueHorizonDays: d.invoiceDueHorizonDays,
        };
    }
    const p = v as Record<string, unknown>;
    return {
        cobrancaCadence: sanitizeCobrancaCadence(p.cobrancaCadence),
        quietHours: sanitizeQuietHours(p.quietHours),
        staleHours: intIn(p.staleHours, 1, 720, d.staleHours),
        invoiceDueHorizonDays: intIn(p.invoiceDueHorizonDays, 0, 365, d.invoiceDueHorizonDays),
    };
}

const DEFAULTS: UiConfig = {
    companyName: 'CoolGroove',
    logoText: 'D',
    themeColor: 'indigo',
    menu: { hidden: [], order: [] },
    dashboard: { hidden: [], order: [] },
    screenPermissions: { groups: {}, users: {} },
    customPages: [],
    taskNotifications: DEFAULT_TASK_NOTIFICATIONS,
    taskNotificationsExternalEnabled: false,
    taskAutomation: { autoPlay: false, autoMerge: false, autoDecompose: false, minMergeScore: 8, minApproveScore: 9, maxJudgeRounds: 3, maxGateFixRounds: 3, maxRoundsPerTask: 20, dailyRoundBudget: 200, judgeModel: '' },
    actionGovernance: { irreversibleRequiresApproval: false, adminBypassIrreversible: true, approvalValueThreshold: null, whatsappDestinationAllowlist: [], businessActionsEnabled: true },
    automationSwitches: { schedulerEnabled: true, alertCronEnabled: true },
    featureSwitches: { dryRunMode: false, financialCommands: false, crmContextInjection: true },
    notificationPolicy: {
        cobrancaCadence: { ...DEFAULT_COBRANCA_CADENCE },
        quietHours: defaultQuietHours(),
        staleHours: 24,
        invoiceDueHorizonDays: 3,
    },
    version: 0,
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

function sanitizeTaskAutomation(v: unknown): TaskAutomationConfig {
    const d = DEFAULTS.taskAutomation;
    if (!v || typeof v !== 'object') return { ...d };
    const a = v as Record<string, unknown>;
    // #1154 P3 item 29: piso SANE de 5 (antes aceitava 1) — aprovar/mergear automaticamente com nota < 5/10
    // nunca é intencional; é secure-default contra um valor perigoso digitado por engano.
    const SCORE_FLOOR = 5;
    const minScore = typeof a.minMergeScore === 'number' ? Math.max(SCORE_FLOOR, Math.min(10, Math.round(a.minMergeScore))) : d.minMergeScore;
    const minApprove = typeof a.minApproveScore === 'number' ? Math.max(SCORE_FLOOR, Math.min(10, Math.round(a.minApproveScore))) : d.minApproveScore;
    // #1154: rodadas de correção configuráveis (1-10). Clamp defensivo — 0 travaria o loop, >10 é custo sem retorno.
    const maxJudge = typeof a.maxJudgeRounds === 'number' ? Math.max(1, Math.min(10, Math.round(a.maxJudgeRounds))) : d.maxJudgeRounds;
    const maxGate = typeof a.maxGateFixRounds === 'number' ? Math.max(1, Math.min(10, Math.round(a.maxGateFixRounds))) : d.maxGateFixRounds;
    // #1154 item 23: tetos de custo. Por-task clampa 1..100; diário 10..5000 (defensivo).
    const maxPerTask = typeof a.maxRoundsPerTask === 'number' ? Math.max(1, Math.min(100, Math.round(a.maxRoundsPerTask))) : d.maxRoundsPerTask;
    const dailyBudget = typeof a.dailyRoundBudget === 'number' ? Math.max(10, Math.min(5000, Math.round(a.dailyRoundBudget))) : d.dailyRoundBudget;
    return {
        autoPlay: a.autoPlay === true,
        autoMerge: a.autoMerge === true,
        autoDecompose: a.autoDecompose === true,
        minMergeScore: minScore,
        minApproveScore: minApprove,
        maxJudgeRounds: maxJudge,
        maxGateFixRounds: maxGate,
        maxRoundsPerTask: maxPerTask,
        dailyRoundBudget: dailyBudget,
        // Modelo do juiz: string livre (o Claude CLI valida o alias/ID); trim + cap defensivo. Vazio = cadeia do chat.
        judgeModel: typeof a.judgeModel === 'string' ? a.judgeModel.trim().slice(0, 60) : d.judgeModel,
    };
}

// Exportado p/ teste unitário direto (mesmo espírito das demais sanitize).
export function sanitizeActionGovernance(v: unknown): ActionGovernanceConfig {
    const d = DEFAULTS.actionGovernance;
    if (!v || typeof v !== 'object') return { ...d };
    const a = v as Record<string, unknown>;
    // Booleanos: NUNCA coerção implícita — só valor explicitamente booleano é aceito; resto cai no default.
    const irreversibleRequiresApproval = typeof a.irreversibleRequiresApproval === 'boolean'
        ? a.irreversibleRequiresApproval
        : d.irreversibleRequiresApproval;
    // adminBypassIrreversible default é true (permissivo).
    const adminBypassIrreversible = typeof a.adminBypassIrreversible === 'boolean'
        ? a.adminBypassIrreversible
        : d.adminBypassIrreversible;
    // Threshold: finito e >= 0, arredondado; negativo/NaN/null vira null (permissivo).
    const rawThreshold = a.approvalValueThreshold;
    const approvalValueThreshold = (Number.isFinite(rawThreshold) && (rawThreshold as number) >= 0)
        ? Math.round(rawThreshold as number)
        : null;
    // Allowlist: cada item vira só dígitos; descarta quem não ficar em 8..15 dígitos.
    const rawAllowlist = a.whatsappDestinationAllowlist;
    const whatsappDestinationAllowlist: string[] = Array.isArray(rawAllowlist)
        ? rawAllowlist
            .map((item) => (typeof item === 'string' ? item.replace(/\D/g, '') : ''))
            .filter((digits) => digits.length >= 8 && digits.length <= 15)
        : [];
    // Kill-switch (#1370): só booleano explícito; default true (permissivo, não quebra nada).
    const businessActionsEnabled = typeof a.businessActionsEnabled === 'boolean'
        ? a.businessActionsEnabled
        : d.businessActionsEnabled;
    return { irreversibleRequiresApproval, adminBypassIrreversible, approvalValueThreshold, whatsappDestinationAllowlist, businessActionsEnabled };
}

// Exportado p/ teste unitário direto (mesmo espírito das demais sanitize).
export function sanitizeAutomationSwitches(v: unknown): AutomationSwitchesConfig {
    const d = DEFAULTS.automationSwitches;
    if (!v || typeof v !== 'object') return { ...d };
    const a = v as Record<string, unknown>;
    // Booleanos: só valor explicitamente booleano é aceito; ausente/inválido cai no default (secure-default true).
    return {
        schedulerEnabled: typeof a.schedulerEnabled === 'boolean' ? a.schedulerEnabled : d.schedulerEnabled,
        alertCronEnabled: typeof a.alertCronEnabled === 'boolean' ? a.alertCronEnabled : d.alertCronEnabled,
    };
}

// Exportado p/ teste unitário direto. Booleanos: só valor explicitamente booleano é aceito;
// ausente/inválido cai no default do respectivo flag (dryRun/financial OFF, crmContext ON).
export function sanitizeFeatureSwitches(v: unknown): FeatureSwitchesConfig {
    const d = DEFAULTS.featureSwitches;
    if (!v || typeof v !== 'object') return { ...d };
    const a = v as Record<string, unknown>;
    return {
        dryRunMode: typeof a.dryRunMode === 'boolean' ? a.dryRunMode : d.dryRunMode,
        financialCommands: typeof a.financialCommands === 'boolean' ? a.financialCommands : d.financialCommands,
        crmContextInjection: typeof a.crmContextInjection === 'boolean' ? a.crmContextInjection : d.crmContextInjection,
    };
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
                    taskAutomation: sanitizeTaskAutomation(parsed.taskAutomation),
                    actionGovernance: sanitizeActionGovernance(parsed.actionGovernance),
                    automationSwitches: sanitizeAutomationSwitches(parsed.automationSwitches),
                    featureSwitches: sanitizeFeatureSwitches(parsed.featureSwitches),
                    notificationPolicy: sanitizeNotificationPolicy(parsed.notificationPolicy),
                    version: typeof parsed.version === 'number' ? parsed.version : 0,
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

    getTicketStaleHours(): number {
        return this.data.notificationPolicy.staleHours;
    }

    getInvoiceDueHorizonDays(): number {
        return this.data.notificationPolicy.invoiceDueHorizonDays;
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
        if (partial.taskAutomation !== undefined) {
            next.taskAutomation = sanitizeTaskAutomation(partial.taskAutomation);
        }
        if (partial.actionGovernance !== undefined) {
            next.actionGovernance = sanitizeActionGovernance(partial.actionGovernance);
        }
        if (partial.automationSwitches !== undefined) {
            next.automationSwitches = sanitizeAutomationSwitches(partial.automationSwitches);
        }
        if (partial.featureSwitches !== undefined) {
            next.featureSwitches = sanitizeFeatureSwitches(partial.featureSwitches);
        }
        if (partial.notificationPolicy !== undefined) {
            next.notificationPolicy = sanitizeNotificationPolicy(partial.notificationPolicy);
        }
        if (typeof partial.appAccessGroupId === 'string') {
            const v = partial.appAccessGroupId.trim().slice(0, 40);
            next.appAccessGroupId = v || undefined; // string vazia = desligar automação
        }
        next.version = (this.data.version || 0) + 1;
        this.data = next;
        this.save();
        return this.get();
    }

    /**
     * MERGE por-entidade do screenPermissions (Central de Permissões). Diferente do update(),
     * NÃO substitui o mapa inteiro: toca apenas os grupos/usuários presentes no delta — assim
     * dois admins editando entidades diferentes não se sobrescrevem. Regra vazia (sem hidden+
     * allowed) REMOVE a entidade (= "Herdar tudo"). Concorrência: se expectedVersion for passado
     * e não bater com a versão atual, retorna { conflict:true } sem gravar (a rota responde 409).
     * Retorna também os ids efetivamente tocados (p/ auditoria com diff).
     */
    applyScreenPermissionsDelta(
        delta: { groups?: Record<string, unknown>; users?: Record<string, unknown> },
        expectedVersion?: number,
    ): { config: UiConfig; conflict?: boolean; touched: { groups: string[]; users: string[] } } {
        if (typeof expectedVersion === 'number' && expectedVersion !== (this.data.version || 0)) {
            return { config: this.get(), conflict: true, touched: { groups: [], users: [] } };
        }
        const next: UiConfig = {
            ...this.data,
            screenPermissions: {
                groups: { ...this.data.screenPermissions.groups },
                users: { ...this.data.screenPermissions.users },
            },
        };
        const touched = { groups: [] as string[], users: [] as string[] };
        (['groups', 'users'] as const).forEach((scope) => {
            const m = delta[scope];
            if (!m || typeof m !== 'object') return;
            for (const key of Object.keys(m)) {
                const id = String(key).trim().slice(0, UI_CONFIG_LIMITS.maxIdLen);
                if (!id) continue;
                const rule = sanitizeRule((m as Record<string, unknown>)[key]);
                if (rule.hidden.length === 0 && rule.allowed.length === 0) {
                    delete next.screenPermissions[scope][id]; // sem regra = volta a herdar (remove override)
                } else {
                    next.screenPermissions[scope][id] = rule;
                }
                touched[scope].push(id);
            }
        });
        next.version = (this.data.version || 0) + 1;
        this.data = next;
        this.save();
        return { config: this.get(), touched };
    }
}

export const uiConfigService = new UiConfigService();
