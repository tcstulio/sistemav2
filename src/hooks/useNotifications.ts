import { useCallback, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { useWhatsAppContext } from '../contexts/WhatsAppContext';
import { AppNotification, AppView } from '../types';
import { config } from '../config';
import { logger } from '../utils/logger';

const log = logger.child('Notifications');

const API = config.API_BASE_URL;

function backendToAppNotification(raw: any): AppNotification {
    return {
        id: raw.id || String(Date.now()),
        event: raw.event || raw.type,
        type: mapEventType(raw.event || raw.type),
        title: raw.title || 'Notificação',
        message: raw.message || raw.body || '',
        date: raw.createdAt || raw.date || Date.now(),
        priority: raw.priority || 'medium',
        read: raw.read || false,
        linkTo: parseLinkTo(raw.linkTo || raw.link_to),
        senderName: raw.senderName,
        channels: raw.channels || raw.deliveredTo,
        recipient: raw.recipient,
        scope: raw.scope,
    };
}

function mapEventType(event: string): AppNotification['type'] {
    if (!event) return 'info';
    if (event.startsWith('invoice') || event.startsWith('payment')) return 'invoice';
    if (event.startsWith('stock')) return 'stock';
    if (event.startsWith('ticket')) return 'ticket';
    if (event.startsWith('agent')) return 'agent';
    if (event.startsWith('task')) return 'task';
    if (event === 'whatsapp' || event.startsWith('whatsapp')) return 'whatsapp';
    if (event === 'email' || event.startsWith('email')) return 'email';
    return 'info';
}

function parseLinkTo(linkTo: any): { view: AppView; id: string } | undefined {
    if (!linkTo) return undefined;
    if (typeof linkTo === 'object' && linkTo.view) return linkTo as { view: AppView; id: string };
    if (typeof linkTo === 'string') {
        const [view, id] = linkTo.split('/');
        if (view) return { view: view as AppView, id: id || '' };
    }
    return undefined;
}

export interface UseNotificationsResult {
    notifications: AppNotification[];
    unreadCount: number;
    markRead: (id: string) => Promise<void>;
    markAllRead: () => Promise<void>;
    clearAll: () => Promise<void>;
}

export const useNotifications = (
    setNotifications: React.Dispatch<React.SetStateAction<AppNotification[]>>,
    onNavigate: (view: string, id: string) => void,
) => {
    const { socket } = useWhatsAppContext();
    const onNavigateRef = useRef(onNavigate);
    onNavigateRef.current = onNavigate;

    useEffect(() => {
        let cancelled = false;

        const fetchNotifications = async () => {
            try {
                const res = await fetch(`${API}/api/notifications?limit=50`);
                if (!res.ok) return;
                const data = await res.json();
                if (cancelled) return;
                const notes = (data.notifications || []).map(backendToAppNotification);
                setNotifications(notes);
            } catch (e) {
                log.error('Failed to fetch notifications', e);
            }
        };

        fetchNotifications();
        return () => { cancelled = true; };
    }, [setNotifications]);

    useEffect(() => {
        if (!socket) return;

        const handleNotification = (raw: any) => {
            const note = backendToAppNotification(raw);
            setNotifications(prev => {
                if (prev.some(n => n.id === note.id)) return prev;
                return [note, ...prev];
            });
        };

        const handleWhatsAppMessage = (msg: any) => {
            if (msg.fromMe) return;
            const note: AppNotification = {
                id: 'wa_' + msg.id,
                type: 'whatsapp',
                title: msg.senderName || msg.pushName || 'WhatsApp',
                message: msg.body || (msg.hasMedia ? '📎 Mídia' : 'Nova mensagem'),
                date: (msg.timestamp || Date.now() / 1000) * 1000,
                priority: 'medium',
                read: false,
                linkTo: { view: 'whatsapp', id: '' },
            };
            setNotifications(prev => [note, ...prev]);
        };

        socket.on('notification', handleNotification);
        socket.on('whatsapp_message', handleWhatsAppMessage);

        return () => {
            socket.off('notification', handleNotification);
            socket.off('whatsapp_message', handleWhatsAppMessage);
        };
    }, [socket, setNotifications]);

    useEffect(() => {
        if (!Capacitor.isNativePlatform()) return;

        let regListener: any, errListener: any, recvListener: any, actListener: any;

        const register = async () => {
            let perm = await PushNotifications.checkPermissions();
            if (perm.receive === 'prompt') perm = await PushNotifications.requestPermissions();
            if (perm.receive !== 'granted') return;
            await PushNotifications.register();
        };

        register();

        PushNotifications.addListener('registration', token => {
            log.debug('Push registration success', { token: token.value });
        }).then(h => { regListener = h; });

        PushNotifications.addListener('registrationError', error => {
            log.error('Push registration error', error);
        }).then(h => { errListener = h; });

        PushNotifications.addListener('pushNotificationReceived', notification => {
            const data = notification.data || {};
            const note: AppNotification = {
                id: notification.id || String(Date.now()),
                type: (data.type as any) || 'info',
                title: notification.title || 'Nova Notificação',
                message: notification.body || '',
                date: Date.now(),
                read: false,
                priority: 'medium',
                linkTo: data.view && data.id ? { view: data.view, id: data.id } : undefined,
            };
            setNotifications(prev => [note, ...prev]);
        }).then(h => { recvListener = h; });

        PushNotifications.addListener('pushNotificationActionPerformed', notification => {
            const data = notification.notification.data;
            if (data?.view) onNavigateRef.current(data.view, data.id || '');
        }).then(h => { actListener = h; });

        return () => {
            regListener?.remove();
            errListener?.remove();
            recvListener?.remove();
            actListener?.remove();
        };
    }, [setNotifications]);
};

export const useNotificationActions = () => {
    return useCallback(async (action: 'markRead' | 'markAllRead' | 'clearAll' | 'dismiss', id?: string): Promise<boolean> => {
        try {
            let res: Response | undefined;
            if (action === 'markRead' && id) {
                res = await fetch(`${API}/api/notifications/${id}/read`, { method: 'PUT' });
            } else if (action === 'markAllRead') {
                res = await fetch(`${API}/api/notifications/read-all`, { method: 'PUT' });
            } else if (action === 'clearAll') {
                res = await fetch(`${API}/api/notifications`, { method: 'DELETE' });
            } else if (action === 'dismiss' && id) {
                res = await fetch(`${API}/api/notifications/${id}`, { method: 'DELETE' });
            }
            if (res && !res.ok) {
                log.error(`Notification action ${action} falhou: HTTP ${res.status}`);
                return false;
            }
            return true;
        } catch (e) {
            log.error(`Failed to ${action}`, e);
            return false;
        }
    }, []);
};
