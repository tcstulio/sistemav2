/**
 * Factory de rate limiters (issue #976 — fundação).
 *
 * Reaproveita o `express-rate-limit` com presets nomeados para uso em
 * TODAS as rotas. Cada preset vira um middleware Express pronto para
 * uso e compartilha o mesmo envelope de resposta:
 *
 *   { success: false, error: { message: 'Muitas requisições', code: 'RATE_LIMIT' } }
 *
 * Diferenças em relação aos outros limiters existentes
 * (`middleware/rateLimit.ts`, `middleware/whatsappRateLimiters.ts`,
 * `middleware/healthRateLimiter.ts`):
 *
 *  - Aqui o response é escrito DIRETAMENTE em `res` (handler chama
 *    `res.status(429).json(envelope)`) — não passa por `next(err)` /
 *    errorHandler. O envelope é FIXO e idêntico ao contrato exigido
 *    pela issue #976. Os outros limiters delegam ao errorHandler para
 *    permitir sanitização adicional em produção; este factory entrega
 *    o envelope cru.
 *  - `keyGenerator` honra `X-Forwarded-For` (além de `CF-Connecting-IP`),
 *    garantindo que o IP real do cliente seja usado mesmo em proxies
 *    genéricos (não-Cloudflare).
 *  - Headers `RateLimit-*` (RFC draft) + `Retry-After` ficam ativos via
 *    `standardHeaders: 'draft-7'` para satisfazer o AC da issue.
 */
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { Request, RequestHandler, Response } from 'express';

// ============================================================
// Window constants
// ============================================================

const ONE_MIN_MS = 60 * 1000;
const FIFTEEN_MIN_MS = 15 * 60 * 1000;

// ============================================================
// Default envelope (resposta 429) — conforme spec da issue #976
// ============================================================

const DEFAULT_RATE_LIMIT_MESSAGE = {
    success: false as const,
    error: {
        message: 'Muitas requisições',
        code: 'RATE_LIMIT'
    }
};

// ============================================================
// Chave por cliente real (atrás de proxies / Cloudflare)
// ============================================================

/**
 * Extrai o IP real do cliente a partir de cabeçalhos de proxy comuns
 * (X-Forwarded-For, CF-Connecting-IP) caindo em `req.ip` quando
 * nenhum estiver presente. `ipKeyGenerator` (do express-rate-limit)
 * normaliza IPv6 (sub-rede /56) — exigência da v7+.
 *
 * Ordem de preferência:
 *   1. `cf-connecting-ip` (Cloudflare reescreve na borda; cliente
 *      não consegue forjar via túnel CF).
 *   2. Primeiro IP em `x-forwarded-for` (proxy reverso genérico).
 *   3. `req.ip` (acesso local / direto).
 *   4. `'unknown'` (fallback seguro; nunca joga `undefined`).
 */
export function realClientIpKey(req: Request): string {
    const cf = req.headers?.['cf-connecting-ip'];
    if (cf) {
        const raw = Array.isArray(cf) ? cf[0] : cf;
        if (typeof raw === 'string' && raw.trim()) return ipKeyGenerator(raw.trim());
    }

    const xff = req.headers?.['x-forwarded-for'];
    if (xff) {
        const first = (Array.isArray(xff) ? xff[0] : xff);
        if (typeof first === 'string' && first.trim()) {
            // `x-forwarded-for` pode trazer "client, proxy1, proxy2" — pega o primeiro.
            return ipKeyGenerator(first.split(',')[0].trim());
        }
    }

    return ipKeyGenerator(req.ip || 'unknown');
}

// ============================================================
// Options do factory
// ============================================================

/**
 * Argumentos do `createLimiter`. O campo `keyGenerator` é opcional
 * porque o factory aplica um default sensato (`realClientIpKey`).
 */
export interface CreateLimiterOptions {
    /** Janela em milissegundos. */
    windowMs: number;
    /** Máximo de requests dentro da janela. */
    max: number;
    /**
     * Body da resposta 429. Pode ser uma string ou um objeto (envelope).
     * Default = envelope padrão exigido pela issue #976.
     */
    message?: unknown;
    /** Key generator customizado. Default = `realClientIpKey`. */
    keyGenerator?: (req: Request, res: Response) => string | Promise<string>;
}

// ============================================================
// Factory
// ============================================================

/**
 * Cria um middleware de rate limit com o envelope padrão da issue #976
 * e headers `RateLimit-*` + `Retry-After` ativos.
 *
 * O `message` opcional permite customizar APENAS o texto dentro de
 * `error.message` (substituindo 'Muitas requisições') — o envelope
 * externo e o `code: 'RATE_LIMIT'` ficam preservados por consistência
 * de contrato.
 */
export function createLimiter(options: CreateLimiterOptions): RequestHandler {
    const { windowMs, max, message, keyGenerator } = options;

    const body =
        message !== undefined
            ? normalizeMessage(message)
            : DEFAULT_RATE_LIMIT_MESSAGE;

    return rateLimit({
        windowMs,
        limit: max,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: body,
        keyGenerator: keyGenerator
            ? (req: Request, res: Response) => keyGenerator(req, res)
            : (req: Request) => realClientIpKey(req),
    });
}

/**
 * Normaliza o `message` recebido para sempre devolver um envelope
 * `{ success: false, error: { message, code } }`. Aceita:
 *   - string  → vira `{ message: <string> }`
 *   - objeto  → usado como está (validado superficialmente)
 */
function normalizeMessage(message: unknown): unknown {
    if (typeof message === 'string') {
        return {
            success: false,
            error: {
                message,
                code: 'RATE_LIMIT'
            }
        };
    }
    if (message && typeof message === 'object') {
        // Garante shape mínimo do envelope. Se faltar `error`, injeta o default.
        const m = message as Record<string, unknown>;
        if (!m.error) {
            return {
                success: false,
                ...m,
                error: { message: 'Muitas requisições', code: 'RATE_LIMIT' }
            };
        }
        return m;
    }
    return DEFAULT_RATE_LIMIT_MESSAGE;
}

// ============================================================
// Presets nomeados
// ============================================================

/**
 * 5 tentativas / 15min. Janela longa + limite apertado é o padrão
 * para brute-force de credenciais (#1540).
 */
export const loginLimiter: RequestHandler = createLimiter({
    windowMs: FIFTEEN_MIN_MS,
    max: 5,
});

/**
 * 20 req/min por IP. Cobre uso humano em rajada (1 req / 3s) e trava
 * abuso de IA (cada chamada é cara) — equivalente ao preset `ai` em
 * `middleware/rateLimit.ts`, mas com envelope direto (sem passar pelo
 * errorHandler).
 */
export const aiLimiter: RequestHandler = createLimiter({
    windowMs: ONE_MIN_MS,
    max: 20,
});

/**
 * 30 req/min por IP. Operações bancárias sensíveis: cobre uso legítimo
 * de um operador humano (consulta + ação por minuto) e trava automação
 * maliciosa (script que varre extratos).
 */
export const bankingLimiter: RequestHandler = createLimiter({
    windowMs: ONE_MIN_MS,
    max: 30,
});

/**
 * 10 req/min por IP. Agendamento de mensagens: cada job pode virar
 * várias mensagens, então limite apertado evita disparo em massa.
 */
export const schedulerLimiter: RequestHandler = createLimiter({
    windowMs: ONE_MIN_MS,
    max: 10,
});

/**
 * 10 req/min por IP. Enumeração de números do WhatsApp
 * (GET /api/whatsapp/check-number/:number). Alinhado com o preset
 * `whatsappCheckLimiter` em `middleware/whatsappRateLimiters.ts`
 * (mesma janela e mesmo `max`).
 */
export const whatsappCheckLimiter: RequestHandler = createLimiter({
    windowMs: ONE_MIN_MS,
    max: 10,
});

/**
 * 60 req/min por IP. Webhook público de entrada (ex.: POST /api/whatsapp/webhook):
 * alto volume legítimo (cada mensagem recebida conta 1 hit) mas precisa
 * trava contra DoS / abuse. 60/min é suficiente para integrações
 * conversacionais e estoura varreduras maliciosas rapidamente.
 */
export const webhookLimiter: RequestHandler = createLimiter({
    windowMs: ONE_MIN_MS,
    max: 60,
});

// ============================================================
// Public API
// ============================================================

export const rateLimitFactory = {
    createLimiter,
    loginLimiter,
    aiLimiter,
    bankingLimiter,
    schedulerLimiter,
    whatsappCheckLimiter,
    webhookLimiter,
};

export default rateLimitFactory;
