/**
 * Testes do Header — exibição do celular (phone_mobile) do usuário logado (#1003).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Header } from '../../components/Layout/Header';
import type { DolibarrConfig, DolibarrUser } from '../../types';

const baseConfig: DolibarrConfig = {
    apiUrl: 'http://test',
    apiKey: 'test-key',
    themeColor: 'indigo',
    darkMode: false,
};

const userWithMobile: DolibarrUser = {
    id: '7', login: 'tulio.silva', firstname: 'Tulio', lastname: 'Silva',
    email: 'tulio@x.com', job: 'Produtor', phone_mobile: '+55 11 99999-0000',
} as any;

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: () => ({
        config: baseConfig,
        notifications: [],
        isSyncing: false,
        currentUser: userWithMobile,
        logout: vi.fn(),
        previewTarget: null,
        setPreviewTarget: vi.fn(),
    }),
}));

vi.mock('../../components/HR/UserAvatar', () => ({
    UserAvatar: () => <div data-testid="user-avatar" />,
}));

describe('Header — exibe celular do usuário logado (#1003)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('mostra o phone_mobile no dropdown do usuário', () => {
        render(
            <MemoryRouter>
                <Header
                    setIsSidebarOpen={vi.fn()}
                    setIsNotificationPanelOpen={vi.fn()}
                    setIsSearchOpen={vi.fn()}
                />
            </MemoryRouter>
        );

        // Abre o dropdown clicando no botão que contém o avatar.
        const btn = screen.getByTestId('user-avatar').closest('button')!;
        fireEvent.click(btn);

        expect(screen.getByText('+55 11 99999-0000')).toBeTruthy();
    });
});
