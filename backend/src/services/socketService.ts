import { Server as SocketIOServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { logger } from '../utils/logger';

const log = logger.child('SocketService');

let io: SocketIOServer | null = null;

export const socketService = {
    init: (httpServer: HttpServer) => {
        const allowedOrigins = [
            'https://app.coolgroove.com.br',
            'https://sistema.coolgroove.com.br',
            ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:3003'] : [])
        ];

        io = new SocketIOServer(httpServer, {
            cors: {
                origin: allowedOrigins,
                methods: ["GET", "POST"],
                credentials: true
            }
        });

        // Authentication Middleware
        io.use(async (socket, next) => {
            const token = socket.handshake.auth.token || socket.handshake.headers['dolapikey'];
            if (!token) {
                return next(new Error("Authentication error: No API Key provided"));
            }

            // We can reuse the cache logic or just validate
            // For sockets, we might want to accept if it was valid recently? 
            // Let's use the service directly.
            try {
                const { dolibarrService } = require('./dolibarrService'); // Lazy load
                // We should ideally use the same cache as the HTTP middleware to avoid double hits
                // But accessing that local Map is hard. 
                // Let's just validate. Socket connections are infrequent (once per session).
                const isValid = await dolibarrService.validateApiKey(token);
                if (isValid) {
                    next();
                } else {
                    next(new Error("Authentication error: Invalid API Key"));
                }
            } catch (e) {
                log.error("Socket Auth Check Failed", e);
                next(new Error("Authentication failed"));
            }
        });

        io.on('connection', (socket) => {
            log.info(`Frontend Client Connected: ${socket.id}`);

            socket.on('disconnect', () => {
                log.info(`Client disconnected: ${socket.id}`);
            });
        });

        log.info("Socket.io initialized");
    },

    getIO: () => {
        if (!io) {
            throw new Error("Socket.io not initialized!");
        }
        return io;
    },

    emit: (event: string, data: any) => {
        if (io) {
            log.debug(`Emitting event: ${event}`, data);
            io.emit(event, data);
        } else {
            log.warn(`Socket.io not initialized, cannot emit event: ${event}`);
        }
    }
};
