/**
 * useApprovalSocket
 *
 * Hook reutilizável que assina os 4 eventos de socket da fila de aprovação
 * (approval_pending / approval_executed / approval_rejected / approval_failed),
 * já emitidos pelo backend (backend/src/services/approvalService.ts:181/262/275/308).
 *
 * Mesmo padrão de tempo real das demais telas (system_events / useNotifications):
 * o socket é obtido de useWhatsAppContext; cada evento é registrado via
 * socket.on(event, handler) e removido no cleanup do useEffect (socket.off),
 * garantindo que múltiplas montagens da tela não acumulem listeners duplicados
 * nem gerem memory leaks (#1222).
 *
 * `onEvent` é mantido num ref para sempre invocar a versão mais recente sem
 * precisar re-registrar os listeners a cada render (a dependência do efeito é
 * apenas o socket — versão estável fornecida pelo contexto).
 */

import { useEffect, useRef } from 'react';
import { useWhatsAppContext } from '../contexts/WhatsAppContext';
import type { PendingAction } from '../services/approvalService';

// Os 4 eventos emitidos pelo backend.
export type ApprovalSocketEvent =
    | 'approval_pending'
    | 'approval_executed'
    | 'approval_rejected'
    | 'approval_failed';

export const APPROVAL_SOCKET_EVENTS: ApprovalSocketEvent[] = [
    'approval_pending',
    'approval_executed',
    'approval_rejected',
    'approval_failed',
];

// Payload normalizado — união dos campos enviados nos 4 pontos do backend.
// Campos opcionais porque cada evento envia um subconjunto diferente.
export interface ApprovalSocketPayload {
    actionId?: string;
    action?: PendingAction;
    success?: boolean;
    result?: unknown;
    error?: string;
    rejectedBy?: string;
    reason?: string;
    message?: string;
}

export type ApprovalSocketHandler = (
    event: ApprovalSocketEvent,
    payload: ApprovalSocketPayload,
) => void;

export function useApprovalSocket(onEvent: ApprovalSocketHandler): void {
    const { socket } = useWhatsAppContext();

    // Sempre chama a versão mais recente do handler (captura closures frescas do
    // componente — ex.: fetchData/refs — sem re-registrar os listeners no socket).
    // Atualização feita num effect (pós-render) para respeitar a regra
    // react-hooks/refs: qualquer evento de socket é assíncrono e só dispara após o
    // commit, quando o ref já foi atualizado.
    const handlerRef = useRef(onEvent);
    useEffect(() => {
        handlerRef.current = onEvent;
    });

    useEffect(() => {
        if (!socket) return;

        const subscriptions = APPROVAL_SOCKET_EVENTS.map((eventName) => {
            const handler = (raw: unknown) => {
                const payload: ApprovalSocketPayload =
                    raw && typeof raw === 'object' ? (raw as ApprovalSocketPayload) : {};
                handlerRef.current(eventName, payload);
            };
            socket.on(eventName, handler);
            return { eventName, handler };
        });

        return () => {
            for (const { eventName, handler } of subscriptions) {
                socket.off(eventName, handler);
            }
        };
    }, [socket]);
}
