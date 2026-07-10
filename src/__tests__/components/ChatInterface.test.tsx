import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInterface } from '../../components/chat/ChatInterface';
import * as Operations from '../../services/api/operations';
import { DolibarrService } from '../../services/dolibarrService';
import { useEvents } from '../../hooks/dolibarr';
import { toast } from 'sonner';

// useConfirm mock: por padrão confirma a ação
const mockConfirm = vi.fn().mockResolvedValue(true);
vi.mock('../../hooks/useConfirm', () => ({
    useConfirm: () => mockConfirm,
    ConfirmProvider: ({ children }: any) => children,
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

vi.mock('../../components/common/RichTextEditor', () => ({
    RichTextEditor: ({ value, onChange, onKeyDown }: any) => (
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

const renderChat = (props: any = {}) =>
    render(
        <ChatInterface elementId="1" elementType="project" {...props} />
    );

describe('ChatInterface — no native alert/confirm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useEvents).mockReturnValue({ data: [], isLoading: false, refetch: mockRefetch } as any);
        vi.mocked(Operations.createEvent).mockResolvedValue({} as any);
        vi.mocked(DolibarrService.uploadDocument).mockResolvedValue({} as any);
    });

    it('renders empty state when no messages', () => {
        renderChat();
        expect(screen.getByText('Nenhum comentário ainda. Inicie a conversa!')).toBeInTheDocument();
    });

    it('renders existing messages', () => {
        vi.mocked(useEvents).mockReturnValue({
            data: [
                { id: '1', elementtype: 'project', fk_element: '1', fk_user_author: 'u2', user_author_name: 'Other', description: 'Hello world', date_start: 1700000000 },
            ],
            isLoading: false,
            refetch: mockRefetch,
        } as any);
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
        renderChat({ elementType: 'task' });

        const fileInputEl = document.querySelector('input[type="file"]') as HTMLInputElement;
        fireEvent.change(fileInputEl, { target: { files: [new File(['content'], 'test.txt')] } });

        await waitFor(() => {
            expect(toast.error).toHaveBeenCalledWith('Upload não suportado neste contexto (falta referência "Ref").');
        });
    });

    it('uses notifyError instead of alert when upload fails', async () => {
        vi.mocked(DolibarrService.uploadDocument).mockRejectedValue(new Error('Upload failed'));

        renderChat({ elementType: 'user', elementId: 'u1' });

        const fileInputEl = document.querySelector('input[type="file"]') as HTMLInputElement;
        fireEvent.change(fileInputEl, { target: { files: [new File(['content'], 'test.txt')] } });

        await waitFor(() => {
            expect(notifyError).toHaveBeenCalledWith('Upload de arquivo', expect.any(Error));
        });
    });
});

describe('ChatInterface — flexbox structure (#662)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useEvents).mockReturnValue({ data: [], isLoading: false, refetch: mockRefetch } as any);
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
        vi.mocked(useEvents).mockReturnValue({ data: [], isLoading: false, refetch: mockRefetch } as any);
        vi.mocked(Operations.createEvent).mockResolvedValue({} as any);
        vi.mocked(DolibarrService.uploadDocument).mockResolvedValue({} as any);
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
        vi.mocked(useEvents).mockReturnValue({
            data: [
                { id: 'real-1', elementtype: 'project', fk_element: '1', fk_user_author: 'u1', user_author_name: 'Eu', description: 'Mensagem dedup', date_start: Math.floor(Date.now() / 1000) },
            ],
            isLoading: false,
            refetch: mockRefetch,
        } as any);

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
        vi.mocked(Operations.deleteEvent).mockResolvedValue({} as any);
        vi.mocked(Operations.updateEvent).mockResolvedValue({} as any);
        vi.mocked(Operations.createEvent).mockResolvedValue({} as any);
        vi.mocked(useEvents).mockReturnValue({
            data: [msgOwn, msgOther],
            isLoading: false,
            refetch: mockRefetch,
        } as any);
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
