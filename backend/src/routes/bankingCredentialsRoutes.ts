import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireDolibarrAdmin } from '../middleware/authMiddleware';
import { bankingCredentialsStore, BankId } from '../services/bankingCredentialsStore';
import { interApiService } from '../services/interApiService';
import { itauApiService } from '../services/itauApiService';
import { createLogger } from '../utils/logger';

const log = createLogger('BankingCredentials');
const router = Router();

// Gravar/ler credenciais bancárias é sensível — todas as rotas exigem admin.
router.use(requireDolibarrAdmin);

const CredsSchema = z.object({
    bank: z.enum(['inter', 'itau']).optional(),
    clientId: z.string().trim().min(1).max(200).optional(),
    clientSecret: z.string().trim().min(1).max(500).optional(),
    environment: z.enum(['sandbox', 'production']).optional(),
    contaCorrente: z.string().trim().max(20).optional(), // só Itaú
    agencia: z.string().trim().max(10).optional(),        // só Itaú
});

/** Aplica as credenciais novas em runtime (sem reiniciar o processo). */
function reload(bank: BankId): void {
    (bank === 'inter' ? interApiService : itauApiService).reloadCredentials();
}

// ── Handlers reutilizáveis ───────────────────────────────────────────────────

function handleSave(req: Request, res: Response, bank?: BankId): Response | void {
    try {
        const body = bank
            ? { bank, ...(req.body || {}) }
            : req.body;
        const parsed = CredsSchema.safeParse(body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validação falhou', issues: parsed.error.issues });
        }
        const { clientId, clientSecret, environment, contaCorrente, agencia } = parsed.data;
        const b: BankId | undefined = parsed.data.bank;
        if (!b) {
            return res.status(400).json({ error: 'bank é obrigatório' });
        }

        const patch: Record<string, unknown> = {};
        if (clientId !== undefined) patch.clientId = clientId;
        if (clientSecret) patch.clientSecret = clientSecret; // vazio/ausente PRESERVA o existente
        if (environment !== undefined) patch.sandbox = environment === 'sandbox';
        if (contaCorrente !== undefined) patch.contaCorrente = contaCorrente;
        if (agencia !== undefined) patch.agencia = agencia;

        bankingCredentialsStore.setCredentials(b, patch, (req as any).user?.login);
        reload(b);

        // NUNCA retorna o secret — apenas flags de status.
        return res.json(bankingCredentialsStore.getStatus(b));
    } catch (e: any) {
        log.error('Erro ao salvar credenciais bancárias', { error: e?.message });
        return res.status(500).json({ error: e?.message || 'Erro ao salvar credenciais' });
    }
}

function handleStatus(req: Request, res: Response, bank?: BankId): Response | void {
    try {
        if (bank) {
            return res.json(bankingCredentialsStore.getStatus(bank));
        }
        const q = req.query.bank as string | undefined;
        if (q === 'inter' || q === 'itau') {
            return res.json(bankingCredentialsStore.getStatus(q));
        }
        return res.json({
            inter: bankingCredentialsStore.getStatus('inter'),
            itau: bankingCredentialsStore.getStatus('itau'),
        });
    } catch (e: any) {
        return res.status(500).json({ error: e?.message || 'Erro ao ler status' });
    }
}

function handleDelete(_req: Request, res: Response, bank: BankId): Response | void {
    try {
        bankingCredentialsStore.clearCredentials(bank);
        reload(bank);
        return res.json(bankingCredentialsStore.getStatus(bank));
    } catch (e: any) {
        return res.status(500).json({ error: e?.message || 'Erro ao remover credenciais' });
    }
}

// ── Rotas unificadas (bank no body/query/param) ─────────────────────────────

// POST /api/banking/credentials — salva (clientSecret cifrado) e aplica em runtime.
router.post('/credentials', (req, res) => handleSave(req, res, undefined));

// GET /api/banking/credentials/status — só flags; nunca o secret.
router.get('/credentials/status', (req, res) => handleStatus(req, res, undefined));

// DELETE /api/banking/credentials/:bank — remove do store (volta ao fallback do .env).
router.delete('/credentials/:bank', (req: Request, res: Response) => {
    const bank = req.params.bank as BankId;
    if (bank !== 'inter' && bank !== 'itau') {
        return res.status(400).json({ error: 'bank inválido' });
    }
    return handleDelete(req, res, bank);
});

// ── Rotas per-bank (issue #988: POST /banking/itau/credentials, /inter/credentials) ─

router.post('/itau/credentials', (req, res) => handleSave(req, res, 'itau'));
router.get('/itau/credentials/status', (req, res) => handleStatus(req, res, 'itau'));
router.delete('/itau/credentials', (req, res) => handleDelete(req, res, 'itau'));

router.post('/inter/credentials', (req, res) => handleSave(req, res, 'inter'));
router.get('/inter/credentials/status', (req, res) => handleStatus(req, res, 'inter'));
router.delete('/inter/credentials', (req, res) => handleDelete(req, res, 'inter'));

export default router;
