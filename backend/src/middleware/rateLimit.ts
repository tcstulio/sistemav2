/**
 * Rate limiters nomeados (issue #1540 — infraestrutura base do epic #34).
 *
 * Cada preset encapsula uma janela + máximo + chaveamento do
 * `express-rate-limit` para um caso de uso específico:
 *
 *   login      → brute-force de credenciais (5/15min, chave = IP+email)
 *   ai         → operações caras de IA (20/min, pula GETs de polling)
 *   banking    → operações bancárias sensíveis (10/15min)
 *   scheduler  → agendamento de mensagens (10/min)
 *   strict     → enumeração de IDs/secrets (10/min/IP)
 *   default    → fallback genérico para rotas sem preset dedicado (100/15min)
 *
 * Em caso de estouro, o handler constrói um Error padronizado
 * (`code: 'RATE_LIMIT'`, `status: 429`) e chama `next(error)` — a
 * resposta é renderizada pelo errorHandler global usando o envelope
 * `fail(...)` de apiResponse.ts, mantendo consistência com as outras
 * rotas (e permitindo auditoria centralizada).
 *
 * NOTA: o limiter `/health` (mais permissivo e com teste de
 * comportamento dedicado) continua em `middleware/healthRateLimiter.ts`
 * — não foi consolidado aqui porque tem semântica diferente
 * (janela curta + contagem alta para monitor externo).
 */
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { NextFunction, Request, RequestHandler, Response } from 'express';

// =============================================
// Window constants
// =============================================

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const ONE_MIN_MS = 60 * 1000;

// =============================================
// Shared handler factory
// =============================================

/**
 * Handler comum: constrói um Error com `code/status/isOperational` e
 * delega ao errorHandler global via `next(error)`. O `errorHandler` então
 * aplica o envelope `fail(res, 'RATE_LIMIT', message)` — o código é
 * incluído em SAFE_ERROR_CODES para aparecer corretamente em produção.
 *
 * Inclui `retryAfter` (segundos) e `limit` em `details` para que clientes
 * possam exibir uma mensagem amigável e agendar retry sem fazer parsing
 * dos headers RateLimit-* (que também ficam disponíveis via
 * `standardHeaders: true`).
 */
function rateLimitHandler(
    windowMs: number,
    limit: number,
    message?: string
): (req: Request, res: Response, next: NextFunction, options: any) => void {
    return (_req, _res, next, _options) => {
        const retryAfter = Math.ceil(windowMs / 1000);
        const err: any = new Error(
            message || `Too many requests. Please try again in ${retryAfter} seconds.`
        );
        err.status = 429;
        err.code = 'RATE_LIMIT';
        err.isOperational = true;
        err.details = { retryAfter, limit };
        next(err);
    };
}

// =============================================
// 1. login — brute-force de credenciais
// =============================================
// Limite BEM apertado (5/15min) com chave = IP+login/email. Sem essa chave
// combinada, um atacante distribuído (botnet) poderia compartilhar o mesmo
// bucket por IP. Aqui cada (IP, usuário) tem o seu próprio contador.
const login: RequestHandler = rateLimit({
    windowMs: FIFTEEN_MIN_MS,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler(FIFTEEN_MIN_MS, 5, 'Too many login attempts. Please try again in 15 minutes.'),
    keyGenerator: (req: Request) => {
        const ip = ipKeyGenerator(req.ip || 'unknown');
        const body = (req.body && typeof req.body === 'object') ? (req.body as any) : {};
        const identifier = String(
            body.email || body.login || body.username || 'anon'
        ).toLowerCase().trim();
        return `${ip}:${identifier}`;
    },
});

// =============================================
// 2. ai — operações de IA
// =============================================
// 20/min é generoso p/ uso humano (1 req a cada 3s em rajada) mas trava
// abuso. Os GETs (polling de job + feed) são skipados — vide
// `skip: (req) => req.method === 'GET'` — porque são LEVES e FREQUENTES;
// sem isso, um job longo estoura 20/min e derruba o chat com 429 (issue #320).
const ai: RequestHandler = rateLimit({
    windowMs: ONE_MIN_MS,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler(ONE_MIN_MS, 20, 'AI rate limit exceeded. Please wait before trying again.'),
    skip: (req: Request) => req.method === 'GET',
});

// =============================================
// 3. banking — operações bancárias sensíveis
// =============================================
const banking: RequestHandler = rateLimit({
    windowMs: FIFTEEN_MIN_MS,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler(FIFTEEN_MIN_MS, 10, 'Banking rate limit exceeded. Please wait.'),
    skip: (req: Request) => req.method !== 'POST',
});

// =============================================
// 4. scheduler — agendamento de mensagens
// =============================================
// 10/min evita disparo em massa de campanhas via scheduler (cada job
// poderia virar várias mensagens; sem limite, um bug faz fan-out).
const scheduler: RequestHandler = rateLimit({
    windowMs: ONE_MIN_MS,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler(ONE_MIN_MS, 10, 'Scheduler rate limit exceeded. Please wait.'),
});

// =============================================
// 5. strict — enumeração de IDs/secrets
// =============================================
// Limite por IP (não combina com user) porque o vetor é "descobrir IDs
// válidos" (ex.: /api/tickets/123, /api/tickets/124, ...) — o que
// protege é travar o IP, não o usuário.
const strict: RequestHandler = rateLimit({
    windowMs: ONE_MIN_MS,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler(ONE_MIN_MS, 10, 'Too many requests. Please slow down.'),
});

// =============================================
// 6. default — fallback genérico
// =============================================
// 100/15min cobre uso humano típico de uma rota qualquer sem preset
// dedicado. Substitui o `globalLimiter` apenas em pontos que NÃO usam o
// global (rotas internas, scripts de agente, etc).
const defaultLimiter: RequestHandler = rateLimit({
    windowMs: FIFTEEN_MIN_MS,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler(FIFTEEN_MIN_MS, 100, 'Rate limit exceeded. Please try again later.'),
});

// =============================================
// 7. sync — sincronização com Dolibarr (#1569)
// =============================================
// 30/min protege o backend de sobrecarga no sync com o Dolibarr (cada run
// dispara N chamadas AJAX ao ERP). É o teto recomendado pela issue #1569
// para os endpoints de /sync/* — cobre operadores múltiplos disparando
// runs manualmente e trava automação descontrolada.
const sync: RequestHandler = rateLimit({
    windowMs: ONE_MIN_MS,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler(ONE_MIN_MS, 30, 'Sync rate limit exceeded. Please wait before retrying.'),
});

// =============================================
// Public API
// =============================================

export const rateLimiters = {
    login,
    ai,
    banking,
    scheduler,
    strict,
    default: defaultLimiter,
    sync,
};

export default rateLimiters;