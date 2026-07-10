import { Router } from 'express';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { aiJobService } from '../services/aiJobService';

// #1011: endpoint de heartbeat leve — GET /api/ai-jobs/:id/status.
//
// Independente do endpoint principal de resultado (GET /api/ai/jobs/:id, que devolve
// o payload completo). Este aqui consulta o aiJobService em memória e devolve APENAS
// metadados de liveness, sem tocar em disco nem baixar o resultado parcial. Serve para
// o cliente detectar que o job continua vivo durante tempestades de 429 (rate-limit):
// o polling de status não conta como "AI request" cara e é barato de servir.
//
// Distinção de 404: id desconhecido -> { reason: 'not_found' }; job expirado (TTL
// purgado) -> { reason: 'expired' }. O cliente diferencia "nunca existiu / foi GC'd"
// de "existiu mas expirou", sem confundir os dois.

const router = Router();

// Mesmo auth do endpoint principal de jobs (GET /api/ai/jobs/:id exige login).
router.use(requireDolibarrLogin);

router.get('/:id/status', (req, res) => {
    const lookup = aiJobService.getJobStatus(req.params.id);
    if (!lookup.ok) {
        // 404 distinto por `reason`: 'not_found' (id desconhecido) vs 'expired' (TTL).
        return res.status(404).json({ reason: lookup.reason === 'expired' ? 'expired' : 'not_found' });
    }
    res.status(200).json(lookup.status);
});

export default router;
