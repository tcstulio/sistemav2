/**
 * Rotas de gestão de GRUPOS e DIREITOS do Dolibarr (sistemav2#820).
 *
 * A REST do Dolibarr não expõe estas escritas; o service (dolibarrService.*) proxeia o
 * custom_groups.php (admin-gated) com a chave de SERVIÇO. Aqui a ÚNICA porta de autorização é
 * requireDolibarrAdmin — garantir que continue aplicado (montado em /api/admin no server.ts).
 * Toda ação grava auditoria (adminAuditService). Montado no MESMO prefixo /api/admin que
 * adminRoutes; os paths (groups/*, users/:id/rights/*) não colidem com /users/:id/permissions.
 */
import express from 'express';
import { z } from 'zod';
import { requireDolibarrAdmin } from '../middleware/authMiddleware';
import { dolibarrService } from '../services/dolibarrService';
import { adminAuditService } from '../services/adminAuditService';
import { createLogger } from '../utils/logger';

const log = createLogger('Groups');
const router = express.Router();

router.use(requireDolibarrAdmin);

const GroupBody = z.object({
    name: z.string().min(1, 'nome obrigatório').max(128),
    note: z.string().max(2000).optional(),
});
const GroupPatchBody = z.object({
    name: z.string().min(1).max(128).optional(),
    note: z.string().max(2000).optional(),
}).refine((d) => d.name !== undefined || d.note !== undefined, { message: 'informe name e/ou note' });

const posId = z.coerce.number().int().positive();

function audit(req: express.Request, action: string, target: string, summary: string) {
    const adminUser = (req as any).user || {};
    adminAuditService.record({
        adminId: String(adminUser.id || 'unknown'),
        adminLogin: String(adminUser.login || 'unknown'),
        action,
        target,
        summary,
    });
}

// Converte erro do service/zod em resposta HTTP coerente.
function fail(res: express.Response, e: any, ctx: string) {
    if (e?.name === 'ZodError') return res.status(400).json({ error: 'Validation Error', details: e.errors });
    const status = typeof e?.status === 'number' && e.status >= 400 ? e.status : 500;
    log.error(`${ctx} error`, { error: e?.message });
    return res.status(status).json({ error: e?.message || 'Falha na operação de grupo' });
}

// ---- Grupos (CRUD) ----
router.post('/groups', async (req, res) => {
    try {
        const body = GroupBody.parse(req.body);
        const result = await dolibarrService.createGroup(body);
        audit(req, 'group.create', String(result?.group_id ?? ''), `Grupo criado: ${body.name}`);
        res.json(result);
    } catch (e) { fail(res, e, 'create group'); }
});

router.put('/groups/:groupId', async (req, res) => {
    try {
        const groupId = String(posId.parse(req.params.groupId));
        const body = GroupPatchBody.parse(req.body);
        const result = await dolibarrService.updateGroup(groupId, body);
        audit(req, 'group.update', groupId, `Grupo ${groupId} atualizado`);
        res.json(result);
    } catch (e) { fail(res, e, 'update group'); }
});

router.delete('/groups/:groupId', async (req, res) => {
    try {
        const groupId = String(posId.parse(req.params.groupId));
        const result = await dolibarrService.deleteGroup(groupId);
        audit(req, 'group.delete', groupId, `Grupo ${groupId} excluído`);
        res.json(result);
    } catch (e) { fail(res, e, 'delete group'); }
});

// ---- Membros do grupo ----
router.post('/groups/:groupId/users/:userId', async (req, res) => {
    try {
        const groupId = String(posId.parse(req.params.groupId));
        const userId = String(posId.parse(req.params.userId));
        const result = await dolibarrService.addUserToGroup(groupId, userId);
        audit(req, 'group.user.add', groupId, `Usuário ${userId} adicionado ao grupo ${groupId}`);
        res.json(result);
    } catch (e) { fail(res, e, 'add group user'); }
});

router.delete('/groups/:groupId/users/:userId', async (req, res) => {
    try {
        const groupId = String(posId.parse(req.params.groupId));
        const userId = String(posId.parse(req.params.userId));
        const result = await dolibarrService.removeUserFromGroup(groupId, userId);
        audit(req, 'group.user.remove', groupId, `Usuário ${userId} removido do grupo ${groupId}`);
        res.json(result);
    } catch (e) { fail(res, e, 'remove group user'); }
});

// ---- Direitos do grupo ----
router.post('/groups/:groupId/rights/:rid', async (req, res) => {
    try {
        const groupId = String(posId.parse(req.params.groupId));
        const rid = String(posId.parse(req.params.rid));
        const result = await dolibarrService.addGroupRight(groupId, rid);
        audit(req, 'group.right.add', groupId, `Direito ${rid} concedido ao grupo ${groupId}`);
        res.json(result);
    } catch (e) { fail(res, e, 'add group right'); }
});

router.delete('/groups/:groupId/rights/:rid', async (req, res) => {
    try {
        const groupId = String(posId.parse(req.params.groupId));
        const rid = String(posId.parse(req.params.rid));
        const result = await dolibarrService.removeGroupRight(groupId, rid);
        audit(req, 'group.right.remove', groupId, `Direito ${rid} removido do grupo ${groupId}`);
        res.json(result);
    } catch (e) { fail(res, e, 'remove group right'); }
});

// ---- Direitos do usuário (override individual sobre os herdados de grupo) ----
router.post('/users/:userId/rights/:rid', async (req, res) => {
    try {
        const userId = String(posId.parse(req.params.userId));
        const rid = String(posId.parse(req.params.rid));
        const result = await dolibarrService.addUserRight(userId, rid);
        audit(req, 'user.right.add', userId, `Direito ${rid} concedido ao usuário ${userId}`);
        res.json(result);
    } catch (e) { fail(res, e, 'add user right'); }
});

router.delete('/users/:userId/rights/:rid', async (req, res) => {
    try {
        const userId = String(posId.parse(req.params.userId));
        const rid = String(posId.parse(req.params.rid));
        const result = await dolibarrService.removeUserRight(userId, rid);
        audit(req, 'user.right.remove', userId, `Direito ${rid} removido do usuário ${userId}`);
        res.json(result);
    } catch (e) { fail(res, e, 'remove user right'); }
});

export default router;
