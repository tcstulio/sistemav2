import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({
        notifications: [],
        setNotifications: vi.fn(),
        currentUser: { id: 'u1', login: 'u1' },
    })),
}));

const { doActionMock } = vi.hoisted(() => ({
    doActionMock: vi.fn(),
}));

vi.mock('../../hooks/useNotifications', () => ({
    useNotificationActions: () => doActionMock,
}));

vi.mock('../../utils/dateUtils', () => ({
    formatTime: (d: number) => String(d),
}));

vi.mock('../../utils/notificationIcons', () => ({
    getNotificationIcon: () => null,
    NOTIFICATION_TYPE_LABELS: {},
}));

import MyNotificationsView from '../../components/MyNotificationsView';

describe('MyNotificationsView — markAllRead loading/disabled (#832)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('desabilita o botão e mostra "Marcando..." durante a ação', async () => {
        let resolveAction: (v: boolean) => void = () => {};
        doActionMock.mockReturnValueOnce(
            new Promise<boolean>((r) => { resolveAction = r; })
        );

        const user = userEvent.setup();
        render(<MyNotificationsView />);

        const btn = screen.getByRole('button', { name: /marcar todas como lidas/i });
        await user.click(btn);

        // Enquanto pendente: botão mostra "Marcando..." e fica desabilitado
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /marcando/i })).toBeDisabled();
        });
        expect(doActionMock).toHaveBeenCalledWith('markAllRead');

        // Ao resolver, volta ao estado normal
        resolveAction(true);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /marcar todas como lidas/i })).not.toBeDisabled();
        });
    });

    it('evita duplo-clique (não chama markAllRead duas vezes)', async () => {
        let resolveAction: (v: boolean) => void = () => {};
        doActionMock.mockReturnValue(
            new Promise<boolean>((r) => { resolveAction = r; })
        );

        const user = userEvent.setup();
        render(<MyNotificationsView />);

        const btn = screen.getByRole('button', { name: /marcar todas como lidas/i });
        await user.click(btn);
        // Segundo clique enquanto desabilitado não deve registrar nova chamada
        await user.click(btn);

        expect(doActionMock).toHaveBeenCalledTimes(1);
        resolveAction(true);
    });
});
