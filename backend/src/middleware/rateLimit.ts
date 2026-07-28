/**
 * Rate limiters nomeados (issue #1540 — infraestrutura base do epic #34).
 *
 * Cada preset encapsula uma janela + máximo + chaveamento do
 * `express-rate-limit` para um caso de uso específico:
 *
 *   login       → brute-force de credenciais (5/15min, chave = IP+email)
 *   ai          → operações caras de IA (20/min, pula GETs de polling)
 *   banking     → operações bancárias sensíveis (30/min)
 *   scheduler   → agendamento de mensagens (10/min)
 *   strict      → enumeração de IDs/secrets (10/min/IP)
 *   default     → fallback genérico para rotas sem preset dedicado (100/15min)
 *   sync        → sincronização com Dolibarr (30/min, #1569)
 *   bankingPost → POSTs sensíveis de bankingRoutes (10/15min, #1330)
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
// Chave por CLIENTE REAL (atrás do túnel Cloudflare)
// =============================================
/**
 * Chave de rate-limit pelo IP do CLIENTE REAL.
 *
 * Atrás do túnel Cloudflare, `req.ip` vira o IP do túnel — o MESMO para TODOS os clientes.
 * Assim o bucket vira global e um único cliente estoura o limite de todos (429 injusto; foi o
 * que fez o modal do deeplink não abrir, ver #1728). O Cloudflare seta `CF-Connecting-IP` com o
 * IP real do cliente e o REESCREVE na borda (o cliente não consegue forjá-lo passando pelo CF).
 * Como o backend só é público via o túnel, confiar nesse header é seguro; fallback = `req.ip`
 * (acesso local/direto). `ipKeyGenerator` normaliza IPv6 (exigência do express-rate-limit v7).
 */
export function clientIpKey(req: Request): string {
    const cf = req.headers?.['cf-connecting-ip'];
    const raw = (Array.isArray(cf) ? cf[0] : cf) || req.ip || 'unknown';
    return ipKeyGenerator(String(raw));
}

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
        const ip = clientIpKey(req);
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
    keyGenerator: clientIpKey,
});

// =============================================
// 3. banking — operações bancárias sensíveis
// =============================================
// 30/min cobre uso legítimo de um operador humano (consulta + ação por
// minuto) e trava automação maliciosa (script que varre extratos).
const banking: RequestHandler = rateLimit({
    windowMs: ONE_MIN_MS,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler(ONE_MIN_MS, 30, 'Banking rate limit exceeded. Please wait.'),
    keyGenerator: clientIpKey,
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
    keyGenerator: clientIpKey,
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
    keyGenerator: clientIpKey,
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
    keyGenerator: clientIpKey,
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
    keyGenerator: clientIpKey,
});

// =============================================
// 8. bankingPost — POSTs sensíveis de bankingRoutes (#1330)
// =============================================
// 10/15min é mais apertado que o `banking` genérico (30/min) porque cobre
// escritas específicas do `bankingRoutes.ts` (import/OFX/CSV, analyze,
// insights, reconcile, balance, export). Cada POST conta — não filtra
// método. Janela de 15min (não 1min) porque as operações legítimas de
// conciliação/import rodam em rajadas curtas (operador abre 5 OFXs
// seguidos, dispara export, etc.) e a janela curta geraria falsos 429.
// AC: a 11ª chamada em 15min retorna 429.
//
// `keyGenerator: clientIpKey` é OBRIGATÓRIO aqui pelo mesmo motivo de
// todos os outros presets: atrás do túnel Cloudflare `req.ip` é o IP do
// túnel (o MESMO para todos os clientes). Sem isso o bucket vira global
// — um único operador estourando 10 POSTs bloqueia banking de TODOS os
// usuários (429 injusto). `clientIpKey` usa o IP real do cliente
// (CF-Connecting-IP); em testes (sem CF) cai em `req.ip`, mantendo o
// comportamento esperado pelo AC (bucket compartilhado por IP).
const bankingPost: RequestHandler = rateLimit({
    windowMs: FIFTEEN_MIN_MS,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: clientIpKey,
    handler: rateLimitHandler(
        FIFTEEN_MIN_MS,
        10,
        'Banking POST rate limit exceeded. Please wait before retrying.'
    ),
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
    bankingPost,
};

export default rateLimiters;