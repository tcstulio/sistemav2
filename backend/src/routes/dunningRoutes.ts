/**
 * dunningRoutes.ts — issue #1403 (parent epic #1400).
 *
 * Rota READ-ONLY fina sobre `dunningService.buildDunningDigest` para a tela `/dunning`.
 *
 * Princípios:
 *   - Apenas GET é aceito. Qualquer outro método (POST/PUT/PATCH/DELETE/...)
 *     responde 405 — essa superfície NUNCA pode virar porta de saída
 *     (blast-radius zero, mesma filosofia do `dunningService`).
 *   - Auth obrigatória (requireDolibarrLogin) — a tela consome dados financeiros
 *     sensíveis (faturas em aberto), mesma proteção do resto do backend.
 *   - Sem persistência: o digest é recalculado a cada GET. Cache/cron ficam
 *     em camada de service (issue posterior), não aqui.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { buildDunningDigest } from '../services/dunningService';
import { createLogger } from '../utils/logger';

const log = createLogger('DunningRoutes');
const router = Router();

router.use(requireDolibarrLogin);

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const QuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
    socid: z.string().min(1).max(64).optional(),
});

router.get('/', async (req: Request, res: Response) => {
    try {
        const q = QuerySchema.parse(req.query);
        const limit = q.limit ?? DEFAULT_LIMIT;
        const digest = await buildDunningDigest({ limit, socid: q.socid });
        log.info('dunning digest gerado', { limit, socid: q.socid ?? null, totalItems: digest.totalItems });
        res.json(digest);
    } catch (e: any) {
        if (e instanceof z.ZodError) {
            return res.status(400).json({ error: 'Parâmetros inválidos', details: e.issues });
        }
        log.error('Erro ao montar dunning digest', { err: e?.message || String(e) });
        res.status(500).json({ error: e?.message || 'Erro interno' });
    }
});

// Blast-radius zero (#1403): qualquer método não-GET vira 405. Garante que esta
// superfície NUNCA vire porta de saída (não escreve em lugar nenhum, não
// dispara nada externo). `router.all` cobre POST/PUT/PATCH/DELETE/HEAD/etc.
router.all('/', (_req: Request, res: Response) => {
    res.status(405).json({ error: 'method_not_allowed' });
});

export default router;