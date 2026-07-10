import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatSidebar } from '../../components/chat/ChatSidebar';

vi.mock('react-router-dom', () => ({
    useNavigate: () => vi.fn(),
    useParams: () => ({ id: undefined }),
    useLocation: () => ({ pathname: '/chat' }),
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: () => ({
        config: { apiUrl: 'http://test/api/index.php', apiKey: 'key' },
        currentUser: { id: 'u1', login: 'tester' },
    }),
}));

vi.mock('../../hooks/dolibarr', () => ({
    useUsers: vi.fn(() => ({ data: [] })),
    useProjects: vi.fn(() => ({ data: [] })),
    useEvents: vi.fn(() => ({ data: [] })),
}));

import { useUsers, useProjects, useEvents } from '../../hooks/dolibarr';

const renderSidebar = (onSelect = vi.fn()) =>
    render(<ChatSidebar onSelect={onSelect} />);

describe('ChatSidebar — descoberta de nova conversa (#601)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useEvents).mockReturnValue({ data: [] } as any);
        vi.mocked(useUsers).mockReturnValue({ data: [] } as any);
        vi.mocked(useProjects).mockReturnValue({ data: [] } as any);
    });

    it('botão Nova conversa está visível na sidebar', () => {
        renderSidebar();
        expect(screen.getByTestId('nova-conversa-btn')).toBeInTheDocument();
    });

    it('sem conversas recentes, estado vazio mostra link "Iniciar nova conversa"', () => {
        renderSidebar();
        expect(screen.getAllByText('Iniciar nova conversa').length).toBeGreaterThan(0);
    });

    it('clicar em Nova conversa exibe todos os usuários disponíveis (não só os com histórico)', async () => {
        vi.mocked(useUsers).mockReturnValue({
            data: [
                { id: 'u2', statut: '1', firstname: 'Ana', lastname: 'Lima', login: 'ana' },
                { id: 'u3', statut: '1', firstname: 'Bob', lastname: 'Silva', login: 'bob' },
            ],
        } as any);
        // Sem eventos: activeUserIds é vazio — sem o clique em Nova só mostraria estado vazio
        vi.mocked(useEvents).mockReturnValue({ data: [] } as any);

        const user = userEvent.setup();
        renderSidebar();

        await user.click(screen.getByTestId('nova-conversa-btn'));

        expect(screen.getByText('Ana Lima')).toBeInTheDocument();
        expect(screen.getByText('Bob Silva')).toBeInTheDocument();
    });

    it('sem conversas recentes e sem nova conversa ativa mostra apenas o estado vazio padrão', () => {
        renderSidebar();
        // Não exibe usuários quando não há histórico e não clicou em Nova
        expect(screen.queryByRole('button', { name: /ana/i })).toBeNull();
    });
});
