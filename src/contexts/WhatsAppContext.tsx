import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { config } from '../config';
import { useDolibarr } from '../context/DolibarrContext';
import { logger } from '../utils/logger';

const log = logger.child('WhatsAppCtx');

interface WhatsAppContextType {
    socket: Socket | null;
    isConnected: boolean;
}

const WhatsAppContext = createContext<WhatsAppContextType>({
    socket: null,
    isConnected: false
});

export const useWhatsAppContext = () => useContext(WhatsAppContext);

export const WhatsAppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [socket, setSocket] = useState<Socket | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const socketRef = useRef<Socket | null>(null);
    const { config: dolibarrConfig } = useDolibarr();
    const apiKey = dolibarrConfig?.apiKey || '';

    useEffect(() => {
        // Don't connect until we have a valid API key
        if (!apiKey) {
            return;
        }

        // Disconnect previous socket if apiKey changed
        if (socketRef.current) {
            socketRef.current.disconnect();
            socketRef.current = null;
        }

        log.debug('Connecting to Socket.IO...');
        const newSocket = io(config.SOCKET_URL, {
            auth: { token: apiKey },
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 1000,
        });

        newSocket.on('connect', () => {
            log.debug('Connected', { socketId: newSocket.id });
            setIsConnected(true);
        });

        newSocket.on('disconnect', (reason) => {
            log.debug('Disconnected', { reason });
            setIsConnected(false);
        });

        newSocket.on('connect_error', (err) => {
            log.error('Connection Error', err);
            setIsConnected(false);
        });

        socketRef.current = newSocket;
        setSocket(newSocket);

        return () => {
            if (socketRef.current) {
                log.debug('Disconnecting...');
                socketRef.current.disconnect();
                socketRef.current = null;
            }
        };
    }, [apiKey]);

    return (
        <WhatsAppContext.Provider value={{ socket, isConnected }}>
            {children}
        </WhatsAppContext.Provider>
    );
};
