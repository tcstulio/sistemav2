/**
 * User Routes — endpoints de perfil do próprio usuário logado.
 *
 * GET /api/users/me -> perfil do usuário autenticado (WHITELIST de campos).
 *
 * Segurança (#1003 / padrão do PR #1007): NUNCA devolvemos o objeto Dolibarr cru,
 * pois ele pode conter `api_key` e outros dados sensíveis. `buildMeResponse` expõe
 * apenas os campos da whitelist + o celular resolvido (phone_mobile || user_mobile).
 */
import { Router, Request, Response } from 'express';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { createLogger } from '../utils/logger';
import { resolveUserMobile } from '../utils/userMobile';

const log = createLogger('User');
const router = Router();

type DolibarrRawUser = Record<string, unknown>;
type AuthedRequest = Request & { user?: DolibarrRawUser | null };

/**
 * Whitelist de campos do usuário Dolibarr que DEVOLVEMOS no /me.
 * Qualquer campo fora desta lista (api_key, pass, pass_crypted, etc.) é descartado.
 */
const ME_FIELDS = [
    'id',
    'login',
    'firstname',
    'lastname',
    'email',
    'job',
    'office_phone',
    'photo',
    'statut',
    'admin',
    'supervisor_id',
    'address',
    'zip',
    'town',
    'state_id',
    'country_id',
    'note_public',
    'color',
    'date_modification',
] as const;

export type MeField = (typeof ME_FIELDS)[number];

export interface MeResponse {
    id: string | number;
    login: string;
    firstname?: string;
    lastname?: string;
    email?: string;
    phone_mobile?: string;
    job?: string;
    office_phone?: string;
    photo?: string;
    statut?: string | number;
    admin?: unknown;
    supervisor_id?: string;
    address?: string;
    zip?: string;
    town?: string;
    state_id?: string;
    country_id?: string;
    note_public?: string;
    color?: string;
    date_modification?: number;
    [key: string]: unknown;
}

/**
 * Constrói a resposta de /me a partir do usuário Dolibarr cru usando WHITELIST.
 * Garante que `api_key` (e qualquer campo fora da lista) jamais seja exposto, e
 * resolve o celular via regra única `phone_mobile || user_mobile` (#1003).
 */
export function buildMeResponse(user: DolibarrRawUser | null | undefined): MeResponse | null {
    if (!user) return null;
    // Construímos como Record<string, unknown> para que a escrita `me[field]` (com
    // `field` sendo união de literais) não dispare TS2322 — ao final tipamos como MeResponse.
    const me: Record<string, unknown> = { id: user.id, login: user.login };
    for (const field of ME_FIELDS) {
        if (field === 'id' || field === 'login') continue;
        const value = user[field];
        if (value !== undefined && value !== null) {
            me[field] = value;
        }
    }
    const mobile = resolveUserMobile(user);
    if (mobile) me.phone_mobile = mobile;
    return me as MeResponse;
}

/**
 * GET /api/users/me
 * Perfil do usuário logado (whitelist — sem api_key).
 */
router.get('/me', requireDolibarrLogin, (req: Request, res: Response) => {
    try {
        const user = (req as AuthedRequest).user;
        const me = buildMeResponse(user);
        if (!me) {
            return res.status(401).json({ status: 'error', message: 'Usuário não autenticado.' });
        }
        res.json(me);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Erro ao buscar usuário.';
        log.error('GET /me error', msg);
        res.status(500).json({ status: 'error', message: msg });
    }
});

export default router;
