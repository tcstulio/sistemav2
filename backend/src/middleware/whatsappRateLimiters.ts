/**
 * Rate limiters do canal WhatsApp (#1568).
 *
 * O endpoint `GET /check-number/:number` é um oráculo de enumeração — responde
 * "este número tem WhatsApp?" — e por isso é alvo clássico de scraping para
 * validar listas de números compradas. O limite geral da API (60/min) é
 * generoso demais para este ponto específico, então aplicamos um limiter
 * dedicado e mais restritivo logo na rota.
 *
 * O webhook (`POST /webhook`) é público por natureza (recebe callbacks de
 * provedores externos) e tolera alto volume, mas sem nenhum limite vira vetor
 * de abuso/DoS — por isso um `webhookLimiter` com teto alto (300/min) por IP.
 *
 * Extraído para módulo próprio (seguindo o padrão de `healthRateLimiter.ts`)
 * para permitir testes integrados SEM mock do `express-rate-limit` e expor as
 * constantes como contrato auditável.
 */
import rateLimit from 'express-rate-limit';

/** Janela do limiter de check-number (1 minuto). */
export const WHATSAPP_CHECK_LIMIT_WINDOW_MS = 60 * 1000;
/** Máximo de consultas check-number por IP por janela. 11ª request → 429. */
export const WHATSAPP_CHECK_LIMIT_MAX = 10;

/** Janela do limiter de webhook (1 minuto). */
export const WHATSAPP_WEBHOOK_LIMIT_WINDOW_MS = 60 * 1000;
/** Máximo de webhooks por IP por janela. 301ª request → 429. */
export const WHATSAPP_WEBHOOK_LIMIT_MAX = 300;

/**
 * Limiter dedicado para `GET /check-number/:number`.
 * Mais restritivo que o geral (10/min) por ser ponto de enumeração.
 */
export const whatsappCheckLimiter = rateLimit({
    windowMs: WHATSAPP_CHECK_LIMIT_WINDOW_MS,
    max: WHATSAPP_CHECK_LIMIT_MAX,
    message: {
        success: false,
        error: {
            code: 'RATE_LIMIT',
            message: 'Too many number checks. Please wait.'
        }
    },
    standardHeaders: true,
    legacyHeaders: false
});

/**
 * Limiter do webhook público. Teto alto (300/min) pois provedores legítimos
 * disparam rajadas, mas sem teto ilimitado para evitar abuso.
 */
export const webhookLimiter = rateLimit({
    windowMs: WHATSAPP_WEBHOOK_LIMIT_WINDOW_MS,
    max: WHATSAPP_WEBHOOK_LIMIT_MAX,
    message: {
        success: false,
        error: {
            code: 'RATE_LIMIT',
            message: 'Too many webhook calls. Please slow down.'
        }
    },
    standardHeaders: true,
    legacyHeaders: false
});
