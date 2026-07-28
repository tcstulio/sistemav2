/**
 * Rate limiters do WhatsApp (issue #1568).
 *
 * Dois limiters nomeados para prevenir abuso e enumeração nas rotas públicas
 * (webhook) e protegidas (check-number) do módulo WhatsApp:
 *
 *   - whatsappCheckLimiter (whatsappCheckLimiter / strict):
 *       aplicado em GET /api/whatsapp/check-number/:number.
 *       10 req/min/IP. Mais restritivo que o `defaultLimiter` (100/15min) porque o
 *       vetor de ataque aqui é ENUMERAÇÃO (descobrir quais números estão no WhatsApp
 *       varrendo prefixos em sequência). 10 req/min é o suficiente para uso legítimo
 *       (UI valida sob demanda, script pontual) e trava varredura automatizada.
 *       Acceptance criterion #1568: 11ª request em 1 min → 429.
 *
 *   - whatsappWebhookLimiter (public webhook):
 *       aplicado em POST /api/whatsapp/webhook.
 *       300 req/min/IP. Webhook é público e de alto volume (bridges conversacionais,
 *       HIL/baileys, etc.) mas precisa trava contra DoS e abuse. Mantém 300/min porque
 *       integrations legítimas (e.g.: cada msg recebida conta 1 hit) operam muito
 *       abaixo desse limite; varreduras maliciosas estouram rapidamente.
 *       Acceptance criterion #1568: 301ª request em 1 min → 429.
 *
 * Constantes exportadas para permitir auditoria de config e testes integrados (sem
 * mock de `express-rate-limit`), seguindo o mesmo padrão de
 * `middleware/healthRateLimiter.ts`.
 */
import rateLimit from 'express-rate-limit';

export const WHATSAPP_CHECK_LIMIT_WINDOW_MS = 60 * 1000;
export const WHATSAPP_CHECK_LIMIT_MAX = 10;

export const WHATSAPP_WEBHOOK_LIMIT_WINDOW_MS = 60 * 1000;
export const WHATSAPP_WEBHOOK_LIMIT_MAX = 300;

export const whatsappCheckLimiter = rateLimit({
    windowMs: WHATSAPP_CHECK_LIMIT_WINDOW_MS,
    max: WHATSAPP_CHECK_LIMIT_MAX,
    message: {
        success: false,
        error: {
            code: 'RATE_LIMIT',
            message: 'Too many number checks. Please wait a minute.'
        }
    },
    standardHeaders: true,
    legacyHeaders: false,
});

export const whatsappWebhookLimiter = rateLimit({
    windowMs: WHATSAPP_WEBHOOK_LIMIT_WINDOW_MS,
    max: WHATSAPP_WEBHOOK_LIMIT_MAX,
    message: {
        success: false,
        error: {
            code: 'RATE_LIMIT',
            message: 'Too many webhook requests. Please slow down.'
        }
    },
    standardHeaders: true,
    legacyHeaders: false,
});
