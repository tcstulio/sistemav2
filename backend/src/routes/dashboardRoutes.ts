/**
 * Dashboard Routes — artefatos gerados (Análise Financeira, Previsão de Vendas) org-wide.
 * Qualquer usuário logado lê e pode (re)gerar — o resultado vale para todos (#124).
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { dashboardArtifactsService } from '../services/dashboardArtifactsService';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { createLogger } from '../utils/logger';

const log = createLogger('Dashboard');
const router = Router();

router.use(requireDolibarrLogin);

const who = (req: Request): string => {
    const u = (req as any).user;
    return u?.login || u?.firstname || u?.lastname || 'usuário';
};

// GET /api/dashboard/artifacts — últimos resultados gerados (ou null).
router.get('/artifacts', (_req: Request, res: Response) => {
    res.json(dashboardArtifactsService.get());
});

// PUT /api/dashboard/artifacts/financial — persiste a análise financeira gerada (texto markdown).
router.put('/artifacts/financial', (req: Request, res: Response) => {
    try {
        const { text } = z.object({ text: z.string().min(1) }).parse(req.body);
        const a = dashboardArtifactsService.setFinancialAnalysis(text, who(req));
        log.info(`Análise financeira regerada por ${a.generatedBy}`);
        res.json(a);
    } catch (e: any) {
        res.status(400).json({ error: e?.message || 'Dados inválidos' });
    }
});

// PUT /api/dashboard/artifacts/forecast — persiste a previsão de vendas gerada (objeto/JSON).
router.put('/artifacts/forecast', (req: Request, res: Response) => {
    try {
        const { data } = z.object({ data: z.any() }).parse(req.body);
        if (data === undefined || data === null) return res.status(400).json({ error: 'data ausente' });
        const a = dashboardArtifactsService.setSalesForecast(data, who(req));
        log.info(`Previsão de vendas regerada por ${a.generatedBy}`);
        res.json(a);
    } catch (e: any) {
        res.status(400).json({ error: e?.message || 'Dados inválidos' });
    }
});

export default router;
