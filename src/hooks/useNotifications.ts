import { useEffect } from 'react';
import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';
import { useWhatsAppContext } from '../contexts/WhatsAppContext'; // Import context
import { AppNotification, AppView } from '../types';
import { useDolibarr } from '../context/DolibarrContext';
import { DolibarrService } from '../services/dolibarrService';

export const useNotifications = (
    setNotifications: React.Dispatch<React.SetStateAction<AppNotification[]>>,
    onNavigate: (view: string, id: string) => void // Relaxed type to string to match MainLayout adapter
) => {
    const { socket } = useWhatsAppContext();
    const { currentUser, config } = useDolibarr();

    useEffect(() => {
        if (!Capacitor.isNativePlatform()) {
            console.log('Push Notifications not supported on web/electron');
            return;
        }

        const registerNotifications = async () => {
            let permStatus = await PushNotifications.checkPermissions();

            if (permStatus.receive === 'prompt') {
                permStatus = await PushNotifications.requestPermissions();
            }

            if (permStatus.receive !== 'granted') {
                console.error('User denied permissions!');
                return;
            }

            await PushNotifications.register();
        };

        registerNotifications();

        // Listener for registration success
        const registrationListener = PushNotifications.addListener('registration', token => {
            console.log('Push registration success, token: ' + token.value);

            // Send token to backend if needed
            if (currentUser && config) {
                const existingToken = currentUser.array_options?.options_push_token;

                if (existingToken !== token.value) {
                    console.log('Updating push token on backend...');

                    // Prepare updated options
                    // Ensure we preserve existing options
                    const updatedOptions = {
                        ...(currentUser.array_options || {}),
                        options_push_token: token.value
                    };

                    DolibarrService.updateUser(config, currentUser.id, {
                        array_options: updatedOptions
                    }).then(() => {
                        console.log('Push token updated successfully.');
                    }).catch(err => {
                        console.error('Failed to update push token:', err);
                    });
                } else {
                    console.log('Push token already up to date.');
                }
            } else {
                console.log('Cannot update push token: User not logged in or config missing.');
            }
        });

        // Listener for registration error
        const registrationErrorListener = PushNotifications.addListener('registrationError', error => {
            console.error('Error on registration: ' + JSON.stringify(error));
        });

        // Listener for notification received (foreground)
        const receivedListener = PushNotifications.addListener('pushNotificationReceived', notification => {
            console.log('Push received: ' + JSON.stringify(notification));

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
            console.log('Push action performed: ' + JSON.stringify(notification));
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

    }, [setNotifications, onNavigate, currentUser, config]);

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
