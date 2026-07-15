/**
 * UI Config Routes — leitura por qualquer usuário logado; escrita só admin.
 * GET  /api/ui-config  -> config de UI da organização (branding/tema)
 * PUT  /api/ui-config  -> admin atualiza o padrão da organização
 * GET  /api/ui-config/admin/users-missing-phone -> diagnóstico de usuários sem telefone (admin)
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { uiConfigService } from '../services/uiConfigService';
import { taskRunnerService } from '../services/taskRunnerService';
import { requireDolibarrLogin, requireDolibarrAdmin } from '../middleware/authMiddleware';
import { adminAuditService } from '../services/adminAuditService';
import { createLogger } from '../utils/logger';
import { resolveUserMobile } from '../utils/userMobile';
import axios from 'axios';
import { config as envConfig } from '../config/env';

const log = createLogger('UiConfig');
const router = Router();

const PrefsSchema = z.object({
    hidden: z.array(z.string()).optional(),
    order: z.array(z.string()).optional(),
}).optional();

// #112 — mapa de permissões de tela; sanitização final fica no service (sanitizeScreenPermissions).
const RuleSchema = z.object({
    hidden: z.array(z.string()).optional(),
    allowed: z.array(z.string()).optional(),
});
const ScreenPermissionsSchema = z.object({
    groups: z.record(z.string(), RuleSchema).optional(),
    users: z.record(z.string(), RuleSchema).optional(),
}).optional();

// #113 — telas customizadas; sanitização final fica no service (sanitizeCustomPages).
const CustomPagesSchema = z.array(z.any()).optional();

// #348 — matriz de notificações de tarefa (evento × papel × canais)
const NotifChannelsSchema = z.array(z.enum(['in-app', 'whatsapp', 'email'])).optional();
const TaskNotifRoleSchema = z.object({
    responsavel: NotifChannelsSchema,
    interveniente: NotifChannelsSchema,
    criador: NotifChannelsSchema,
}).optional();
const TaskNotificationsSchema = z.object({
    assigned: TaskNotifRoleSchema,
    acceptance_pending: TaskNotifRoleSchema,
    acceptance_overdue: TaskNotifRoleSchema,
    deadline_reminder: TaskNotifRoleSchema,
    overdue: TaskNotifRoleSchema,
    stalled: TaskNotifRoleSchema,
    completed: TaskNotifRoleSchema,
    comment: TaskNotifRoleSchema,
}).optional();

const UpdateSchema = z.object({
    companyName: z.string().min(1).max(100).optional(),
    logoText: z.string().min(1).max(8).optional(),
    logoUrl: z.string().max(500).optional(),
    themeColor: z.string().optional(),
    menu: PrefsSchema,
    dashboard: PrefsSchema,
    screenPermissions: ScreenPermissionsSchema,
    customPages: CustomPagesSchema,
    taskNotifications: TaskNotificationsSchema,
    taskNotificationsExternalEnabled: z.boolean().optional(),
    taskAutomation: z.object({
        autoPlay: z.boolean().optional(),
        autoMerge: z.boolean().optional(),
        autoDecompose: z.boolean().optional(),
        minMergeScore: z.number().min(1).max(10).optional(),
        minApproveScore: z.number().min(1).max(10).optional(),
        // #1154: rodadas/tetos de custo — validação de faixa fica no sanitizeTaskAutomation (clampa).
        // Se não forem listados aqui o Zod ESTRIPA as chaves → o save do editor reseta p/ os defaults.
        maxJudgeRounds: z.number().optional(),
        maxGateFixRounds: z.number().optional(),
        maxRoundsPerTask: z.number().optional(),
        dailyRoundBudget: z.number().optional(),
        // #1411/#1443: juiz Claude-first configurável. Sem isto, o Zod estripa o campo e o
        // save do editor volta p/ '' (cadeia do chat). Rota valida só o tipo (string) —
        // alinhado com o padrão actionGovernance/notificationPolicy (#1207/#1293): o cap
        // 60 fica no service (sanitizeTaskAutomation → .slice(0, 60)), que TRUNCA em vez
        // de rejeitar (AC#3: '>60 chars → sanitize corta pra 60 sem quebrar a validação').
        judgeModel: z.string().optional(),
    }).optional(),
    // #1207: governança de ações irreversíveis — só valida forma/tipos aqui; o sanitize real
    // (clamp de threshold, filtragem de allowlist por dígitos, etc.) fica no service.
    // Bug #1195: o Zod estripa chaves não listadas, então declarar os 4 campos explicitamente.
    actionGovernance: z.object({
        irreversibleRequiresApproval: z.boolean(),
        adminBypassIrreversible: z.boolean(),
        approvalValueThreshold: z.number().nullable(),
        whatsappDestinationAllowlist: z.array(z.string()),
    }).optional(),
    // Grupo Dolibarr p/ "Habilitar acesso ao app" (sem isto o Zod descartaria o campo e o save não persistiria).
    appAccessGroupId: z.string().max(40).optional(),
    // #1439 — sessionId primário do WhatsApp (default global p/ scheduler). Trim + cap no service.
    // Zod precisa declarar a chave p/ ela sobreviver ao .parse() e chegar ao sanitize.
    whatsappPrimarySessionId: z.string().max(80).optional(),
    // #1440 — política de fallback da sessão primária. O #1437 declarou o campo no service+sanitize mas
    // ESQUECEU o Zod da rota → o .parse() estripava a chave e o save da política era NO-OP (bug #1443).
    whatsappFallbackPolicy: z.enum(['fail', 'first-working']).optional(),
    // #1204: kill-switches de automações de fundo (schedulerService / alertCronService). O Zod precisa
    // declarar o objeto p/ os flags sobreviverem ao .parse() e chegarem ao service (senão são estripados).
    automationSwitches: z.object({
        schedulerEnabled: z.boolean().optional(),
        alertCronEnabled: z.boolean().optional(),
    }).optional(),
    // #1129: kill-switches perigosos (DRY_RUN / FINANCIAL_COMMANDS / CRM_CONTEXT). Zod declara o
    // objeto p/ os 3 flags sobreviverem ao .parse() e chegarem intactos ao service.
    featureSwitches: z.object({
        dryRunMode: z.boolean().optional(),
        financialCommands: z.boolean().optional(),
        crmContextInjection: z.boolean().optional(),
    }).optional(),
    // #1293: política de notificações (cadência/quiet-hours/alertas). Sanitização final (clamp de
    // faixas, validação de HH:mm) fica no service; o Zod só declara a forma p/ os campos sobreviverem.
    notificationPolicy: z.object({
        cobrancaCadence: z.object({
            reminderDaysBefore: z.number().optional(),
            recobrancaIntervalDays: z.number().optional(),
            escalateAfterCobrancas: z.number().optional(),
            prazoDeAceiteDays: z.number().optional(),
        }).optional(),
        quietHours: z.object({
            whatsapp: z.object({
                enabled: z.boolean().optional(),
                startHHmm: z.string().optional(),
                endHHmm: z.string().optional(),
                weekdaysOnly: z.boolean().optional(),
            }).optional(),
            email: z.object({
                enabled: z.boolean().optional(),
                startHHmm: z.string().optional(),
                endHHmm: z.string().optional(),
                weekdaysOnly: z.boolean().optional(),
            }).optional(),
            'in-app': z.object({
                enabled: z.boolean().optional(),
                startHHmm: z.string().optional(),
                endHHmm: z.string().optional(),
                weekdaysOnly: z.boolean().optional(),
            }).optional(),
        }).optional(),
        staleHours: z.number().optional(),
        invoiceDueHorizonDays: z.number().optional(),
    }).optional(),
});

// Leitura: qualquer usuário logado (p/ renderizar branding/tema da org).
router.get('/', requireDolibarrLogin, (_req: Request, res: Response) => {
    res.json(uiConfigService.get());
});

// Escrita: somente admin (define o padrão da organização).
router.put('/', requireDolibarrAdmin, (req: Request, res: Response) => {
    try {
        const data = UpdateSchema.parse(req.body);
        // #1168: captura o piso de merge ANTES do save p/ detectar baixa e destravar holds de score
        // de tasks 'approved' que estavam retidas (o mergeHoldReason persistia e o resumePendingMerges as pulava).
        const prevMinMerge = (data.taskAutomation && typeof data.taskAutomation.minMergeScore === 'number')
            ? uiConfigService.get().taskAutomation.minMergeScore
            : undefined;
        // #1129: captura o valor ANTES do save p/ detectar mudança no kill-switch financeiro (get()
        // depois do update() devolveria o novo estado e a auditoria nunca dispararia).
        const prevFinancial = uiConfigService.get().featureSwitches?.financialCommands;
        const updated = uiConfigService.update(data as any);
        // #1168: baixar o minMergeScore destrava tasks 'approved' retidas por score p/ re-avaliação.
        // Holds por outros motivos (auto-merge off) são preservados pelo próprio método (mergeHoldKind !== 'score').
        if (prevMinMerge !== undefined && updated.taskAutomation.minMergeScore < prevMinMerge) {
            taskRunnerService.onMinMergeScoreLowered(prevMinMerge, updated.taskAutomation.minMergeScore);
        }
        // #1129: mudança no kill-switch de comandos financeiros (/pagar,/pix) gera trilha de auditoria
        // explícita — movimenta dinheiro real, precisa registrar quem acionou em incidente.
        const adminUser = (req as any).user || {};
        const nextFinancial = data.featureSwitches && typeof (data.featureSwitches as any).financialCommands === 'boolean'
            ? updated.featureSwitches.financialCommands
            : undefined;
        if (nextFinancial !== undefined && nextFinancial !== prevFinancial) {
            adminAuditService.record({
                adminId: String(adminUser.id || 'unknown'),
                adminLogin: String(adminUser.login || 'unknown'),
                action: 'ui-config.feature-switches.financial',
                target: 'financialCommands',
                summary: `Comandos financeiros (/pagar,/pix) ${nextFinancial ? 'HABILITADOS' : 'DESABILITADOS'} por admin`,
                changes: { financialCommands: { before: prevFinancial, after: nextFinancial } },
            });
        }
        log.info('UI config da organização atualizado por admin');
        adminAuditService.record({
            adminId: String(adminUser.id || 'unknown'),
            adminLogin: String(adminUser.login || 'unknown'),
            action: 'ui-config.update',
            summary: `Config de UI da organização atualizada (${Object.keys(data).join(', ') || 'sem alterações'})`,
        });
        res.json(updated);
    } catch (e: any) {
        res.status(400).json({ error: e?.message || 'Dados inválidos' });
    }
});

// Central de Permissões — MERGE por-entidade do screenPermissions (delta), com concorrência.
// Diferente do PUT (substitui tudo), só toca os grupos/usuários enviados — seguro p/ edição
// em massa por vários admins. expectedVersion: a versão que a UI leu (409 se mudou no meio).
const ScreenPermsDeltaSchema = z.object({
    delta: z.object({
        groups: z.record(z.string(), RuleSchema).optional(),
        users: z.record(z.string(), RuleSchema).optional(),
    }),
    expectedVersion: z.number().int().optional(),
});

router.patch('/screen-permissions', requireDolibarrAdmin, (req: Request, res: Response) => {
    try {
        const { delta, expectedVersion } = ScreenPermsDeltaSchema.parse(req.body);
        const before = uiConfigService.get().screenPermissions;
        const result = uiConfigService.applyScreenPermissionsDelta(delta as any, expectedVersion);
        if (result.conflict) {
            return res.status(409).json({
                error: 'conflict',
                message: 'A configuração mudou desde que você carregou. Recarregue e tente novamente.',
                config: result.config,
            });
        }
        // Auditoria com diff por-entidade (só os ids tocados) — reversível/visível.
        const after = result.config.screenPermissions;
        const changes: Record<string, { before: unknown; after: unknown }> = {};
        (['groups', 'users'] as const).forEach((scope) => {
            for (const id of result.touched[scope]) {
                changes[`${scope}:${id}`] = { before: (before as any)[scope][id] || null, after: (after as any)[scope][id] || null };
            }
        });
        const adminUser = (req as any).user || {};
        adminAuditService.record({
            adminId: String(adminUser.id || 'unknown'),
            adminLogin: String(adminUser.login || 'unknown'),
            action: 'ui-config.screen-permissions',
            summary: `Permissões de tela alteradas: ${result.touched.groups.length} grupo(s), ${result.touched.users.length} usuário(s)`,
            changes,
        });
        res.json(result.config);
    } catch (e: any) {
        res.status(400).json({ error: e?.message || 'Dados inválidos' });
    }
});

/**
 * GET /api/ui-config/admin/users-missing-phone
 * Admin-only: lista todos os usuários ativos do Dolibarr que não têm phone_mobile nem user_mobile.
 * Útil para diagnosticar quem não receberá notificações via WhatsApp.
 * Pagina automaticamente para não fazer N+1 caro.
 */
router.get('/admin/users-missing-phone', requireDolibarrAdmin, async (req: Request, res: Response) => {
    try {
        // dolibarrUrl já inclui /api/index.php (ex.: https://sistema.coolgroove.com.br/api/index.php)
        const baseUrl = (envConfig.dolibarrUrl || '').replace(/\/$/, '') + '/';
        const doliKey = envConfig.dolibarrKey;
        if (!baseUrl || !doliKey) {
            return res.status(503).json({ error: 'Dolibarr não configurado' });
        }

        const PAGE_SIZE = 100;
        let page = 0;
        let allUsers: any[] = [];
        let keepGoing = true;

        while (keepGoing) {
            const response = await axios.get(`${baseUrl}users`, {
                headers: { DOLAPIKEY: doliKey },
                params: { limit: PAGE_SIZE, page, sqlfilters: '(t.statut:=:1)' },
                validateStatus: (s) => s === 200,
            });
            const batch: any[] = Array.isArray(response.data) ? response.data : [];
            allUsers = allUsers.concat(batch);
            keepGoing = batch.length === PAGE_SIZE;
            page++;
            // Proteção contra loops infinitos em instâncias Dolibarr muito grandes
            if (page > 50) break;
        }

        const missing = allUsers
            .filter(u => {
                const mobile = resolveUserMobile(u) || '';
                return !mobile;
            })
            .map(u => ({
                id: u.id,
                login: u.login,
                name: [u.firstname, u.lastname].filter(Boolean).join(' ') || u.login,
                email: u.email || null,
            }));

        res.json({ total: allUsers.length, missingCount: missing.length, users: missing });
    } catch (e: any) {
        log.error('GET /admin/users-missing-phone error', e.message);
        res.status(500).json({ error: e?.message || 'Erro ao buscar usuários' });
    }
});

export default router;
