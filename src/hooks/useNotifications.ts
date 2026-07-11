import { useCallback, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { useWhatsAppContext } from '../contexts/WhatsAppContext';
import { AppNotification, AppView } from '../types';
import { config } from '../config';
import { logger } from '../utils/logger';

const log = logger.child('Notifications');

const API = config.API_BASE_URL;

// #1315: intervalo de polling. Garante que uma notificação criada via notify_person
// apareça (em até 30s) mesmo quando o websocket está indisponível (ex.: túnel Cloudflare
// ou app cross-origin), cumprindo o critério de aceite da issue.
// Exportado para que os testes referenciem o mesmo valor em vez de hardcodear 30_000.
export const NOTIFICATION_POLL_INTERVAL_MS = 30_000;

/**
 * Faz o merge do feed do servidor com o estado local. O servidor é a fonte da verdade
 * (ordem, leitura, deleções), mas preservamos uma marcação "lida" otimista local que o
 * servidor ainda não refletiu — evita piscar o badge de volta a "não-lida" entre o clique
 * do usuário e o próximo ciclo de polling.
 */
function mergeNotifications(server: AppNotification[], prev: AppNotification[]): AppNotification[] {
    const prevById = new Map(prev.map(n => [n.id, n]));
    return server.map(s => {
        const local = prevById.get(s.id);
        if (local && local.read && !s.read) return { ...s, read: true };
        return s;
    });
}

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
        let timer: ReturnType<typeof setInterval> | null = null;

        const fetchNotifications = async () => {
            try {
                // credentials:'include' garante o cookie de sessão (dolapikey) mesmo cross-origin;
                // sem isso o feed dava 401 quando o app e o backend não são same-origin.
                const res = await fetch(`${API}/api/notifications?limit=50`, { credentials: 'include' });
                if (!res.ok) return;
                const data = await res.json();
                if (cancelled) return;
                const notes = (data.notifications || []).map(backendToAppNotification);
                setNotifications(prev => mergeNotifications(notes, prev));
            } catch (e) {
                log.error('Failed to fetch notifications', e);
            }
        };

        fetchNotifications();

        // #1315: polling a cada 30s. Backstop de entrega quando o socket cai/atrasa — assim uma
        // notificação criada via notify_person aparece no sino em até 30s, sem depender de reload.
        timer = setInterval(fetchNotifications, NOTIFICATION_POLL_INTERVAL_MS);

        // Reforça a atualização imediata quando a aba volta a ficar visível, em vez de aguardar
        // até o próximo tick de 30s (o setInterval não dispara enquanto a aba está em background).
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') fetchNotifications();
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            cancelled = true;
            if (timer) clearInterval(timer);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
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
            // Para prevenir falsificação de painel (phishing/spoofing) e estados fantasmas
            // que somem ao recarregar a página, mensagens diretas de WhatsApp não entram mais
            // na store global de notificações do sistema, mas podem ser roteadas para um Toast 
            // ou componente exclusivo no futuro.
            log.debug('Mensagem recebida via WhatsApp:', msg);
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
            // #1315: credentials:'include' em TODAS as ações (PUT/DELETE), igual ao GET do feed.
            // Sem isso, via túnel Cloudflare (cross-origin) o cookie dolapikey não é enviado e a
            // rota requireDolibarrLogin devolve 401 — "marcar como lida" parecia não funcionar.
            const auth = { credentials: 'include' as RequestCredentials };
            if (action === 'markRead' && id) {
                res = await fetch(`${API}/api/notifications/${id}/read`, { method: 'PUT', ...auth });
            } else if (action === 'markAllRead') {
                res = await fetch(`${API}/api/notifications/read-all`, { method: 'PUT', ...auth });
            } else if (action === 'clearAll') {
                res = await fetch(`${API}/api/notifications`, { method: 'DELETE', ...auth });
            } else if (action === 'dismiss' && id) {
                res = await fetch(`${API}/api/notifications/${id}`, { method: 'DELETE', ...auth });
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
