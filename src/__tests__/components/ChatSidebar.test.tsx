import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ChatSidebar } from '../../components/chat/ChatSidebar';
import type { DolibarrUser, Project, AgendaEvent } from '../../types';
import type { DolibarrHookResult } from '../../hooks/dolibarr';

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

const renderSidebar = (onSelect = vi.fn(), initialEntry = '/chat') =>
    render(
        <MemoryRouter initialEntries={[initialEntry]}>
            <ChatSidebar onSelect={onSelect} />
        </MemoryRouter>
    );

describe('ChatSidebar — descoberta de nova conversa (#601)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useEvents).mockReturnValue({ data: [] } as unknown as DolibarrHookResult<AgendaEvent>);
        vi.mocked(useUsers).mockReturnValue({ data: [] } as unknown as DolibarrHookResult<DolibarrUser>);
        vi.mocked(useProjects).mockReturnValue({ data: [] } as unknown as DolibarrHookResult<Project>);
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
        } as unknown as DolibarrHookResult<DolibarrUser>);
        // Sem eventos: activeUserIds é vazio — sem o clique em Nova só mostraria estado vazio
        vi.mocked(useEvents).mockReturnValue({ data: [] } as unknown as DolibarrHookResult<AgendaEvent>);

        const user = userEvent.setup();
        renderSidebar();

        await user.click(screen.getByTestId('nova-conversa-btn'));

        expect(screen.getByText('Ana Lima')).toBeInTheDocument();
        expect(screen.getByText('Bob Silva')).toBeInTheDocument();
    });

    it('sem conversas recentes e sem nova conversa ativa mostra apenas o estado vazio padrão', () => {
        renderSidebar();
        // Não exibe usuários quando não há histórico e não clicou em Nova
        expect(screen.queryByRole('link', { name: /ana/i })).toBeNull();
    });
});
