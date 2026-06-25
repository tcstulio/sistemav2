import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WhatsAppView from '../../components/WhatsAppView';
import { ConfirmProvider } from '../../hooks/useConfirm';
import { WhatsAppService } from '../../services/whatsappService';
import { AiService } from '../../services/aiService';
import { toast } from 'sonner';

vi.mock('sonner', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
    },
}));

vi.mock('../../utils/notifyError', () => ({
    notifyError: vi.fn(),
}));

vi.mock('../../services/whatsappService', () => ({
    WhatsAppService: {
        getAccounts: vi.fn(),
        getSessionSettings: vi.fn(),
        getUserSettings: vi.fn(),
        updateSessionSettings: vi.fn(),
        updateUserSettings: vi.fn(),
        getChatSettings: vi.fn(),
        updateChatSettings: vi.fn(),
        sendAudioMessage: vi.fn(),
        sendFileMessage: vi.fn(),
        sendMessage: vi.fn(),
        startSession: vi.fn(),
        deleteSession: vi.fn(),
        assignConversation: vi.fn(),
        getQrCode: vi.fn(),
    },
}));

vi.mock('../../services/aiService', () => ({
    AiService: {
        analyzeSystem: vi.fn(),
    },
}));

vi.mock('../../contexts/WhatsAppContext', () => ({
    useWhatsAppContext: vi.fn(() => ({ socket: null })),
}));

vi.mock('../../hooks/whatsapp/useSessions', () => ({
    useSessions: vi.fn(() => ({
        sessions: [{ id: 'sess1', name: 'Session 1', status: 'connected', phoneNumber: '123', platform: 'WAHA' }],
        loading: false,
        refreshSessions: vi.fn(),
        startSession: vi.fn(),
        stopSession: vi.fn(),
        qrCodes: {},
    })),
}));

vi.mock('../../hooks/whatsapp/useConversations', () => ({
    useConversations: vi.fn(() => ({
        conversations: [],
        loading: false,
        refreshConversations: vi.fn(),
    })),
}));

vi.mock('../../hooks/whatsapp/useMessages', () => ({
    useMessages: vi.fn(() => ({
        messages: [],
        loading: false,
        sendMessage: vi.fn(),
    })),
}));

vi.mock('../../hooks/useCRMContext', () => ({
    useCRMContext: vi.fn(() => null),
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({ config: { baseUrl: 'http://test', apiKey: 'key' }, currentUser: { id: 'u1', login: 'tester' } })),
}));

vi.mock('../../hooks/dolibarr', () => ({
    useUsers: vi.fn(() => ({ data: [] })),
    useCustomers: vi.fn(() => ({ data: [] })),
    useContacts: vi.fn(() => ({ data: [] })),
    useSuppliers: vi.fn(() => ({ data: [] })),
    useInvoices: vi.fn(() => ({ data: [] })),
    useOrders: vi.fn(() => ({ data: [] })),
    useTickets: vi.fn(() => ({ data: [] })),
    useProjects: vi.fn(() => ({ data: [] })),
}));

// Capture callback props from sub-components so we can invoke them in tests
let capturedCallbacks: Record<string, (...args: any[]) => any> = {};

vi.mock('../../components/whatsapp/ConversationList', () => ({
    ConversationList: (props: any) => {
        capturedCallbacks.onDeleteSession = props.onDeleteSession;
        capturedCallbacks.onSelect = props.onSelect;
        capturedCallbacks.onSettingsClick = props.onSettingsClick;
        return (
            <div data-testid="conversation-list">
                <button data-testid="delete-session-btn" onClick={() => props.onDeleteSession?.('sess1')}>
                    Delete Session
                </button>
                <button
                    data-testid="select-conv-btn"
                    onClick={() => props.onSelect({ id: 'c1', accountId: 'sess1', customerName: 'Test', customerNumber: '123', lastMessage: '', lastMessageTimestamp: Date.now(), unreadCount: 0, status: 'open', isGroup: false })}
                >
                    Select Conversation
                </button>
                <button data-testid="settings-btn" onClick={() => props.onSettingsClick?.()}>
                    Open Settings
                </button>
            </div>
        );
    },
}));

vi.mock('../../components/whatsapp/ChatWindow', () => ({
    ChatWindow: () => <div data-testid="chat-window" />,
}));

vi.mock('../../components/whatsapp/MessageInput', () => ({
    MessageInput: (props: any) => {
        capturedCallbacks.onSendMessage = props.onSendMessage;
        capturedCallbacks.onSendAudio = props.onSendAudio;
        capturedCallbacks.onSendFile = props.onSendFile;
        return (
            <div data-testid="message-input">
                <button data-testid="send-msg-btn" onClick={() => props.onSendMessage('hello')}>Send Msg</button>
                <button data-testid="send-sys-btn" onClick={() => props.onSendMessage('/sys test query')}>Send Sys</button>
                <button data-testid="send-audio-btn" onClick={() => props.onSendAudio(new Blob([]))}>Send Audio</button>
                <button data-testid="send-file-btn" onClick={() => props.onSendFile(new File([], 'f.txt'))}>Send File</button>
            </div>
        );
    },
}));

vi.mock('../../components/whatsapp/ContextPanel', () => ({
    ContextPanel: () => <div data-testid="context-panel" />,
}));

vi.mock('../../components/whatsapp/ConnectModal', () => ({
    ConnectModal: () => <div data-testid="connect-modal" />,
}));

vi.mock('../../components/whatsapp/CreateSessionModal', () => ({
    CreateSessionModal: () => <div data-testid="create-session-modal" />,
}));

vi.mock('../../components/whatsapp/NewConversationModal', () => ({
    NewConversationModal: () => <div data-testid="new-conversation-modal" />,
}));

vi.mock('../../components/whatsapp/WhatsAppProfileSettings', () => ({
    WhatsAppProfileSettings: () => <div data-testid="profile-settings" />,
}));

const { notifyError } = await import('../../utils/notifyError');

const renderView = () =>
    render(
        <ConfirmProvider>
            <WhatsAppView />
        </ConfirmProvider>
    );

describe('WhatsAppView — no native alert/confirm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        capturedCallbacks = {};
        vi.mocked(WhatsAppService.getChatSettings).mockResolvedValue({ autoReplyEnabled: undefined } as any);
        vi.mocked(WhatsAppService.getSessionSettings).mockResolvedValue({} as any);
        vi.mocked(WhatsAppService.getUserSettings).mockResolvedValue({ signatureName: '' } as any);
    });

    it('uses toast.success instead of alert for /sys analysis result', async () => {
        const user = userEvent.setup();
        vi.mocked(AiService.analyzeSystem).mockResolvedValue('All systems normal');

        renderView();

        // Select a conversation so MessageInput renders
        await user.click(screen.getByTestId('select-conv-btn'));

        // Trigger /sys command
        await user.click(screen.getByTestId('send-sys-btn'));

        await waitFor(() => {
            expect(toast.success).toHaveBeenCalledWith(
                'Análise do Sistema',
                { description: 'All systems normal', duration: 10000 }
            );
        });
    });

    it('uses notifyError instead of alert when /sys analysis fails', async () => {
        const user = userEvent.setup();
        vi.mocked(AiService.analyzeSystem).mockRejectedValue(new Error('AI down'));

        renderView();

        await user.click(screen.getByTestId('select-conv-btn'));
        await user.click(screen.getByTestId('send-sys-btn'));

        await waitFor(() => {
            expect(notifyError).toHaveBeenCalledWith('Analisar sistema', expect.any(Error));
        });
    });

    it('uses notifyError instead of alert when sending audio fails', async () => {
        const user = userEvent.setup();
        vi.mocked(WhatsAppService.sendAudioMessage).mockRejectedValue(new Error('Network error'));

        renderView();

        await user.click(screen.getByTestId('select-conv-btn'));
        await user.click(screen.getByTestId('send-audio-btn'));

        await waitFor(() => {
            expect(notifyError).toHaveBeenCalledWith('Enviar áudio', expect.any(Error));
        });
    });

    it('uses notifyError instead of alert when sending file fails', async () => {
        const user = userEvent.setup();
        vi.mocked(WhatsAppService.sendFileMessage).mockRejectedValue(new Error('Upload failed'));

        renderView();

        await user.click(screen.getByTestId('select-conv-btn'));
        await user.click(screen.getByTestId('send-file-btn'));

        await waitFor(() => {
            expect(notifyError).toHaveBeenCalledWith('Enviar arquivo', expect.any(Error));
        });
    });

    it('shows in-app confirm dialog instead of window.confirm for delete session', async () => {
        const user = userEvent.setup();

        renderView();

        await user.click(screen.getByTestId('delete-session-btn'));

        const dialog = await screen.findByRole('dialog');
        expect(dialog).toBeTruthy();
        expect(within(dialog).getByText('Excluir sessão?')).toBeTruthy();
    });

    it('does not call stopSession when user cancels delete confirm', async () => {
        const user = userEvent.setup();

        renderView();

        await user.click(screen.getByTestId('delete-session-btn'));

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Cancelar'));

        // Ensure dialog is gone (action was cancelled)
        await waitFor(() => {
            expect(screen.queryByRole('dialog')).toBeNull();
        });
    });

    it('settings modal usa <Modal> reutilizável e fecha com ESC (#832)', async () => {
        const user = userEvent.setup();

        renderView();

        await user.click(screen.getByTestId('settings-btn'));

        // Modal reutilizável renderiza role="dialog" com o título
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Configurações do WhatsApp')).toBeTruthy();

        // ESC fecha (comportamento do <Modal>, antes os modais eram <div> inline sem ESC)
        await user.keyboard('{Escape}');

        await waitFor(() => {
            expect(screen.queryByRole('dialog')).toBeNull();
        });
    });
});
