/**
 * Tests for VirtualAssistant model badge (issue #718).
 * Verifica que o rodapé de cada mensagem exibe corretamente qual modelo respondeu
 * e aplica o estilo de fallback quando necessário.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ChatMessage } from '../../services/aiService';

// ── hoisted mocks (antes do hoist de vi.mock) ────────────────────────────────

const mockSafeStorage = vi.hoisted(() => ({
    getItem: vi.fn(() => null),
    getJSON: vi.fn(() => [] as ChatMessage[]),
    setItem: vi.fn(),
    setJSON: vi.fn(),
    removeItem: vi.fn(),
}));

const mockChatWithData = vi.hoisted(() => vi.fn());

// ── vi.mock factories ─────────────────────────────────────────────────────────

vi.mock('react-router-dom', () => ({
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: '/', search: '' }),
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: () => ({ config: { apiUrl: 'http://test', apiKey: 'k' } }),
}));

vi.mock('../../utils/safeStorage', () => ({
    safeStorage: mockSafeStorage,
}));

vi.mock('../../utils/logger', () => ({
    logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('../../utils/errorStore', () => ({
    formatErrorsForAgent: vi.fn(() => ''),
}));

vi.mock('../../config/viewRegistry', () => ({
    formatViewContext: vi.fn(() => ''),
}));

vi.mock('../../services/agentBootstrapService', () => ({
    getAgentBootstrapConfig: vi.fn().mockResolvedValue({
        enabled: false,
        includeTasks: false,
        includeAgenda: false,
        includeFinancial: false,
        extraInstruction: '',
    }),
}));

vi.mock('../../services/aiService', () => ({
    AiService: {
        chatWithData: (...args: any[]) => mockChatWithData(...args),
        getChatSessions: vi.fn().mockResolvedValue([]),
        createChatSession: vi.fn().mockResolvedValue({ id: 'sess-1' }),
        deleteChatSession: vi.fn().mockResolvedValue(true),
        deleteAllChatSessions: vi.fn().mockResolvedValue(true),
    },
}));

// ── static import after mocks ─────────────────────────────────────────────────

import VirtualAssistant from '../../components/VirtualAssistant';

// ── helper ───────────────────────────────────────────────────────────────────

function renderAndOpen(messages: ChatMessage[] = []) {
    mockSafeStorage.getJSON.mockReturnValue(messages);
    const utils = render(<VirtualAssistant />);
    // Abre o FAB (primeiro botão na página)
    const fab = utils.container.querySelector('button')!;
    fireEvent.click(fab);
    return utils;
}

// ── testes ────────────────────────────────────────────────────────────────────

describe('VirtualAssistant — badge de modelo (#718)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockChatWithData.mockResolvedValue({
            reply: 'ok',
            sessionId: null,
            usage: undefined,
            model: undefined,
            fellBack: false,
        });
    });

    it('exibe o modelo primário sem destaque quando fellBack=false', async () => {
        const messages: ChatMessage[] = [
            {
                role: 'model',
                text: 'Olá!',
                usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
                model: 'glm-5.2',
                fellBack: false,
            },
        ];
        renderAndOpen(messages);

        await waitFor(() => {
            expect(screen.getByText('glm-5.2')).toBeInTheDocument();
        });

        const badge = screen.getByText('glm-5.2');
        expect(badge.textContent).not.toContain('fallback');
        expect(badge.className).not.toContain('amber');
    });

    it('exibe badge com texto "(fallback)" e estilo amber quando fellBack=true', async () => {
        const messages: ChatMessage[] = [
            {
                role: 'model',
                text: 'Resposta pelo fallback.',
                usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
                model: 'MiniMax-M3',
                fellBack: true,
            },
        ];
        renderAndOpen(messages);

        await waitFor(() => {
            expect(screen.getByText('MiniMax-M3 (fallback)')).toBeInTheDocument();
        });

        const badge = screen.getByText('MiniMax-M3 (fallback)');
        expect(badge.className).toContain('amber');
    });

    it('não quebra e não exibe badge quando a mensagem não tem model (retrocompat)', async () => {
        const messages: ChatMessage[] = [
            {
                role: 'model',
                text: 'Mensagem antiga sem model.',
                usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
            },
        ];
        renderAndOpen(messages);

        await waitFor(() => {
            expect(screen.getByText('Mensagem antiga sem model.')).toBeInTheDocument();
        });

        expect(screen.queryByText(/fallback/i)).toBeNull();
    });

    it('inclui model e fellBack=false na mensagem quando o modelo primário responde', async () => {
        mockChatWithData.mockResolvedValue({
            reply: 'Resposta do GLM.',
            sessionId: 'sess-1',
            usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
            model: 'glm-5.2',
            fellBack: false,
        });

        renderAndOpen([]);

        const input = screen.getByRole('textbox');
        fireEvent.change(input, { target: { value: 'Oi assistente' } });
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

        await waitFor(() => {
            expect(screen.getByText('glm-5.2')).toBeInTheDocument();
        }, { timeout: 3000 });

        const badge = screen.getByText('glm-5.2');
        expect(badge.className).not.toContain('amber');
    });

    it('inclui model e fellBack=true na mensagem quando o fallback responde', async () => {
        mockChatWithData.mockResolvedValue({
            reply: 'Resposta do MiniMax.',
            sessionId: 'sess-1',
            usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
            model: 'MiniMax-M3',
            fellBack: true,
        });

        renderAndOpen([]);

        const input = screen.getByRole('textbox');
        fireEvent.change(input, { target: { value: 'Oi' } });
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

        await waitFor(() => {
            expect(screen.getByText('MiniMax-M3 (fallback)')).toBeInTheDocument();
        }, { timeout: 3000 });

        const badge = screen.getByText('MiniMax-M3 (fallback)');
        expect(badge.className).toContain('amber');
    });
});

// #967: o % de contexto no cabeçalho e o aviso >90% eram calculados SOMANDO
// usage.totalTokens de todas as mensagens. Como cada promptTokens já inclui a
// conversa inteira, o somatório double-contava e inflava o % (aviso falso).
describe('VirtualAssistant — uso real do contexto (#967)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockChatWithData.mockResolvedValue({
            reply: 'ok',
            sessionId: null,
            usage: undefined,
            model: undefined,
            fellBack: false,
        });
    });

    it('exibe o % com base apenas no ÚLTIMO turno, não na soma de todos', async () => {
        // 3 turnos: somatório (bug antigo) = 60000 -> 30%; último turno (correto) = 30000 -> 15%.
        const messages: ChatMessage[] = [
            { role: 'model', text: 'r1', usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10000 } },
            { role: 'model', text: 'r2', usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20000 } },
            { role: 'model', text: 'r3', usage: { promptTokens: 15, completionTokens: 15, totalTokens: 30000 } },
        ];

        renderAndOpen(messages);

        // Janela padrão do componente = 200000. 30000/200000 = 15%.
        await waitFor(() => {
            expect(screen.getByText(/\(15%\)/)).toBeInTheDocument();
        });
        expect(screen.queryByText(/\(30%\)/)).toBeNull();
    });

    it('NÃO dispara o aviso de >90% quando só o somatório ultrapassa, mas o último turno não', async () => {
        // Pré-carrega 2 turnos de 80000 (somatório 160000 = 80%, mas último = 40%).
        const messages: ChatMessage[] = [
            { role: 'user', text: 'msg1' },
            { role: 'model', text: 'resp1', usage: { promptTokens: 40000, completionTokens: 40000, totalTokens: 80000 }, model: 'glm-5.2' },
            { role: 'user', text: 'msg2' },
            { role: 'model', text: 'resp2', usage: { promptTokens: 40000, completionTokens: 40000, totalTokens: 80000 }, model: 'glm-5.2' },
        ];

        // Resposta nova: último turno = 90000 (45%). Somatório = 250000 -> 125% (bug antigo).
        mockChatWithData.mockResolvedValue({
            reply: 'Tudo certo.',
            sessionId: 'sess-1',
            usage: { promptTokens: 50000, completionTokens: 40000, totalTokens: 90000 },
            model: 'glm-5.2',
            fellBack: false,
        });

        renderAndOpen(messages);

        const input = screen.getByRole('textbox');
        fireEvent.change(input, { target: { value: 'mais uma' } });
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

        await waitFor(() => {
            expect(screen.getByText('Tudo certo.')).toBeInTheDocument();
        }, { timeout: 3000 });

        expect(screen.queryByText(/Contexto acima de 90%/)).toBeNull();
        expect(screen.queryByText(/contexto está ficando grande/i)).toBeNull();
    });

    it('dispara o aviso de >90% quando o ÚLTIMO turno realmente excede 90% da janela', async () => {
        const messages: ChatMessage[] = [
            { role: 'user', text: 'msg1' },
            { role: 'model', text: 'resp1', usage: { promptTokens: 10000, completionTokens: 5000, totalTokens: 15000 }, model: 'glm-5.2' },
        ];

        mockChatWithData.mockResolvedValue({
            reply: 'Resposta longa.',
            sessionId: 'sess-1',
            // Último turno = 190000 -> 95% da janela de 200000.
            usage: { promptTokens: 170000, completionTokens: 20000, totalTokens: 190000 },
            model: 'glm-5.2',
            fellBack: false,
        });

        renderAndOpen(messages);

        const input = screen.getByRole('textbox');
        fireEvent.change(input, { target: { value: 'pergunta' } });
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

        await waitFor(() => {
            expect(screen.getByText(/Contexto acima de 90%/)).toBeInTheDocument();
        }, { timeout: 3000 });
    });
});
