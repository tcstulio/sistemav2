import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MyNotificationsView from '../../components/MyNotificationsView';
import type { AppNotification } from '../../types';

const mockSetNotifications = vi.fn();
const mockDoAction = vi.fn(() => Promise.resolve(true));

// Notificações de fixture
const personalNote: AppNotification = {
    id: 'n1',
    type: 'task',
    title: 'Tarefa atribuída',
    message: 'Você foi atribuído à tarefa X',
    date: 1000000,
    priority: 'medium',
    read: false,
    recipient: 'user1',
    scope: 'personal',
};

const systemNote: AppNotification = {
    id: 'n2',
    type: 'stock',
    title: 'Estoque baixo',
    message: 'Produto Y com estoque baixo',
    date: 999000,
    priority: 'high',
    read: false,
    scope: 'system',
};

const readNote: AppNotification = {
    id: 'n3',
    type: 'info',
    title: 'Informação lida',
    message: 'Já foi lida',
    date: 998000,
    priority: 'low',
    read: true,
    recipient: 'user1',
    scope: 'personal',
};

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: () => ({
        notifications: [personalNote, systemNote, readNote],
        setNotifications: mockSetNotifications,
        currentUser: { id: 'user1', login: 'user1', firstname: 'Test', lastname: 'User', statut: '1' },
    }),
}));

vi.mock('../../hooks/useNotifications', () => ({
    useNotificationActions: () => mockDoAction,
}));

const renderView = () =>
    render(
        <MemoryRouter>
            <MyNotificationsView onNavigate={vi.fn()} />
        </MemoryRouter>
    );

describe('MyNotificationsView (#531)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renderiza a página com abas Minhas e Sistema', () => {
        renderView();
        expect(screen.getByRole('button', { name: /Minhas/i })).toBeTruthy();
        expect(screen.getByRole('button', { name: /Sistema/i })).toBeTruthy();
    });

    it('aba Minhas mostra somente notificações pessoais (scope=personal)', () => {
        renderView();
        // Aba "Minhas" ativa por padrão
        expect(screen.getByText('Tarefa atribuída')).toBeTruthy();
        // Notificação de sistema não deve aparecer na aba Minhas
        expect(screen.queryByText('Estoque baixo')).toBeNull();
    });

    it('aba Sistema mostra somente notificações de sistema (scope=system)', () => {
        renderView();
        fireEvent.click(screen.getByRole('button', { name: /Sistema/i }));
        expect(screen.getByText('Estoque baixo')).toBeTruthy();
        expect(screen.queryByText('Tarefa atribuída')).toBeNull();
    });

    it('filtro Não-lidas mostra somente itens não lidos', () => {
        renderView();
        // Na aba Minhas há: n1 (unread) e n3 (read)
        fireEvent.click(screen.getByRole('button', { name: /Não-lidas/i }));
        expect(screen.getByText('Tarefa atribuída')).toBeTruthy();
        expect(screen.queryByText('Informação lida')).toBeNull();
    });

    it('filtro Lidas mostra somente itens lidos', () => {
        renderView();
        // Há múltiplos botões com "Lidas": o filtro e o header "Marcar todas como lidas"
        // Usar getAllByRole e pegar o que tem exatamente "Lidas" (o filtro)
        const lidasBtns = screen.getAllByRole('button', { name: /Lidas/i });
        const lidasFilter = lidasBtns.find(b => b.textContent?.trim() === 'Lidas');
        expect(lidasFilter).toBeTruthy();
        fireEvent.click(lidasFilter!);
        expect(screen.getByText('Informação lida')).toBeTruthy();
        expect(screen.queryByText('Tarefa atribuída')).toBeNull();
    });

    it('clicar em marcar como lida chama o hook e atualização otimista', async () => {
        renderView();
        // Botão de clock (marcar como lida) ao lado da notificação não-lida n1
        const markReadBtns = screen.getAllByLabelText('Marcar como lida');
        expect(markReadBtns.length).toBeGreaterThan(0);
        fireEvent.click(markReadBtns[0]);
        // Atualização otimista: setNotifications chamado
        await waitFor(() => expect(mockSetNotifications).toHaveBeenCalled());
        // Ação de API chamada com 'markRead'
        await waitFor(() => expect(mockDoAction).toHaveBeenCalledWith('markRead', 'n1'));
    });

    it('estado vazio exibe mensagem quando não há notificações no filtro', () => {
        renderView();
        // Vai para aba Sistema e filtra Lidas — não há nenhuma
        fireEvent.click(screen.getByRole('button', { name: /Sistema/i }));
        // Há múltiplos botões com "Lidas": filtrar pelo texto exato
        const lidasBtns = screen.getAllByRole('button', { name: /Lidas/i });
        const lidasFilter = lidasBtns.find(b => b.textContent?.trim() === 'Lidas');
        fireEvent.click(lidasFilter!);
        expect(screen.getByText(/Nenhuma notificação lida aqui/i)).toBeTruthy();
    });

    it('exibe rótulo de origem (ex.: Tarefa) em cada notificação', () => {
        renderView();
        // O badge de tipo "Tarefa" deve aparecer
        expect(screen.getByText('Tarefa')).toBeTruthy();
    });
});
