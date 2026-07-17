import { Router } from 'express';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { describeConfirm, executeConfirm } from '../services/agentActionConfirm';
import { agentActivityService } from '../services/agentActivityService';
import { createLogger } from '../utils/logger';

const log = createLogger('AgentActionRoutes');
const router = Router();

// HITL de ação irreversível (robô-de-negócio §8.1): a tela /confirm-action usa estas rotas.
router.use(requireDolibarrLogin);

/** Verifica o token e devolve a descrição legível (SEM executar) — alimenta a tela de confirmação. */
router.post('/describe', (req, res) => {
    const token = (req.body || {}).token;
    if (!token) return res.status(400).json({ ok: false, error: 'token ausente' });
    res.json(describeConfirm(String(token)));
});

/** Confirma e EXECUTA a ação com a chave DO USUÁRIO logado (RBAC real). Anti-replay por jti. */
router.post('/execute', async (req, res) => {
    const token = (req.body || {}).token;
    if (!token) return res.status(400).json({ ok: false, error: 'token ausente' });

    // requireDolibarrLogin já resolveu a chave EFETIVA do usuário (sessão → dolapikey real) neste header.
    const userKey = req.headers['dolapikey'] as string;
    // Ator LOGADO (da sessão) — o executeConfirm exige que bata com o actorUserId do token (D).
    const user = (req as any).user || {};
    const sessionUserId = String(user.id || '');
    const r = await executeConfirm(String(token), sessionUserId, userKey);

    if (r.ok) {
        // Trilha (F0.3): registra a execução CONFIRMADA com o ator logado.
        try {
            agentActivityService.record({
                userId: String(user.id || user.login || ''),
                userName: [user.firstname, user.lastname].filter(Boolean).join(' ') || user.login || 'Usuário',
                tool: r.action,
                args: {},
                result: 'confirmado',
                requestedVia: 'chat',
            });
        } catch (e: any) {
            log.warn('Falha ao registrar a trilha da confirmação (não-fatal)', e?.message);
        }
    }

    res.status(r.ok ? 200 : 400).json(r);
});

export default router;
