import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { createLogger } from './utils/logger';
import { initSentry } from './utils/sentry';

initSentry();

const log = createLogger('Server');
import { config } from './config/env';
import whatsappRoutes from './routes/whatsappRoutes';
import schedulerRoutes from './routes/schedulerRoutes';
import githubRoutes from './routes/githubRoutes';
import { sessionService } from './services/legacy/sessionService';
import { schedulerService } from './services/schedulerService';

const app = express();

// ===========================================
// Startup Security Checks
// ===========================================
if (!config.adminKey) {
    log.warn('ADMIN_KEY not set! Admin routes will reject all requests. Set ADMIN_KEY in .env');
}

// ===========================================
// Proxy Configuration (Cloudflare Tunnel)
// ===========================================
// Trust the first proxy - required for:
// - Rate limiting to correctly identify users by real IP
// - Secure cookies to work behind HTTPS proxy
// - Correct IP logging in audit trails
app.set('trust proxy', 1);

// ===========================================
// Security Middleware
// ===========================================

// Helmet.js - Security headers
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "wss:", "https:"],
        }
    },
    crossOriginEmbedderPolicy: false, // Required for some integrations
}));

// CORS - Configured for specific origins
const allowedOrigins = [
    'https://app.coolgroove.com.br',
    'https://sistema.coolgroove.com.br',
    // :3003 é a porta REAL do frontend dev (vite). Sem ela, PATCH/PUT/login (preflight CORS)
    // do localhost:3003 eram rejeitados (500). :3000/:5173 mantidos por compatibilidade.
    ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:3003', 'http://localhost:3000', 'http://localhost:5173'] : [])
];

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, Postman, etc.)
        if (!origin) return callback(null, true);

        // Túnel cloudflared (URL muda a cada restart) e IPs locais são liberados FORA de produção.
        // Em produção use os domínios fixos em allowedOrigins (app/sistema.coolgroove.com.br).
        const isDev = process.env.NODE_ENV !== 'production';
        if (isDev || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            log.warn(`CORS blocked request from origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'DOLAPIKEY', 'X-Admin-Key'],
    exposedHeaders: ['X-Total-Count', 'X-RateLimit-Remaining'],
    maxAge: 86400 // 24h preflight cache
}));

// ===========================================
// Rate Limiting
// ===========================================

// Global rate limiter
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500, // 500 requests per IP per window
    message: { error: 'Too many requests. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/health' // Skip health checks
});

// Strict limiter for AI endpoints (expensive operations).
// Só limita os POSTs caros (generate-reply*, analyze): os GETs em /ai/* são leves e
// FREQUENTES — polling do job (GET /jobs/:id a cada 2.5s) e do feed (GET /agent/activity).
// Sem o skip, um job longo estoura 20/min e derruba o chat com 429 (issue #320).
// O limiter global (500/15min) continua cobrindo os GETs como backstop.
const aiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 20, // 20 AI requests per minute
    message: { error: 'AI rate limit exceeded. Please wait before trying again.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === 'GET'
});

// Banking limiter (sensitive operations)
const bankingLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 banking requests per minute
    message: { error: 'Banking rate limit exceeded. Please wait.' },
    standardHeaders: true,
    legacyHeaders: false
});

// Scheduler limiter (message scheduling)
const schedulerLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'Scheduler rate limit exceeded. Please wait.' },
    standardHeaders: true,
    legacyHeaders: false
});

// Strict limiter for auth (login attempts)
const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    message: { error: 'Too many requests to auth endpoints.' },
    standardHeaders: true,
    legacyHeaders: false
});

// Apply global limiter
app.use(globalLimiter);

// ===========================================
// Body Parsing
// ===========================================
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ===========================================
// Audit Logging
// ===========================================
import { auditMiddleware } from './middleware/auditMiddleware';
app.use(auditMiddleware);

// Routes
import adminRoutes from './routes/adminRoutes';
import groupsRoutes from './routes/groupsRoutes';
import aiRoutes from './routes/aiRoutes';
import authRoutes from './routes/authRoutes';
import { authMiddleware, requireDolibarrLogin } from './middleware/authMiddleware';

// Middleware that skips auth for webhook paths (incoming bank notifications must be public)
const bankingAuthMiddleware = (req: any, res: any, next: any) => {
    if (req.path.startsWith('/webhook/')) return next();
    return requireDolibarrLogin(req, res, next);
};

app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/ai', aiLimiter, aiRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin', groupsRoutes); // grupos/direitos (sistemav2#820) — mesmo prefixo, paths distintos
app.use('/api/auth', authLimiter, authRoutes);

// Endereço público do túnel cloudflared (sem auth — a URL não é segredo)
import { tunnelService } from './services/tunnelService';
app.get('/api/tunnel/url', (_req, res) => res.json(tunnelService.getStatus()));

import dolibarrRoutes from './routes/dolibarrRoutes';
app.use('/api/dolibarr', dolibarrRoutes);

app.use('/api/scheduler', schedulerLimiter, schedulerRoutes);

import webhookRoutes from './routes/webhookRoutes';
app.use('/api/webhook', webhookRoutes);

import bankingCredentialsRoutes from './routes/bankingCredentialsRoutes';
app.use('/api/banking', bankingLimiter, bankingCredentialsRoutes); // admin-only (#45) — antes do bankingRoutes
import bankingRoutes from './routes/bankingRoutes';
app.use('/api/banking', bankingLimiter, bankingRoutes);

import interBankingRoutes from './routes/interBankingRoutes';
app.use('/api/inter', bankingLimiter, bankingAuthMiddleware, interBankingRoutes);

import itauBankingRoutes from './routes/itauBankingRoutes';
app.use('/api/itau', bankingLimiter, bankingAuthMiddleware, itauBankingRoutes);

import approvalRoutes from './routes/approvalRoutes';
app.use('/api/approvals', approvalRoutes);

import documentRoutes from './routes/documentRoutes';
app.use('/api/documents', documentRoutes);

import emailRoutes from './routes/emailRoutes';
app.use('/api/email', emailRoutes);

import centrovibeRoutes from './routes/centrovibeRoutes';
app.use('/api/centrovibe', requireDolibarrLogin, centrovibeRoutes);

import integrationRoutes from './routes/integrationRoutes';
app.use('/api/integration', integrationRoutes);

import uiConfigRoutes from './routes/uiConfigRoutes';
app.use('/api/ui-config', uiConfigRoutes);

import userRoutes from './routes/userRoutes';
app.use('/api/users', userRoutes); // /me usa whitelist — nunca devolve api_key (#1003)

import dashboardRoutes from './routes/dashboardRoutes';
app.use('/api/dashboard', dashboardRoutes);

import taskRoutes from './routes/taskRoutes';
app.use('/api/tasks', taskRoutes);

import notificationRoutes from './routes/notificationRoutes';
app.use('/api/notifications', notificationRoutes);

import systemEventsRoutes from './routes/systemEventsRoutes';
app.use('/api/system-events', systemEventsRoutes);

import simulatorRoutes from './routes/simulatorRoutes';
app.use('/api/simulator', simulatorRoutes);

app.use('/api/github', githubRoutes);

// Health Check
app.get('/health', async (req, res) => {
    const health: Record<string, any> = {
        status: 'ok',
        server: 'CoolGroove Backend',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        memory: {
            used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
            rss: Math.round(process.memoryUsage().rss / 1024 / 1024)
        },
        dependencies: {}
    };

    const checks: Promise<void>[] = [];

    checks.push((async () => {
        try {
            const { dolibarrService } = require('./services/dolibarrService');
            const isValid = await dolibarrService.validateApiKey(config.dolibarrKey);
            health.dependencies.dolibarr = isValid ? 'ok' : 'error';
        } catch {
            health.dependencies.dolibarr = 'unavailable';
        }
    })());

    checks.push((async () => {
        try {
            const { schedulerService } = require('./services/schedulerService');
            health.dependencies.scheduler = schedulerService.isRunning ? 'ok' : 'stopped';
        } catch {
            health.dependencies.scheduler = 'unavailable';
        }
    })());

    checks.push((async () => {
        try {
            const { interApiService } = require('./services/interApiService');
            health.dependencies.banco_inter = interApiService.isReady() ? 'ok' : 'not_configured';
        } catch {
            health.dependencies.banco_inter = 'unavailable';
        }
    })());

    checks.push((async () => {
        try {
            const { itauApiService } = require('./services/itauApiService');
            health.dependencies.banco_itau = itauApiService.isReady() ? 'ok' : 'not_configured';
        } catch {
            health.dependencies.banco_itau = 'unavailable';
        }
    })());

    checks.push((async () => {
        try {
            const { sessionService } = require('./services/legacy/sessionService');
            const sessions = sessionService.getAllSessions();
            if (sessions.length === 0) {
                health.dependencies.whatsapp = 'not_configured';
            } else {
                // 'WORKING' = sessão conectada; qualquer outro estado (SCAN_QR_CODE, STOPPED…) = degradado
                health.dependencies.whatsapp = sessions.some((s: any) => s.status === 'WORKING') ? 'ok' : 'degraded';
            }
        } catch {
            health.dependencies.whatsapp = 'unavailable';
        }
    })());

    await Promise.allSettled(checks);

    const hasErrors = Object.values(health.dependencies).some((v: any) => v === 'error');
    if (hasErrors) {
        health.status = 'degraded';
    }

    res.json(health);
});

// ===========================================
// Global Error Handler (must be last)
// ===========================================
import { errorHandler } from './middleware/errorHandler';
app.use(errorHandler);

import { getSentryRequestHandler } from './utils/sentry';
const sentryErrorHandler = getSentryRequestHandler();
if (sentryErrorHandler) {
    sentryErrorHandler(app);
}

// Socket.io initialization
import { socketService } from './services/socketService';

const server = app.listen(Number(config.port), '0.0.0.0', () => {
    log.info(`Backend running on http://0.0.0.0:${config.port}`);
});

// Initialize Socket.io with the HTTP server
socketService.init(server);

// #1154 P3 item 22: quando o TaskRunner sobe este backend como PREVIEW (renderizar/screenshot de uma
// tela p/ verificar), ele copia o .env de PRODUÇÃO. Sem isto, o preview rodaria os workers de fundo
// contra a PROD real — dispararia crons, notificações e mensagens de WhatsApp, e até rodaria o PRÓPRIO
// robô. PREVIEW_MODE=1 desliga todos os efeitos colaterais (o preview vira read-only).
const IS_PREVIEW = process.env.PREVIEW_MODE === '1';
if (IS_PREVIEW) log.warn('PREVIEW_MODE=1 — workers de fundo DESLIGADOS (scheduler/crons/TaskRunner/bancos/tunnel): preview read-only.');

// Cloudflare tunnel automático (se CLOUDFLARE_TUNNEL_ENABLED=true) — URL pública dinâmica
if (!IS_PREVIEW) tunnelService.start();

// Initialize WhatsApp Service
log.info('SessionService loaded');

// Start Scheduler Worker (checks for pending messages every 30s)
import { eventScraperService } from './services/eventScraperService';
import { alertCronService } from './services/alertCronService';
import { delegationService } from './services/delegationService';
import { taskRunnerService } from './services/taskRunnerService';
if (!IS_PREVIEW) {
    schedulerService.startWorker();
    log.info('SchedulerService worker started');

    // Start Event Scraper Worker (interval/auto-run vêm da config — scraperConfigStore)
    eventScraperService.startWorker();
    log.info('EventScraperService worker started (config-driven)');

    // Start Alert Cron (invoices, stock, tasks, tickets)
    alertCronService.start();
    log.info('AlertCronService started');

    // Reidrata o estado durável da delegação a partir do Dolibarr (#293) — best-effort, não bloqueia o boot.
    delegationService.hydrateFromDolibarr()
        .then((n) => { if (n > 0) log.info(`DelegationService: ${n} delegação(ões) reidratada(s) do Dolibarr (#293)`); })
        .catch(() => { /* best-effort */ });

    // Start TaskRunner polling (sync GitHub issues com label "opencode-task")
    taskRunnerService.startPolling();
}

// Start GC de Worktrees scheduler (issue #1112): cron diário do backend que dispara
// scripts/gc-worktrees.ts (subprocesso isolado, junction-safe). Config via env:
// GC_SCHEDULE_ENABLED / GC_SCHEDULE_TIME (default "03:00").
import { gcSchedulerService } from './services/gcSchedulerService';
gcSchedulerService.start();
log.info('GcSchedulerService started (issue #1112)');

// Initialize Banking Services
import { interApiService } from './services/interApiService';
import { itauApiService } from './services/itauApiService';

(async () => {
    if (IS_PREVIEW) return; // #1154 P3 item 22: preview não conecta aos bancos
    try {
        await interApiService.initialize();
        log.info('Banco Inter API initialized');
    } catch (e: any) {
        log.error(`Failed to initialize Banco Inter: ${e.message}`);
    }

    try {
        await itauApiService.initialize();
        log.info('Banco Itaú API initialized');
    } catch (e: any) {
        log.debug('Itaú API not configured (optional)');
    }
})();

import { agentConfigService } from './services/agentConfigService';
(async () => {
    try {
        await agentConfigService.refresh();
        const profile = await agentConfigService.getProfile();
        log.info(`Agent config loaded: ${profile.lastname} (${profile.job}), enabled=${profile.config.enabled}`);
    } catch (e: any) {
        log.error(`Failed to load agent config: ${e.message}`);
    }
})();

// Graceful Shutdown Logic
const gracefulShutdown = async (signal: string) => {
    log.info(`${signal} received - starting graceful shutdown`);

    // Safety Timeout: força a saída se algo travar. 12s (era 5s): o client.destroy() do WhatsApp
    // precisa fechar o Chrome inteiro e 5s cortava o destroy no meio → chrome ÓRFÃO segurando o
    // perfil mesmo num shutdown "gracioso" (#896 — uma das fontes dos zumbis de 2026-07-07).
    setTimeout(() => {
        log.error('Shutdown timed out - forcing exit');
        process.exit(1);
    }, 12000).unref();

    // 1. Close HTTP Server (Stops accepting new connections)
    server.close((err) => {
        if (err) {
            log.error('Error closing HTTP server', err);
        } else {
            log.info('HTTP server closed');
        }
    });

    // 2. Stop Scheduler Worker
    schedulerService.stopWorker();

    // 3. Stop Alert Cron
    alertCronService.stop();

    // Stop GC de Worktrees scheduler (#1112)
    gcSchedulerService.stop();

    // 3. Destroy WhatsApp Clients (Releases Chrome processes & Ports)
    try {
        await sessionService.destroy();
    } catch (e) {
        log.error('Error destroying WhatsApp service', e);
    }

    log.info(`${signal} shutdown complete - exiting`);
    process.exit(0);
};

// Monitor Signals (Nodemon sends SIGUSR2, Ctrl+C sends SIGINT)
process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.once('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // Nodemon restart
