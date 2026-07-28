import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ChatSidebar } from '../../components/chat/ChatSidebar';
import type { DolibarrUser, Project, AgendaEvent } from '../../types';
import type { DolibarrHookResult } from '../../hooks/dolibarr';

// NÃO mocka o react-router-dom: usamos o <MemoryRouter> e o <NavLink> reais
// para validar aria-current e navegação client-side (#1027).

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: () => ({
        config: { apiUrl: 'http://test/api/index.php', apiKey: 'key' },
        currentUser: { id: 'u1', login: 'tester' },
    }),
}));

vi.mock('../../hooks/dolibarr', () => ({
    useUsers: vi.fn(),
    useProjects: vi.fn(),
    useEvents: vi.fn(),
}));

import { useUsers, useProjects, useEvents } from '../../hooks/dolibarr';

const usersData: DolibarrUser[] = [
    { id: 'u2', login: 'ana', statut: '1', firstname: 'Ana', lastname: 'Lima', job: 'Dev' },
    { id: 'u3', login: 'bob', statut: '1', firstname: 'Bob', lastname: 'Silva', job: 'QA' },
];

const projectsData: Project[] = [
    { id: 'p1', ref: 'PRJ1', title: 'Projeto Um', socid: '0', statut: '1', progress: 0 },
];

const eventsData: AgendaEvent[] = [
    { id: 'ev1', ref: '', label: '', date_start: 0, date_end: 0, type_code: 'AC_CHAT', percentage: 0, elementtype: 'user', fk_user_author: 'u1', fk_element: 'u2' },
    { id: 'ev2', ref: '', label: '', date_start: 0, date_end: 0, type_code: 'AC_CHAT', percentage: 0, elementtype: 'user', fk_user_author: 'u1', fk_element: 'u3' },
    { id: 'ev3', ref: '', label: '', date_start: 0, date_end: 0, type_code: 'AC_CHAT', percentage: 0, elementtype: 'project', fk_element: 'p1' },
];

const renderSidebar = (
    initialEntry: string,
    onSelect: (type: 'user' | 'project' | 'topic', id: string, name: string) => void = vi.fn(),
) =>
    render(
        <MemoryRouter initialEntries={[initialEntry]}>
            <ChatSidebar onSelect={onSelect} />
        </MemoryRouter>
    );

describe('ChatSidebar — NavLink, aria-current e navegação client-side (#1027)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useUsers).mockReturnValue({ data: usersData } as unknown as DolibarrHookResult<DolibarrUser>);
        vi.mocked(useProjects).mockReturnValue({ data: projectsData } as unknown as DolibarrHookResult<Project>);
        vi.mocked(useEvents).mockReturnValue({ data: eventsData } as unknown as DolibarrHookResult<AgendaEvent>);
    });

    it('usuário ativo recebe aria-current="page" automaticamente via NavLink', () => {
        renderSidebar('/chat/user/u2');
        const anaLink = screen.getByRole('link', { name: /ana lima/i });
        expect(anaLink).toHaveAttribute('aria-current', 'page');
    });

    it('usuário inativo NÃO recebe aria-current', () => {
        renderSidebar('/chat/user/u2');
        expect(screen.getByRole('link', { name: /bob silva/i })).not.toHaveAttribute('aria-current');
    });

    it('projeto ativo recebe aria-current="page" automaticamente via NavLink', () => {
        renderSidebar('/chat/project/p1');
        expect(screen.getByRole('link', { name: /projeto um/i })).toHaveAttribute('aria-current', 'page');
    });

    it('itens são renderizados como <a> (NavLink) com href do router, não window.location', () => {
        renderSidebar('/chat/user/u2');
        const anaLink = screen.getByRole('link', { name: /ana lima/i });
        expect(anaLink.tagName).toBe('A');
        expect(anaLink).toHaveAttribute('href', '/chat/user/u2');
    });

    it('clicar em outro usuário navega client-side e alterna aria-current (sem reload)', async () => {
        const user = userEvent.setup();
        renderSidebar('/chat/user/u2');

        expect(screen.getByRole('link', { name: /ana lima/i })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('link', { name: /bob silva/i })).not.toHaveAttribute('aria-current');

        await user.click(screen.getByRole('link', { name: /bob silva/i }));

        // A navegação client-side troca o item ativo — prova que não há reload via window.location
        expect(screen.getByRole('link', { name: /bob silva/i })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('link', { name: /ana lima/i })).not.toHaveAttribute('aria-current');
    });

    it('clicar em um usuário dispara onSelect com tipo/id/nome corretos', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        renderSidebar('/chat', onSelect);

        await user.click(screen.getByRole('link', { name: /ana lima/i }));

        expect(onSelect).toHaveBeenCalledWith('user', 'u2', 'Ana');
    });

    it('clicar em um projeto dispara onSelect com tipo/id/nome corretos', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        renderSidebar('/chat', onSelect);

        await user.click(screen.getByRole('link', { name: /projeto um/i }));

        expect(onSelect).toHaveBeenCalledWith('project', 'p1', 'PRJ1');
    });
});
