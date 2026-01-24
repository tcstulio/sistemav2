import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { config } from '../config';

interface WhatsAppContextType {
    socket: Socket | null;
    isConnected: boolean;
    // We can add global event listeners here or just expose socket
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

    useEffect(() => {
        const savedConfig = localStorage.getItem('coolgroove_config');
        let apiKey = '';
        if (savedConfig) {
            try {
                const parsed = JSON.parse(savedConfig);
                apiKey = parsed.apiKey || '';
            } catch (e) {
                console.error("Failed to parse config for socket auth");
            }
        }

        if (!apiKey) {
            console.warn('[WhatsAppProvider] No API Key found in coolgroove_config. Socket will not connect.');
            return;
        }

        console.log('[WhatsAppProvider] Connecting to Socket.IO...');
        const newSocket = io(config.SOCKET_URL || 'http://localhost:3000', {
            auth: { token: apiKey },
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 1000,
        });

        newSocket.on('connect', () => {
            console.log('[WhatsAppProvider] Connected: ', newSocket.id);
            setIsConnected(true);
        });

        newSocket.on('disconnect', (reason) => {
            console.log('[WhatsAppProvider] Disconnected:', reason);
            setIsConnected(false);
        });

        newSocket.on('connect_error', (err) => {
            console.error('[WhatsAppProvider] Connection Error:', err);
            setIsConnected(false);
        });

        socketRef.current = newSocket;
        setSocket(newSocket);

        return () => {
            console.log('[WhatsAppProvider] Disconnecting...');
            newSocket.disconnect();
        };
    }, []);

    return (
        <WhatsAppContext.Provider value={{ socket, isConnected }}>
            {children}
        </WhatsAppContext.Provider>
    );
};
