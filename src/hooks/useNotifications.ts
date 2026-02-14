import { useEffect } from 'react';
import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';
import { useWhatsAppContext } from '../contexts/WhatsAppContext'; // Import context
import { AppNotification, AppView } from '../types';
import { logger } from '../utils/logger';

const log = logger.child('Notifications');

export const useNotifications = (
    setNotifications: React.Dispatch<React.SetStateAction<AppNotification[]>>,
    onNavigate: (view: string, id: string) => void // Relaxed type to string to match MainLayout adapter
) => {
    const { socket } = useWhatsAppContext();

    useEffect(() => {
        if (!Capacitor.isNativePlatform()) {
            log.debug('Push Notifications not supported on web/electron');
            return;
        }

        const registerNotifications = async () => {
            let permStatus = await PushNotifications.checkPermissions();

            if (permStatus.receive === 'prompt') {
                permStatus = await PushNotifications.requestPermissions();
            }

            if (permStatus.receive !== 'granted') {
                log.error('User denied permissions!');
                return;
            }

            await PushNotifications.register();
        };

        registerNotifications();

        // Listener for registration success
        const registrationListener = PushNotifications.addListener('registration', token => {
            log.debug('Push registration success', { token: token.value });
            // TODO: Send token to backend if needed
        });

        // Listener for registration error
        const registrationErrorListener = PushNotifications.addListener('registrationError', error => {
            log.error('Error on registration', error);
        });

        // Listener for notification received (foreground)
        const receivedListener = PushNotifications.addListener('pushNotificationReceived', notification => {
            log.debug('Push received', notification);

            const data = notification.data || {};

            // Generate in-app notification
            const newNote: AppNotification = {
                id: notification.id || String(Date.now()),
                title: notification.title || 'Nova Notificação',
                message: notification.body || '',
                date: Date.now(),
                read: false,
                type: (data.type as any) || 'info', // stock, invoice, ticket, info
                priority: 'medium',
                linkTo: data.view && data.id ? { view: data.view, id: data.id } : undefined
            };

            setNotifications(prev => [newNote, ...prev]);
        });

        // Listener for notification action (background/tapped)
        const actionListener = PushNotifications.addListener('pushNotificationActionPerformed', notification => {
            log.debug('Push action performed', notification);
            const data = notification.notification.data;
            if (data && data.view) {
                // Navigate to the screen
                onNavigate(data.view, data.id || '');
            }
        });

        return () => {
            // Cleanup listeners
            registrationListener.then(handle => handle.remove());
            registrationErrorListener.then(handle => handle.remove());
            receivedListener.then(handle => handle.remove());
            actionListener.then(handle => handle.remove());
        };

    }, [setNotifications, onNavigate]);

    useEffect(() => {
        if (!socket) return;

        const handleMessage = (msg: any) => {
            // Ignore own messages
            if (msg.fromMe) return;

            const newNote: AppNotification = {
                id: 'wa_' + msg.id,
                title: msg.senderName || msg.pushName || 'WhatsApp',
                message: msg.body || (msg.hasMedia ? '📎 Mídia' : 'Nova mensagem'),
                date: (msg.timestamp || Date.now() / 1000) * 1000,
                read: false,
                type: 'whatsapp',
                priority: 'medium',
                linkTo: { view: 'whatsapp', id: '' }
            };

            setNotifications(prev => [newNote, ...prev]);
        };

        socket.on('whatsapp_message', handleMessage);

        return () => {
            socket.off('whatsapp_message', handleMessage);
        };
    }, [socket, setNotifications]);
};
