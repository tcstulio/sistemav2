import { Server as SocketIOServer } from 'socket.io';
import { Server as HttpServer } from 'http';

let io: SocketIOServer | null = null;

export const socketService = {
    init: (httpServer: HttpServer) => {
        io = new SocketIOServer(httpServer, {
            cors: {
                origin: "*", // Allow all origins for now (dev mode)
                methods: ["GET", "POST"]
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
                console.error("Socket Auth Check Failed", e);
                next(new Error("Authentication failed"));
            }
        });

        io.on('connection', (socket) => {
            console.log('Frontend Client Connected:', socket.id);

            socket.on('disconnect', () => {
                console.log('Client disconnected:', socket.id);
            });
        });

        console.log("Socket.io initialized");
    },

    getIO: () => {
        if (!io) {
            throw new Error("Socket.io not initialized!");
        }
        return io;
    },

    emit: (event: string, data: any) => {
        if (io) {
            console.log(`[SocketService] Emitting event: ${event}`, data);
            io.emit(event, data);
        } else {
            console.warn("Socket.io not initialized, cannot emit event:", event);
        }
    }
};
