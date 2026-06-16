import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInterface } from '../../components/Chat/ChatInterface';
import * as Operations from '../../services/api/operations';
import { DolibarrService } from '../../services/dolibarrService';
import { useEvents } from '../../hooks/dolibarr';
import { toast } from 'sonner';

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
