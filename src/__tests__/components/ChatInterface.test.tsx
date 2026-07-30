/**
 * Testes do ChatInterface.
 *
 * Suite original preservada (renderização, flexbox, envio, otimista/dedup,
 * upload, excluir/editar, reply, notifyError) + testes novos de callbacks
 * tipados (issue #1026: onSend/onReply/onEdit/onDelete tipados com
 * ChatMessage/ChatReply).
 *
 * Nenhum `as any`: os mocks são construídos com tipagem explícita e, quando
 * inevitável (tipos complexos do TanStack Query), com double-assertion
 * `as unknown as Type` devidamente justificada.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps, ReactNode } from 'react';
import { ChatInterface } from '../../components/chat/ChatInterface';
import * as Operations from '../../services/api/operations';
import { DolibarrService } from '../../services/dolibarrService';
import { useEvents } from '../../hooks/dolibarr';
import type { AgendaEvent } from '../../types';
import type { ChatMessage, ChatReply } from '../../components/chat/types';
import { toast } from 'sonner';

// useConfirm mock: por padrão confirma a ação.
// `vi.hoisted` garante que o mock exista antes da factory do `vi.mock` rodar.
const mockConfirm = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));
vi.mock('../../hooks/useConfirm', () => ({
    useConfirm: () => mockConfirm,
    ConfirmProvider: ({ children }: { children?: ReactNode }) => children,
}));

vi.mock('sonner', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warning: vi.fn(),
    },
}));

vi.mock('../../utils/notifyError', () => ({
    notifyError: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
    useNavigate: () => vi.fn(),
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: () => ({
        config: { apiUrl: 'http://test/api/index.php', apiKey: 'key' },
        currentUser: { id: 'u1', login: 'tester' },
        refreshData: vi.fn(),
    }),
}));

vi.mock('../../hooks/dolibarr', () => ({
    useEvents: vi.fn(),
    useProjects: vi.fn(() => ({ data: [] })),
    useUsers: vi.fn(() => ({ data: [] })),
}));

vi.mock('../../services/api/operations', () => ({
    createEvent: vi.fn(),
    deleteEvent: vi.fn(),
    updateEvent: vi.fn(),
}));

vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: {
        uploadDocument: vi.fn(),
    },
}));

interface MockEditorProps {
    value: string;
    onChange: (value: string) => void;
    onKeyDown: (event: { key: string; preventDefault: () => void; shiftKey?: boolean }) => void;
}
vi.mock('../../components/common/RichTextEditor', () => ({
    RichTextEditor: ({ value, onChange, onKeyDown }: MockEditorProps) => (
        <textarea
            data-testid="message-input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
        />
    ),
}));

vi.mock('../../components/Projects/TaskWizard', () => ({
    TaskWizard: () => null,
}));

const { notifyError } = await import('../../utils/notifyError');

const mockRefetch = vi.fn();

/**
 * Constrói o valor de retorno de `useEvents` para os mocks.
 * `useEvents` retorna `DolibarrHookResult<AgendaEvent>` (um `UseQueryResult`
 * estendido com ~20 campos internos do React Query); nos testes só precisamos
 * de `data`/`isLoading`/`refetch`, por isso o cast duplo via `unknown`
 * preserva a tipagem do hook sem recorrer a `any`.
 */
type UseEventsReturn = ReturnType<typeof useEvents>;
const eventsReturn = (data: Partial<AgendaEvent>[] = [], isLoading = false): UseEventsReturn =>
    ({ data: data as AgendaEvent[], isLoading, refetch: mockRefetch } as unknown as UseEventsReturn);

type ChatInterfaceProps = ComponentProps<typeof ChatInterface>;

const renderChat = (props: Partial<ChatInterfaceProps> = {}) =>
    render(
        <ChatInterface elementId="1" elementType="project" {...props} />
    );

describe('ChatInterface — no native alert/confirm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useEvents).mockReturnValue(eventsReturn());
        vi.mocked(Operations.createEvent).mockResolvedValue({});
        vi.mocked(DolibarrService.uploadDocument).mockResolvedValue({});
    });

    it('renders empty state when no messages', () => {
        renderChat();
        expect(screen.getByText('Nenhum comentário ainda. Inicie a conversa!')).toBeInTheDocument();
    });

    it('renders existing messages', () => {
        vi.mocked(useEvents).mockReturnValue(eventsReturn([
            { id: '1', elementtype: 'project', fk_element: '1', fk_user_author: 'u2', user_author_name: 'Other', description: 'Hello world', date_start: 1700000000 },
        ]));
        renderChat();
        expect(screen.getByText('Hello world')).toBeInTheDocument();
    });

    it('sends a message via Operations.createEvent on Enter', async () => {
        const user = userEvent.setup();
        renderChat();

        const input = screen.getByTestId('message-input');
        await user.type(input, 'Test message');
        fireEvent.keyDown(input, { key: 'Enter' });

        await waitFor(() => {
            expect(Operations.createEvent).toHaveBeenCalledWith(
                expect.any(Object),
                expect.objectContaining({ description: 'Test message' })
            );
        });
    });

    it('uses notifyError instead of alert when sending message fails', async () => {
        const user = userEvent.setup();
        vi.mocked(Operations.createEvent).mockRejectedValue(new Error('Network error'));

        renderChat();

        const input = screen.getByTestId('message-input');
        await user.type(input, 'Test message');
        fireEvent.keyDown(input, { key: 'Enter' });

        await waitFor(() => {
            expect(notifyError).toHaveBeenCalledWith('Enviar mensagem', expect.any(Error));
        });
    });

    it('uses toast.error instead of alert for unsupported upload context', async () => {
        const user = userEvent.setup();
        renderChat({ elementType: 'task' });

        const fileInputEl = document.querySelector('input[type="file"]') as HTMLInputElement;
        fireEvent.change(fileInputEl, { target: { files: [new File(['content'], 'test.png', { type: 'image/png' })] } });
        await user.click(screen.getByRole('button', { name: /enviar mensagem/i }));

        await waitFor(() => {
            expect(toast.error).toHaveBeenCalledWith('Upload não suportado neste contexto (falta referência "Ref").');
        });
    });

    it('uses notifyError instead of alert when upload fails', async () => {
        const user = userEvent.setup();
        vi.mocked(DolibarrService.uploadDocument).mockRejectedValue(new Error('Upload failed'));

        renderChat({ elementType: 'user', elementId: 'u1' });

        const fileInputEl = document.querySelector('input[type="file"]') as HTMLInputElement;
        fireEvent.change(fileInputEl, { target: { files: [new File(['content'], 'test.png', { type: 'image/png' })] } });
        await user.click(screen.getByRole('button', { name: /enviar mensagem/i }));

        await waitFor(() => {
            expect(notifyError).toHaveBeenCalledWith('Upload de arquivo', expect.any(Error));
        });
    });
});

describe('ChatInterface — flexbox structure (#662)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useEvents).mockReturnValue(eventsReturn());
    });

    it('root container has min-h-0 and flex flex-col', () => {
        const { container } = renderChat();
        const root = container.firstChild as HTMLElement;
        expect(root.className).toContain('min-h-0');
        expect(root.className).toContain('flex');
        expect(root.className).toContain('flex-col');
    });

    it('default height is "100%" to inherit from parent', () => {
        const { container } = renderChat();
        const root = container.firstChild as HTMLElement;
        expect((root.style as CSSStyleDeclaration).height).toBe('100%');
    });

    it('respects a custom height prop when provided', () => {
        const { container } = renderChat({ height: '500px' });
        const root = container.firstChild as HTMLElement;
        expect((root.style as CSSStyleDeclaration).height).toBe('500px');
    });

    it('messages area has flex-1 min-h-0 overflow-y-auto', () => {
        renderChat();
        const messagesArea = document.querySelector('.flex-1.min-h-0.overflow-y-auto');
        expect(messagesArea).not.toBeNull();
    });

    it('footer/input area has flex-shrink-0 so it is never pushed off-screen', () => {
        renderChat();
        const footer = screen.getByTestId('message-input').closest('.flex-shrink-0');
        expect(footer).not.toBeNull();
    });
});

describe('ChatInterface — fluxo de envio de mensagem (#664)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useEvents).mockReturnValue(eventsReturn());
        vi.mocked(Operations.createEvent).mockResolvedValue({});
        vi.mocked(DolibarrService.uploadDocument).mockResolvedValue({});
    });

    it('renderiza input e botão de enviar no DOM', () => {
        renderChat();
        expect(screen.getByTestId('message-input')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /enviar mensagem/i })).toBeInTheDocument();
    });

    it('envia com payload correto (type_code AC_CHAT, elementtype, fk_element) ao clicar em enviar', async () => {
        const user = userEvent.setup();
        renderChat({ elementType: 'project', elementId: '42' });

        const input = screen.getByTestId('message-input');
        await user.type(input, 'Olá mundo');
        await user.click(screen.getByRole('button', { name: /enviar mensagem/i }));

        await waitFor(() => {
            expect(Operations.createEvent).toHaveBeenCalledWith(
                expect.any(Object),
                expect.objectContaining({
                    type_code: 'AC_CHAT',
                    elementtype: 'project',
                    fk_element: '42',
                    description: 'Olá mundo',
                    userownerid: 'u1',
                })
            );
        });
    });

    it('limpa o input após sucesso do POST', async () => {
        const user = userEvent.setup();
        renderChat();

        const input = screen.getByTestId('message-input') as HTMLTextAreaElement;
        await user.type(input, 'Mensagem de sucesso');
        await user.click(screen.getByRole('button', { name: /enviar mensagem/i }));

        await waitFor(() => {
            expect(Operations.createEvent).toHaveBeenCalled();
        });
        await waitFor(() => {
            expect((screen.getByTestId('message-input') as HTMLTextAreaElement).value).toBe('');
        });
    });

    it('preserva o texto e mostra erro inline quando o envio falha', async () => {
        const user = userEvent.setup();
        vi.mocked(Operations.createEvent).mockRejectedValue(new Error('Payload inválido'));

        renderChat();

        const input = screen.getByTestId('message-input') as HTMLTextAreaElement;
        await user.type(input, 'Texto importante');
        await user.click(screen.getByRole('button', { name: /enviar mensagem/i }));

        await waitFor(() => {
            expect(screen.getByTestId('send-error')).toBeInTheDocument();
        });
        // O texto NÃO é perdido em caso de erro
        expect((screen.getByTestId('message-input') as HTMLTextAreaElement).value).toBe('Texto importante');
        expect(notifyError).toHaveBeenCalledWith('Enviar mensagem', expect.any(Error));
    });

    it('mostra a mensagem imediatamente na conversa após enviar (atualização otimista)', async () => {
        const user = userEvent.setup();
        renderChat();

        const input = screen.getByTestId('message-input');
        await user.type(input, 'Mensagem otimista');
        await user.click(screen.getByRole('button', { name: /enviar mensagem/i }));

        await waitFor(() => {
            expect(screen.getByText('Mensagem otimista')).toBeInTheDocument();
        });
    });

    it('descarta a mensagem otimista quando a real chega via useEvents (dedup)', async () => {
        const user = userEvent.setup();
        renderChat();

        const input = screen.getByTestId('message-input');
        await user.type(input, 'Mensagem dedup');
        await user.click(screen.getByRole('button', { name: /enviar mensagem/i }));

        await waitFor(() => {
            expect(screen.getByText('Mensagem dedup')).toBeInTheDocument();
        });

        // Simula o servidor devolvendo a mensagem real (mesma descrição/contexto)
        vi.mocked(useEvents).mockReturnValue(eventsReturn([
            { id: 'real-1', elementtype: 'project', fk_element: '1', fk_user_author: 'u1', user_author_name: 'Eu', description: 'Mensagem dedup', date_start: Math.floor(Date.now() / 1000) },
        ]));

        await waitFor(() => {
            expect(screen.getAllByText('Mensagem dedup')).toHaveLength(1);
        });
    });
});

const msgOwn = { id: 'msg-1', elementtype: 'project', fk_element: '1', fk_user_author: 'u1', user_author_name: 'Eu', description: 'Minha mensagem', date_start: 1700000000 };
const msgOther = { id: 'msg-2', elementtype: 'project', fk_element: '1', fk_user_author: 'u99', user_author_name: 'Outro', description: 'Mensagem alheia', date_start: 1700000001 };

describe('ChatInterface — excluir/editar mensagens (#601)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockConfirm.mockResolvedValue(true);
        vi.mocked(Operations.deleteEvent).mockResolvedValue({});
        vi.mocked(Operations.updateEvent).mockResolvedValue({});
        vi.mocked(Operations.createEvent).mockResolvedValue({});
        vi.mocked(useEvents).mockReturnValue(eventsReturn([msgOwn, msgOther]));
    });

    it('mensagem própria exibe botão Excluir; mensagem alheia não exibe', () => {
        renderChat();
        expect(screen.getByTestId('delete-btn-msg-1')).toBeInTheDocument();
        expect(screen.queryByTestId('delete-btn-msg-2')).toBeNull();
    });

    it('mensagem própria exibe botão Editar; mensagem alheia não exibe', () => {
        renderChat();
        expect(screen.getByTestId('edit-btn-msg-1')).toBeInTheDocument();
        expect(screen.queryByTestId('edit-btn-msg-2')).toBeNull();
    });

    it('clicar em Excluir (com confirmação) chama Operations.deleteEvent com o id correto', async () => {
        const user = userEvent.setup();
        renderChat();

        await user.click(screen.getByTestId('delete-btn-msg-1'));

        await waitFor(() => {
            expect(Operations.deleteEvent).toHaveBeenCalledWith(expect.any(Object), 'msg-1');
        });
    });

    it('clicar em Excluir sem confirmar (mockConfirm=false) não chama deleteEvent', async () => {
        mockConfirm.mockResolvedValue(false);
        const user = userEvent.setup();
        renderChat();

        await user.click(screen.getByTestId('delete-btn-msg-1'));

        await waitFor(() => {
            expect(Operations.deleteEvent).not.toHaveBeenCalled();
        });
    });

    it('erro ao excluir dispara notifyError', async () => {
        vi.mocked(Operations.deleteEvent).mockRejectedValue(new Error('Falha na exclusão'));
        const user = userEvent.setup();
        renderChat();

        await user.click(screen.getByTestId('delete-btn-msg-1'));

        await waitFor(() => {
            expect(notifyError).toHaveBeenCalledWith('Excluir mensagem', expect.any(Error));
        });
    });

    it('clicar em Editar exibe input inline; salvar chama Operations.updateEvent', async () => {
        const user = userEvent.setup();
        renderChat();

        await user.click(screen.getByTestId('edit-btn-msg-1'));

        const editInput = await screen.findByTestId('edit-input-msg-1');
        expect(editInput).toBeInTheDocument();

        await user.clear(editInput);
        await user.type(editInput, 'Texto editado');
        await user.click(screen.getByTestId('save-edit-msg-1'));

        await waitFor(() => {
            expect(Operations.updateEvent).toHaveBeenCalledWith(
                expect.any(Object),
                'msg-1',
                expect.objectContaining({ description: 'Texto editado' })
            );
        });
    });
});

describe('ChatInterface — fluxo de resposta (reply) (#1572)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(Operations.createEvent).mockResolvedValue({});
        vi.mocked(useEvents).mockReturnValue(eventsReturn([msgOther]));
    });

    it('clicar em "Responder" em uma mensagem alheia exibe o banner com nome e trecho do conteúdo', async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const { container } = renderChat();

        // O botão de resposta fica no grupo da mensagem e é selecionado pelo title.
        const replyBtn = container.querySelector('button[title="Responder"]') as HTMLButtonElement;
        expect(replyBtn).not.toBeNull();
        await user.click(replyBtn);

        // O banner mostra o nome do autor ("Outro") e os primeiros 50 chars do conteúdo.
        expect(screen.getByText(/Respondendo a Outro/)).toBeInTheDocument();
        // O trecho do banner recebe sufixo "..." — distinto do bubble da mensagem.
        expect(screen.getByText(/Mensagem alheia\.\.\./)).toBeInTheDocument();
    });

    it('o botão × do banner cancela a resposta limpando o contexto', async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const { container } = renderChat();

        const replyBtn = container.querySelector('button[title="Responder"]') as HTMLButtonElement;
        await user.click(replyBtn);
        expect(screen.getByText(/Respondendo a Outro/)).toBeInTheDocument();

        // O botão × é o único botão com texto "×" dentro do banner.
        const cancelBtn = screen.getByRole('button', { name: '×' });
        await user.click(cancelBtn);

        await waitFor(() => {
            expect(screen.queryByText(/Respondendo a Outro/)).toBeNull();
        });
        expect(Operations.createEvent).not.toHaveBeenCalled();
    });

    it('enviar após responder inclui o bloco de citação no payload description', async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const { container } = renderChat();

        const replyBtn = container.querySelector('button[title="Responder"]') as HTMLButtonElement;
        await user.click(replyBtn);

        const input = screen.getByTestId('message-input');
        await user.type(input, 'Resposta adequada');
        await user.click(screen.getByRole('button', { name: /enviar mensagem/i }));

        await waitFor(() => {
            expect(Operations.createEvent).toHaveBeenCalledWith(
                expect.any(Object),
                expect.objectContaining({
                    description: expect.stringContaining('<blockquote'),
                })
            );
            // A citação referencia o autor e o conteúdo original, além do texto da resposta.
            const call = vi.mocked(Operations.createEvent).mock.calls[0][1] as { description: string };
            expect(call.description).toContain('Outro');
            expect(call.description).toContain('Mensagem alheia');
            expect(call.description).toContain('Resposta adequada');
        });
    });

    it('após enviar com sucesso, o banner de resposta é removido', async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const { container } = renderChat();

        const replyBtn = container.querySelector('button[title="Responder"]') as HTMLButtonElement;
        await user.click(replyBtn);
        await user.type(screen.getByTestId('message-input'), 'Reply ok');
        await user.click(screen.getByRole('button', { name: /enviar mensagem/i }));

        await waitFor(() => {
            expect(Operations.createEvent).toHaveBeenCalled();
        });
        await waitFor(() => {
            expect(screen.queryByText(/Respondendo a Outro/)).toBeNull();
        });
    });
});

describe('ChatInterface — tipos sem any (#1572)', () => {
    it('chatMessages é ChatMessage[]: campo content é renderizado no lugar de description/label', () => {
        vi.mocked(useEvents).mockReturnValue(eventsReturn([
            { id: 't1', elementtype: 'project', fk_element: '1', fk_user_author: 'u2', user_author_name: 'Outro', description: 'Conteúdo via content', date_start: 1700000000 },
        ]));
        renderChat();
        expect(screen.getByText('Conteúdo via content')).toBeInTheDocument();
    });
});

describe('ChatInterface — callbacks tipados onSend/onReply/onEdit/onDelete (#1026)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockConfirm.mockResolvedValue(true);
        vi.mocked(Operations.createEvent).mockResolvedValue({});
        vi.mocked(Operations.deleteEvent).mockResolvedValue({});
        vi.mocked(Operations.updateEvent).mockResolvedValue({});
        vi.mocked(DolibarrService.uploadDocument).mockResolvedValue({});
        vi.mocked(useEvents).mockReturnValue(eventsReturn([msgOwn, msgOther]));
    });

    it('onSend é chamado com a ChatMessage após o envio bem-sucedido', async () => {
        const user = userEvent.setup();
        const onSend = vi.fn<(message: ChatMessage) => void>();
        renderChat({ onSend });

        const input = screen.getByTestId('message-input');
        await user.type(input, 'Callback send');
        await user.click(screen.getByRole('button', { name: /enviar mensagem/i }));

        await waitFor(() => {
            expect(onSend).toHaveBeenCalledTimes(1);
        });
        const sent = onSend.mock.calls[0][0];
        expect(sent.content).toContain('Callback send');
        expect(sent.senderId).toBe('u1');
        expect(sent.elementtype).toBe('project');
        expect(sent.fk_element).toBe('1');
    });

    it('onSend NÃO é chamado quando createEvent falha', async () => {
        const user = userEvent.setup();
        vi.mocked(Operations.createEvent).mockRejectedValue(new Error('Falha de rede'));
        const onSend = vi.fn<(message: ChatMessage) => void>();
        renderChat({ onSend });

        await user.type(screen.getByTestId('message-input'), 'Mensagem que falha');
        await user.click(screen.getByRole('button', { name: /enviar mensagem/i }));

        await waitFor(() => {
            expect(screen.getByTestId('send-error')).toBeInTheDocument();
        });
        expect(onSend).not.toHaveBeenCalled();
    });

    it('onReply é chamado com um ChatReply ao clicar em "Responder"', async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const onReply = vi.fn<(reply: ChatReply) => void>();
        const { container } = renderChat({ onReply });

        const replyBtn = container.querySelector('button[title="Responder"]') as HTMLButtonElement;
        await user.click(replyBtn);

        expect(onReply).toHaveBeenCalledTimes(1);
        const reply = onReply.mock.calls[0][0];
        expect(reply.messageId).toBe('msg-1');
        expect(reply.senderName).toBe('Eu');
        expect(reply.content).toBe('Minha mensagem');
    });

    it('onEdit é chamado com a ChatMessage após salvar a edição', async () => {
        const user = userEvent.setup();
        const onEdit = vi.fn<(message: ChatMessage) => void>();
        renderChat({ onEdit });

        await user.click(screen.getByTestId('edit-btn-msg-1'));
        const editInput = screen.getByTestId('edit-input-msg-1');
        await user.clear(editInput);
        await user.type(editInput, 'Texto editado');
        await user.click(screen.getByTestId('save-edit-msg-1'));

        await waitFor(() => {
            expect(onEdit).toHaveBeenCalledTimes(1);
        });
        expect(onEdit.mock.calls[0][0].id).toBe('msg-1');
    });

    it('onDelete é chamado com a ChatMessage após a exclusão confirmada', async () => {
        const user = userEvent.setup();
        const onDelete = vi.fn<(message: ChatMessage) => void>();
        renderChat({ onDelete });

        await user.click(screen.getByTestId('delete-btn-msg-1'));

        await waitFor(() => {
            expect(onDelete).toHaveBeenCalledTimes(1);
        });
        expect(onDelete.mock.calls[0][0].id).toBe('msg-1');
    });

    it('onDelete NÃO é chamado quando o usuário cancela a confirmação', async () => {
        mockConfirm.mockResolvedValue(false);
        const user = userEvent.setup();
        const onDelete = vi.fn<(message: ChatMessage) => void>();
        renderChat({ onDelete });

        await user.click(screen.getByTestId('delete-btn-msg-1'));

        await waitFor(() => {
            expect(Operations.deleteEvent).not.toHaveBeenCalled();
        });
        expect(onDelete).not.toHaveBeenCalled();
    });
});

describe('ChatInterface — anexos de vídeo (#1032)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useEvents).mockReturnValue(eventsReturn());
        vi.mocked(Operations.createEvent).mockResolvedValue({});
        vi.mocked(DolibarrService.uploadDocument).mockResolvedValue({});
    });

    it('aceita imagens, PDFs, MP4 e WebM com seleção múltipla', () => {
        renderChat();

        const input = screen.getByLabelText('Selecionar anexos') as HTMLInputElement;
        expect(input).toHaveAttribute('accept', 'image/*,application/pdf,video/mp4,video/webm');
        expect(input).toHaveAttribute('multiple');
    });

    it('mostra erro inline para tipo não suportado', () => {
        renderChat();

        fireEvent.change(screen.getByLabelText('Selecionar anexos'), {
            target: { files: [new File(['texto'], 'arquivo.txt', { type: 'text/plain' })] },
        });

        expect(screen.getByTestId('attachment-error')).toHaveTextContent('tipo não suportado');
        expect(screen.queryByText('arquivo.txt')).not.toBeInTheDocument();
        expect(DolibarrService.uploadDocument).not.toHaveBeenCalled();
    });

    it('bloqueia vídeo acima de 10 MB com mensagem clara', () => {
        renderChat();
        const video = new File(['video'], 'grande.mp4', { type: 'video/mp4' });
        Object.defineProperty(video, 'size', { value: 10 * 1024 * 1024 + 1 });

        fireEvent.change(screen.getByLabelText('Selecionar anexos'), {
            target: { files: [video] },
        });

        expect(screen.getByTestId('attachment-error')).toHaveTextContent('Vídeo acima de 10 MB não é suportado');
        expect(screen.queryByText('grande.mp4')).not.toBeInTheDocument();
        expect(DolibarrService.uploadDocument).not.toHaveBeenCalled();
    });

    it('arrasta imagem, PDF e vídeo juntos, mostra previews e envia todos', async () => {
        const user = userEvent.setup();
        renderChat({ elementType: 'user', elementId: 'u1' });
        const files = [
            new File(['imagem'], 'foto.png', { type: 'image/png' }),
            new File(['pdf'], 'manual.pdf', { type: 'application/pdf' }),
            new File(['video'], 'curto.webm', { type: 'video/webm' }),
        ];

        fireEvent.drop(screen.getByTestId('chat-dropzone'), { dataTransfer: { files } });

        expect(screen.getByText('foto.png')).toBeInTheDocument();
        expect(screen.getByText('manual.pdf')).toBeInTheDocument();
        expect(screen.getByText('curto.webm')).toBeInTheDocument();
        expect(DolibarrService.uploadDocument).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: /enviar mensagem/i }));

        await waitFor(() => {
            expect(DolibarrService.uploadDocument).toHaveBeenCalledTimes(3);
            expect(Operations.createEvent).toHaveBeenCalledWith(
                expect.any(Object),
                expect.objectContaining({
                    description: expect.stringContaining('curto.webm'),
                })
            );
        });
        const description = vi.mocked(Operations.createEvent).mock.calls[0][1].description as string;
        expect(description).toContain('foto.png');
        expect(description).toContain('manual.pdf');
    });
});
