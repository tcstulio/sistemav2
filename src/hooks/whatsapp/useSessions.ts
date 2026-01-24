import { useState, useEffect, useCallback } from 'react';
import { useWhatsAppContext } from '../../contexts/WhatsAppContext'; // Adjust path
import { WhatsAppService } from '../../services/whatsappService';
import { WhatsAppAccount } from '../../types';
import { toast } from 'sonner';

export const useSessions = () => {
    const { socket } = useWhatsAppContext();
    const [sessions, setSessions] = useState<WhatsAppAccount[]>([]);
    const [loading, setLoading] = useState(true);

    const [qrCodes, setQrCodes] = useState<Record<string, string>>({});

    const fetchSessions = useCallback(async () => {
        setLoading(true);
        try {
            const data = await WhatsAppService.getAccounts();
            setSessions(data || []);
        } catch (error) {
            console.error('[useSessions] Failed to fetch sessions', error);
            toast.error('Erro ao carregar sessões');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchSessions();
    }, [fetchSessions]);

    // Socket Events
    useEffect(() => {
        if (!socket) return;

        const handleStatus = (data: { sessionId: string, status: string }) => {
            // console.log('[useSessions] Status Update:', data);
            setSessions(prev => {
                const exists = prev.find(s => s.id === data.sessionId);
                if (exists) {
                    return prev.map(s =>
                        s.id === data.sessionId ? { ...s, status: (data.status === 'SCAN_QR_CODE' ? 'qr_code' : data.status) as any } : s
                    );
                } else {
                    // New session appearing!
                    return [...prev, {
                        id: data.sessionId,
                        name: `Sessão ${data.sessionId}`,
                        status: (data.status === 'SCAN_QR_CODE' ? 'qr_code' : data.status) as any,
                        phoneNumber: '---',
                        platform: 'WAHA'
                    }];
                }
            });

            // If new session appeared or something changed drastically, maybe refetch?
            // For now, optimistic update is fine for status.

            // Clear QR if working
            if (data.status === 'WORKING' || data.status === 'connected') {
                setQrCodes(prev => {
                    const next = { ...prev };
                    delete next[data.sessionId];
                    return next;
                });
            }
        };

        const handleQr = async (data: { sessionId: string, qr: string }) => {
            // We received the RAW QR code string (signal that QR is ready).
            // Since we can't render raw QR without a library, and we don't want to rely on DataURIs causing lag,
            // we fetch the generated image from the backend (which handles the Auth headers via Service).

            // 1. Update status
            setSessions(prev => prev.map(s =>
                s.id === data.sessionId ? { ...s, status: 'qr_code' } : s
            ));

            // 2. Fetch Image
            try {
                const blob = await WhatsAppService.getQrCode(data.sessionId);
                if (blob) {
                    const url = URL.createObjectURL(blob);
                    setQrCodes(prev => ({ ...prev, [data.sessionId]: url }));
                }
            } catch (e) {
                console.error('Failed to load QR image', e);
            }
        };

        socket.on('session_status', handleStatus);
        socket.on('session_qr', handleQr);

        return () => {
            socket.off('session_status', handleStatus);
            socket.off('session_qr', handleQr);
        };
    }, [socket]);

    const startSession = async (sessionId: string) => {
        try {
            await WhatsAppService.startSession(sessionId);
            toast.success('Iniciando sessão...');
            // Status update will come via socket
        } catch (e: any) {
            toast.error('Erro ao iniciar sessão: ' + e.message);
        }
    };

    const stopSession = async (sessionId: string) => {
        try {
            await WhatsAppService.deleteSession(sessionId); // Delete/Stop
            toast.success('Sessão parada/removida');
            fetchSessions(); // Refresh list as it might be deleted
        } catch (e: any) {
            toast.error('Erro ao parar sessão: ' + e.message);
        }
    };

    return {
        sessions,
        loading,
        refreshSessions: fetchSessions,
        startSession,
        stopSession,
        qrCodes // Expose QR codes
    };
};
