/**
 * Health Route (#1042)
 *
 * GET /health — verifica o status real de todas as dependências críticas via
 * healthCheckService. Retorna HTTP 200 quando tudo OK, 503 quando algum check
 * crítico está down ou (configurável) quando o status é degradado.
 *
 * HEALTH_FAIL_ON_DEGRADED (default "true"): quando "false", status "degraded"
 * responde 200 em vez de 503 — útil para ambientes onde somente down deve alertar.
 */
import { Router } from 'express';
import { checkAll, httpStatusFor } from '../services/healthCheckService';
import { config } from '../config/env';

const router = Router();

router.get('/', async (_req, res) => {
    const report = await checkAll();
    const httpStatus = httpStatusFor(report, config.healthFailOnDegraded);

    res.status(httpStatus).json({
        status: report.status,
        server: 'CoolGroove Backend',
        uptime: process.uptime(),
        checks: report.checks,
        timestamp: report.timestamp,
        memory: {
            used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
            rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
        },
    });
});

export default router;
