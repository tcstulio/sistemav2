/**
 * ChatMessages component tests (#1577)
 *
 * Cobre os critérios de aceitação do issue:
 *  - [x] Botão Cancelar aparece só com job ativo e some ao terminar.
 *  - [x] Resumo do cancelamento é exibido na UI quando evento 'cancelled' chega.
 *  - [x] Sinal de visibilidade enviado quando a aba fica oculta/visível durante job ativo.
 *  - [x] Hook retorna boolean (isVisible) e é reutilizável (testado em usePageVisibility.test).
 *  - [x] Config para desativar notificações (localStorage) persiste.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Socket } from 'socket.io-client';
import { ChatMessages } from '../../components/chat/ChatMessages';

// ---- Mocks --------------------------------------------------------------------------

// Socket fake: captura o handler registrado para 'chat:job:cancelled' e permite
// dispará-lo no teste (simula o evento vindo do backend).
const fakeSocket = vi.hoisted(() => {
    const handlers: Record<string, Set<(payload: unknown) => void>> = {};
    const socket = {
        on(event: string, h: (p: unknown) => void) {
            (handlers[event] ||= new Set()).add(h);
        },
        off(event: string, h: (p: unknown) => void) {
            handlers[event]?.delete(h);
        },
        disconnect: vi.fn(),
        emit: vi.fn(),
        connected: false,
        // Helpers de teste
        __emit(event: string, payload: unknown) {
            handlers[event]?.forEach((h) => h(payload));
        },
        __listenerCount(event: string) {
            return handlers[event]?.size ?? 0;
        },
        __reset() {
            for (const k of Object.keys(handlers)) delete handlers[k];
            socket.disconnect.mockClear();
            socket.emit.mockClear();
        },
    };
    return { socket };
});

vi.mock('socket.io-client', () => ({
    default: vi.fn(() => fakeSocket.socket as unknown as Socket),
    io: vi.fn(() => fakeSocket.socket as unknown as Socket),
}));

// AiService mock: chatWithData enfileira e chama onJobStarted imediatamente.
// #1577: preserva ChatJobCancelledError do módulo real (a classe é usada pelo componente
// para distinguir cancelamento de erro genérico via `instanceof` — se a mock substituir
// o módulo por completo, a classe viraria undefined e o instanceof lançaria TypeError).
const mockChatWithData = vi.hoisted(() => vi.fn());
const mockResumeChatJob = vi.hoisted(() => vi.fn());
vi.mock('../../services/aiService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../services/aiService')>();
    return {
        ...actual,
        AiService: {
            chatWithData: mockChatWithData,
            resumeChatJob: mockResumeChatJob,
        },
    };
});

vi.mock('sonner', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warning: vi.fn(),
    },
}));

// axios mock: captura POSTs para /api/chat/jobs/:id/cancel e /visibility.
const mockAxiosPost = vi.hoisted(() => vi.fn());
vi.mock('axios', () => ({
    default: { post: mockAxiosPost },
}));

// ---- Helpers ------------------------------------------------------------------------

function setVisible(visible: boolean) {
    Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => (visible ? 'visible' : 'hidden'),
    });
    document.dispatchEvent(new Event('visibilitychange'));
}

const CHAT_CONFIG_KEY = 'coolgroove_chat_messages_config';

function setStoredConfig(notificationsEnabled: boolean) {
    localStorage.setItem(CHAT_CONFIG_KEY, JSON.stringify({ notificationsEnabled }));
}

function clearStoredConfig() {
    localStorage.removeItem(CHAT_CONFIG_KEY);
}

function getStoredConfigRaw(): string | null {
    return localStorage.getItem(CHAT_CONFIG_KEY);
}

//chatWithData que NUNCA resolve (mantém o job ativo para os testes de cancelamento)
function hangChatWithData() {
    mockChatWithData.mockImplementation(
        (_msg: string, _h: unknown, _i: unknown, _s: unknown, _p: unknown, onJobStarted?: (id: string) => void) => {
            if (onJobStarted) onJobStarted('job-123');
            return new Promise(() => {}); // nunca resolve
        },
    );
}

//chatWithData que resolve com uma reply
function resolveChatWithData(reply = 'Resposta do agente') {
    mockChatWithData.mockImplementation(
        (_msg: string, _h: unknown, _i: unknown, _s: unknown, _p: unknown, onJobStarted?: (id: string) => void) => {
            if (onJobStarted) onJobStarted('job-456');
            return Promise.resolve({ reply });
        },
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    fakeSocket.socket.__reset();
    mockAxiosPost.mockReset();
    mockChatWithData.mockReset();
    clearStoredConfig();
    setVisible(true);
});

// ---- Testes -------------------------------------------------------------------------

describe('ChatMessages (#1577) — botão Cancelar', () => {
    it('NÃO renderiza o botão Cancelar quando não há job ativo', () => {
        render(<ChatMessages />);
        expect(screen.queryByTestId('cancel-job-btn')).toBeNull();
        expect(screen.queryByTestId('processing-indicator')).toBeNull();
    });

    it('renderiza o botão Cancelar assim que um job está ativo', async () => {
        hangChatWithData();
        const user = userEvent.setup();
        render(<ChatMessages />);

        await user.type(screen.getByTestId('chat-messages-input'), 'Olá');
        await user.click(screen.getByTestId('chat-messages-send'));

        await waitFor(() => {
            expect(screen.getByTestId('cancel-job-btn')).toBeInTheDocument();
        });
        expect(screen.getByTestId('processing-indicator')).toBeInTheDocument();
    });

    it('some ao concluir o job (reply recebida)', async () => {
        resolveChatWithData('Pronto!');
        const user = userEvent.setup();
        render(<ChatMessages />);

        await user.type(screen.getByTestId('chat-messages-input'), 'Olá');
        await user.click(screen.getByTestId('chat-messages-send'));

        await waitFor(() => {
            expect(screen.queryByTestId('cancel-job-btn')).toBeNull();
        });
        expect(screen.getByText('Pronto!')).toBeInTheDocument();
    });

    it('POST /api/chat/jobs/:id/cancel ao clicar em Cancelar', async () => {
        hangChatWithData();
        const user = userEvent.setup();
        render(<ChatMessages />);

        await user.type(screen.getByTestId('chat-messages-input'), 'Processa');
        await user.click(screen.getByTestId('chat-messages-send'));

        const cancelBtn = await screen.findByTestId('cancel-job-btn');
        await user.click(cancelBtn);

        await waitFor(() => {
            expect(mockAxiosPost).toHaveBeenCalledWith(
                '/api/chat/jobs/job-123/cancel',
                {},
                expect.objectContaining({ headers: expect.objectContaining({ Authorization: expect.any(String) }) }),
            );
        });
    });

    it('Cancel fica disabled se o jobId ainda não chegou (placeholder state)', async () => {
        // chatWithData demora a devolver o jobId — simula job sem id ainda
        mockChatWithData.mockImplementation(() => new Promise(() => {}));
        const user = userEvent.setup();
        render(<ChatMessages />);

        await user.type(screen.getByTestId('chat-messages-input'), 'x');
        await user.click(screen.getByTestId('chat-messages-send'));

        await waitFor(() => {
            const btn = screen.getByTestId('cancel-job-btn') as HTMLButtonElement;
            expect(btn.disabled).toBe(true);
        });
    });
});

describe('ChatMessages (#1577) — evento cancelled', () => {
    it('exibe o resumo parcial quando o evento chat:job:cancelled chega', async () => {
        hangChatWithData();
        const user = userEvent.setup();
        render(<ChatMessages />);

        await user.type(screen.getByTestId('chat-messages-input'), 'Teste');
        await user.click(screen.getByTestId('chat-messages-send'));

        await screen.findByTestId('cancel-job-btn');

        // Backend emite o evento 'cancelled' com o partialSummary
        act(() => {
            fakeSocket.socket.__emit('chat:job:cancelled', {
                jobId: 'job-123',
                partialSummary: 'Resumo parcial até aqui.',
            });
        });

        expect(screen.getByText(/Resumo parcial do cancelamento:/)).toBeInTheDocument();
        expect(screen.getByText('Resumo parcial até aqui.')).toBeInTheDocument();
        // Job encerra — botão cancelar some
        expect(screen.queryByTestId('cancel-job-btn')).toBeNull();
    });

    it('ignora evento cancelled para jobId diferente do job ativo (sem cross-talk)', async () => {
        hangChatWithData();
        const user = userEvent.setup();
        render(<ChatMessages />);

        await user.type(screen.getByTestId('chat-messages-input'), 'Olá');
        await user.click(screen.getByTestId('chat-messages-send'));

        await screen.findByTestId('cancel-job-btn');

        act(() => {
            fakeSocket.socket.__emit('chat:job:cancelled', {
                jobId: 'outro-job-999',
                partialSummary: 'Não deveria aparecer aqui.',
            });
        });

        expect(screen.queryByText(/Resumo parcial do cancelamento:/)).toBeNull();
        expect(screen.getByTestId('cancel-job-btn')).toBeInTheDocument();
    });

    it('mostra texto fallback quando o evento chega sem partialSummary', async () => {
        hangChatWithData();
        const user = userEvent.setup();
        render(<ChatMessages />);

        await user.type(screen.getByTestId('chat-messages-input'), 'x');
        await user.click(screen.getByTestId('chat-messages-send'));

        await screen.findByTestId('cancel-job-btn');

        act(() => {
            fakeSocket.socket.__emit('chat:job:cancelled', { jobId: 'job-123' });
        });

        expect(screen.getByText('Operação cancelada.')).toBeInTheDocument();
    });
});

// #1577: resiliência — quando o socket 'chat:job:cancelled' se perde (server restart,
// problema de transporte), o pollChatJob detecta o status 'cancelled' via GET /jobs/:id
// e lança ChatJobCancelledError. O ChatMessages deve tratar isso silenciosamente,
// exibindo o resumo parcial sem mostrar bubble de "Erro:".
describe('ChatMessages (#1577) — cancelled detectado via polling (fallback de socket)', () => {
    it('exibe o resumo parcial quando chatWithData rejeita com ChatJobCancelledError', async () => {
        const { ChatJobCancelledError } = await import('../../services/aiService');
        mockChatWithData.mockImplementation(
            (_msg: string, _h: unknown, _i: unknown, _s: unknown, _p: unknown, onJobStarted?: (id: string) => void) => {
                if (onJobStarted) onJobStarted('job-poll-1');
                return Promise.reject(new ChatJobCancelledError('Resumo via polling.'));
            },
        );
        const user = userEvent.setup();
        render(<ChatMessages />);

        await user.type(screen.getByTestId('chat-messages-input'), 'x');
        await user.click(screen.getByTestId('chat-messages-send'));

        await waitFor(() => {
            expect(screen.getByText(/Resumo parcial do cancelamento:/)).toBeInTheDocument();
        });
        expect(screen.getByText('Resumo via polling.')).toBeInTheDocument();
        // NÃO mostra bubble de erro genérico.
        expect(screen.queryByText(/Erro:/)).toBeNull();
        // Job encerra — botão cancelar some.
        expect(screen.queryByTestId('cancel-job-btn')).toBeNull();
    });

    it('usa fallback "Operação cancelada." quando ChatJobCancelledError vem sem partialSummary', async () => {
        const { ChatJobCancelledError } = await import('../../services/aiService');
        mockChatWithData.mockImplementation(
            () => Promise.reject(new ChatJobCancelledError(null)),
        );
        const user = userEvent.setup();
        render(<ChatMessages />);

        await user.type(screen.getByTestId('chat-messages-input'), 'x');
        await user.click(screen.getByTestId('chat-messages-send'));

        await waitFor(() => {
            expect(screen.getByText('Operação cancelada.')).toBeInTheDocument();
        });
    });

    it('NÃO duplica o bubble quando socket E polling ambos reportam cancelamento', async () => {
        const { ChatJobCancelledError } = await import('../../services/aiService');
        // chatWithData rejeita DEPOIS de o socket emitir (race comum: o evento chega
        // primeiro porque o polling tem atraso de POLL_MS).
        let socketEmit: (() => void) | null = null;
        mockChatWithData.mockImplementation(
            (_msg: string, _h: unknown, _i: unknown, _s: unknown, _p: unknown, onJobStarted?: (id: string) => void) => {
                if (onJobStarted) onJobStarted('job-poll-2');
                return new Promise<void>((_, reject) => {
                    socketEmit = () => {
                        // Socket dispara primeiro; depois o polling rejeita com o erro tipado.
                        fakeSocket.socket.__emit('chat:job:cancelled', {
                            jobId: 'job-poll-2',
                            partialSummary: 'Resumo do socket.',
                        });
                        setTimeout(() => reject(new ChatJobCancelledError('Resumo do polling.')), 0);
                    };
                });
            },
        );
        const user = userEvent.setup();
        render(<ChatMessages />);

        await user.type(screen.getByTestId('chat-messages-input'), 'x');
        await user.click(screen.getByTestId('chat-messages-send'));
        await screen.findByTestId('cancel-job-btn');

        act(() => socketEmit?.());

        await waitFor(() => {
            expect(screen.getByText('Resumo do socket.')).toBeInTheDocument();
        });
        // O resumo do polling NÃO deve aparecer (cancelledSummary já estava setado).
        await waitFor(() => {
            expect(screen.queryByText('Resumo do polling.')).toBeNull();
        });
    });

    it('respeita o toggle de notificações feito DEPOIS do mount (closure bug fix)', async () => {
        // Regressão: o listener de socket é registrado 1x no mount; sem o ref, ele
        // captura notificationsEnabled inicial e ignora toggles posteriores.
        const { toast } = await import('sonner');
        hangChatWithData();
        const user = userEvent.setup();
        render(<ChatMessages />);

        await user.type(screen.getByTestId('chat-messages-input'), 'x');
        await user.click(screen.getByTestId('chat-messages-send'));
        await screen.findByTestId('cancel-job-btn');

        // Desativa notificações DEPOIS do mount (valor inicial era true).
        await user.click(screen.getByTestId('notifications-toggle'));
        expect(toast.success).toHaveBeenCalledWith('Notificações desativadas');

        (toast.info as ReturnType<typeof vi.fn>).mockClear();
        act(() => {
            fakeSocket.socket.__emit('chat:job:cancelled', {
                jobId: 'job-123',
                partialSummary: 'Resumo.',
            });
        });

        // O toast NÃO deve disparar (config atual = false, graças ao ref).
        expect(toast.info).not.toHaveBeenCalled();
        // Mas o bubble do resumo aparece normalmente.
        expect(screen.getByText('Resumo.')).toBeInTheDocument();
    });
});

describe('ChatMessages (#1577) — sinal de Page Visibility', () => {
    it('envia POST /api/chat/jobs/:id/visibility {hidden:true} quando a aba fica oculta durante job', async () => {
        hangChatWithData();
        const user = userEvent.setup();
        render(<ChatMessages />);

        await user.type(screen.getByTestId('chat-messages-input'), 'x');
        await user.click(screen.getByTestId('chat-messages-send'));
        await screen.findByTestId('cancel-job-btn');

        mockAxiosPost.mockClear();

        act(() => setVisible(false));

        await waitFor(() => {
            expect(mockAxiosPost).toHaveBeenCalledWith(
                '/api/chat/jobs/job-123/visibility',
                { hidden: true },
                expect.objectContaining({ headers: expect.objectContaining({ Authorization: expect.any(String) }) }),
            );
        });
    });

    it('envia {hidden:false} quando a aba volta a ficar visível', async () => {
        hangChatWithData();
        const user = userEvent.setup();
        render(<ChatMessages />);

        await user.type(screen.getByTestId('chat-messages-input'), 'x');
        await user.click(screen.getByTestId('chat-messages-send'));
        await screen.findByTestId('cancel-job-btn');

        act(() => setVisible(false));
        await waitFor(() => expect(mockAxiosPost).toHaveBeenCalledWith(
            '/api/chat/jobs/job-123/visibility',
            { hidden: true },
            expect.any(Object),
        ));

        mockAxiosPost.mockClear();
        act(() => setVisible(true));

        await waitFor(() => {
            expect(mockAxiosPost).toHaveBeenCalledWith(
                '/api/chat/jobs/job-123/visibility',
                { hidden: false },
                expect.any(Object),
            );
        });
    });

    it('NÃO envia sinal de visibilidade quando não há job ativo', () => {
        mockAxiosPost.mockClear();
        render(<ChatMessages />);

        act(() => setVisible(false));
        act(() => setVisible(true));

        // Nenhum POST deve ter sido feito para /visibility
        const visibilityCalls = mockAxiosPost.mock.calls.filter(
            (args: unknown[]) => typeof args[0] === 'string' && (args[0] as string).includes('/visibility'),
        );
        expect(visibilityCalls).toHaveLength(0);
    });

    it('reage em ≤500ms (event-driven — dispara no próximo microtask após visibilitychange)', async () => {
        hangChatWithData();
        const user = userEvent.setup();
        render(<ChatMessages />);

        await user.type(screen.getByTestId('chat-messages-input'), 'x');
        await user.click(screen.getByTestId('chat-messages-send'));
        await screen.findByTestId('cancel-job-btn');

        const start = Date.now();
        act(() => setVisible(false));

        await waitFor(() => {
            expect(mockAxiosPost).toHaveBeenCalledWith(
                '/api/chat/jobs/job-123/visibility',
                { hidden: true },
                expect.any(Object),
            );
        });
        const elapsed = Date.now() - start;
        // O evento é síncrono a partir do dispatchEvent; o POST é emitido no próximo
        // ciclo do React. Em ambiente de teste (jsdom + fake timers desligados),
        // isso acontece em poucas dezenas de ms.
        expect(elapsed).toBeLessThan(500);
    });
});

describe('ChatMessages (#1577) — config de notificações (localStorage)', () => {
    it('inicia com notificações habilitadas por padrão', () => {
        render(<ChatMessages />);
        const toggle = screen.getByTestId('notifications-toggle');
        expect(toggle.getAttribute('aria-pressed')).toBe('true');
    });

    it('persiste preferência ao alternar (localStorage)', async () => {
        const user = userEvent.setup();
        render(<ChatMessages />);
        const toggle = screen.getByTestId('notifications-toggle');

        await user.click(toggle);
        expect(toggle.getAttribute('aria-pressed')).toBe('false');

        // Persistido
        const stored = getStoredConfigRaw();
        expect(stored).toBeDefined();
        expect(JSON.parse(stored as string)).toEqual({ notificationsEnabled: false });
    });

    it('carrega preferência persistida (desativada) na montagem', () => {
        setStoredConfig(false);
        render(<ChatMessages />);
        const toggle = screen.getByTestId('notifications-toggle');
        expect(toggle.getAttribute('aria-pressed')).toBe('false');
    });

    it('alternar volta a habilitar notificações (idempotente)', async () => {
        const user = userEvent.setup();
        render(<ChatMessages />);
        const toggle = screen.getByTestId('notifications-toggle');

        await user.click(toggle); // off
        expect(toggle.getAttribute('aria-pressed')).toBe('false');
        await user.click(toggle); // on
        expect(toggle.getAttribute('aria-pressed')).toBe('true');

        const stored = getStoredConfigRaw();
        expect(JSON.parse(stored as string)).toEqual({ notificationsEnabled: true });
    });

    it('NÃO mostra toast de cancelamento quando notificações estão desativadas', async () => {
        setStoredConfig(false);
        const { toast } = await import('sonner');
        hangChatWithData();
        const user = userEvent.setup();
        render(<ChatMessages />);

        await user.type(screen.getByTestId('chat-messages-input'), 'x');
        await user.click(screen.getByTestId('chat-messages-send'));
        await screen.findByTestId('cancel-job-btn');

        act(() => {
            fakeSocket.socket.__emit('chat:job:cancelled', {
                jobId: 'job-123',
                partialSummary: 'Resumo.',
            });
        });

        // A UI ainda mostra o resumo, mas o toast NÃO é disparado (config off).
        expect(screen.getByText('Resumo.')).toBeInTheDocument();
        expect(toast.info).not.toHaveBeenCalled();
    });

    it('MOSTRA toast de cancelamento quando notificações estão ativadas', async () => {
        const { toast } = await import('sonner');
        hangChatWithData();
        const user = userEvent.setup();
        render(<ChatMessages />);

        await user.type(screen.getByTestId('chat-messages-input'), 'x');
        await user.click(screen.getByTestId('chat-messages-send'));
        await screen.findByTestId('cancel-job-btn');

        act(() => {
            fakeSocket.socket.__emit('chat:job:cancelled', {
                jobId: 'job-123',
                partialSummary: 'Resumo ON.',
            });
        });

        expect(toast.info).toHaveBeenCalledWith(
            'Operação cancelada',
            expect.objectContaining({ description: expect.stringContaining('Resumo ON') }),
        );
    });
});

describe('ChatMessages (#1577) — fluxo de envio', () => {
    it('renderiza input e botão de enviar', () => {
        render(<ChatMessages />);
        expect(screen.getByTestId('chat-messages-input')).toBeInTheDocument();
        expect(screen.getByTestId('chat-messages-send')).toBeInTheDocument();
    });

    it('envia mensagem ao clicar no botão e exibe a resposta', async () => {
        resolveChatWithData('Tudo certo!');
        const user = userEvent.setup();
        render(<ChatMessages />);

        await user.type(screen.getByTestId('chat-messages-input'), 'Olá');
        await user.click(screen.getByTestId('chat-messages-send'));

        await waitFor(() => {
            expect(screen.getByText('Olá')).toBeInTheDocument();
        });
        await waitFor(() => {
            expect(screen.getByText('Tudo certo!')).toBeInTheDocument();
        });
    });

    it('desabilita o botão enviar quando input está vazio', () => {
        render(<ChatMessages />);
        const sendBtn = screen.getByTestId('chat-messages-send') as HTMLButtonElement;
        expect(sendBtn.disabled).toBe(true);
    });

    it('submete ao pressionar Enter (sem Shift)', async () => {
        resolveChatWithData('Reply');
        render(<ChatMessages />);
        const input = screen.getByTestId('chat-messages-input');

        fireEvent.change(input, { target: { value: 'Olá' } });
        fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

        await waitFor(() => {
            expect(mockChatWithData).toHaveBeenCalled();
        });
    });

    it('mostra erro inline quando chatWithData rejeita', async () => {
        mockChatWithData.mockRejectedValue(new Error('Falha de rede'));
        const user = userEvent.setup();
        render(<ChatMessages />);

        await user.type(screen.getByTestId('chat-messages-input'), 'oi');
        await user.click(screen.getByTestId('chat-messages-send'));

        await waitFor(() => {
            expect(screen.getByText(/Erro: Falha de rede/)).toBeInTheDocument();
        });
        // Botão cancelar some após o erro
        expect(screen.queryByTestId('cancel-job-btn')).toBeNull();
    });
});
