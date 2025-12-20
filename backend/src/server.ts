import express from 'express';
import cors from 'cors';
import { config } from './config/env';
import whatsappRoutes from './routes/whatsappRoutes';
// import { wahaService } from './services/wahaService'; // DEPRECATED
import { sessionService } from './services/sessionService'; // ADDED

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

// Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', server: 'Doligen Backend' });
});

// Socket.io initialization
import { socketService } from './services/socketService';

const server = app.listen(config.port, () => {
    console.log(`Backend running on http://localhost:${config.port}`);
});

// Initialize Socket.io with the HTTP server
socketService.init(server);

// Initialize WhatsApp Service
// sessionService auto-initializes on import (loads persisted sessions)
// But we can log it
console.log('[Server] SessionService loaded.');

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

    // 2. Destroy WhatsApp Clients (Releases Chrome processes & Ports)
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
