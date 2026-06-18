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
    bank: z.enum(['inter', 'itau']),
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

// POST /api/banking/credentials — salva (clientSecret cifrado) e aplica em runtime.
router.post('/credentials', (req: Request, res: Response) => {
    try {
        const parsed = CredsSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validação falhou', issues: parsed.error.issues });
        }
        const { bank, clientId, clientSecret, environment, contaCorrente, agencia } = parsed.data;

        const patch: Record<string, unknown> = {};
        if (clientId !== undefined) patch.clientId = clientId;
        if (clientSecret) patch.clientSecret = clientSecret; // vazio/ausente PRESERVA o existente
        if (environment !== undefined) patch.sandbox = environment === 'sandbox';
        if (contaCorrente !== undefined) patch.contaCorrente = contaCorrente;
        if (agencia !== undefined) patch.agencia = agencia;

        bankingCredentialsStore.setCredentials(bank, patch, (req as any).user?.login);
        reload(bank);

        // NUNCA retorna o secret — apenas flags de status.
        return res.json(bankingCredentialsStore.getStatus(bank));
    } catch (e: any) {
        log.error('Erro ao salvar credenciais bancárias', { error: e?.message });
        return res.status(500).json({ error: e?.message || 'Erro ao salvar credenciais' });
    }
});

// GET /api/banking/credentials/status — só flags; nunca o secret.
router.get('/credentials/status', (req: Request, res: Response) => {
    try {
        const bank = req.query.bank as string | undefined;
        if (bank === 'inter' || bank === 'itau') {
            return res.json(bankingCredentialsStore.getStatus(bank));
        }
        return res.json({
            inter: bankingCredentialsStore.getStatus('inter'),
            itau: bankingCredentialsStore.getStatus('itau'),
        });
    } catch (e: any) {
        return res.status(500).json({ error: e?.message || 'Erro ao ler status' });
    }
});

// DELETE /api/banking/credentials/:bank — remove do store (volta ao fallback do .env).
router.delete('/credentials/:bank', (req: Request, res: Response) => {
    try {
        const bank = req.params.bank;
        if (bank !== 'inter' && bank !== 'itau') {
            return res.status(400).json({ error: 'bank inválido' });
        }
        bankingCredentialsStore.clearCredentials(bank);
        reload(bank);
        return res.json(bankingCredentialsStore.getStatus(bank));
    } catch (e: any) {
        return res.status(500).json({ error: e?.message || 'Erro ao remover credenciais' });
    }
});

export default router;
