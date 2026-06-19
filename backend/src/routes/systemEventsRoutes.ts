import { Router, Request } from 'express';
import { z } from 'zod';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { systemEventsService, getAllowedSources, SystemEventSource, SystemUser } from '../services/systemEventsService';
import { createLogger } from '../utils/logger';

const log = createLogger('SystemEventsRoutes');
const router = Router();

router.use(requireDolibarrLogin);

const VALID_SOURCES = ['audit', 'agent', 'delegation', 'notification', 'scheduler', 'approval', 'task'];

function resolveUser(req: Request): SystemUser {
    const u = (req as any).user || {};
    const isAdmin = u.admin === '1' || u.admin === 1 || u.admin === true;
    const name = [u.firstname, u.lastname].filter(Boolean).join(' ') || u.login || String(u.id || '');
    return { id: String(u.id || u.login || ''), login: u.login || '', name, isAdmin };
}

const QuerySchema = z.object({
    sources: z.string().optional(),
    type: z.string().optional(),
    actor: z.string().optional(),
    search: z.string().optional(),
    dateFrom: z.coerce.number().optional(),
    dateTo: z.coerce.number().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
});

// Feed unificado dos eventos do sistema (visibilidade por usuário; admin vê tudo). (#519)
router.get('/', async (req, res) => {
    try {
        const q = QuerySchema.parse(req.query);
        const user = resolveUser(req);
        const sources = q.sources
            ? (q.sources.split(',').map((s) => s.trim()).filter((s) => VALID_SOURCES.includes(s)) as SystemEventSource[])
            : undefined;
        const result = await systemEventsService.query({
            user, sources,
            type: q.type, actor: q.actor, search: q.search,
            dateFrom: q.dateFrom, dateTo: q.dateTo, limit: q.limit, offset: q.offset,
        });
        res.json(result);
    } catch (e: any) {
        if (e instanceof z.ZodError) return res.status(400).json({ error: 'Parâmetros inválidos', details: e.issues });
        log.error('GET /system-events error', e?.message);
        res.status(500).json({ error: e.message });
    }
});

// Fontes que o usuário logado pode ver — para montar os chips de filtro no frontend.
router.get('/sources', (req, res) => {
    try {
        res.json({ sources: getAllowedSources(resolveUser(req)) });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
