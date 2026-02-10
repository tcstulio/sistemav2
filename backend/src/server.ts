import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { logger } from './utils/logger';

const log = logger.child('Server');
import { config } from './config/env';
import whatsappRoutes from './routes/whatsappRoutes';
import schedulerRoutes from './routes/schedulerRoutes';
import { sessionService } from './services/sessionService';
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
    ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:3000', 'http://localhost:5173'] : [])
];

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, Postman, etc.)
        if (!origin) return callback(null, true);

        if (allowedOrigins.includes(origin)) {
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

// Strict limiter for AI endpoints (expensive operations)
const aiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 20, // 20 AI requests per minute
    message: { error: 'AI rate limit exceeded. Please wait before trying again.' },
    standardHeaders: true,
    legacyHeaders: false
});

// Banking limiter (sensitive operations)
const bankingLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 banking requests per minute
    message: { error: 'Banking rate limit exceeded. Please wait.' },
    standardHeaders: true,
    legacyHeaders: false
});

// Apply global limiter
app.use(globalLimiter);

// ===========================================
// Body Parsing
// ===========================================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ===========================================
// Audit Logging
// ===========================================
import { auditMiddleware } from './middleware/auditMiddleware';
app.use(auditMiddleware);

// Routes
import adminRoutes from './routes/adminRoutes';
import aiRoutes from './routes/aiRoutes';
import authRoutes from './routes/authRoutes';
import { authMiddleware, requireDolibarrLogin } from './middleware/authMiddleware';

// Middleware that skips auth for webhook paths (incoming bank notifications must be public)
const bankingAuthMiddleware = (req: any, res: any, next: any) => {
    if (req.path.startsWith('/webhook/')) return next();
    return requireDolibarrLogin(req, res, next);
};

app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/ai', aiLimiter, aiRoutes); // AI endpoints have strict rate limiting
// Protect Admin Routes
app.use('/api/admin', adminRoutes);
app.use('/api/auth', authRoutes);

// Dolibarr Proxy
import dolibarrRoutes from './routes/dolibarrRoutes';
app.use('/api/dolibarr', dolibarrRoutes);

// Scheduler Routes (Messages, Broadcasts, Reminders)
app.use('/api/scheduler', schedulerRoutes);

// Webhook Routes (External Triggers, Dolibarr Integration)
import webhookRoutes from './routes/webhookRoutes';
app.use('/api/webhook', webhookRoutes);

// Banking Routes (Import, Analysis, Reconciliation)
import bankingRoutes from './routes/bankingRoutes';
app.use('/api/banking', bankingLimiter, bankingRoutes);

// Banco Inter API Routes (Banking, Pix, Boletos, Webhooks)
import interBankingRoutes from './routes/interBankingRoutes';
app.use('/api/inter', bankingLimiter, bankingAuthMiddleware, interBankingRoutes);

// Banco Itaú API Routes (Banking, Pix, Boletos, Webhooks)
import itauBankingRoutes from './routes/itauBankingRoutes';
app.use('/api/itau', bankingLimiter, bankingAuthMiddleware, itauBankingRoutes);

// Approval Routes (Fila de aprovação para automações bancárias)
import approvalRoutes from './routes/approvalRoutes';
app.use('/api/approvals', approvalRoutes);

// Document Routes (Envio de documentos via WhatsApp)
import documentRoutes from './routes/documentRoutes';
app.use('/api/documents', documentRoutes);

// Email Routes
import emailRoutes from './routes/emailRoutes';
app.use('/api/email', emailRoutes);

// CentroVibe Routes (Event Management)
import centrovibeRoutes from './routes/centrovibeRoutes';
app.use('/api/centrovibe', requireDolibarrLogin, centrovibeRoutes);

// Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', server: 'CoolGroove Backend' });
});

// ===========================================
// Global Error Handler (must be last)
// ===========================================
import { errorHandler } from './middleware/errorHandler';
app.use(errorHandler);

// Socket.io initialization
import { socketService } from './services/socketService';

const server = app.listen(Number(config.port), '0.0.0.0', () => {
    log.info(`Backend running on http://0.0.0.0:${config.port}`);
});

// Initialize Socket.io with the HTTP server
socketService.init(server);

// Initialize WhatsApp Service
log.info('SessionService loaded');

// Start Scheduler Worker (checks for pending messages every 30s)
schedulerService.startWorker();
log.info('SchedulerService worker started');

// Start Event Scraper Worker (scrapes ticket platforms every 6h)
import { eventScraperService } from './services/eventScraperService';
eventScraperService.startWorker(6);
log.info('EventScraperService worker started (6h interval)');

// Initialize Banking Services
import { interApiService } from './services/interApiService';
import { itauApiService } from './services/itauApiService';

(async () => {
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

// Graceful Shutdown Logic
const gracefulShutdown = async (signal: string) => {
    log.info(`${signal} received - starting graceful shutdown`);

    // Safety Timeout: Force exit after 5 seconds if anything hangs
    setTimeout(() => {
        log.error('Shutdown timed out - forcing exit');
        process.exit(1);
    }, 5000).unref();

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
