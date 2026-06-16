/**
 * UI Config Routes — leitura por qualquer usuário logado; escrita só admin.
 * GET  /api/ui-config  -> config de UI da organização (branding/tema)
 * PUT  /api/ui-config  -> admin atualiza o padrão da organização
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { uiConfigService } from '../services/uiConfigService';
import { requireDolibarrLogin, requireDolibarrAdmin } from '../middleware/authMiddleware';
import { adminAuditService } from '../services/adminAuditService';
import { createLogger } from '../utils/logger';

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
        const updated = uiConfigService.update(data as any);
        log.info('UI config da organização atualizado por admin');
        const adminUser = (req as any).user || {};
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

export default router;
