/**
 * Health Route (#1042, #1415)
 *
 * GET /health — verifica o status real de todas as dependências via healthCheckService.
 *
 * Semântica de status (#1415):
 *  - 'down' → 503 (dependência crítica — hoje apenas Dolibarr — está fora).
 *  - 'degraded' → 200 por padrão (uptime monitor não deve flapear por WhatsApp caído,
 *    bancos não-configurados, scheduler stuck etc.; o body `checks.*` ainda reflete
 *    cada dependência individualmente).
 *  - HEALTH_FAIL_ON_DEGRADED=true reverte o default: faz 'degraded' voltar a 503
 *    (útil p/ pipelines CI rígidos ou ambientes que preferem alerta conservador).
 *  - 'ok' → 200.
 *
 * Backward compat (#1415): o campo `dependencies` é mantido como alias de `checks`
 * para não quebrar consumidores/tests legados que ainda esperam a chave antiga.
 */
import { Router } from 'express';
import { checkAll } from '../services/healthCheckService';

const router = Router();

router.get('/', async (_req, res) => {
    const report = await checkAll();

    const failOnDegraded = process.env.HEALTH_FAIL_ON_DEGRADED === 'true';
    let httpStatus = 200;
    if (report.status === 'down') {
        httpStatus = 503;
    } else if (report.status === 'degraded' && failOnDegraded) {
        httpStatus = 503;
    }

    res.status(httpStatus).json({
        status: report.status,
        server: 'CoolGroove Backend',
        uptime: process.uptime(),
        checks: report.checks,
        dependencies: report.checks,
        timestamp: report.timestamp,
        memory: {
            used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
            rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
        },
    });
});

export default router;
