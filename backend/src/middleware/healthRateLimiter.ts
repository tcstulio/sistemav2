/**
 * /health rate limiter (#1415)
 *
 * O endpoint /health é público e isento de auth (atrás do túnel Cloudflare que serve
 * uptime monitor externo). Sem limite, um scraper/monitor abusivo fan-out em checks
 * externos (Dolibarr, isReady() dos bancos, sessionService do WhatsApp) a cada hit,
 * derrubando latência do backend e/ou disparando rate-limit do próprio Dolibarr.
 *
 * 60 req/min por IP é generoso para monitor típico (1 req/s) + UI do app em polling
 * eventual, mas trava abuso real sem afetar operação legítima.
 *
 * Extraído para um módulo próprio para permitir testes integrados (sem mock do
 * `express-rate-limit`) e auditoria de config. Os outros limiters do server.ts
 * (aiLimiter, bankingLimiter, schedulerLimiter, authLimiter) continuam inline —
 * este foi destacado porque é o único com teste de comportamento dedicado.
 */
import rateLimit from 'express-rate-limit';

export const HEALTH_LIMIT_WINDOW_MS = 60 * 1000;
export const HEALTH_LIMIT_MAX = 60;

export const healthLimiter = rateLimit({
    windowMs: HEALTH_LIMIT_WINDOW_MS,
    max: HEALTH_LIMIT_MAX,
    message: { error: 'Too many health requests. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
});