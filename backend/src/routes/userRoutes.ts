/**
 * User Routes — dados do usuário logado (#1003).
 *
 * GET /api/users/me expõe um recorte do perfil Dolibarr do usuário autenticado,
 * mapeando phone_mobile (celular) e fax — antes descartados pela integração, que
 * só repassava o telefone fixo. Whitelist explícita de campos: nunca vaza api_key,
 * senha nem demais campos sensíveis do objeto cru do Dolibarr.
 */
import { Router, Request, Response } from 'express';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { createLogger } from '../utils/logger';

const log = createLogger('UserRoutes');
const router = Router();

router.use(requireDolibarrLogin);

/**
 * Monta o JSON de /me a partir do usuário em req.user (populado pelo
 * requireDolibarrLogin via getUserByKey). Celular vem de phone_mobile, com
 * fallback p/ user_mobile (alias que o Dolibarr usa em alguns endpoints).
 */
function buildMeResponse(user: any) {
    const mobile = user?.phone_mobile || user?.user_mobile || null;
    return {
        id: user?.id ?? null,
        login: user?.login ?? null,
        firstname: user?.firstname ?? null,
        lastname: user?.lastname ?? null,
        email: user?.email ?? null,
        job: user?.job ?? null,
        // Telefone fixo (office_phone é o campo nativo; alguns endpoints trazem só `phone`).
        phone: user?.office_phone || user?.phone || null,
        // Celular — campo central desta tarefa (#1003).
        phone_mobile: mobile,
        fax: user?.fax ?? null,
        photo: user?.photo ?? null,
        statut: user?.statut ?? null,
        admin: user?.admin ?? null,
    };
}

// GET /api/users/me — perfil do usuário autenticado (inclui phone_mobile e fax).
router.get('/me', (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user || (!user.id && !user.login)) {
        log.warn('GET /me sem usuário autenticado em req.user');
        return res.status(401).json({ error: 'Usuário não autenticado.' });
    }
    res.json(buildMeResponse(user));
});

export default router;
