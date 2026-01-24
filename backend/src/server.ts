import express from 'express';
import cors from 'cors';
import { initLogger } from './utils/logger';

// Initialize logger with timestamp
initLogger();
import { config } from './config/env';
import whatsappRoutes from './routes/whatsappRoutes';
import schedulerRoutes from './routes/schedulerRoutes';
import { sessionService } from './services/sessionService';
import { schedulerService } from './services/schedulerService';

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Routes
import adminRoutes from './routes/adminRoutes';
import aiRoutes from './routes/aiRoutes';
import authRoutes from './routes/authRoutes';
import { authMiddleware } from './middleware/authMiddleware';

app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/ai', aiRoutes);
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
app.use('/api/banking', bankingRoutes);

// Banco Inter API Routes (Banking, Pix, Boletos, Webhooks)
import interBankingRoutes from './routes/interBankingRoutes';
app.use('/api/inter', interBankingRoutes);

// Banco Itaú API Routes (Banking, Pix, Boletos, Webhooks)
import itauBankingRoutes from './routes/itauBankingRoutes';
app.use('/api/itau', itauBankingRoutes);

// Approval Routes (Fila de aprovação para automações bancárias)
import approvalRoutes from './routes/approvalRoutes';
app.use('/api/approvals', approvalRoutes);

// Document Routes (Envio de documentos via WhatsApp)
import documentRoutes from './routes/documentRoutes';
app.use('/api/documents', documentRoutes);

// Email Routes
import emailRoutes from './routes/emailRoutes';
app.use('/api/email', emailRoutes);

// Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', server: 'CoolGroove Backend' });
});

// Socket.io initialization
import { socketService } from './services/socketService';

const server = app.listen(Number(config.port), '0.0.0.0', () => {
    console.log(`Backend running on http://0.0.0.0:${config.port}`);
});

// Initialize Socket.io with the HTTP server
socketService.init(server);

// Initialize WhatsApp Service
console.log('[Server] SessionService loaded.');

// Start Scheduler Worker (checks for pending messages every 30s)
schedulerService.startWorker();
console.log('[Server] SchedulerService worker started.');

// Initialize Banking Services
import { interApiService } from './services/interApiService';
import { itauApiService } from './services/itauApiService';

(async () => {
    try {
        await interApiService.initialize();
        console.log('[Server] Banco Inter API initialized.');
    } catch (e: any) {
        console.error('[Server] Failed to initialize Banco Inter:', e.message);
    }

    try {
        await itauApiService.initialize();
        // console.log('[Server] Banco Itaú API initialized.');
    } catch (e: any) {
        // Itaú pode ser opcional
    }
})();

// Graceful Shutdown Logic
const gracefulShutdown = async (signal: string) => {
    console.log(`\n[${signal}] Received. Starting graceful shutdown...`);

    // Safety Timeout: Force exit after 5 seconds if anything hangs
    setTimeout(() => {
        console.error('[Server] Shutdown timed out. Forcing exit.');
        process.exit(1);
    }, 5000).unref();

    // 1. Close HTTP Server (Stops accepting new connections)
    server.close((err) => {
        if (err) {
            console.error('[Server] Error closing HTTP server:', err);
        } else {
            console.log('[Server] HTTP server closed.');
        }
    });

    // 2. Stop Scheduler Worker
    schedulerService.stopWorker();

    // 3. Destroy WhatsApp Clients (Releases Chrome processes & Ports)
    try {
        await sessionService.destroy();
    } catch (e) {
        console.error('[Server] Error destroying WhatsApp service:', e);
    }

    console.log(`[${signal}] Shutdown complete. Exiting.`);
    process.exit(0);
};

// Monitor Signals (Nodemon sends SIGUSR2, Ctrl+C sends SIGINT)
process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.once('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // Nodemon restart
