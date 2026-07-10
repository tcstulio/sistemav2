import { Router } from 'express';
import { z } from 'zod';
import { requireDolibarrLogin, requireDolibarrAdmin } from '../middleware/authMiddleware';
import { agentPromptStore, AgentPromptActor } from '../services/agentPromptStore';
import { createLogger } from '../utils/logger';

const log = createLogger('AgentConfigRoutes');
const router = Router();

function isAdmin(req: any): boolean {
    const a = req?.user?.admin;
    return a === '1' || a === 1 || a === true;
}

function actorFrom(req: any): AgentPromptActor {
    const u = req?.user || {};
    const name = [u.firstname, u.lastname].filter(Boolean).join(' ') || u.login || 'unknown';
    return {
        id: String(u.id || u.login || 'unknown'),
        login: String(u.login || 'unknown'),
        name,
    };
}

/**
 * GET /api/agent/config — retorna o system prompt atual, o padrão e o histórico.
 * Leitura liberada para qualquer logado; `canEdit` reflete se o usuário é admin.
 */
router.get('/config', requireDolibarrLogin, (req, res) => {
    try {
        res.json(agentPromptStore.getSnapshot(isAdmin(req)));
    } catch (e: any) {
        log.error('Falha ao ler agent config', e.message);
        res.status(500).json({ error: e.message });
    }
});

const UpdateConfigSchema = z.object({
    systemPrompt: z.string().min(1).max(20000).optional(),
    restoreDefault: z.boolean().optional(),
}).refine(
    d => d.restoreDefault === true || (typeof d.systemPrompt === 'string' && d.systemPrompt.trim().length > 0),
    { message: 'Forneça systemPrompt não-vazio ou restoreDefault=true.' },
);

/**
 * PUT /api/agent/config — salva nova versão do system prompt (admin only).
 * Auditoria: registra quem/alterou/quando e o conteúdo anterior no histórico
 * (últimas 5). Aceita { systemPrompt } ou { restoreDefault: true }.
 */
router.put('/config', requireDolibarrLogin, requireDolibarrAdmin, (req, res) => {
    let patch: z.infer<typeof UpdateConfigSchema>;
    try {
        patch = UpdateConfigSchema.parse(req.body);
    } catch (e: any) {
        if (e instanceof z.ZodError) {
            return res.status(400).json({ error: 'Config inválida', details: e.issues });
        }
        return res.status(400).json({ error: e.message });
    }

    try {
        const actor = actorFrom(req);
        const snapshot = patch.restoreDefault
            ? agentPromptStore.restoreDefault(actor, true)
            : agentPromptStore.update(patch.systemPrompt!, actor, true);
        res.json(snapshot);
    } catch (e: any) {
        log.error('Falha ao salvar agent config', e.message);
        res.status(500).json({ error: e.message });
    }
});

export default router;
