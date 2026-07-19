/**
 * ChatMessages (#1577)
 *
 * Componente de chat do assistente baseado em JOBS assíncronos (POST /api/ai/generate-reply-async
 * → polling /api/ai/jobs/:id). Diferente do ChatInterface (comentários persistidos no Dolibarr),
 * este módulo conversa com o agente de IA em streaming via jobs.
 *
 * Features obrigatórias (#1577):
 *  - Botão "Cancelar" visível apenas enquanto há um job ativo (status queued/running). Some
 *    ao concluir (done/error/cancelled).
 *  - Ao clicar em Cancelar → POST /api/chat/jobs/:id/cancel. Quando o evento de socket
 *    'chat:job:cancelled' chega, o `partialSummary` é exibido na UI como um bubble especial.
 *  - Hook de Page Visibility: quando a aba fica oculta durante um job ativo, envia
 *    POST /api/chat/jobs/:id/visibility { hidden: true } (e { hidden: false } ao voltar).
 *    Reage em <500ms (event-driven via usePageVisibility).
 *  - Config local (localStorage) para desativar notificações — persiste entre sessões.
 *
 * O socket é criado localmente (mesmo padrão do TaskConsole): um único socket.io por
 * instância montada, desconectado no cleanup. O listener de 'chat:job:cancelled' é
 * registrado UMA vez e removido no unmount.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import io, { Socket } from 'socket.io-client';
import { Send, Loader2, X, Bell, BellOff } from 'lucide-react';
import { toast } from 'sonner';
import { AiService, ChatJobProgress } from '../../services/aiService';
import { usePageVisibility } from '../../hooks/usePageVisibility';
import { safeStorage } from '../../utils/safeStorage';
import { logger } from '../../utils/logger';

// ---- Config local (localStorage) ---------------------------------------------------

// Chave única p/ a preference de notificações deste componente. Valores:
//   { notificationsEnabled: boolean }
// Default: habilitado (true) — só desativa se o usuário clicar no toggle.
const CHAT_MESSAGES_CONFIG_KEY = 'coolgroove_chat_messages_config';

interface ChatMessagesConfig {
    notificationsEnabled: boolean;
}

function loadConfig(): ChatMessagesConfig {
    return safeStorage.getJSON<ChatMessagesConfig>(CHAT_MESSAGES_CONFIG_KEY, {
        notificationsEnabled: true,
    });
}

function saveConfig(cfg: ChatMessagesConfig): void {
    safeStorage.setJSON(CHAT_MESSAGES_CONFIG_KEY, cfg);
}

// ---- Component ----------------------------------------------------------------------

export interface ChatMessagesProps {
    /** ID de sessão de chat existente (opcional). Se ausente, o backend cria uma. */
    sessionId?: string;
    /** Contexto da página atual repassado ao agente (ex.: "Tela: Clientes"). */
    pageContext?: string;
    /** ClassName customizada para o root (altura controlada pelo pai). */
    className?: string;
}

interface ChatBubble {
    id: string;
    role: 'user' | 'model' | 'system';
    text: string;
    /** Marcador de bubble especial de cancelamento (resumo parcial exibido pelo evento 'cancelled'). */
    isCancelledSummary?: boolean;
}

/** Estado interno do job ativo — `null` quando não há job em andamento. */
interface ActiveJobState {
    jobId: string;
    startedAt: number;
}

const PROCESSING_TIMEOUT_MS = 40 * 60 * 1000;

function newBubbleId(): string {
    return `bubble-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const ChatMessages: React.FC<ChatMessagesProps> = ({
    sessionId,
    pageContext,
    className,
}) => {
    const [messages, setMessages] = useState<ChatBubble[]>([]);
    const [input, setInput] = useState('');
    const [activeJob, setActiveJob] = useState<ActiveJobState | null>(null);
    const [isSending, setIsSending] = useState(false);
    const [cancelledSummary, setCancelledSummary] = useState<string | null>(null);
    const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(
        () => loadConfig().notificationsEnabled,
    );

    const { isVisible } = usePageVisibility();

    const socketRef = useRef<Socket | null>(null);
    const inputRef = useRef<HTMLTextAreaElement | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);

    // activeJob é lido dentro de handlers de socket/effect estáveis; mantemos um ref
    // sincronizado para que o listener de 'chat:job:cancelled' (registrado 1x) sempre
    // enxergue o jobId atual sem re-assinar o socket a cada render.
    const activeJobRef = useRef<ActiveJobState | null>(null);
    useEffect(() => {
        activeJobRef.current = activeJob;
    }, [activeJob]);

    const isProcessing = !!activeJob;

    // ---- Socket: assina 'chat:job:cancelled' --------------------------------------

    useEffect(() => {
        const token = (() => {
            try {
                const saved = safeStorage.getJSON<Record<string, unknown>>('coolgroove_config', {});
                return (saved.apiKey as string) || '';
            } catch {
                return '';
            }
        })();

        const socket = io({ auth: { token }, transports: ['websocket', 'polling'] });
        socketRef.current = socket;

        const onCancelled = (payload: { jobId?: string; partialSummary?: string }) => {
            // Só reage se o evento for para o job ATIVO neste componente. Evita cross-talk
            // entre múltiplas instâncias do ChatMessages (ex.: uma em outra aba).
            const current = activeJobRef.current;
            if (!current) return;
            if (payload?.jobId && payload.jobId !== current.jobId) return;

            const summary = payload?.partialSummary || 'Operação cancelada.';
            setCancelledSummary(summary);
            // Adiciona um bubble especial sinalizando o cancelamento (aceite #1577 item 2).
            setMessages((prev) => [
                ...prev,
                {
                    id: newBubbleId(),
                    role: 'system',
                    text: summary,
                    isCancelledSummary: true,
                },
            ]);
            setActiveJob(null);
            if (notificationsEnabled) {
                toast.info('Operação cancelada', { description: summary.slice(0, 120) });
            }
        };

        socket.on('chat:job:cancelled', onCancelled);

        return () => {
            socket.off('chat:job:cancelled', onCancelled);
            socket.disconnect();
            socketRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ---- Sinal de Page Visibility -------------------------------------------------
    //
    // Sempre que `isVisible` muda DURANTE um job ativo, envia o sinal correspondente
    // ao backend. O contrato é hidden = !isVisible. Reage em <500ms porque o hook é
    // event-driven (visibilitychange dispara no instante da troca de aba).

    const sendVisibilitySignal = useCallback(async (jobId: string, hidden: boolean) => {
        try {
            await axios.post(
                `/api/chat/jobs/${jobId}/visibility`,
                { hidden },
                { headers: { Authorization: `Bearer ${getToken()}` } },
            );
        } catch (err) {
            // Sinal best-effort: não derruba a UX se o backend recusar (job já expirou etc.).
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.warn?.(`[ChatMessages] sinal de visibilidade falhou para ${jobId}: ${errMsg}`);
        }
    }, []);

    useEffect(() => {
        // Só sinaliza quando há um job ativo — visibilidade fora de job é irrelevante.
        if (!activeJob) return;
        void sendVisibilitySignal(activeJob.jobId, !isVisible);
    }, [isVisible, activeJob, sendVisibilitySignal]);

    // ---- Reset de cancelledSummary quando um novo job inicia ---------------------

    useEffect(() => {
        if (activeJob && cancelledSummary) {
            setCancelledSummary(null);
        }
    }, [activeJob, cancelledSummary]);

    // ---- Auto-scroll para a última mensagem --------------------------------------

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    // ---- Toggle de notificações (localStorage) -----------------------------------

    const toggleNotifications = useCallback(() => {
        // Lê o valor ATUAL via ref funcional p/ evitar deps efeitos colaterais dentro
        // do updater (anti-pattern em React estrito — updaters devem ser puros).
        setNotificationsEnabled((prev) => {
            const next = !prev;
            // Efeitos colaterais (persistência + toast) acontecem fora do updater.
            // Usamos microtask para garantir que o toast só apareça depois do commit
            // (visualmente é instantâneo, mas evita warns do StrictMode).
            queueMicrotask(() => {
                saveConfig({ notificationsEnabled: next });
                toast.success(next ? 'Notificações ativadas' : 'Notificações desativadas');
            });
            return next;
        });
    }, []);

    // ---- Envio de mensagem -------------------------------------------------------

    const handleSend = useCallback(async () => {
        const trimmed = input.trim();
        if (!trimmed || isSending || isProcessing) return;

        const userBubble: ChatBubble = { id: newBubbleId(), role: 'user', text: trimmed };
        setMessages((prev) => [...prev, userBubble]);
        setInput('');
        setIsSending(true);
        // Marca o job ativo IMEDIATAMENTE antes de ter o jobId real — assim o botão
        // Cancelar aparece desde o início. O jobId é atualizado quando o callback
        // onJobStarted dispara.
        const placeholderStartedAt = Date.now();
        setActiveJob({ jobId: '', startedAt: placeholderStartedAt });

        try {
            const result = await AiService.chatWithData(
                trimmed,
                [], // histórico real vive no backend (issue #1151)
                undefined,
                sessionId,
                pageContext,
                (jobId: string) => {
                    // #1577: captura o jobId assim que enfileirado para habilitar o
                    // cancelamento e o sinal de visibilidade.
                    setActiveJob({ jobId, startedAt: Date.now() });
                },
                (_p: ChatJobProgress) => {
                    // Heartbeat de progresso — poderíamos atualizar um indicador "Xs".
                    // Por ora apenas garante que o polling continue vivo.
                },
            );

            const replyText =
                (result as { reply?: string })?.reply ||
                'Sem resposta do assistente.';
            setMessages((prev) => [
                ...prev,
                { id: newBubbleId(), role: 'model', text: replyText },
            ]);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setMessages((prev) => [
                ...prev,
                { id: newBubbleId(), role: 'system', text: `Erro: ${msg}` },
            ]);
        } finally {
            setIsSending(false);
            setActiveJob(null);
            inputRef.current?.focus();
        }
    }, [input, isSending, isProcessing, sessionId, pageContext]);

    // ---- Cancelamento ------------------------------------------------------------

    const handleCancel = useCallback(async () => {
        const current = activeJobRef.current;
        if (!current?.jobId) {
            // Job ainda não tem id (não terminou o enqueue): não há o que cancelar.
            // Mantém o estado ativo — o usuário verá o Cancelar habilitar em instantes.
            return;
        }
        try {
            await axios.post(
                `/api/chat/jobs/${current.jobId}/cancel`,
                {},
                { headers: { Authorization: `Bearer ${getToken()}` } },
            );
            // O estado será atualizado quando o evento 'chat:job:cancelled' chegar via socket.
            // Se o socket falhar, o polling do chatWithData perceberá o status cancelled.
            toast.success('Cancelamento solicitado');
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Falha ao cancelar.';
            toast.error(`Não foi possível cancelar: ${msg}`);
        }
    }, []);

    // ---- Timeout de segurança: expira o job se passar do teto absoluto -----------

    useEffect(() => {
        if (!activeJob) return;
        const remaining = PROCESSING_TIMEOUT_MS - (Date.now() - activeJob.startedAt);
        const t = setTimeout(() => {
            if (activeJobRef.current?.jobId === activeJob.jobId) {
                setActiveJob(null);
                setMessages((prev) => [
                    ...prev,
                    { id: newBubbleId(), role: 'system', text: 'Tempo limite excedido.' },
                ]);
            }
        }, Math.max(remaining, 0));
        return () => clearTimeout(t);
    }, [activeJob]);

    // ---- Render ------------------------------------------------------------------

    const placeHolder = useMemo(() => {
        if (isSending || isProcessing) return 'Processando...';
        return 'Digite sua mensagem...';
    }, [isSending, isProcessing]);

    return (
        <div
            data-testid="chat-messages-root"
            className={`flex flex-col min-h-0 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 overflow-hidden ${className || ''}`}
            style={{ height: '100%' }}
        >
            {/* Header */}
            <div className="p-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex justify-between items-center">
                <h3 className="font-medium text-gray-700 dark:text-gray-200 text-sm">
                    Assistente
                </h3>
                <button
                    type="button"
                    data-testid="notifications-toggle"
                    onClick={toggleNotifications}
                    className="p-2 text-gray-400 hover:text-blue-500"
                    title={notificationsEnabled ? 'Desativar notificações' : 'Ativar notificações'}
                    aria-label={notificationsEnabled ? 'Desativar notificações' : 'Ativar notificações'}
                    aria-pressed={notificationsEnabled}
                >
                    {notificationsEnabled ? <Bell size={16} /> : <BellOff size={16} />}
                </button>
            </div>

            {/* Messages */}
            <div
                ref={scrollRef}
                data-testid="chat-messages-list"
                className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3 bg-gray-50/50 dark:bg-gray-900/50"
            >
                {messages.length === 0 && !isProcessing && (
                    <div className="text-center text-gray-400 py-10 text-sm">
                        Envie uma mensagem para iniciar.
                    </div>
                )}

                {messages.map((m) => {
                    const isUser = m.role === 'user';
                    const isModel = m.role === 'model';

                    if (m.isCancelledSummary) {
                        return (
                            <div
                                key={m.id}
                                data-testid={`cancelled-summary-${m.id}`}
                                role="status"
                                className="mx-auto max-w-[90%] text-center text-xs bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-700 rounded-lg p-3"
                            >
                                <strong>Resumo parcial do cancelamento:</strong>
                                <div className="mt-1 whitespace-pre-wrap">{m.text}</div>
                            </div>
                        );
                    }

                    return (
                        <div
                            key={m.id}
                            className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                        >
                            <div
                                className={`max-w-[80%] rounded-lg p-3 shadow-sm text-sm ${
                                    isUser
                                        ? 'bg-blue-600 text-white rounded-tr-none'
                                        : isModel
                                            ? 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 border border-gray-200 dark:border-gray-600 rounded-tl-none'
                                            : 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-700'
                                }`}
                            >
                                <div className="whitespace-pre-wrap">{m.text}</div>
                            </div>
                        </div>
                    );
                })}

                {isProcessing && (
                    <div
                        data-testid="processing-indicator"
                        className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400"
                    >
                        <Loader2 size={14} className="animate-spin" />
                        <span>Processando...</span>
                        <button
                            type="button"
                            data-testid="cancel-job-btn"
                            onClick={handleCancel}
                            disabled={!activeJob?.jobId}
                            className="ml-2 inline-flex items-center gap-1 px-2 py-1 rounded bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50 border border-red-200 dark:border-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Cancelar operação"
                            aria-label="Cancelar operação"
                        >
                            <X size={12} />
                            Cancelar
                        </button>
                    </div>
                )}
            </div>

            {/* Input */}
            <div className="p-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex items-end gap-2 flex-shrink-0">
                <textarea
                    ref={inputRef}
                    data-testid="chat-messages-input"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            void handleSend();
                        }
                    }}
                    placeholder={placeHolder}
                    rows={1}
                    disabled={isSending || isProcessing}
                    className="flex-1 resize-none text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-gray-800 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
                <button
                    type="button"
                    data-testid="chat-messages-send"
                    onClick={() => void handleSend()}
                    disabled={isSending || isProcessing || !input.trim()}
                    aria-label="Enviar mensagem"
                    className="bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    {isSending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                </button>
            </div>
        </div>
    );
};

function getToken(): string {
    try {
        const saved = safeStorage.getJSON<Record<string, unknown>>('coolgroove_config', {});
        return (saved.apiKey as string) || '';
    } catch {
        return '';
    }
}

export default ChatMessages;
