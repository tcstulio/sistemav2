/**
 * Testes do ChatInterface — callbacks tipados (issue #1026).
 *
 * Estes testes verificam que os callbacks `onSend`, `onReply`, `onEdit` e
 * `onDelete` são tipados com as interfaces do módulo Chat (ChatMessage /
 * ChatReply) e disparados nos momentos corretos. Nenhum `as any` é usado:
 * os mocks são construídos com tipagem explícita e `as unknown as Type`
 * (double-assertion) quando necessário para satisfazer tipos complexos de
 * bibliotecas externas (React Query).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

// ---------------------------------------------------------------------------
// Mocks — módulos externos
// ---------------------------------------------------------------------------

vi.mock('react-router-dom', () => ({
    useNavigate: () => vi.fn(),
}));

vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../../utils/notifyError', () => ({
    notifyError: vi.fn(),
}));

// useConfirm retorna uma função (ConfirmFn); mock hoisted para configurar por teste
const mockConfirm = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));
vi.mock('../../hooks/useConfirm', () => ({
    useConfirm: () => mockConfirm,
}));

// DolibarrContext
vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(),
}));

// Hooks de dados (useEvents, useProjects, useUsers)
vi.mock('../../hooks/dolibarr', () => ({
    useEvents: vi.fn(),
    useProjects: vi.fn(),
    useUsers: vi.fn(),
}));

// Operations — preserva exports reais, sobrescreve apenas os três usados
const mockCreateEvent = vi.hoisted(() => vi.fn());
const mockDeleteEvent = vi.hoisted(() => vi.fn());
const mockUpdateEvent = vi.hoisted(() => vi.fn());
vi.mock('../../services/api/operations', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../services/api/operations')>();
    return {
        ...actual,
        createEvent: mockCreateEvent,
        deleteEvent: mockDeleteEvent,
        updateEvent: mockUpdateEvent,
    };
});

vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: { uploadDocument: vi.fn() },
}));

// RichTextEditor — mocka como textarea controlado
interface MockEditorProps {
    value: string;
    onChange: (value: string) => void;
    onKeyDown?: (event: ReactKeyboardEvent) => void;
}
vi.mock('../../components/common/RichTextEditor', () => ({
    RichTextEditor: ({ value, onChange, onKeyDown }: MockEditorProps) => (
        <textarea
            data-testid="rich-text-editor"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
        />
    ),
}));

vi.mock('../../components/Projects/TaskWizard', () => ({
    TaskWizard: () => <div data-testid="task-wizard" />,
}));

// sanitizeHtml — mocka SafeHtml para renderizar HTML diretamente
interface MockSafeHtmlProps {
    html: string;
    className?: string;
}
vi.mock('../../utils/sanitizeHtml', () => ({
    SafeHtml: ({ html }: MockSafeHtmlProps) => (
        <div data-testid="safe-html" dangerouslySetInnerHTML={{ __html: html }} />
    ),
    stripHtml: (html: string) => html.replace(/<[^>]*>?/gm, ''),
}));

// ---------------------------------------------------------------------------
// Imports (após vi.mock para receber as versões mockadas)
// ---------------------------------------------------------------------------

import { useDolibarr } from '../../context/DolibarrContext';
import { useEvents, useProjects, useUsers } from '../../hooks/dolibarr';
import { ChatInterface } from '../../components/chat/ChatInterface';
import type { DolibarrHookResult } from '../../hooks/dolibarr';
import type { AgendaEvent, DolibarrConfig, DolibarrUser } from '../../types';
import type { ChatMessage, ChatReply } from '../../components/chat/types';

// ---------------------------------------------------------------------------
// Helpers — construídos sem `as any`
// ---------------------------------------------------------------------------

/**
 * Cria um DolibarrHookResult mínimo para testes. Usa double-assertion
 * (`as unknown as`) porque UseQueryResult (TanStack Query v5) tem ~20
 * propriedades obrigatórias que não são relevantes para estes testes.
 */
function mockResult<T>(
    data: T[],
    opts?: { isLoading?: boolean; refetch?: () => Promise<unknown> },
): DolibarrHookResult<T> {
    return {
        data,
        isLoading: opts?.isLoading ?? false,
        refetch: opts?.refetch ?? vi.fn(() => Promise.resolve()),
    } as unknown as DolibarrHookResult<T>;
}

function makeEvent(overrides: Partial<AgendaEvent> = {}): AgendaEvent {
    return {
        id: 'ev-1',
        ref: 'REF1',
        label: 'Comentário em project',
        date_start: 1700000000,
        date_end: 1700000000,
        type_code: 'AC_CHAT',
        percentage: 100,
        description: 'Olá mundo',
        elementtype: 'project',
        fk_element: '10',
        fk_user_author: '99',
        user_author_name: 'Other',
        ...overrides,
    };
}

const mockConfig: DolibarrConfig = {
    apiUrl: 'http://test/api/index.php',
    apiKey: 'key',
    themeColor: '#000',
    darkMode: false,
};

const mockUser: DolibarrUser = {
    id: '42',
    login: 'tester',
    statut: '1',
};

const mockRefreshData = vi.fn();

const defaultProps = {
    elementId: '10',
    elementType: 'project',
};

function setupHookMocks(events: AgendaEvent[] = []): void {
    vi.mocked(useEvents).mockReturnValue(mockResult(events));
    vi.mocked(useProjects).mockReturnValue(mockResult([]));
    vi.mocked(useUsers).mockReturnValue(mockResult([]));
    vi.mocked(useDolibarr).mockReturnValue({
        config: mockConfig,
        currentUser: mockUser,
        refreshData: mockRefreshData,
    } as unknown as ReturnType<typeof useDolibarr>);
}

// ---------------------------------------------------------------------------
// Setup global
// ---------------------------------------------------------------------------

beforeEach(() => {
    vi.clearAllMocks();
    mockConfirm.mockResolvedValue(true);
    mockCreateEvent.mockResolvedValue({ id: 'new-1' });
    mockDeleteEvent.mockResolvedValue(undefined);
    mockUpdateEvent.mockResolvedValue(undefined);
    setupHookMocks([]);
});

// ---------------------------------------------------------------------------
// Testes — renderização básica
// ---------------------------------------------------------------------------

describe('ChatInterface — renderização básica', () => {
    it('exibe mensagem de vazio quando não há eventos', () => {
        render(<ChatInterface {...defaultProps} />);
        expect(screen.getByText('Nenhum comentário ainda. Inicie a conversa!')).toBeInTheDocument();
    });

    it('renderiza mensagens vindas do Dolibarr', () => {
        setupHookMocks([
            makeEvent({ id: 'ev-1', description: 'Primeira mensagem', user_author_name: 'Alice' }),
        ]);
        render(<ChatInterface {...defaultProps} />);
        expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    it('preserva conteúdo HTML ao renderizar mensagem', () => {
        setupHookMocks([
            makeEvent({ id: 'ev-1', description: '<strong>Negrito</strong>', user_author_name: 'Bob' }),
        ]);
        render(<ChatInterface {...defaultProps} />);
        const safeHtml = screen.getByTestId('safe-html');
        expect(safeHtml.innerHTML).toContain('<strong>Negrito</strong>');
    });
});

// ---------------------------------------------------------------------------
// Testes — callbacks tipados (#1026)
// ---------------------------------------------------------------------------

describe('ChatInterface — onReply tipado com ChatReply (#1026)', () => {
    it('invoca onReply com ChatReply ao clicar no botão de responder', () => {
        const onReply = vi.fn<(reply: ChatReply) => void>();
        setupHookMocks([
            makeEvent({ id: 'ev-42', description: 'Responder isto', user_author_name: 'Bob' }),
        ]);
        render(<ChatInterface {...defaultProps} onReply={onReply} />);

        fireEvent.click(screen.getByTitle('Responder'));

        expect(onReply).toHaveBeenCalledTimes(1);
        const arg = onReply.mock.calls[0][0];
        expect(arg.messageId).toBe('ev-42');
        expect(arg.content).toBe('Responder isto');
        expect(arg.senderId).toBe('99');
        expect(arg.senderName).toBe('Bob');
    });

    it('não invoca onReply quando callback não é fornecido', () => {
        setupHookMocks([makeEvent({ id: 'ev-1', description: 'Teste' })]);
        render(<ChatInterface {...defaultProps} />);
        // Simplesmente não deve quebrar
        fireEvent.click(screen.getByTitle('Responder'));
        expect(screen.getByText(/Respondendo a/)).toBeInTheDocument();
    });
});

describe('ChatInterface — onSend tipado com ChatMessage (#1026)', () => {
    it('invoca onSend com ChatMessage após envio bem-sucedido', async () => {
        const onSend = vi.fn<(message: ChatMessage) => void>();
        render(<ChatInterface {...defaultProps} onSend={onSend} />);

        await userEvent.type(screen.getByTestId('rich-text-editor'), 'Nova mensagem');
        fireEvent.click(screen.getByLabelText('Enviar mensagem'));

        await waitFor(() => {
            expect(onSend).toHaveBeenCalledTimes(1);
        });

        const sentMsg = onSend.mock.calls[0][0];
        expect(sentMsg.content).toContain('Nova mensagem');
        expect(sentMsg.senderId).toBe('42');
        expect(sentMsg.elementtype).toBe('project');
        expect(sentMsg.fk_element).toBe('10');
    });

    it('não invoca onSend quando createEvent falha', async () => {
        const onSend = vi.fn<(message: ChatMessage) => void>();
        mockCreateEvent.mockRejectedValue(new Error('Falha de rede'));
        render(<ChatInterface {...defaultProps} onSend={onSend} />);

        await userEvent.type(screen.getByTestId('rich-text-editor'), 'Mensagem que falha');
        fireEvent.click(screen.getByLabelText('Enviar mensagem'));

        await waitFor(() => {
            expect(screen.getByTestId('send-error')).toBeInTheDocument();
        });
        expect(onSend).not.toHaveBeenCalled();
    });
});

describe('ChatInterface — onDelete tipado com ChatMessage (#1026)', () => {
    it('invoca onDelete com ChatMessage após confirmar exclusão', async () => {
        const onDelete = vi.fn<(message: ChatMessage) => void>();
        setupHookMocks([
            makeEvent({ id: 'ev-7', fk_user_author: '42', user_author_name: 'Eu', description: 'Minha msg' }),
        ]);
        render(<ChatInterface {...defaultProps} onDelete={onDelete} />);

        fireEvent.click(screen.getByTitle('Excluir'));

        await waitFor(() => {
            expect(onDelete).toHaveBeenCalledTimes(1);
        });
        expect(onDelete.mock.calls[0][0].id).toBe('ev-7');
    });

    it('não invoca onDelete quando usuário cancela a confirmação', async () => {
        const onDelete = vi.fn<(message: ChatMessage) => void>();
        mockConfirm.mockResolvedValue(false);
        setupHookMocks([
            makeEvent({ id: 'ev-7', fk_user_author: '42', user_author_name: 'Eu' }),
        ]);
        render(<ChatInterface {...defaultProps} onDelete={onDelete} />);

        fireEvent.click(screen.getByTitle('Excluir'));
        await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
        expect(onDelete).not.toHaveBeenCalled();
    });
});

describe('ChatInterface — onEdit tipado com ChatMessage (#1026)', () => {
    it('invoca onEdit com ChatMessage após salvar edição', async () => {
        const onEdit = vi.fn<(message: ChatMessage) => void>();
        setupHookMocks([
            makeEvent({ id: 'ev-9', fk_user_author: '42', user_author_name: 'Eu', description: 'Original' }),
        ]);
        render(<ChatInterface {...defaultProps} onEdit={onEdit} />);

        fireEvent.click(screen.getByTitle('Editar'));
        fireEvent.change(screen.getByTestId('edit-input-ev-9'), { target: { value: 'Editado' } });
        fireEvent.click(screen.getByTestId('save-edit-ev-9'));

        await waitFor(() => {
            expect(onEdit).toHaveBeenCalledTimes(1);
        });
        expect(onEdit.mock.calls[0][0].id).toBe('ev-9');
    });

    it('não invoca onEdit quando updateEvent falha', async () => {
        const onEdit = vi.fn<(message: ChatMessage) => void>();
        mockUpdateEvent.mockRejectedValue(new Error('Falha'));
        setupHookMocks([
            makeEvent({ id: 'ev-9', fk_user_author: '42', user_author_name: 'Eu', description: 'Original' }),
        ]);
        render(<ChatInterface {...defaultProps} onEdit={onEdit} />);

        fireEvent.click(screen.getByTitle('Editar'));
        fireEvent.change(screen.getByTestId('edit-input-ev-9'), { target: { value: 'Editado' } });
        fireEvent.click(screen.getByTestId('save-edit-ev-9'));

        await waitFor(() => expect(mockUpdateEvent).toHaveBeenCalled());
        expect(onEdit).not.toHaveBeenCalled();
    });
});
