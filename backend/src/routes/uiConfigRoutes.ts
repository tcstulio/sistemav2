/**
 * UI Config Routes — leitura por qualquer usuário logado; escrita só admin.
 * GET  /api/ui-config  -> config de UI da organização (branding/tema)
 * PUT  /api/ui-config  -> admin atualiza o padrão da organização
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { uiConfigService } from '../services/uiConfigService';
import { requireDolibarrLogin, requireDolibarrAdmin } from '../middleware/authMiddleware';
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

const UpdateSchema = z.object({
    companyName: z.string().min(1).max(100).optional(),
    logoText: z.string().min(1).max(8).optional(),
    logoUrl: z.string().max(500).optional(),
    themeColor: z.string().optional(),
    menu: PrefsSchema,         // #110 — ordem/visibilidade do menu
    dashboard: PrefsSchema,    // #111 — ordem/visibilidade dos widgets
    screenPermissions: ScreenPermissionsSchema,  // #112 — permissões de tela por pessoa/grupo
});

// Leitura: qualquer usuário logado (p/ renderizar branding/tema da org).
router.get('/', requireDolibarrLogin, (_req: Request, res: Response) => {
    res.json(uiConfigService.get());
});

// Escrita: somente admin (define o padrão da organização).
router.put('/', requireDolibarrAdmin, (req: Request, res: Response) => {
    try {
        const data = UpdateSchema.parse(req.body);
        const updated = uiConfigService.update(data);
        log.info('UI config da organização atualizado por admin');
        res.json(updated);
    } catch (e: any) {
        res.status(400).json({ error: e?.message || 'Dados inválidos' });
    }
});

export default router;
